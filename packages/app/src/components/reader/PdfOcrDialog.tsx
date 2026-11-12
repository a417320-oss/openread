import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getRecognizedText, openOcrPdf, recognizePdf } from "@/lib/pdf-ocr";
import { validatePageRange, type OcrProgress } from "@readany/core/pdf/ocr";
import type { Book } from "@readany/core/types";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function PdfOcrDialog({
  book,
  currentPage,
  open,
  onOpenChange,
}: {
  book: Book;
  currentPage: number;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const { t } = useTranslation();
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [language, setLanguage] = useState("chi_sim+eng");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    setMessage("");
    setProgress(null);
    setTotal(0);
    openOcrPdf(book)
      .then(async ({ pdf }) => {
        if (alive) {
          setTotal(pdf.numPages);
          const first = Math.max(1, Math.min(currentPage || 1, pdf.numPages));
          setStart(first);
          setEnd(Math.min(first + 9, pdf.numPages));
        }
        await pdf.destroy();
      })
      .catch((err) => {
        if (alive) setError(String(err));
      });
    return () => {
      alive = false;
    };
  }, [open, book.id, book.filePath]);

  const run = async () => {
    setError("");
    setMessage("");
    try {
      validatePageRange(start, end, total);
    } catch {
      setError(t("ocr.invalidRange", { total }));
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const result = await recognizePdf(book, {
        start,
        end,
        language,
        force,
        signal: abort.signal,
        onProgress: setProgress,
      });
      setMessage(
        t("ocr.complete", {
          recognized: result.recognized,
          reused: result.reused,
          empty: result.empty,
        }),
      );
    } catch (err) {
      if (abort.signal.aborted) setMessage(t("ocr.cancelled"));
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };

  const exportText = async () => {
    setError("");
    try {
      validatePageRange(start, end, total);
      const text = await getRecognizedText(book, start, end);
      if (!text) {
        setError(t("ocr.noText"));
        return;
      }
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `OpenRead-OCR-${start}-${end}.txt`,
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (path) {
        const { writeTextFile } = await import("@tauri-apps/plugin-fs");
        await writeTextFile(path, text);
        setMessage(t("ocr.exported"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("ocr.title")}</DialogTitle>
          <DialogDescription>{t("ocr.description")}</DialogDescription>
        </DialogHeader>
        <p className="truncate text-sm font-medium">{book.meta.title}</p>
        <p className="text-sm text-muted-foreground">{t("ocr.pages", { total })}</p>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            {t("ocr.from")}
            <input
              aria-label={t("ocr.from")}
              type="number"
              min={1}
              max={total}
              value={start}
              disabled={busy || !total}
              onChange={(e) => setStart(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="text-sm">
            {t("ocr.to")}
            <input
              aria-label={t("ocr.to")}
              type="number"
              min={1}
              max={total}
              value={end}
              disabled={busy || !total}
              onChange={(e) => setEnd(Number(e.target.value))}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2"
            />
          </label>
        </div>
        <label className="text-sm">
          {t("ocr.language")}
          <select
            aria-label={t("ocr.language")}
            value={language}
            disabled={busy}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2"
          >
            <option value="chi_sim+eng">简体中文 + English</option>
            <option value="chi_tra+eng">繁體中文 + English</option>
            <option value="eng">English</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={force}
            disabled={busy}
            onChange={(e) => setForce(e.target.checked)}
          />
          {t("ocr.force")}
        </label>
        {progress && (
          <div role="status" aria-live="polite" className="space-y-2 text-sm">
            <p>
              {t("ocr.progress", {
                page: progress.page,
                completed: progress.completed,
                total: progress.total,
              })}
            </p>
            <progress
              aria-label={t("ocr.title")}
              max={progress.total}
              value={progress.completed}
              className="h-2 w-full"
            />
          </div>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive break-words">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("ocr.hint")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={exportText} disabled={busy || !total}>
            {t("ocr.export")}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={() => controller.current?.abort()}>
              {t("ocr.cancel")}
            </Button>
          ) : (
            <Button onClick={run} disabled={!total}>
              {t("ocr.start")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
