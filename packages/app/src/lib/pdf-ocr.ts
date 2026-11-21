import { fallbackContentService } from "@readany/core/ai/fallback-content-service";
import { readOcrPage, saveOcrPage } from "@readany/core/pdf/ocr-cache";
import { collectPdfTextPages } from "@readany/core/pdf/ocr-epub";
import { pdfFingerprint, runOcrPages, type OcrProgress } from "@readany/core/pdf/ocr";
import type { Book } from "@readany/core/types";
import { readFile } from "@tauri-apps/plugin-fs";
import { resolveDesktopDataPath } from "@/lib/storage/desktop-library-root";
import { createBrowserPdfRecognizer, openBrowserOcrPdf, readBrowserPdfText } from "./browser-pdf-ocr";

const activeBooks = new Set<string>();
const assetBase = () => new URL("/vendor/", location.href);

export async function openOcrPdf(book: Book) {
  const bytes = await readFile(await resolveDesktopDataPath(book.filePath));
  const fingerprint = await pdfFingerprint(bytes);
  const task = openBrowserOcrPdf({ data: bytes }, assetBase());
  try {
    return { pdf: await task.promise, fingerprint };
  } catch (error) {
    await task.destroy().catch(() => {});
    throw error;
  }
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
  const recognizer = createBrowserPdfRecognizer(assetBase());
  try {
    const { pdf, fingerprint } = await openOcrPdf(book);
    try {
      return await runOcrPages({
        ...options,
        fingerprint,
        totalPages: pdf.numPages,
        readCached: page => readOcrPage(fingerprint, page),
        readNativeText: page => readBrowserPdfText(pdf, page),
        recognize: page => recognizer.recognize(pdf, page, options.language, options.signal),
        save: async result => {
          await saveOcrPage(result);
          fallbackContentService.clear(book.id);
        },
      });
    } finally {
      await pdf.destroy();
    }
  } finally {
    activeBooks.delete(book.id);
    await recognizer.close();
  }
}

export async function getRecognizedPages(book: Book, start: number, end: number) {
  const { pdf, fingerprint } = await openOcrPdf(book);
  try {
    return {
      fingerprint,
      pages: await collectPdfTextPages({
        start,
        end,
        total: pdf.numPages,
        readOcr: async page => (await readOcrPage(fingerprint, page))?.text,
        readNative: page => readBrowserPdfText(pdf, page),
      }),
    };
  } finally {
    await pdf.destroy();
  }
}
