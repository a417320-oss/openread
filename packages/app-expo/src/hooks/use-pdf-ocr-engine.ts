import type {
  OcrMessage,
  OcrOperation,
  RecognitionResult,
} from "@/lib/reader/ocr-protocol";
import { useCallback, useEffect, useRef } from "react";
import type { WebView, WebViewMessageEvent } from "react-native-webview";

interface PendingRequest {
  id: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export function usePdfOcrEngine() {
  const webView = useRef<WebView>(null);
  const pending = useRef<PendingRequest | null>(null);
  const nextId = useRef(0);

  const finish = useCallback((error: Error | null, value?: unknown) => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    clearTimeout(request.timeout);
    if (error) request.reject(error);
    else request.resolve(value);
  }, []);

  useEffect(() => () => finish(new Error("OCR engine closed")), [finish]);

  const send = <T,>(operation: OcrOperation) => new Promise<T>((resolve, reject) => {
    if (!webView.current || pending.current) {
      reject(new Error("OCR engine is unavailable or busy"));
      return;
    }
    const id = ++nextId.current;
    pending.current = {
      id,
      resolve: value => resolve(value as T),
      reject,
      timeout: setTimeout(() => finish(new Error("OCR engine timed out")), 180_000),
    };
    webView.current.injectJavaScript(`window.dispatchOcr(${JSON.stringify({ ...operation, id })}); true;`);
  });

  const handleMessage = (event: WebViewMessageEvent, onReady: () => void) => {
    let message: OcrMessage;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.kind === "ready") onReady();
    else if (message?.id === pending.current?.id) {
      if (message?.kind === "error") finish(new Error(message.error));
      if (message?.kind === "result") finish(null, message.value);
    }
  };

  return {
    webView,
    handleMessage,
    fail: (error: Error) => finish(error),
    open: (url: string) => send<number>({ kind: "open", url }),
    readText: (page: number) => send<string>({ kind: "text", page }),
    recognize: (page: number, language: string) =>
      send<RecognitionResult>({ kind: "recognize", page, language }),
    release: () => send<null>({ kind: "release" }),
    cancel: () => webView.current?.injectJavaScript('window.dispatchOcr({kind:"cancel"}); true;'),
  };
}
