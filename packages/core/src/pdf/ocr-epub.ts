import { buildStoreOnlyZip, type ZipEntry } from "../utils/store-only-zip";
import { validatePageRange } from "./ocr";

export const OCR_EPUB_MIME = "application/epub+zip";

export function pdfOcrLanguageTag(language: string): string {
  if (language === "eng") return "en";
  return language.startsWith("chi_tra") ? "zh-Hant" : "zh-Hans";
}

export interface PdfTextPage {
  page: number;
  text: string;
}

/** Prefer saved OCR, with the source text layer as a fallback for mixed PDFs. */
export async function collectPdfTextPages(options: {
  start: number;
  end: number;
  total: number;
  readOcr(page: number): Promise<string | undefined>;
  readNative(page: number): Promise<string>;
}): Promise<PdfTextPage[]> {
  validatePageRange(options.start, options.end, options.total);
  const pages: PdfTextPage[] = [];
  for (let page = options.start; page <= options.end; page++) {
    const cached = (await options.readOcr(page))?.trim();
    const text = cached || (await options.readNative(page)).trim();
    if (text) pages.push({ page, text });
  }
  return pages;
}

function xml(text: string): string {
  // PDF encodings and OCR can yield control characters or isolated surrogates.
  return text
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildPdfOcrEpub(options: {
  title: string;
  author?: string;
  language: string;
  identifier: string;
  pages: PdfTextPage[];
  pageTitle(page: number): string;
  contentsTitle: string;
}): Uint8Array {
  const pages = options.pages.filter(({ text }) => xml(text).trim());
  if (!pages.length) throw new Error("No text to export");
  const title = xml(options.title.trim()) || "OpenRead OCR";
  const author = xml(options.author?.trim() ?? "");
  const language = xml(options.language);
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];
  const add = (name: string, content: string) => entries.push({ name, data: encoder.encode(content) });
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  const xhtml = (heading: string, body: string) => `${declaration}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
<head><title>${heading}</title></head><body>${body}</body></html>`;
  const chapters = pages.map(({ page, text }, index) => ({
    id: `p${index + 1}`,
    title: xml(options.pageTitle(page)),
    body: text.split(/\r\n|\n|\r/).map(line => xml(line).trim()).filter(Boolean)
      .map(line => `<p>${line}</p>`).join("\n"),
  }));

  add("mimetype", OCR_EPUB_MIME);
  add("META-INF/container.xml", `${declaration}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  add("EPUB/content.opf", `${declaration}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${xml(options.identifier)}</dc:identifier>
<dc:title>${title}</dc:title><dc:language>${language}</dc:language>
${author ? `<dc:creator>${author}</dc:creator>` : ""}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>
</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${chapters.map(({ id }) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest><spine>${chapters.map(({ id }) => `<itemref idref="${id}"/>`).join("")}</spine></package>`);
  const contents = xml(options.contentsTitle);
  add("EPUB/nav.xhtml", xhtml(contents, `<nav epub:type="toc"><h1>${contents}</h1><ol>
${chapters.map(chapter => `<li><a href="${chapter.id}.xhtml">${chapter.title}</a></li>`).join("\n")}
</ol></nav>`));
  for (const chapter of chapters) {
    add(`EPUB/${chapter.id}.xhtml`, xhtml(chapter.title, `<h1>${chapter.title}</h1>\n${chapter.body}`));
  }
  return buildStoreOnlyZip(entries);
}
