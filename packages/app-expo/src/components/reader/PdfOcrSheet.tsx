import { usePdfOcrEngine } from "@/hooks/use-pdf-ocr-engine";
import { prepareOcrRuntime } from "@/lib/reader/ocr-runtime";
import { useColors } from "@/styles/theme";
import { readOcrPage, saveOcrPage } from "@readany/core/pdf/ocr-cache";
import {
  OCR_EPUB_MIME,
  buildPdfOcrEpub,
  collectPdfTextPages,
  pdfOcrLanguageTag,
} from "@readany/core/pdf/ocr-epub";
import { type OcrProgress, runOcrPages, validatePageRange } from "@readany/core/pdf/ocr";
import type { Book } from "@readany/core/types";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const languages = [
  { id: "chi_sim+eng", label: "简体中文 + English" },
  { id: "chi_tra+eng", label: "繁體中文 + English" },
  { id: "eng", label: "English" },
];

export function PdfOcrSheet({
  book, currentPage, serverUrl, onClose,
}: {
  book: Book;
  currentPage: number;
  serverUrl: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const engine = usePdfOcrEngine();
  const [runtimeUrl, setRuntimeUrl] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [total, setTotal] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [language, setLanguage] = useState(languages[0].id);
  const [force, setForce] = useState(false);
  const [job, setJob] = useState<"ocr" | "export" | null>(null);
  const [progress, setProgress] = useState<OcrProgress>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const initializing = useRef(false);
  const working = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);

  const bookPath = book.filePath;
  useEffect(() => {
    let active = true;
    void prepareOcrRuntime().then(
      path => { if (active) setRuntimeUrl(`${serverUrl}/${path}/index.html`); },
      err => { if (active) setError(String(err)); },
    );
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [serverUrl]);

  useEffect(() => {
    if (!runtimeUrl || total || unavailable) return;
    const timeout = setTimeout(() => {
      setUnavailable(true);
      setError(t("ocr.engineFailed"));
    }, 60_000);
    return () => clearTimeout(timeout);
  }, [runtimeUrl, total, unavailable, t]);

  const loadPdf = async () => {
    if (initializing.current) return;
    initializing.current = true;
    try {
      const parts = bookPath.split("/");
      const file = new File(Paths.document, ...parts);
      if (!file.exists) throw new Error(t("ocr.pdfMissing"));
      const identity = await digestStringAsync(CryptoDigestAlgorithm.SHA256,
        JSON.stringify([book.id, book.fileHash, bookPath, file.size, file.modificationTime]));
      const pages = await engine.open(`${serverUrl}/${parts.map(encodeURIComponent).join("/")}`);
      const page = Math.max(1, Math.min(currentPage || 1, pages));
      setStart(String(page));
      setEnd(String(Math.min(page + 9, pages)));
      setFingerprint(identity);
      setTotal(pages);
    } catch (err) {
      setUnavailable(true);
      setError(String(err));
    }
  };
  const engineFailed = () => {
    const error = t("ocr.engineFailed");
    setUnavailable(true);
    setError(error);
    engine.fail(new Error(error));
  };

  const run = async (type: "ocr" | "export") => {
    if (working.current || unavailable || !total) return;
    setMessage("");
    setError("");
    const first = Number(start);
    const last = Number(end);
    try {
      validatePageRange(first, last, total);
    } catch {
      setError(t("ocr.invalidRange", { total }));
      return;
    }

    working.current = true;
    setJob(type);
    setProgress(undefined);
    const readCached = (page: number) => readOcrPage(fingerprint, page);
    const abort = new AbortController();
    try {
      if (type === "ocr") {
        controller.current = abort;
        const result = await runOcrPages({
          start: first, end: last, totalPages: total, fingerprint, language, force,
          signal: abort.signal,
          readNativeText: engine.readText,
          readCached,
          recognize: page => engine.recognize(page, language),
          save: saveOcrPage,
          onProgress: setProgress,
        });
        setMessage(t("ocr.mobileComplete", { ...result }));
      } else {
        const pages = await collectPdfTextPages({
          start: first, end: last, total,
          readOcr: async page => (await readCached(page))?.text,
          readNative: engine.readText,
        });
        if (!pages.length) {
          setError(t("ocr.noText"));
          return;
        }

        const directory = new Directory(Paths.document, "ocr-exports");
        directory.create({ intermediates: true, idempotent: true });
        const file = new File(directory, `OpenRead-OCR-${first}-${last}-${fingerprint.slice(0, 8)}.epub`);
        file.write(buildPdfOcrEpub({
          title: book.meta.title,
          author: book.meta.author,
          language: pdfOcrLanguageTag(language),
          identifier: `urn:openread:ocr:${fingerprint}:${first}-${last}`,
          pages,
          pageTitle: page => t("ocr.epubPage", { page }),
          contentsTitle: t("reader.toc", "Contents"),
        }));
        setMessage(t("ocr.mobileExported", { name: file.name }));
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, { mimeType: OCR_EPUB_MIME, UTI: "org.idpf.epub-container" });
        }
      }
    } catch (err) {
      if (abort.signal.aborted) setMessage(t("ocr.cancelled"));
      else setError(String(err));
    } finally {
      if (type === "ocr") await engine.release().catch(() => {});
      controller.current = undefined;
      working.current = false;
      setJob(null);
    }
  };

  const cancel = () => {
    controller.current?.abort();
    engine.cancel();
  };
  const close = () => { if (!working.current) onClose(); };
  const disabled = !total || unavailable || job !== null;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        {runtimeUrl && !unavailable && (
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={styles.engine}>
            <WebView
              ref={engine.webView}
              source={{ uri: runtimeUrl }}
              originWhitelist={[serverUrl]}
              onShouldStartLoadWithRequest={({ url }) => url === runtimeUrl || url === "about:blank"}
              onMessage={event => engine.handleMessage(event, () => { void loadPdf(); })}
              onError={engineFailed}
              onHttpError={event => { if (event.nativeEvent.url === runtimeUrl) engineFailed(); }}
              onRenderProcessGone={engineFailed}
              onContentProcessDidTerminate={engineFailed}
            />
          </View>
        )}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={[styles.heading, { color: colors.foreground }]}>{t("ocr.title")}</Text>
            <Pressable accessibilityRole="button" onPress={close} disabled={job !== null}>
              <Text style={{ color: colors.mutedForeground }}>{t("common.close", "Close")}</Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.mutedForeground }}>{t("ocr.mobileDescription")}</Text>
          {!total && !error && <ActivityIndicator color={colors.primary} />}
          {total > 0 && (
            <>
              <Text style={{ color: colors.mutedForeground }}>{t("ocr.pages", { total })}</Text>
              <View style={styles.row}>
                {[
                  { label: t("ocr.from"), value: start, change: setStart },
                  { label: t("ocr.to"), value: end, change: setEnd },
                ].map(({ label, value, change }) => (
                  <View style={styles.range} key={label}>
                    <Text style={{ color: colors.foreground }}>{label}</Text>
                    <TextInput accessibilityLabel={label} value={value} onChangeText={change}
                      editable={!disabled} keyboardType="number-pad" selectTextOnFocus
                      style={[styles.control, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                ))}
              </View>
              <Text style={{ color: colors.foreground }}>{t("ocr.language")}</Text>
              <View style={styles.row}>
                {languages.map(({ id, label }) => (
                  <Pressable key={id} accessibilityRole="radio"
                    accessibilityState={{ checked: id === language, disabled }}
                    disabled={disabled} onPress={() => setLanguage(id)}
                    style={[styles.control, { borderColor: id === language ? colors.primary : colors.border }]}>
                    <Text style={{ color: id === language ? colors.primary : colors.foreground }}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.header}>
                <Text style={[styles.range, { color: colors.foreground }]}>{t("ocr.force")}</Text>
                <Switch accessibilityLabel={t("ocr.force")} value={force} onValueChange={setForce} disabled={disabled} />
              </View>
              <Text style={{ color: colors.mutedForeground }}>{t("ocr.hint")}</Text>
              <View style={styles.row}>
                <Pressable accessibilityRole="button" disabled={job !== "ocr" && disabled}
                  onPress={job === "ocr" ? cancel : () => { void run("ocr"); }}
                  style={[styles.control, { borderColor: colors.primary }]}>
                  <Text style={{ color: colors.primary }}>{t(job === "ocr" ? "ocr.cancel" : "ocr.start")}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={disabled}
                  onPress={() => { void run("export"); }}
                  style={[styles.control, { borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}>
                  <Text style={{ color: colors.foreground }}>{t("ocr.exportEpub")}</Text>
                </Pressable>
              </View>
            </>
          )}
          {job === "ocr" && progress && (
            <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground }}>{t("ocr.progress", { ...progress })}</Text>
          )}
          {job === "export" && <ActivityIndicator color={colors.primary} />}
          {!!message && <Text accessibilityLiveRegion="polite" style={{ color: colors.foreground }}>{message}</Text>}
          {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  heading: { fontSize: 19, fontWeight: "600", flex: 1 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  range: { flex: 1, gap: 4 },
  control: { minHeight: 44, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center" },
  engine: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
