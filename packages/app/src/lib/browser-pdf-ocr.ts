import * as pdfjs from "pdfjs-dist";
import { createWorker, type Worker } from "tesseract.js";

export function openBrowserOcrPdf(source: { data: Uint8Array } | { url: string }, assets: URL) {
  const pdfAssets = new URL("pdfjs-local/", assets);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.mjs", pdfAssets).href;
  return pdfjs.getDocument({
    ...source,
    isEvalSupported: false,
    useWorkerFetch: false,
    cMapUrl: new URL("cmaps/", pdfAssets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", pdfAssets).href,
    wasmUrl: new URL("wasm/", pdfAssets).href,
  });
}

export async function readBrowserPdfText(pdf: pdfjs.PDFDocumentProxy, number: number): Promise<string> {
  const page = await pdf.getPage(number);
  try {
    return (await page.getTextContent()).items.map(item =>
      "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
    ).join("").trim();
  } finally {
    page.cleanup();
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("OCR cancelled", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Render one page at a time and reuse the language model for the current job. */
export function createBrowserPdfRecognizer(assets: URL) {
  let worker: Worker | undefined;
  let currentLanguage: string | undefined;
  const close = async () => {
    const previous = worker;
    worker = undefined;
    currentLanguage = undefined;
    await previous?.terminate();
  };
  return {
    close,
    async recognize(pdf: pdfjs.PDFDocumentProxy, number: number, language: string, signal: AbortSignal) {
      if (signal.aborted) throw new DOMException("OCR cancelled", "AbortError");
      const stopWorker = () => { void close().catch(() => {}); };
      signal.addEventListener("abort", stopWorker, { once: true });
      try {
        if (!worker || currentLanguage !== language) {
          await close();
          const pending = createWorker(language, 1, {
            workerPath: new URL("ocr/worker.min.js", assets).href,
            corePath: new URL("ocr/core/", assets).href,
            langPath: new URL("ocr/lang/", assets).href,
            workerBlobURL: false,
          });
          void pending.then(created => {
            if (signal.aborted) return created.terminate();
          }).catch(() => {});
          worker = await abortable(pending, signal);
          currentLanguage = language;
        }
        const activeWorker = worker;
        const page = await abortable(pdf.getPage(number), signal);
        const canvas = document.createElement("canvas");
        try {
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(3, 3000 / Math.max(base.width, base.height)) });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Unable to create OCR canvas");
          const render = page.render({ canvas, canvasContext: context, viewport, background: "white" });
          const cancelRender = () => render.cancel();
          signal.addEventListener("abort", cancelRender, { once: true });
          try {
            await abortable(render.promise, signal);
            const { data } = await abortable(activeWorker.recognize(canvas), signal);
            return { text: data.text, confidence: data.confidence };
          } finally {
            signal.removeEventListener("abort", cancelRender);
          }
        } finally {
          canvas.width = canvas.height = 0;
          page.cleanup();
        }
      } finally {
        signal.removeEventListener("abort", stopWorker);
      }
    },
  };
}
