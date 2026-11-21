import { Directory } from "expo-file-system";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveOcrEpubToFolder } from "./save-ocr-epub";

vi.mock("expo-file-system", () => ({
  Directory: { pickDirectoryAsync: vi.fn() },
}));

describe("Android EPUB folder export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes the complete EPUB to the selected folder with its original name and MIME type", async () => {
    const bytes = Uint8Array.of(80, 75, 3, 4);
    const write = vi.fn();
    const createFile = vi.fn(() => ({ write }));
    vi.mocked(Directory.pickDirectoryAsync).mockResolvedValue({ createFile } as unknown as Directory);
    const file = { name: "OpenRead-OCR-1-8.epub", bytes: async () => bytes };

    await expect(saveOcrEpubToFolder(file)).resolves.toBe(true);
    expect(createFile).toHaveBeenCalledWith(file.name, "application/epub+zip");
    expect(write).toHaveBeenCalledWith(bytes);
  });

  it("keeps the generated EPUB when the folder picker is cancelled", async () => {
    vi.mocked(Directory.pickDirectoryAsync).mockRejectedValue({ code: "ERR_PICKER_CANCELLED" });
    const bytes = vi.fn();
    await expect(saveOcrEpubToFolder({ name: "OpenRead.epub", bytes })).resolves.toBe(false);
    expect(bytes).not.toHaveBeenCalled();
  });

  it("reports a folder picker failure so the reader can still share the file", async () => {
    const error = new Error("Storage provider is unavailable");
    vi.mocked(Directory.pickDirectoryAsync).mockRejectedValue(error);
    await expect(saveOcrEpubToFolder({ name: "OpenRead.epub", bytes: vi.fn() })).rejects.toThrow(error);
  });
});
