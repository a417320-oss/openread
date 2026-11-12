import { beforeEach, describe, expect, it } from "vitest";
import { setPlatformService, type IPlatformService } from "../services";
import { readOcrPage, saveOcrPage } from "./ocr-cache";
import type { OcrPage } from "./ocr";

describe("persistent OCR cache", () => {
  const files = new Map<string, string>();
  const result: OcrPage = {
    version: 1,
    fingerprint: "a".repeat(64),
    page: 7,
    language: "eng",
    text: "saved text",
    confidence: 97,
  };
  const key = `/library/pdf-ocr/${result.fingerprint}-7.json`;
  const platform = {
    getDataDir: async () => "/library",
    joinPath: async (...parts: string[]) => parts.join("/"),
    exists: async (file: string) => files.has(file),
    mkdir: async () => {},
    readTextFile: async (file: string) => files.get(file)!,
    writeTextFile: async (file: string, data: string) => {
      files.set(file, data);
    },
  } as unknown as IPlatformService;
  beforeEach(() => {
    files.clear();
    setPlatformService(platform);
  });

  it("persists through a platform reinitialization and isolates PDFs and pages", async () => {
    await saveOcrPage(result);
    setPlatformService({ ...platform });
    expect(await readOcrPage(result.fingerprint, 7)).toEqual(result);
    expect(await readOcrPage("b".repeat(64), 7)).toBeNull();
    expect(await readOcrPage(result.fingerprint, 8)).toBeNull();
  });

  it("recovers from truncated or mismatched cache records", async () => {
    for (const value of [
      "{broken",
      JSON.stringify({ ...result, version: 2 }),
      JSON.stringify({ ...result, fingerprint: "b".repeat(64) }),
      JSON.stringify({ ...result, page: 8 }),
      JSON.stringify({ ...result, confidence: null }),
    ]) {
      files.set(key, value);
      expect(await readOcrPage(result.fingerprint, 7)).toBeNull();
    }
  });

  it("refuses path traversal and invalid page numbers", async () => {
    await expect(readOcrPage("../../settings", 1)).rejects.toThrow("Invalid OCR cache key");
    await expect(readOcrPage(result.fingerprint, -1)).rejects.toThrow("Invalid OCR cache key");
    await expect(saveOcrPage({ ...result, confidence: NaN })).rejects.toThrow("Invalid OCR result");
    expect(files.size).toBe(0);
  });
});
