/** Local PDF OCR jobs. Page numbers are 1-based PDF pages, never printed page labels. */
export interface OcrPage {
  version: 1;
  fingerprint: string;
  page: number;
  language: string;
  text: string;
  confidence: number;
}

export interface OcrProgress {
  page: number;
  completed: number;
  total: number;
  recognized: number;
  reused: number;
  empty: number;
}

export function validatePageRange(start: number, end: number, total: number): void {
  if (![start, end, total].every(Number.isSafeInteger) || start < 1 || end < start || end > total) {
    throw new Error(`Invalid PDF page range: ${start}-${end} (1-${total})`);
  }
}

export function hasReadableText(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= 40;
}

export async function pdfFingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateOcrPage(
  value: unknown,
  fingerprint: string,
  page: number,
): value is OcrPage {
  if (!value || typeof value !== "object") return false;
  const item = value as OcrPage;
  return (
    item.version === 1 &&
    item.fingerprint === fingerprint &&
    item.page === page &&
    typeof item.language === "string" &&
    typeof item.text === "string" &&
    Number.isFinite(item.confidence) &&
    item.confidence >= 0 &&
    item.confidence <= 100
  );
}

export async function runOcrPages(options: {
  start: number;
  end: number;
  totalPages: number;
  fingerprint: string;
  language: string;
  force?: boolean;
  signal: AbortSignal;
  readNativeText(page: number): Promise<string>;
  readCached(page: number): Promise<OcrPage | null>;
  recognize(page: number): Promise<{ text: string; confidence: number }>;
  save(result: OcrPage): Promise<void>;
  onProgress(progress: OcrProgress): void;
}): Promise<OcrProgress> {
  const { start, end, signal } = options;
  validatePageRange(start, end, options.totalPages);
  const progress: OcrProgress = {
    page: start,
    completed: 0,
    total: end - start + 1,
    recognized: 0,
    reused: 0,
    empty: 0,
  };
  for (let page = start; page <= end; page++) {
    signal.throwIfAborted();
    progress.page = page;
    options.onProgress({ ...progress });
    const cached = await options.readCached(page);
    const native = await options.readNativeText(page);
    signal.throwIfAborted();
    if (
      !options.force &&
      ((cached?.text.trim() && cached.language === options.language) || hasReadableText(native))
    ) {
      progress.reused++;
    } else {
      const result = await options.recognize(page);
      signal.throwIfAborted();
      const text = result.text.trim();
      // A blank/failed re-recognition must not destroy a previously useful page.
      if (text) {
        await options.save({
          version: 1,
          fingerprint: options.fingerprint,
          page,
          language: options.language,
          text,
          confidence: result.confidence,
        });
        progress.recognized++;
      } else {
        progress.empty++;
      }
    }
    progress.completed++;
    options.onProgress({ ...progress });
  }
  return progress;
}
