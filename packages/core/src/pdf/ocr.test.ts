import { describe, expect, it, vi } from "vitest";
import {
  hasReadableText,
  pdfFingerprint,
  runOcrPages,
  validatePageRange,
  type OcrPage,
} from "./ocr";

function job(overrides: Partial<Parameters<typeof runOcrPages>[0]> = {}) {
  return {
    start: 2,
    end: 4,
    totalPages: 675,
    fingerprint: "a".repeat(64),
    language: "chi_sim+eng",
    signal: new AbortController().signal,
    readNativeText: vi.fn(async () => ""),
    readCached: vi.fn(async (): Promise<OcrPage | null> => null),
    recognize: vi.fn(async () => ({ text: "扫描图像中的文字", confidence: 95 })),
    save: vi.fn(async () => {}),
    onProgress: vi.fn(),
    ...overrides,
  };
}

describe("PDF OCR", () => {
  it("rejects invalid ranges before reading any pages", async () => {
    for (const range of [
      [0, 1],
      [3, 2],
      [1, 676],
      [1.5, 2],
      [NaN, 2],
    ]) {
      const options = job({ start: range[0], end: range[1] });
      await expect(runOcrPages(options)).rejects.toThrow("Invalid PDF page range");
      expect(options.recognize).not.toHaveBeenCalled();
    }
    expect(() => validatePageRange(1, 675, 675)).not.toThrow();
  });

  it("recognizes only the requested range and persists each page before advancing", async () => {
    const options = job();
    expect(await runOcrPages(options)).toMatchObject({ completed: 3, recognized: 3, total: 3 });
    expect(options.recognize.mock.calls).toEqual([[2], [3], [4]]);
    expect(options.save.mock.calls.map(([page]) => page.page)).toEqual([2, 3, 4]);
    expect(options.onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ completed: 3 }));
  });

  it("reuses cached pages and native text; page numbers alone still require OCR", async () => {
    const options = job({
      readNativeText: vi.fn(async (p) => (p === 2 ? "Readable text ".repeat(10) : "123")),
      readCached: vi.fn(async (p) =>
        p === 3
          ? {
              version: 1,
              fingerprint: "a".repeat(64),
              page: 3,
              language: "chi_sim+eng",
              text: "cached",
              confidence: 90,
            }
          : null,
      ),
    });
    expect(await runOcrPages(options)).toMatchObject({ recognized: 1, reused: 2 });
    expect(options.recognize.mock.calls).toEqual([[4]]);
    expect(hasReadableText("目录，。。 17")).toBe(false);
    expect(hasReadableText("中文文字".repeat(12))).toBe(true);
  });

  it("cancellation retains completed pages and does not save the interrupted page", async () => {
    const controller = new AbortController();
    const options = job({
      signal: controller.signal,
      recognize: vi.fn(async (p) => {
        if (p === 3) controller.abort();
        return { text: "recognized", confidence: 90 };
      }),
    });
    await expect(runOcrPages(options)).rejects.toThrow();
    expect(options.save).toHaveBeenCalledTimes(1);
    expect(options.save).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("propagates engine errors instead of reporting success or overwriting results", async () => {
    const options = job({
      recognize: vi.fn(async () => {
        throw new Error("OCR engine failed");
      }),
    });
    await expect(runOcrPages(options)).rejects.toThrow("OCR engine failed");
    expect(options.save).not.toHaveBeenCalled();
  });

  it("force mode reruns native pages, but an empty result never overwrites cache", async () => {
    const options = job({
      force: true,
      readNativeText: vi.fn(async () => "Native text".repeat(10)),
      recognize: vi.fn(async () => ({ text: " ", confidence: 0 })),
    });
    expect(await runOcrPages(options)).toMatchObject({ empty: 3, recognized: 0, reused: 0 });
    expect(options.save).not.toHaveBeenCalled();
  });

  it("keys results by PDF content, not filename or book title", async () => {
    const a = new TextEncoder().encode("PDF A");
    const b = new TextEncoder().encode("PDF B");
    expect(await pdfFingerprint(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(await pdfFingerprint(a)).toBe(await pdfFingerprint(a.slice()));
    expect(await pdfFingerprint(a)).not.toBe(await pdfFingerprint(b));
  });
});
