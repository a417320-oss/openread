# OpenRead

[English](#english) · [PDF OCR 使用说明](docs/pdf-ocr.md) · [下载](https://github.com/a417320-oss/openread/releases)

支持本地 PDF 图片文字识别的开源 AI 阅读器，基于 [ReadAny](https://github.com/codedogQBY/ReadAny) v1.3.6 改进，采用 **GPL-3.0-or-later**。

## 新增与保留

- **离线 PDF OCR**：简体中文、繁体中文、英文；选择页码范围，显示进度，支持取消、逐页保存和再次打开后复用。
- **识别后供 AI 阅读**：扫描页文字可用于章节提取、PDF 页读取和重新建立向量索引，也可导出 TXT。
- **稳定的桌面启动**：保留 Plus 连接服务、模型选择恢复、系统代理适配和安全关闭修复。
- **保留原有阅读能力**：书库、批注、笔记、EPUB/PDF 阅读、AI 对话及同步等。

OCR 在本机执行，不上传 PDF，不需要 API 密钥。原 PDF 不变；本版本不向 PDF 写入透明文字层。
使用 AI 对话时，所选 AI 服务仍会接收发送给它的文字。OCR 对模糊扫描、复杂表格和手写的识别可能有误。

## Windows 使用

在 Releases 下载 `OpenRead-1.4.0-windows-x64.zip`，解压到固定目录，运行 `Setup-OpenRead.cmd` 创建桌面入口，之后双击 **OpenRead**。
需要 Windows 10/11 和 WebView2。便携包包含启动所需的 Node.js。

打开 PDF → 顶部“识别 PDF 图片文字” → 输入 PDF 页码范围 → 开始识别。识别完成后可让 AI 总结这些页。

ChatGPT 订阅连接是可选功能。运行启动器后，在浏览器打开 `http://127.0.0.1:38618/`，通过官方登录授权，随后重新运行 OpenRead 启动器。是否可用以及使用额度取决于账号权限和服务端支持。也可在设置中配置自己的 API 服务。

升级已有 ReadAny 时，应用继续使用原资料库标识，保留书籍、笔记和模型配置。请先退出旧应用。OpenRead 使用独立发布页手动更新，避免被上游版本覆盖。

## 从源码构建

需要 Node.js 24+、pnpm 9.15.0，以及 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)（Rust；Windows 还需 MSVC Build Tools）。

```sh
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm --filter app... --filter @readany/cli... install --frozen-lockfile
npm ci --prefix plus-bridge
pnpm test
pnpm test:ocr
pnpm --filter @readany/cli test
node --test plus-bridge/bridge.test.mjs plus-bridge/desktop.test.mjs deployment/openread.test.mjs
pnpm --filter app build
node scripts/ocr-smoke.mjs
pnpm --filter app tauri build --bundles nsis
```

构建会从锁定版本的 npm 依赖中复制 OCR 引擎和语言包，运行时不依赖 CDN。首次安装依赖需要联网。
Windows GitHub Actions 会运行测试、编译应用并生成包含 Plus 启动器的便携 ZIP。
普通 Tauri 安装包不包含 Node.js 连接服务；需要 Plus 启动修复时请使用便携包。

`com.readany.app`、`@readany/*`、CLI 的 `readany` 命令以及原数据库命名有意保留，以兼容已有数据和集成。
`deployment/verify.test.mjs` 是原机器部署验证，不属于干净环境下的通用测试。

## 开源与致谢

感谢 codedogQBY、ReadAny Team、Foliate、PDF.js、Tesseract.js 及所有贡献者。
保留上游 Git 历史、版权和 GPL 许可证；修改说明见 [NOTICE.md](NOTICE.md)。
本项目独立维护，不是 ReadAny 官方版本，也不是 OpenAI 官方产品。
原项目文档见 [docs/upstream](docs/upstream)。

账号令牌、书籍、OCR 结果、运行日志和个人设置不包含在源码或发布包中。

## English

OpenRead is an independent GPL-3.0-or-later fork of ReadAny v1.3.6. It adds offline OCR for scanned PDFs (Simplified Chinese, Traditional Chinese and English), page-range jobs with cancellation and persistent results, AI/CLI access to recognized text, and a Windows launcher that preserves the existing ChatGPT subscription connection and model selection fixes.

Download the portable Windows ZIP from Releases, extract it to a permanent directory, and run `Setup-OpenRead.cmd`. In the PDF reader, select **Recognize PDF text (OCR)**. The original PDF remains unchanged. Recognition results can be exported as text; this version does not insert a searchable text layer into the PDF.

Build commands above use Node.js 24+, pnpm 9.15.0 and Tauri's native prerequisites. Internal ReadAny identifiers are intentionally retained for data compatibility. See LICENSE and NOTICE.md for attribution.
