import { getPlatformService } from "../services";
import { type OcrPage, validateOcrPage } from "./ocr";

export const PDF_OCR_DIRECTORY = "pdf-ocr";

async function cachePath(
  fingerprint: string,
  page: number,
): Promise<{ dir: string; file: string }> {
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(page) || page < 1) {
    throw new Error("Invalid OCR cache key");
  }
  const platform = getPlatformService();
  const dir = await platform.joinPath(await platform.getDataDir(), PDF_OCR_DIRECTORY);
  return { dir, file: await platform.joinPath(dir, `${fingerprint}-${page}.json`) };
}

export async function readOcrPage(fingerprint: string, page: number): Promise<OcrPage | null> {
  const platform = getPlatformService();
  const { file } = await cachePath(fingerprint, page);
  if (!(await platform.exists(file))) return null;
  try {
    const value: unknown = JSON.parse(await platform.readTextFile(file));
    return validateOcrPage(value, fingerprint, page) ? value : null;
  } catch {
    // An interrupted write is recoverable by recognizing this page again.
    return null;
  }
}

export async function saveOcrPage(result: OcrPage): Promise<void> {
  if (!validateOcrPage(result, result.fingerprint, result.page))
    throw new Error("Invalid OCR result");
  const platform = getPlatformService();
  const { dir, file } = await cachePath(result.fingerprint, result.page);
  await platform.mkdir(dir);
  await platform.writeTextFile(file, JSON.stringify(result));
}
