# Linux DO · Codex 外观（伪装版）

把 [linux.do](https://linux.do/) 换成 Codex 桌面 app 风格的用户脚本：左 rail + 线程主区 + 右侧「代码面板」，明暗双模式，外加一整套上班摸鱼用的**伪装**能力。

## 从哪移植来的

本脚本**移植自 [czm15053/linuxdo-idea-ui](https://github.com/czm15053/linuxdo-idea-ui)**（「摸鱼办公皮肤合集 · Linux DO & X (Twitter) & 小红书」，MIT）：

- **代码基线**：该仓库 Linux DO 专区的「脚本六：Codex 桌面 app 外观」—— [`linuxdo-codex.user.js`](https://github.com/czm15053/linuxdo-idea-ui/blob/main/linuxdo-codex.user.js)。本脚本的直接基线是这条线上更新的 v0.3.1（含 agent 装饰、设置面板、页面不透明度），仓库 `main` 上目前是 v0.2.0。
- **数据流与组件**：同一仓库的 IM 皮肤实现 —— `im/src/bridge/`（Discourse API、软跳转、用户、分类、CF 盾）与 `im/src/features/`（阅读进度、引用跳源楼、投票、点赞、书签、灯箱），脚本里「移植自 im 皮肤 / feishu 脚本 / terminal 皮肤」的注释指的就是它们。
- **外观与玩法补强**：`reference/v2ex-codex.user.js` 1.0.0（V2EX 版，作者 link）—— 伪装模式、伪装视图、侧边栏模式、缩略图与悬浮大图预览、rail 对比度配色。

同一条线上有两份 linux.do 脚本，**只应启用一份**：

| 文件 | 说明 |
| --- | --- |
| `linuxdo-codex.user.js` | **本目录的交付物（v1.0.0）**。数据流沿用上游那条线，外观/玩法按 `reference/v2ex-codex.user.js` 1.0.0 补齐。 |
| `linuxdo.user.js` | v0.3.1 基线（移植时的参照）。⚠️ **当前不在工作区**，见文末「工作区状态」。要复现它可从脚本管理器导出，或装上游仓库的 v0.2.0。 |
| `reference/v2ex-codex.user.js` | V2EX 版 Codex 外观（v1.0.0），本次玩法移植的来源。 |

> ⚠️ 两份 linux.do 脚本会画同一套 UI（同名 `.codex-rail` / `.codex-main`），同时启用就是 rails 叠罗汉。
> 请到脚本管理器里**只启用 `linuxdo-codex.user.js`**。万一两份都在跑，本脚本检测到「不是自己画的」那一套 UI 会让位，不会去改对方的界面。
> （上游仓库自身也强调「同一站点内不同外观脚本互斥」，见其 README 顶部提示。）

## 安装

1. 安装 Tampermonkey / Violentmonkey / ScriptCat 任一并启用。
2. 新建脚本，粘贴 `linuxdo-codex.user.js` 全文保存（`@match https://linux.do/*`，`@run-at document-start`）。
3. 打开 linux.do；右上角齿轮（或 `Ctrl`/`⌘` + `,`）打开设置面板。

## 相比移植基线（v0.3.1）多了什么

**伪装（摸鱼）**

- **伪装模式**：左栏品牌名 → `Codex`，标签页标题 → 源码文件名（如 `lib.rs — platform`），不再出现 Linux DO / 帖子标题。
- **应急伪装键**：连按两下 `Esc`（默认）、`F2`、或 `Ctrl+Shift+H` —— 整个视口瞬间变成「代码编辑器 + 正在跑测试的终端」，再按一次恢复。`Ctrl+Shift+H` 无论怎么配都有效。
- **侧边栏模式**：鼠标一离开页面区域（或窗口失焦 / 切标签页）自动伪装，鼠标回来自动恢复 —— 只撤它自己触发的那次，手动按出的伪装不会被鼠标带出来。三个子开关独立控制。
- 伪装视图只切外观，不卸载任何真实 DOM，恢复时零损失。

**正文图片**

- 图片按可调尺寸收窄成缩略图（默认 260×170），鼠标悬停时在旁边浮出大图并显示文件名/分辨率，点击仍是原来的可缩放灯箱。≤300×200 的小图（表情、图标）自动跳过。

**外观**

- rail 配色按**实测有效对比度**重调：`#27353b` 底 + 灰字在深色下有效对比度只有 3.38:1，换成压暗的底色 + 近白文字（见 CSS Token 段注释）。
- 新增设置项：品牌名、项目名、标签页图标（Codex 圆角图标 / 保留 linux.do 原图标）、应急键、缩略图尺寸、悬浮预览开关。
- **隐藏原生 Discourse 侧边栏**：`Topics / Upcoming events / All categories / Default` 那一列（`.sidebar-wrapper` / `#d-sidebar`）在 DOM 里和 `#main-outlet` 平级、自己没有背景色，原来会直接压在自绘 rail 上；现在整条 `display: none`。

数据流没有重写：`/latest.json`、`/categories.json`、`/t/<id>.json` 取数，DiscourseURL 软跳转，通知菜单收养、composer、阅读进度上报、书签、点赞、投票、引用跳源楼、CF 盾回退全部沿用上游那条线在 v0.3.1 里的实现。被改动的只有 48 行（都写在新脚本顶部的头注释里）。

## 与上游版本的关系

| | 上游 `linuxdo-codex.user.js` | 移植基线（v0.3.1，已丢失） | 本交付物 `linuxdo-codex.user.js` |
| --- | --- | --- | --- |
| 版本 | v0.2.0 | v0.3.1 | v1.0.0 |
| 列表 / 详情 / composer / 通知收养 | ✅ | ✅ | ✅（未改） |
| agent 装饰（思考块 / 工具调用行） | — | ✅ | ✅ |
| 设置面板 + 页面不透明度 | — | ✅ | ✅ |
| 伪装模式 / 应急键 / 侧边栏模式 | — | — | ✅ |
| 缩略图 + 悬浮大图预览 | — | — | ✅ |
| rail 对比度配色 | 旧 token | 旧 token | ✅ 实测校准 |

> 上表按上游仓库 `main` 分支（抓取时）与本地文件实测比对，仅用于说明差异来源。

## 冒烟测试

`tools/smoke/` 里是一套真实浏览器端到端测试：起一个假的 linux.do（外壳 HTML + Discourse JSON 端点 + 一张 400×300 的真 PNG + 一个「已有别的主题接管」的页面），用 headless Chrome 加载被测脚本，再通过 CDP 在页面里跑断言。

```powershell
node tools/smoke/run.js
```

覆盖 83 条断言，分两个阶段：

1. **正常接管**（冒充 linux.do）：从 `/latest.json`、`/categories.json`、`/t/<id>.json` 渲染列表与详情；**原生侧边栏（`.sidebar-wrapper` / `#d-sidebar` / 底栏）被 `display:none`**；伪装标题/品牌名/favicon；应急键三种配置（Esc² / F2 / Ctrl+Shift+H）；侧边栏模式三种子开关（含「手动退出后自动伪装仍生效」「鼠标回来不撤手动进的伪装」）；设置面板落盘与 Esc 状态机；缩略图与悬浮预览；切语言后的标题联动；composer 输入与实时预览。
2. **互斥让位**（页面上已有别的 Codex 主题 UI）：不注入样式、不加标记、不画第二套 rail/主区、不改标题与 favicon，也不接管对方那份 `.cx-modal`。

> 注意：在有文件沙箱的环境里运行需要放开 `chrome.exe` 执行权限（脚本会启动 headless Chrome 并让它在系统临时目录建 profile）。
> 断言若失败，退出码为 1，并打印页面异常与 `console.error`。

## 目录

```
linuxdo-codex.user.js        交付物：linux.do 版 Codex 外观（伪装版）
reference/v2ex-codex.user.js V2EX 版，玩法移植来源
tools/smoke/                 真实浏览器冒烟测试（stub 服务 + CDP runner + 断言）
tools/recover/               从 DSH 会话记录（多 frame zstd）里捞回被删文件的脚本
linuxdo.user.js              v0.3.1 基线 —— 当前不在工作区，见下方「工作区状态」
```

## 工作区状态

`linuxdo.user.js`（v0.3.1，310,782 字节，SHA256 `C325B8F491B6209CC2751B3EA847B7DEAFFD427BFFB8BD88EDDE85DC80ED0DA2`）是本脚本移植时参照的基线：它在本会话开始时还在，会话中途从工作区消失了，**不是本脚本的产物，也未被本脚本改写**（交付物是在它之上单独新建的文件）。

- 交付物 `linuxdo-codex.user.js` 不受影响：它包含基线的全部实现（数据流、composer、通知收养、阅读进度、书签、点赞、投票、引用跳源楼、CF 盾回退），可以单独使用。
- 想恢复那份基线：从你的脚本管理器里导出（最可靠，能拿到一字不差的版本），或改用上游仓库 `main` 上的 v0.2.0（较早一版，少 agent 装饰与设置面板）。
- `tools/recover/` 是本会话为了排查这次丢失写的工具：DSH 的 `session.v4.jsonl.zstd` 是多个 zstd frame 顺序拼接，Node 的 zstd API 只吃第一个 frame，所以要逐 frame 解压。用它翻遍本工作区的三个会话记录后确认：里面只有分块读取的片段，**没有完整副本**，所以无法从会话记录里原样还原。

## 许可与致谢

- **代码基线**：[czm15053/linuxdo-idea-ui](https://github.com/czm15053/linuxdo-idea-ui)（摸鱼办公皮肤合集，MIT License，Copyright (c) 2026 czm15053），Linux DO 专区「脚本六：Codex 桌面 app 外观」`linuxdo-codex.user.js` 及其 `im/` 皮肤实现。本脚本是该作品的衍生版本，继续以 MIT 分发，请一并保留上游版权声明。
- **玩法移植来源**：`reference/v2ex-codex.user.js`（作者 link）—— 伪装模式、伪装视图、侧边栏模式、缩略图与悬浮大图预览、rail 对比度配色。
- favicon 用的 OpenAI 花朵 path 来自 simple-icons（CC0）。
- 同一上游仓库里还有 IM 三合一（飞书 / 钉钉 / 企业微信）、JetBrains IDEA、终端 TUI（Claude Code / Codex CLI）等外观，需要别的风格可以直接装那边的脚本（记得与本脚本互斥）。
