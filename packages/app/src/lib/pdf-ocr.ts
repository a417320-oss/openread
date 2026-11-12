import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import { fallbackContentService } from "@readany/core/ai/fallback-content-service";
import { pdfFingerprint, runOcrPages, type OcrProgress } from "@readany/core/pdf/ocr";
import { readOcrPage, saveOcrPage } from "@readany/core/pdf/ocr-cache";
import type { Book } from "@readany/core/types";
import { readFile } from "@tauri-apps/plugin-fs";
import * as pdfjs from "pdfjs-dist";
import { createWorker, type Worker } from "tesseract.js";

pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs-local/pdf.worker.mjs";
const activeBooks = new Set<string>();

export async function openOcrPdf(book: Book) {
  const bytes = await readFile(await resolveDesktopDataPath(book.filePath));
  const fingerprint = await pdfFingerprint(bytes);
  const pdf = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useWorkerFetch: false,
    cMapUrl: "/vendor/pdfjs-local/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/pdfjs-local/standard_fonts/",
    wasmUrl: "/vendor/pdfjs-local/wasm/",
  }).promise;
  return { pdf, fingerprint };
}

/** Reject immediately on cancellation even if a worker stops without settling its current job. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export async function recognizePdf(
  book: Book,
  options: {
    start: number;
    end: number;
    language: string;
    force: boolean;
    signal: AbortSignal;
    onProgress(progress: OcrProgress): void;
  },
): Promise<OcrProgress> {
  if (activeBooks.has(book.id)) throw new Error("This PDF already has a running OCR task.");
  activeBooks.add(book.id);
  let worker: Worker | undefined;
  let pdf: pdfjs.PDFDocumentProxy | undefined;
  const stopWorker = () => {
    if (worker) void worker.terminate();
  };
  options.signal.addEventListener("abort", stopWorker, { once: true });
  try {
    const opened = await openOcrPdf(book);
    pdf = opened.pdf;
    const document = pdf;
    const { fingerprint } = opened;
    return await runOcrPages({
      ...options,
      fingerprint,
      totalPages: pdf.numPages,
      readCached: (page) => readOcrPage(fingerprint, page),
      readNativeText: async (number) => {
        const page = await document.getPage(number);
        try {
          return (await page.getTextContent()).items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ");
        } finally {
          page.cleanup();
        }
      },
      recognize: async (number) => {
        if (!worker) {
          // Every asset is bundled. Neither PDF images nor recognized text leave this device.
          const pendingWorker = createWorker(options.language, 1, {
            workerPath: new URL("/vendor/ocr/worker.min.js", location.href).href,
            corePath: new URL("/vendor/ocr/core/", location.href).href,
            langPath: new URL("/vendor/ocr/lang/", location.href).href,
            workerBlobURL: false,
          });
          void pendingWorker.then(
            (created) => {
              if (options.signal.aborted) void created.terminate();
            },
            () => {},
          );
          worker = await abortable(pendingWorker, options.signal);
        }
        const page = await document.getPage(number);
        const base = page.getViewport({ scale: 1 });
        // Keep large scans within bounded canvas memory (at most ~9 megapixels).
        const scale = Math.min(3, 3000 / Math.max(base.width, base.height));
        const viewport = page.getViewport({ scale });
        const canvas = globalThis.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to create OCR canvas");
        const task = page.render({ canvas, canvasContext: context, viewport, background: "white" });
        const cancelRender = () => task.cancel();
        options.signal.addEventListener("abort", cancelRender, { once: true });
        try {
          await abortable(task.promise, options.signal);
          const result = await abortable(worker.recognize(canvas), options.signal);
          return { text: result.data.text, confidence: result.data.confidence };
        } finally {
          options.signal.removeEventListener("abort", cancelRender);
          canvas.width = canvas.height = 0;
          page.cleanup();
        }
      },
      save: async (result) => {
        await saveOcrPage(result);
        fallbackContentService.clear(book.id);
      },
    });
  } finally {
    options.signal.removeEventListener("abort", stopWorker);
    try {
      if (worker) await worker.terminate();
    } finally {
      if (pdf) await pdf.destroy();
      activeBooks.delete(book.id);
    }
  }
}

export async function getRecognizedText(book: Book, start: number, end: number): Promise<string> {
  const { pdf, fingerprint } = await openOcrPdf(book);
  try {
    const { validatePageRange } = await import("@readany/core/pdf/ocr");
    validatePageRange(start, end, pdf.numPages);
    const pages: string[] = [];
    for (let number = start; number <= end; number++) {
      const cached = await readOcrPage(fingerprint, number);
      let text = cached?.text;
      if (!text) {
        const page = await pdf.getPage(number);
        text = (await page.getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        page.cleanup();
      }
      if (text.trim()) pages.push(`[PDF ${number}]\n${text.trim()}`);
    }
    return pages.join("\n\n");
  } finally {
    await pdf.destroy();
  }
}
