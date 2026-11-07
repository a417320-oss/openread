# Windows 本机安装

2026-11-06 安装官方稳定版 **ReadAny v1.3.6**，源码检出对应标签，
本地部署分支为 `local-deployment`。使用官方 Windows x64 NSIS 安装包，
安装前核对 GitHub 发行资源的 SHA-256；版本和摘要记录在 `deployment/release.json`。

- 项目目录：`D:\Heisenberg Reading\ReadAny`
- 应用程序：`runtime\app.exe`
- 启动入口：直接打开桌面或开始菜单的 ReadAny，也可双击 `Start-ReadAny.cmd`；都会启动本机 Plus 连接服务并保留模型选择。
- 使用方式：这是桌面应用，直接导入书籍阅读，无需启动本地 HTTP 服务。
- 首次运行：按引导完成初始化；AI 配置可稍后填写服务商、地址、模型和 API Key。

使用 ChatGPT Plus 订阅的登录、自动配置和启停方法见 [Plus 连接说明](plus-connection.md)。
2026-11-08 已将桌面和开始菜单入口统一到 Plus 启动器，原始快捷方式保留备份。

运行数据默认在 `%APPDATA%\com.readany.app`，WebView2 缓存位于
`%LOCALAPPDATA%\com.readany.app`。关闭应用后备份整个数据目录；
更改数据位置时以应用设置中的路径为准。安装包、安装目录和缓存不纳入 Git。

## 验证

安装并启动应用后，在项目目录执行：

```powershell
node --test deployment/verify.test.mjs
```

验证内容：官方安装包摘要、Windows 程序版本、随包 CLI 语法、运行进程、
SQLite 数据库初始化、旧项目删除和旧服务端口关闭。
这是官方二进制的安装验证；没有从源码重新构建，也没有运行源码开发测试。
已观察到 ReadAny 中文初始化界面正常显示；未配置或测试外部 AI 服务。
本次安装验证结果：6 项全部通过。

## 已移除的旧项目

DeepRead 后台服务已停止，`D:\Heisenberg Reading\DeepRead` 已删除。
删除前的备份位于：

`D:\Heisenberg Reading\.cache\retired-deepread-20261106-223003`

- `reading-data.zip`：书架、书籍、设置和对话数据。
- `source.bundle`：旧项目 Git 历史（含此前的本地部署提交）。

原工作区的 Heisenberg Reading 应用和根目录 PDF 保留。
