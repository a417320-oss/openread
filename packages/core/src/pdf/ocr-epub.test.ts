import { DOMParser } from "@xmldom/xmldom";
import { Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import { describe, expect, it, vi } from "vitest";
import { buildStoreOnlyZip, readStoreOnlyZip } from "../utils/store-only-zip";
import { OCR_EPUB_MIME, buildPdfOcrEpub, collectPdfTextPages } from "./ocr-epub";

describe("PDF OCR export", () => {
  it("uses recognized text, falls back to the PDF text layer and omits blank pages", async () => {
    const native = vi.fn(async (page: number) => page === 6 ? "Existing text" : "");
    await expect(collectPdfTextPages({
      start: 4, end: 6, total: 10,
      readOcr: async page => page === 4 ? "  扫描文字 " : undefined,
      readNative: native,
    })).resolves.toEqual([
      { page: 4, text: "扫描文字" },
      { page: 6, text: "Existing text" },
    ]);
    expect(native.mock.calls).toEqual([[5], [6]]);
  });

  it("validates page ranges before reading pages", async () => {
    const read = vi.fn();
    await expect(collectPdfTextPages({
      start: 3, end: 5, total: 4, readOcr: read, readNative: read,
    })).rejects.toThrow("Invalid PDF page range");
    expect(read).not.toHaveBeenCalled();
  });

  const book = {
    title: "扫描 & 文字",
    author: "Example <Author>",
    language: "zh-Hans",
    identifier: "urn:openread:test",
    pageTitle: (page: number) => `PDF 第 ${page} 页`,
    contentsTitle: "目录",
  };

  it("writes an EPUB with Unicode text, metadata, and a linked table of contents", async () => {
    const bytes = buildPdfOcrEpub({
      ...book,
      pages: [
        { page: 5, text: "第一段：3 < 5 & 6\n\n第二段\u0000" },
        { page: 9, text: "Last page" },
      ],
    });
    const reader = new ZipReader(new Uint8ArrayReader(bytes));
    try {
      const entries = await reader.getEntries();
      expect(entries[0]).toMatchObject({ filename: "mimetype", compressionMethod: 0 });
      expect(new TextDecoder().decode(bytes.subarray(38, 58))).toBe(OCR_EPUB_MIME);
      const documents = new Map([...readStoreOnlyZip(bytes)].map(({ name, data }) =>
        [name, new TextDecoder().decode(data)],
      ));
      const parse = (name: string) => new DOMParser({
        errorHandler: { error: message => { throw new Error(message); } },
      }).parseFromString(documents.get(name)!, "application/xml");
      const container = parse("META-INF/container.xml");
      expect(container.getElementsByTagName("rootfile")[0].getAttribute("full-path")).toBe("EPUB/content.opf");
      const opf = parse("EPUB/content.opf");
      expect(opf.getElementsByTagName("dc:title")[0].textContent).toBe(book.title);
      expect(opf.getElementsByTagName("dc:creator")[0].textContent).toBe(book.author);
      expect(Array.from(opf.getElementsByTagName("itemref"), item => item.getAttribute("idref"))).toEqual(["p1", "p2"]);
      const nav = parse("EPUB/nav.xhtml");
      const links = Array.from(nav.getElementsByTagName("a"));
      expect(links.map(link => link.textContent)).toEqual(["PDF 第 5 页", "PDF 第 9 页"]);
      expect(links.map(link => link.getAttribute("href"))).toEqual(["p1.xhtml", "p2.xhtml"]);
      const paragraphs = parse("EPUB/p1.xhtml").getElementsByTagName("p");
      expect(Array.from(paragraphs, p => p.textContent)).toEqual(["第一段：3 < 5 & 6", "第二段"]);
    } finally {
      await reader.close();
    }
  });

  it("rejects an export containing only whitespace and invalid XML characters", () => {
    expect(() => buildPdfOcrEpub({ ...book, pages: [{ page: 1, text: " \u0000" }] })).toThrow("No text");
  });
});

it("rejects damaged packed offline assets", () => {
  const zip = buildStoreOnlyZip([{ name: "worker.js", data: new Uint8Array([1, 2]) }]);
  expect([...readStoreOnlyZip(zip)][0].data).toEqual(new Uint8Array([1, 2]));
  zip[39] = 4;
  expect(() => [...readStoreOnlyZip(zip)]).toThrow("checksum");
  expect(() => [...readStoreOnlyZip(zip.subarray(0, -1))]).toThrow("trailer");
});
