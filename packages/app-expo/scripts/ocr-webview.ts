import {
  createBrowserPdfRecognizer,
  openBrowserOcrPdf,
  readBrowserPdfText,
} from "../../app/src/lib/browser-pdf-ocr";
import type { OcrCommand, OcrMessage } from "../src/lib/reader/ocr-protocol";

const native = window as Window & {
  ReactNativeWebView?: { postMessage(message: string): void };
  dispatchOcr?(command: OcrCommand): void;
};
const assets = new URL("./", location.href);
const recognizer = createBrowserPdfRecognizer(assets);
let task: ReturnType<typeof openBrowserOcrPdf> | undefined;
let active: AbortController | undefined;
const post = (message: OcrMessage) => native.ReactNativeWebView?.postMessage(JSON.stringify(message));

async function execute(command: Exclude<OcrCommand, { kind: "cancel" }>, signal: AbortSignal) {
  if (command.kind === "open") {
    const url = new URL(command.url);
    if (url.origin !== location.origin) throw new Error("OCR requires a local PDF");
    await task?.destroy();
    task = openBrowserOcrPdf({ url: url.href }, assets);
    return (await task.promise).numPages;
  }
  if (command.kind === "release") {
    await recognizer.close();
    return null;
  }
  if (!task) throw new Error("PDF has not been opened");
  const pdf = await task.promise;
  if (command.kind === "text") return readBrowserPdfText(pdf, command.page);
  return recognizer.recognize(pdf, command.page, command.language, signal);
}

native.dispatchOcr = command => {
  if (command.kind === "cancel") {
    active?.abort();
    return;
  }
  if (active) {
    post({ kind: "error", id: command.id, error: "OCR engine is busy" });
    return;
  }
  const controller = new AbortController();
  active = controller;
  void execute(command, controller.signal).then(
    value => {
      active = undefined;
      post({ kind: "result", id: command.id, value });
    },
    error => {
      active = undefined;
      post({ kind: "error", id: command.id, error: String(error) });
    },
  );
};
window.addEventListener("pagehide", () => {
  active?.abort();
  void recognizer.close().catch(() => {});
  void task?.destroy().catch(() => {});
});
post({ kind: "ready" });
