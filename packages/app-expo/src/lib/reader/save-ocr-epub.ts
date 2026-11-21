import { OCR_EPUB_MIME } from "@readany/core/pdf/ocr-epub";
import { Directory, type File } from "expo-file-system";

/** Copy the generated file to an Android folder the reader chooses in the system picker. */
export async function saveOcrEpubToFolder(file: Pick<File, "name" | "bytes">): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "ERR_PICKER_CANCELLED") return false;
    throw error;
  }
  const bytes = await file.bytes();
  folder.createFile(file.name, OCR_EPUB_MIME).write(bytes);
  return true;
}
