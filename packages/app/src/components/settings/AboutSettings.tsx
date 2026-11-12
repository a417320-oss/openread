import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function AboutSettings() {
  const [version, setVersion] = useState("");
  const { i18n } = useTranslation();
  const chinese = i18n.language.startsWith("zh");
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">OpenRead</h1>
        <p className="text-sm text-muted-foreground">{version}</p>
      </div>
      <p>
        {chinese
          ? "支持本地 PDF 图片文字识别的 AI 阅读器。"
          : "An AI reader with local OCR for scanned PDFs."}
      </p>
      <div className="flex flex-wrap gap-4 text-sm underline">
        <a href="https://github.com/a417320-oss/openread" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a href="https://github.com/a417320-oss/openread/releases" target="_blank" rel="noreferrer">
          {chinese ? "下载更新" : "Download updates"}
        </a>
        <a href="https://github.com/a417320-oss/openread/issues" target="_blank" rel="noreferrer">
          {chinese ? "反馈问题" : "Report an issue"}
        </a>
      </div>
      <p className="text-sm text-muted-foreground">
        {chinese
          ? "此分支采用手动更新，以保留 OpenRead 的 OCR 和连接改进。"
          : "This fork uses manual updates to preserve OpenRead's OCR and connection improvements."}
      </p>
      <div className="space-y-2 border-t pt-4 text-sm text-muted-foreground">
        <p>OpenRead © 2026 a417320-oss. GPL-3.0-or-later.</p>
        <p>
          {chinese
            ? "基于 ReadAny，感谢原作者及所有贡献者。"
            : "Based on ReadAny. Thanks to its authors and contributors."}
        </p>
        <a
          className="underline"
          href="https://github.com/codedogQBY/ReadAny"
          target="_blank"
          rel="noreferrer"
        >
          ReadAny · codedogQBY / ReadAny Team
        </a>
      </div>
    </div>
  );
}
