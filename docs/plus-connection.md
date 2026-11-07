# 使用 ChatGPT Plus 订阅额度

ReadAny v1.3.6 原版的 OpenAI 配置要求 API 密钥。本机的 `plus-bridge` 兼容服务
使用 OpenAI 官方开源应用 OAuth 流程，将 ReadAny 的 Chat Completions 请求转换为
订阅支持的 Responses API 请求。原版桌面程序没有被替换或重新打包。

## 首次连接

1. 双击桌面的 **ReadAny**，或项目根目录的 `Start-ReadAny.cmd`，启动仅监听 `127.0.0.1:38618` 的连接服务。
2. 浏览器打开 <http://127.0.0.1:38618/>，点击 **Continue with ChatGPT**。
3. 在 OpenAI 官方页面登录你的 Plus 账号，检查并授权使用 ChatGPT 订阅额度。
   是否支持该账号、地区和所选模型，以 OpenAI 的授权及实际请求结果为准。
4. 页面显示已连接后，再次打开桌面的 ReadAny。
   脚本会查询账号可用模型，正常关闭 ReadAny、备份设置并配置本机连接，再打开应用。
5. 若仍在首次引导页面，AI 设置会自动带入；点击「测试连接」，成功后继续「下一步」。

自动配置的项目：

| 项目 | 值 |
| --- | --- |
| Provider | OpenAI |
| 显示名称 | ChatGPT Plus（订阅额度） |
| API 地址 | `http://127.0.0.1:38618/v1` |
| API 密钥 | 自动生成的本机连接密钥，不是 OpenAI API Key 或登录令牌 |
| 模型 | 从登录账号的模型目录选择；保留仍可用的现有选择 |

2026-11-08 起，桌面和当前用户开始菜单的 ReadAny 快捷方式均指向 Plus 启动器，
会先启动连接服务、检查/恢复已选模型，再打开阅读器。以后可直接使用原有桌面图标。
原始快捷方式备份在 `.cache/plus/shortcut-backups`；Node 路径固定在
`.cache/plus/runtime.json`，不依赖 Codex 提供的 PATH。
没有显式代理环境变量时，后台服务继承本机已有的 Windows 系统代理；不会修改系统代理设置。
启动时还会检查模型列表和请求模式；即使端点名称还在，只要模型列表被清空或请求模式
不适用于本机连接，也会补齐设置。已经有效的已选模型会保留。
阅读本身可离线，AI 请求需要联网。本连接不会切换到单独计费的 API Key。

## 额度、数据和限制

订阅额度与使用该 ChatGPT 计划的其他应用共享，不增加额外额度。
书中参与问答的片段、提问和相关上下文会发送给 OpenAI。
额度、地区、权限或服务错误会原样反映到应用，不会自动选择其他付费路径。
仅实现模型查询、文本/图片问答及本地函数工具兼容；此登录方式不支持嵌入、
语音等独立 API。ReadAny 原有的本地嵌入功能可以按其自身配置使用。

OAuth 令牌使用 Windows 当前用户的 DPAPI 加密，保存在忽略提交且限制访问的
`.cache/plus/credentials.dpapi`。设置变更前的备份是同目录下
`settings-before-plus.dpapi`。密码、验证码和 OAuth 令牌无需发到聊天中。
连接页面支持选择已保存账号、添加账号和断开当前账号。

## 管理与验证

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File plus-bridge/control.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File plus-bridge/control.ps1 stop
node --test plus-bridge/bridge.test.mjs plus-bridge/desktop.test.mjs deployment/verify.test.mjs
```

日志在 `.cache/plus/stdout.log` 和 `stderr.log`；程序不记录令牌和请求正文。
测试覆盖模拟 OAuth、PKCE、签名校验、权限、刷新、函数工具转换、流式错误、
本机访问限制、DPAPI 重启读取和设置保留；模拟测试通过不代表真实账号已授权。
真实登录、账号模型查询及一次完成的推理请求后，才能确认订阅接通。

2026-11-07 修复登录页 `no-referrer` 导致浏览器表单提交 `Origin: null` 的问题：
普通页面使用 `same-origin`，OAuth 回调保留 `no-referrer`；未知来源与无效 CSRF 仍被拒绝。

## 本机接通验收

2026-11-07 已完成真实账号授权，读取到 8 个可用模型，并在 ReadAny 中选定
`gpt-6.1-sol`。通过 ReadAny 保存的本机连接配置发送简短流式请求，得到 HTTP 200、
完整终止事件和回复「ReadAny Plus 连接成功」。ReadAny 自带「测试连接」也显示
「连接成功，已实际调用模型 gpt-6.1-sol」。未使用书籍正文作为验收请求内容。

首次引导的端点切换可能清空模型选择；完成引导后，可在「设置 → AI → 模型」重新选择。
已经配置成功后，继续使用根目录 `Start-ReadAny.cmd` 启动。

如果配置文件已有 Plus 端点，而仍然打开的阅读窗口只显示默认 OpenAI，
请正常退出整个 ReadAny 后，再使用启动脚本打开，让各阅读窗口重新载入设置。
仅关闭设置面板不会刷新窗口内已经载入的旧状态。
2026-11-07 已按此方式完成一次重新配置：保留现有授权，恢复
`gpt-6.1-sol` 和 8 个账号模型；用不含书籍内容的测试请求取得 HTTP 200 和回复 `OK`。

已授权安装环境的验证命令（检查保存的模型及本机连接状态，不额外发送推理请求）：

```powershell
$env:READANY_VERIFY_PLUS='1'
$env:READANY_VERIFY_DESKTOP='1'
node --test plus-bridge/bridge.test.mjs plus-bridge/desktop.test.mjs deployment/verify.test.mjs
```

需要修复或重新生成桌面与开始菜单入口时：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File plus-bridge/install-shortcuts.ps1
```

真实桌面启动回归测试会正常关闭应用、停止后台服务，移除测试进程内的代理环境变量
及 Node 专用 PATH，再通过桌面快捷方式连续启动两次，确认模型和连接保留。
不读取阅读窗口或书籍内容。窗口均正常关闭并等待退出宽限期后，如果同一路径的应用
仍留下无窗口后台进程，才清理该残留；仍有窗口时中止验收。最后保留 ReadAny 打开。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/desktop-launch-smoke.ps1 -Rounds 2
```

2026-11-08 验收：真实桌面快捷方式在无 Codex 代理环境变量、无 Node 专用 PATH 的
环境下连续两次冷启动成功；每次都保留 `gpt-6.1-sol` 和 8 个模型，并自动启动 Plus 服务。
最终实际调用取得 HTTP 200 和回复 `OK`。

依赖重装（Node.js 24，其他源代码开发依赖无需安装）：

```powershell
npm ci --prefix plus-bridge --cache .cache/npm --no-audit --no-fund
```

官方协议：
[登录与注册](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、
[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、
[额度与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。
