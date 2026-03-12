# CLAUDE.md — ClawWork 项目指南

## 项目概述

ClawWork 是一个 OpenClaw 桌面客户端，体验对标 Claude Cowork：三栏布局、多任务并行、结构化进度追踪。在此基础上新增文件管理能力——所有 AI 产物自动落盘到本地 Git Repo，可搜索、可追溯。

**不是** OpenClaw 管理后台，**不是**通用 IM 客户端，**不是**多人协作工具。

## 架构

```
┌─────────────────────┐       ┌──────────────────────────┐
│ OpenClaw Server      │  WS   │ ClawWork Desktop App     │
│ (Node.js 进程)       │◄────►│ (Electron 34 进程)        │
│                     │       │                          │
│ ┌─────────────────┐ │       │  React 19 UI             │
│ │ Gateway :18789  │ │       │  SQLite (元数据索引)       │
│ │ Agent Engine    │ │       │  Git Repo (产物版本化)     │
│ │ ┌─────────────┐ │ │       │                          │
│ │ │ clawwork    │ │ │       └──────────────────────────┘
│ │ │ channel     │ │ │
│ │ │ plugin      │ │ │ ← 运行在 OpenClaw 内部
│ │ │ :13579      │ │ │    通过 jiti 加载 TS
│ │ └─────────────┘ │ │
│ └─────────────────┘ │
└─────────────────────┘
```

**两个进程，两个 WS 连接：**

1. Desktop → Gateway (:18789)：发送用户消息，接收 session 事件广播
2. Desktop → Plugin (:13579)：接收 Agent 的 sendText/sendMedia 回调推送

Channel Plugin 运行在 OpenClaw 进程里（不是 Electron 里）。它告诉 OpenClaw："Agent 发消息时，通过 WS 推给 ClawWork App"。

## Monorepo 结构

```
clawwork/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json        # ES2022, strict, bundler resolution
├── packages/
│   ├── shared/               # @clawwork/shared — 零依赖类型桥梁
│   │   └── src/
│   │       ├── types.ts      # Task, Message, Artifact, ToolCall, ProgressStep
│   │       ├── protocol.ts   # WsMessage 联合类型 + type guards
│   │       └── constants.ts  # 端口号, buildSessionKey(), 心跳参数
│   ├── channel-plugin/       # openclaw-channel-clawwork — OpenClaw 插件
│   │   ├── openclaw.plugin.json
│   │   └── src/index.ts      # register() → WS server + outbound adapter
│   └── desktop/              # @clawwork/desktop — Electron 应用
│       ├── electron.vite.config.ts  # React + Tailwind v4 vite plugin
│       └── src/
│           ├── main/index.ts        # Electron 主进程, hiddenInset titleBar
│           ├── preload/index.ts     # contextBridge
│           └── renderer/
│               ├── index.html
│               ├── main.tsx         # React 入口
│               ├── App.tsx          # 三栏布局 (260px | flex | 320px)
│               ├── styles/theme.css # dark/light CSS Variables, accent #0FFD0D
│               └── layouts/
│                   ├── LeftNav/     # 新任务、搜索、文件管理、任务列表、设置
│                   ├── MainArea/    # 顶栏 + 消息区 + 输入框
│                   └── RightPanel/  # 任务产物 + 版本记录
```

### 包间依赖

```
@clawwork/shared ← 被其他两个包引用
     ↑       ↑
     │       │
channel-plugin  @clawwork/desktop
```

`@clawwork/shared` 的 tsconfig 启用了 `composite: true`，desktop 通过 `references` 引用它。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Electron 34 + electron-vite 3 |
| 前端 | React 19, TypeScript 5.x, Tailwind CSS v4 |
| 状态管理 | Zustand 5 (计划) |
| 数据库 | better-sqlite3 + Drizzle ORM (计划) |
| Git 操作 | simple-git (计划) |
| 图标 | lucide-react |
| 构建 | Vite 6 (via electron-vite) |
| 打包 | electron-builder (macOS Universal Binary) |
| 包管理 | pnpm 10 workspace |

## 开发命令

```bash
# 安装所有依赖
pnpm install

# 开发 Desktop App（Electron 热更新）
pnpm --filter @clawwork/desktop dev

# 类型检查
pnpm exec tsc --noEmit -p packages/shared/tsconfig.json
pnpm exec tsc --noEmit -p packages/desktop/tsconfig.json
pnpm exec tsc --noEmit -p packages/channel-plugin/tsconfig.json

# 将 Channel Plugin symlink 安装到 OpenClaw（开发模式）
openclaw plugins install -l ./packages/channel-plugin

# 打包
pnpm --filter @clawwork/desktop build
```

## 关键协议

### Session Key 格式

```
agent:<agentId>:task-<taskId>
```

每个 Task 对应一个独立的 OpenClaw session。session 间并行执行，session 内串行。Gateway 广播所有 session 事件（不过滤），客户端按 sessionKey 路由到对应 Task。

### WebSocket 消息类型 (packages/shared/src/protocol.ts)

**Plugin → Desktop（Agent 出站）：**

| type | 用途 |
|---|---|
| `text` | Agent 文本回复 |
| `media` | Agent 生成文件 (mediaPath) |
| `tool_call` | 工具调用状态更新 |
| `stream_chunk` | 流式响应片段 |

**Desktop → Plugin（用户入站）：**

| type | 用途 |
|---|---|
| `user_message` | 用户发送消息 |
| `create_session` | 创建新 session |

**双向：**

| type | 用途 |
|---|---|
| `heartbeat` | 心跳 (30s 间隔) |
| `error` | 错误通知 |

### 文件传输

MVP 只做同机部署：`sendMedia()` 通过 WS 发送 `mediaPath`（本地文件路径），Desktop 复制到 Task 产物目录。

注意 `mediaLocalRoots` 安全校验（v2026.3.2+），plugin 必须正确传播该参数。

## 主题系统

CSS Variables 驱动，dark 为默认。切换方式：`<html data-theme="dark|light">`。

核心色值：accent green `#0FFD0D`（dark）/ `#0B8A0A`（light），背景 `#1C1C1C` / `#FAFAFA`。

所有颜色通过 `var(--xxx)` 引用，不硬编码。

## 当前进度

### 已完成 ✅

- **T1-0** Monorepo 骨架 (pnpm workspace, tsconfig, .gitignore, git init)
- **T1-1** Desktop 包 (Electron main, preload, renderer 入口, theme CSS)
- **T1-2** Channel Plugin (register(), WS server, sendText/sendMedia outbound adapter)
- **T1-3** Shared 类型 (types.ts, protocol.ts, constants.ts) — Drizzle ORM schema 待做
- **T1-4** 三栏布局 (App.tsx: 260px LeftNav | flex MainArea | 320px RightPanel, 右侧可折叠)
- **T1-5** LeftNav 静态结构 (新任务按钮, 搜索框, 文件管理入口, 示例任务列表, 设置)

### 下一步 — Phase 1.3: OpenClaw 通信链路

- **T1-6** Channel Plugin 完善：确保 `sendText()` 通过 WS 正确到达 Electron
- **T1-7** Electron 主进程 WS 客户端：连接 Gateway (:18789)，心跳，断线重连
- **T1-8** 消息发送：Electron → Gateway，携带 sessionKey
- **T1-9** 消息接收 + sessionKey 路由：Gateway 事件按 sessionKey 分发到对应 Task store

**Phase 1 验收标准：能在 Electron 空白页面中通过代码与 OpenClaw Agent 完成一轮对话。**

### 后续 Phase 概览

- **Phase 2** — 核心 UI 交互 (T2-1 ~ T2-10): Task CRUD、对话流组件、流式响应、工具调用折叠块、Progress/Artifacts 面板、多任务并行验证
- **Phase 3** — 产物管理 (T3-1 ~ T3-7): sendMedia 文件落盘、Git auto-commit、文件浏览器 (搜索+筛选+宫格列表+跳转回 Task)
- **Phase 4** — 打磨+打包 (T4-1 ~ T4-7): 主题切换、全局搜索 (FTS5)、Settings、错误处理、electron-builder dmg

## 任务依赖图

```
Phase 1:
  T1-0 → T1-1 ─────┐
         T1-2 ─────┤→ T1-6 → T1-7 → T1-8 → T1-9
         T1-3 ─────┘
         T1-4 ─┬→ (Phase 2 UI 依赖)
         T1-5 ─┘

Phase 2:
  [T2-1 → T2-2 → T2-3]   Task CRUD 链路（串行）
  [T2-4 → T2-5 → T2-6 → T2-7]   对话流组件（串行）
  [T2-8, T2-9]   右侧面板（可并行）
  T2-10   多任务验证（所有 Phase 2 完成后）

Phase 3:
  [T3-1 → T3-2 → T3-3]   产物落盘（串行）
  [T3-4 → T3-5 → T3-6 → T3-7]   文件浏览器（串行）
  两条线可并行

Phase 4:
  [T4-1, T4-2, T4-3, T4-4]   全部可并行
  T4-5 → T4-6 → T4-7   打包链路（串行）
```

## 已知问题与风险

| 问题 | 影响 | 参考 |
|---|---|---|
| Gateway 协议文档不完整 | 需要读源码反推 | 参考 feishu/dingtalk plugin |
| Channel ID 校验 bug | 自定义 channel 启动可能报错 | [#12484](https://github.com/openclaw/openclaw/issues/12484) |
| Gateway 广播无 session 过滤 | 客户端需自行按 sessionKey 过滤 | [#32579](https://github.com/openclaw/openclaw/issues/32579) |
| `mediaLocalRoots` 安全校验 | 文件发送可能被拒 | [#20258](https://github.com/openclaw/openclaw/issues/20258), [#36477](https://github.com/openclaw/openclaw/issues/36477) |
| Session 4AM 自动重置 | 长期 Task 上下文被清 | Plugin 需配置禁用自动重置 |

## 编码约定

- TypeScript strict 模式，不允许 `any`（plugin 的 `api` 参数除外，OpenClaw 无类型定义）
- 所有颜色使用 CSS Variables，不硬编码 hex
- 组件文件放 `layouts/` (布局组件) 或 `components/` (通用组件)，按功能目录组织
- 状态管理用 Zustand，每个 domain 一个 store（`taskStore`, `messageStore`, `uiStore`）
- WebSocket 消息类型统一在 `@clawwork/shared/src/protocol.ts` 定义，两端共享

## 设计文档

完整设计文档见仓库外的 `openclaw-desktop-design.md`（v0.2），包含数据模型、UI 原型、ADR、28 个开发任务的完整描述和验收标准。
