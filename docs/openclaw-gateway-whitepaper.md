# OpenClaw Gateway Protocol Whitepaper

> Source of truth: reverse-engineered from `~/git/openclaw` (version 2026.3.14)
> Date: 2026-03-16

---

## 1. Architecture Overview

Gateway is a WebSocket-first server (default port `:18789`) sitting between clients and the OpenClaw Agent Engine. All client communication goes through a **single persistent WebSocket connection**.

```
┌─────────────────────┐          ┌────────────────────────────┐
│ ClawWork Desktop    │  WS :18789  │ OpenClaw Gateway Server    │
│                     │◄──────────►│                            │
│ React 19 + Electron │           │ ┌────────────────────────┐ │
│                     │           │ │ Protocol Validator     │ │
│                     │           │ │ (AJV/TypeBox schemas)  │ │
│                     │           │ ├────────────────────────┤ │
│                     │           │ │ RPC Dispatcher         │ │
│                     │           │ │ (60+ methods)          │ │
│                     │           │ ├────────────────────────┤ │
│                     │           │ │ Broadcast Engine       │ │
│                     │           │ │ (19 event types)       │ │
│                     │           │ ├────────────────────────┤ │
│                     │           │ │ Agent Engine           │ │
│                     │           │ │ Session Store          │ │
│                     │           │ │ Cron Service           │ │
│                     │           │ └────────────────────────┘ │
│                     │           │                            │
│                     │           │ HTTP: /health, /v1/chat/*  │
└─────────────────────┘          └────────────────────────────┘
```

Key design decisions:

- **Single WS connection** per client (no REST API for core operations)
- **Request/Response + Event** three-frame model
- **Broadcast without session filtering** — clients must filter by `sessionKey`
- **JSON Schema validation** (TypeBox + AJV) on all frames
- **Scope-based access control** on events and methods

---

## 2. Frame Protocol

All communication uses JSON frames over WebSocket. Three frame types form a discriminated union on the `type` field.

### 2.1 Request Frame (Client → Server)

```typescript
{
  type: "req",
  id: string,        // unique request ID, client-generated
  method: string,    // RPC method name (e.g. "chat.send")
  params?: unknown   // method-specific parameters
}
```

### 2.2 Response Frame (Server → Client)

```typescript
{
  type: "res",
  id: string,        // matches request.id
  ok: boolean,       // success or failure
  payload?: unknown, // method-specific response data (when ok=true)
  error?: {          // ErrorShape (when ok=false)
    code: string,
    message: string,
    details?: unknown,
    retryable?: boolean,
    retryAfterMs?: number
  }
}
```

**Error Codes:**

| Code              | Meaning                              |
| ----------------- | ------------------------------------ |
| `NOT_LINKED`      | Channel/account not linked           |
| `NOT_PAIRED`      | Device not paired                    |
| `AGENT_TIMEOUT`   | Agent execution timed out            |
| `INVALID_REQUEST` | Bad parameters or validation failure |
| `UNAVAILABLE`     | Service temporarily unavailable      |

### 2.3 Event Frame (Server → Client, broadcast)

```typescript
{
  type: "event",
  event: string,            // event type name
  payload?: unknown,        // event-specific data
  seq?: number,             // global monotonic sequence (broadcast only)
  stateVersion?: {
    presence?: number,
    health?: number
  }
}
```

### 2.4 Constants

| Constant                     | Value                  |
| ---------------------------- | ---------------------- |
| `MAX_PAYLOAD_BYTES`          | 25 MB                  |
| `MAX_BUFFERED_BYTES`         | 50 MB (per connection) |
| `MAX_PREAUTH_PAYLOAD_BYTES`  | 64 KB                  |
| `TICK_INTERVAL_MS`           | 30,000 ms              |
| `HEALTH_REFRESH_INTERVAL_MS` | 60,000 ms              |
| `HANDSHAKE_TIMEOUT_MS`       | 3,000 ms               |
| `DEDUPE_TTL_MS`              | 5 minutes              |
| `DEDUPE_MAX`                 | 1,000 entries          |

---

## 3. Connection Lifecycle

### 3.1 Handshake Flow

```
Client                          Gateway
  │                               │
  │── TCP WebSocket upgrade ─────►│
  │                               │
  │◄── event: connect.challenge ──│  { nonce: UUID, ts: milliseconds }
  │                               │
  │── req: connect ──────────────►│  (see ConnectParams below)
  │                               │
  │◄── res: hello-ok ────────────│  (see HelloOk below)
  │                               │
  │   (connection established)    │
  │                               │
  │── req: chat.send ────────────►│
  │◄── event: chat (delta) ──────│  (streaming)
  │◄── event: agent ─────────────│  (tool calls)
  │◄── event: chat (final) ──────│
  │                               │
  │◄── event: tick ──────────────│  (every 30s)
  │                               │
```

### 3.2 ConnectParams

```typescript
{
  minProtocol: 1,
  maxProtocol: 1,
  client: {
    id: GatewayClientId,           // see §3.3
    displayName?: string,
    version: string,               // app version
    platform: string,              // "darwin", "win32", "linux"
    deviceFamily?: string,         // "MacBookPro18,1"
    modelIdentifier?: string,      // hardware model
    mode: GatewayClientMode,       // see §3.3
    instanceId?: string            // unique instance UUID
  },
  caps?: string[],                 // capability flags, see §3.4
  commands?: string[],             // slash commands this client supports
  permissions?: Record<string, boolean>,
  pathEnv?: string,
  role?: string,                   // "operator" (default), "node", etc.
  scopes?: string[],               // e.g. ["operator.admin"]
  device?: {                       // device-based auth
    id: string,
    publicKey: string,
    signature: string,
    signedAt: number,              // timestamp ms
    nonce: string
  },
  auth?: {                         // auth credentials
    token?: string,                // shared secret token
    bootstrapToken?: string,       // first-time setup token
    deviceToken?: string,          // device-issued JWT
    password?: string              // password auth
  },
  locale?: string,
  userAgent?: string
}
```

### 3.3 Client Identity

**Client IDs** (for ClawWork, use `openclaw-macos`):

| ID                    | Purpose               |
| --------------------- | --------------------- |
| `webchat-ui`          | Browser WebChat UI    |
| `openclaw-control-ui` | Admin Control UI      |
| `openclaw-macos`      | macOS desktop app     |
| `openclaw-ios`        | iOS app               |
| `openclaw-android`    | Android app           |
| `cli`                 | Command-line client   |
| `gateway-client`      | Generic SDK client    |
| `node-host`           | Remote compute node   |
| `test`                | Automated testing     |
| `fingerprint`         | Device fingerprinting |
| `openclaw-probe`      | Health probing        |

**Client Modes:**

| Mode      | Purpose                                   |
| --------- | ----------------------------------------- |
| `webchat` | WebChat UI interface                      |
| `cli`     | Command-line interface                    |
| `ui`      | Desktop/Mobile UI (use this for ClawWork) |
| `backend` | Backend service                           |
| `node`    | Remote compute node                       |
| `probe`   | Health check probing                      |
| `test`    | Automated testing                         |

### 3.4 Capability Negotiation

Capabilities are requested in `ConnectParams.caps` and gate access to specific event streams.

| Capability    | Effect                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `tool-events` | Enables receiving `agent` events with tool-call details. Without this cap, tool events are not sent to the client. |

### 3.5 HelloOk Response

```typescript
{
  type: "hello-ok",
  protocol: 1,
  server: {
    version: string,     // e.g. "2026.3.14"
    connId: string       // UUID for this connection
  },
  features: {
    methods: string[],   // all available RPC methods
    events: string[]     // all possible event types
  },
  snapshot: {
    presence: PresenceEntry[],    // who is connected
    health: HealthSnapshot,       // system health
    stateVersion: {
      presence: number,
      health: number
    },
    uptimeMs: number,
    configPath?: string,
    stateDir?: string,
    sessionDefaults?: {
      defaultAgentId: string,     // default agent ID
      mainKey: string,            // main session key template
      mainSessionKey: string,     // resolved main session key
      scope?: string
    },
    authMode?: "none" | "token" | "password" | "trusted-proxy",
    updateAvailable?: {
      currentVersion: string,
      latestVersion: string,
      channel: string
    }
  },
  canvasHostUrl?: string,
  auth?: {
    deviceToken: string,    // issued device token (store for reconnection)
    role: string,
    scopes: string[],
    issuedAtMs?: number
  },
  policy: {
    maxPayload: number,        // bytes per frame (25MB)
    maxBufferedBytes: number,  // per-connection buffer limit (50MB)
    tickIntervalMs: number     // heartbeat interval (30s)
  }
}
```

---

## 4. Events (Server → Client)

Gateway broadcasts 19 event types. All events use the Event Frame format.

### 4.1 Event Types

| Event                     | Payload                                      | `dropIfSlow`          | Scope Guard          | Purpose                   |
| ------------------------- | -------------------------------------------- | --------------------- | -------------------- | ------------------------- |
| `connect.challenge`       | `{ nonce, ts }`                              | No                    | —                    | Auth handshake            |
| `chat`                    | ChatEvent                                    | delta: Yes, final: No | —                    | Message streaming         |
| `agent`                   | AgentEvent                                   | Tool: Yes             | —                    | Agent execution events    |
| `presence`                | PresenceEntry[]                              | No                    | —                    | Client connect/disconnect |
| `tick`                    | `{ ts }`                                     | Yes                   | —                    | Heartbeat (30s)           |
| `health`                  | HealthSnapshot                               | Yes                   | —                    | System health (60s)       |
| `heartbeat`               | varies                                       | Yes                   | —                    | Agent heartbeat ACK       |
| `shutdown`                | `{ reason, restartExpectedMs? }`             | No                    | —                    | Graceful shutdown         |
| `talk.mode`               | varies                                       | No                    | —                    | Voice mode change         |
| `cron`                    | CronEvent                                    | No                    | —                    | Cron job events           |
| `node.pair.requested`     | varies                                       | No                    | `operator.pairing`   | Node pairing request      |
| `node.pair.resolved`      | varies                                       | No                    | `operator.pairing`   | Node pairing result       |
| `node.invoke.request`     | varies                                       | No                    | —                    | Node task dispatch        |
| `device.pair.requested`   | varies                                       | No                    | `operator.pairing`   | Device pairing request    |
| `device.pair.resolved`    | varies                                       | No                    | `operator.pairing`   | Device pairing result     |
| `voicewake.changed`       | varies                                       | No                    | —                    | Voice wake config         |
| `exec.approval.requested` | varies                                       | No                    | `operator.approvals` | Execution approval        |
| `exec.approval.resolved`  | varies                                       | No                    | `operator.approvals` | Approval resolution       |
| `update-available`        | `{ currentVersion, latestVersion, channel }` | No                    | —                    | Software update           |

**Scope Guards:**

- `operator.admin` — has access to all scoped events
- `operator.approvals` — exec approval events
- `operator.pairing` — device/node pairing events

### 4.2 Chat Event (event: `chat`)

The primary event for receiving AI responses. Streams incrementally.

```typescript
{
  runId: string,          // unique run identifier
  sessionKey: string,     // session this message belongs to
  seq: number,            // monotonic sequence within the run
  state: "delta" | "final" | "aborted" | "error",
  message?: {
    role: "assistant",
    content: [{ type: "text", text: string }],
    timestamp: number
  },
  errorMessage?: string,  // when state="error"
  usage?: unknown,        // token usage info
  stopReason?: string     // when state="final", e.g. "end_turn"
}
```

**State machine:**

```
         ┌─────────┐
         │  delta   │──► (repeated, throttled at 150ms)
         └────┬────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 ┌──────┐ ┌───────┐ ┌───────┐
 │final │ │aborted│ │ error │
 └──────┘ └───────┘ └───────┘
```

- **delta**: Streamed text fragment. Throttled at 150ms intervals. `message.content[0].text` contains the **full accumulated text** up to this point (not just the delta).
- **final**: Complete response. Contains final text (or `undefined` message if suppressed). May include `stopReason`.
- **aborted**: User-initiated abort via `chat.abort`.
- **error**: Execution failure. `errorMessage` contains details.

### 4.3 Agent Event (event: `agent`)

Requires `caps: ["tool-events"]` capability. Provides granular agent execution visibility.

```typescript
{
  runId: string,                    // same as chat event runId
  seq: number,                      // monotonic within the run
  stream: string,                   // event stream type
  ts: number,                       // timestamp in milliseconds
  sessionKey?: string,              // added by server for routing
  data: Record<string, unknown>     // stream-specific data
}
```

**Stream types:**

| stream      | data fields                                       | description              |
| ----------- | ------------------------------------------------- | ------------------------ |
| `assistant` | `{ text, delta }`                                 | Text generation fragment |
| `tool`      | `{ phase, name, args?, result?, partialResult? }` | Tool invocation          |
| `lifecycle` | `{ phase, error?, stopReason? }`                  | Run lifecycle            |
| `error`     | `{ reason, expected?, received? }`                | Sequence errors          |

**Tool event phases:**

- `phase: "start"` — tool invocation begins, includes `name` and `args`
- `phase: "end"` — tool invocation complete, includes `result` (stripped unless `verboseLevel=full`)

**Lifecycle event phases:**

- `phase: "start"` — agent run begins
- `phase: "end"` — agent run completes normally, may include `stopReason`
- `phase: "error"` — agent run failed, includes `error`

**Tool Event Delivery:**
Tool events use **targeted delivery**, not broadcast. Only connections that:

1. Have `caps: ["tool-events"]`
2. Are registered for the specific `runId`

receive tool events. Registration happens automatically when a client sends `chat.send`. TTL is 10 minutes (refreshed on activity), with a 30-second grace period after run finalization.

### 4.4 Broadcast Behavior

- Events broadcast to **all connected clients** (except targeted tool events)
- **No server-side session filtering** — client must route by `sessionKey`
- Slow consumers (bufferedAmount > 50MB) are disconnected with code `1008`
- Events marked `dropIfSlow: true` are silently dropped for slow consumers instead of disconnecting
- Global `seq` counter for ordering broadcast events

---

## 5. RPC Methods Reference

### 5.1 Complete Method List

```
health                    doctor.memory.status      logs.tail
channels.status           channels.logout
status                    usage.status              usage.cost
tts.status                tts.providers             tts.enable
tts.disable               tts.convert               tts.setProvider
config.get                config.set                config.apply
config.patch              config.schema             config.schema.lookup
exec.approvals.get        exec.approvals.set        exec.approvals.node.get
exec.approvals.node.set   exec.approval.request     exec.approval.waitDecision
exec.approval.resolve
wizard.start              wizard.next               wizard.cancel
wizard.status
talk.config               talk.mode
models.list               tools.catalog
agents.list               agents.create             agents.update
agents.delete             agents.files.list         agents.files.get
agents.files.set
skills.status             skills.bins               skills.install
skills.update
update.run
voicewake.get             voicewake.set
secrets.reload            secrets.resolve
sessions.list             sessions.preview          sessions.patch
sessions.reset            sessions.delete           sessions.compact
last-heartbeat            set-heartbeats            wake
node.pair.request         node.pair.list            node.pair.approve
node.pair.reject          node.pair.verify
device.pair.list          device.pair.approve       device.pair.reject
device.pair.remove        device.token.rotate       device.token.revoke
node.rename               node.list                 node.describe
node.pending.drain        node.pending.enqueue      node.pending.pull
node.pending.ack          node.invoke               node.invoke.result
node.event                node.canvas.capability.refresh
cron.list                 cron.status               cron.add
cron.update               cron.remove               cron.run
cron.runs
gateway.identity.get      system-presence           system-event
send                      agent                     agent.identity.get
agent.wait                browser.request
chat.history              chat.abort                chat.send
```

Channel plugins may register additional methods.

### 5.2 Chat Methods (Core for ClawWork)

#### `chat.send`

Send a user message to a session. Triggers agent execution and streaming response.

```typescript
// Request
{
  sessionKey: string,               // e.g. "agent:main:clawwork:task:<taskId>"
  message: string,                  // user message text
  thinking?: string,                // thinking/reasoning prompt level
  deliver?: boolean,                // false = no external channel delivery (use false)
  attachments?: unknown[],          // file attachments
  timeoutMs?: number,               // request timeout
  systemInputProvenance?: {         // input source tracking
    source: string,
    channel?: string
  },
  systemProvenanceReceipt?: string,
  idempotencyKey: string            // UUID for deduplication (REQUIRED)
}

// Response
{
  ok: true,
  payload: {
    runId: string,                  // use this to correlate chat/agent events
    sessionId: string
  }
}
```

After `chat.send` returns, the response streams via `event:"chat"` and `event:"agent"` broadcasts.

#### `chat.history`

Fetch session message history.

```typescript
// Request
{
  sessionKey: string,
  limit?: number                    // 1-1000, default 200
}

// Response
{
  ok: true,
  payload: {
    messages: Array<{
      role: "user" | "assistant" | "system",
      content: Array<{ type: string, text?: string, ... }>,
      timestamp?: number
    }>
  }
}
```

Max response size: 6 MB.

#### `chat.abort`

Abort an ongoing agent run.

```typescript
// Request
{
  sessionKey: string,
  runId?: string                    // specific run to abort; if omitted, aborts current
}
```

After abort, a `chat` event with `state: "aborted"` is broadcast.

#### `chat.inject`

Inject a system message into a session (admin/testing).

```typescript
// Request
{
  sessionKey: string,
  message: string,
  label?: string                    // max 100 chars
}
```

### 5.3 Session Methods

#### `sessions.list`

```typescript
// Request
{
  limit?: number,
  activeMinutes?: number,           // filter: only sessions active within N minutes
  includeGlobal?: boolean,
  includeUnknown?: boolean,
  includeDerivedTitles?: boolean,   // reads first 8KB per session (expensive)
  includeLastMessage?: boolean,     // reads last 16KB per session (expensive)
  label?: string,                   // filter by label
  spawnedBy?: string,               // filter by parent session
  agentId?: string,                 // filter by agent
  search?: string                   // text search
}
```

#### `sessions.preview`

Get preview snippets for multiple sessions.

```typescript
// Request
{
  keys: string[],                   // session keys (min 1)
  limit?: number,
  maxChars?: number                 // min 20
}

// Response per session
{
  key: string,
  status: "missing" | "empty" | "ok" | "error",
  items: object[]
}
```

#### `sessions.patch`

Modify session metadata.

```typescript
// Request
{
  key: string,
  label?: string | null,
  thinkingLevel?: string | null,
  fastMode?: boolean | null,
  verboseLevel?: string | null,
  reasoningLevel?: string | null,
  responseUsage?: "off" | "tokens" | "full" | "on" | null,
  elevatedLevel?: string | null,
  execHost?: string | null,
  execSecurity?: string | null,
  execAsk?: string | null,
  execNode?: string | null,
  model?: string | null,            // override LLM model for this session
  spawnedBy?: string | null,
  spawnedWorkspaceDir?: string | null,
  spawnDepth?: number | null,
  subagentRole?: "orchestrator" | "leaf" | null,
  subagentControlScope?: "children" | "none" | null,
  sendPolicy?: "allow" | "deny" | null,
  groupActivation?: "mention" | "always" | null
}
```

#### `sessions.reset`

```typescript
{
  key: string,
  reason?: "new" | "reset"          // "new" = fresh session, "reset" = restart context
}
```

#### `sessions.delete`

```typescript
{
  key: string,
  deleteTranscript?: boolean        // also remove transcript files
}
```

#### `sessions.compact`

Compress session transcript.

```typescript
{
  key: string,
  maxLines?: number                 // min 1
}
```

### 5.4 Agent Methods

#### `agent`

Full-featured agent invocation (superset of `chat.send`).

```typescript
{
  message: string,                  // REQUIRED
  agentId?: string,                 // specific agent
  to?: string,                      // delivery target
  replyTo?: string,                 // reply to message
  sessionId?: string,
  sessionKey?: string,
  thinking?: string,
  deliver?: boolean,
  attachments?: unknown[],
  channel?: string,
  replyChannel?: string,
  accountId?: string,
  replyAccountId?: string,
  threadId?: string,
  groupId?: string,
  groupChannel?: string,
  groupSpace?: string,
  timeout?: number,                 // ms
  bestEffortDeliver?: boolean,
  lane?: string,                    // concurrency lane
  extraSystemPrompt?: string,       // additional system instructions
  internalEvents?: AgentInternalEvent[],
  inputProvenance?: InputProvenance,
  idempotencyKey: string,           // REQUIRED
  label?: string                    // session label
}
```

#### `agent.identity.get`

```typescript
// Request
{ agentId?: string, sessionKey?: string }

// Response
{
  agentId: string,
  name?: string,
  avatar?: string,                  // avatar file path
  emoji?: string                    // emoji identifier
}
```

#### `agent.wait`

Wait for an agent run to complete.

```typescript
// Request
{ runId: string, timeoutMs?: number }
```

### 5.5 Agent & Model Management

#### `agents.list`

```typescript
// Response
{
  defaultId: string,
  mainKey: string,
  scope: "per-sender" | "global",
  agents: Array<{
    id: string,
    name?: string,
    identity?: {
      name?: string,
      theme?: string,
      emoji?: string,
      avatar?: string,
      avatarUrl?: string
    }
  }>
}
```

#### `agents.create`

```typescript
// Request
{ name: string, workspace: string, emoji?: string, avatar?: string }

// Response
{ ok: true, agentId: string, name: string, workspace: string }
```

#### `agents.update`

```typescript
{ agentId: string, name?: string, workspace?: string, model?: string, avatar?: string }
```

#### `agents.delete`

```typescript
{ agentId: string, deleteFiles?: boolean }
// Response: { ok: true, agentId: string, removedBindings: number }
```

#### `agents.files.list` / `agents.files.get` / `agents.files.set`

Manage agent configuration files (system prompt, etc).

```typescript
// files.list
{ agentId: string }
// Response: { agentId, workspace, files: AgentFileEntry[] }

// files.get
{ agentId: string, name: string }
// Response: { agentId, workspace, file: AgentFileEntry }

// files.set
{ agentId: string, name: string, content: string }
// Response: { ok: true, agentId, workspace, file: AgentFileEntry }

// AgentFileEntry
{
  name: string,
  path: string,
  missing: boolean,
  size?: number,
  updatedAtMs?: number,
  content?: string
}
```

#### `models.list`

```typescript
// Response
{
  models: Array<{
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
    reasoning?: boolean;
  }>;
}
```

#### `tools.catalog`

```typescript
// Request
{ agentId?: string, includePlugins?: boolean }

// Response
{
  agentId: string,
  profiles: Array<{
    id: "minimal" | "coding" | "messaging" | "full",
    label: string
  }>,
  groups: Array<{
    id: string,
    label: string,
    source: "core" | "plugin",
    pluginId?: string,
    tools: Array<{
      id: string,
      label: string,
      description: string,
      source: "core" | "plugin",
      pluginId?: string,
      optional?: boolean,
      defaultProfiles: ("minimal" | "coding" | "messaging" | "full")[]
    }>
  }>
}
```

### 5.6 External Messaging

#### `send`

Send a message to an external channel (Telegram, Discord, etc).

```typescript
{
  to: string,                       // recipient identifier
  message?: string,
  mediaUrl?: string,                // single media URL
  mediaUrls?: string[],             // multiple media URLs
  gifPlayback?: boolean,
  channel?: string,                 // target channel plugin
  accountId?: string,
  agentId?: string,                 // for media root resolution
  threadId?: string,                // channel-specific thread
  sessionKey?: string,              // mirror output to transcript
  idempotencyKey: string
}
```

### 5.7 Configuration Methods

#### `config.get` / `config.set` / `config.patch` / `config.apply`

Read and modify server configuration at runtime.

#### `config.schema` / `config.schema.lookup`

Get JSON Schema for configuration validation.

### 5.8 Cron Methods

Scheduled task management.

#### `cron.add`

```typescript
{
  name: string,
  agentId?: string | null,
  sessionKey?: string | null,
  description?: string,
  enabled?: boolean,
  deleteAfterRun?: boolean,
  schedule: CronSchedule,
  sessionTarget: "main" | "isolated" | "current" | "session:...",
  wakeMode: "next-heartbeat" | "now",
  payload: CronPayload,
  delivery?: CronDelivery,
  failureAlert?: false | CronFailureAlert
}
```

**Schedule types:**

```typescript
// One-time
{ kind: "at", at: string }                    // ISO datetime

// Interval
{ kind: "every", everyMs: number, anchorMs?: number }

// Cron expression
{ kind: "cron", expr: string, tz?: string, staggerMs?: number }
```

**Payload types:**

```typescript
// System event
{ kind: "systemEvent", text: string }

// Agent turn
{
  kind: "agentTurn",
  message: string,
  model?: string,
  fallbacks?: string[],
  thinking?: string,
  timeoutSeconds?: number,
  deliver?: boolean,
  channel?: string,
  to?: string,
  bestEffortDeliver?: boolean
}
```

#### `cron.list`

```typescript
{
  includeDisabled?: boolean,
  limit?: number,                   // 1-200
  offset?: number,
  query?: string,
  enabled?: "all" | "enabled" | "disabled",
  sortBy?: "nextRunAtMs" | "updatedAtMs" | "name",
  sortDir?: "asc" | "desc"
}
```

#### `cron.run`

```typescript
{ id: string, mode?: "due" | "force" }
// or
{ jobId: string, mode?: "due" | "force" }
```

#### `cron.runs`

Get execution history.

```typescript
{
  scope?: "job" | "all",
  id?: string,
  jobId?: string,
  limit?: number,                   // 1-200
  offset?: number,
  statuses?: ("ok" | "error" | "skipped")[],
  deliveryStatuses?: ("delivered" | "not-delivered" | "unknown" | "not-requested")[],
  query?: string,
  sortDir?: "asc" | "desc"
}
```

### 5.9 Skills Methods

#### `skills.status`

```typescript
{ agentId?: string }
```

#### `skills.install`

```typescript
{ name: string, installId: string, timeoutMs?: number }  // min 1000ms
```

#### `skills.update`

```typescript
{ skillKey: string, enabled?: boolean, apiKey?: string, env?: Record<string, string> }
```

### 5.10 Node Methods

Remote compute node management.

| Method                 | Purpose                  |
| ---------------------- | ------------------------ |
| `node.list`            | List connected nodes     |
| `node.describe`        | Get node capabilities    |
| `node.rename`          | Rename a node            |
| `node.invoke`          | Execute command on node  |
| `node.invoke.result`   | Return invocation result |
| `node.event`           | Report node event        |
| `node.pending.enqueue` | Queue work for a node    |
| `node.pending.drain`   | Drain pending queue      |
| `node.pending.pull`    | Pull next pending item   |
| `node.pending.ack`     | Acknowledge completion   |
| `node.pair.request`    | Initiate pairing         |
| `node.pair.list`       | List pairing requests    |
| `node.pair.approve`    | Approve pairing          |
| `node.pair.reject`     | Reject pairing           |
| `node.pair.verify`     | Verify paired node       |

### 5.11 Device Methods

Device authentication lifecycle.

| Method                | Purpose                      |
| --------------------- | ---------------------------- |
| `device.pair.list`    | List pending device pairings |
| `device.pair.approve` | Approve device               |
| `device.pair.reject`  | Reject device                |
| `device.pair.remove`  | Remove paired device         |
| `device.token.rotate` | Rotate device token          |
| `device.token.revoke` | Revoke device token          |

### 5.12 Execution Approval

Interactive approval workflow for agent actions.

| Method                       | Purpose                        |
| ---------------------------- | ------------------------------ |
| `exec.approval.request`      | Request approval for an action |
| `exec.approval.waitDecision` | Wait for approval decision     |
| `exec.approval.resolve`      | Approve or reject              |
| `exec.approvals.get`         | Get approval settings          |
| `exec.approvals.set`         | Set approval settings          |
| `exec.approvals.node.get`    | Get node approval settings     |
| `exec.approvals.node.set`    | Set node approval settings     |

### 5.13 Other Methods

| Method                            | Purpose                                             |
| --------------------------------- | --------------------------------------------------- |
| `health`                          | Gateway health status                               |
| `status`                          | System status                                       |
| `usage.status`                    | Token/cost usage stats                              |
| `usage.cost`                      | Cost breakdown                                      |
| `logs.tail`                       | Stream gateway log lines                            |
| `gateway.identity.get`            | Gateway instance identity                           |
| `system-presence`                 | Current presence snapshot                           |
| `system-event`                    | Emit system event                                   |
| `wake`                            | `{ mode: "now" \| "next-heartbeat", text: string }` |
| `browser.request`                 | Browser integration                                 |
| `wizard.start/next/cancel/status` | Onboarding wizard                                   |
| `channels.status`                 | Channel connection status                           |
| `channels.logout`                 | Disconnect channel                                  |
| `update.run`                      | Trigger software update                             |
| `doctor.memory.status`            | Memory diagnostics                                  |

---

## 6. HTTP Endpoints

In addition to WebSocket, Gateway exposes HTTP endpoints:

| Path                   | Method  | Purpose                      |
| ---------------------- | ------- | ---------------------------- |
| `/health`, `/healthz`  | GET     | Liveness probe               |
| `/ready`, `/readyz`    | GET     | Readiness probe              |
| `/v1/chat/completions` | POST    | OpenAI-compatible chat API   |
| `/v1/responses`        | POST    | OpenResponses API            |
| Agent avatar URLs      | GET     | Serve agent avatar images    |
| Canvas WS path         | WS      | Canvas collaboration         |
| Plugin routes          | Various | Channel plugin HTTP handlers |

The `/v1/chat/completions` endpoint allows OpenAI-compatible integration, but for ClawWork the WebSocket protocol is the primary interface.

---

## 7. Authentication

### 7.1 Auth Modes

Gateway supports four authentication modes (configured server-side):

| Mode            | ConnectParams field | Description                 |
| --------------- | ------------------- | --------------------------- |
| `none`          | —                   | No auth required            |
| `token`         | `auth.token`        | Shared secret token         |
| `password`      | `auth.password`     | Password authentication     |
| `trusted-proxy` | —                   | Trust reverse proxy headers |

Device-based auth (`auth.deviceToken` or `device.*` fields) is an additional layer.

### 7.2 Rate Limiting

| Scope           | Max Attempts | Window | Lockout |
| --------------- | ------------ | ------ | ------- |
| `shared-secret` | 10           | 60s    | 300s    |
| `device-token`  | 10           | 60s    | 300s    |
| `hook-auth`     | 20           | 60s    | 300s    |
| `default`       | 10           | 60s    | 300s    |

Loopback addresses (`127.0.0.1`, `::1`) are exempt by default.

### 7.3 Roles & Scopes

Roles control method and event access:

- `operator` — default role for human users
- `node` — compute node role

Scopes (carried in `ConnectParams.scopes`):

- `operator.admin` — full access to all scoped events
- `operator.approvals` — exec approval events
- `operator.pairing` — device/node pairing events

---

## 8. Session Key Format

Session keys uniquely identify conversation contexts:

```
agent:<agentKey>:<scope>:<label>
```

For ClawWork:

```
agent:main:clawwork:task:<taskId>
```

- Sessions are created implicitly on first `chat.send`
- Each session maintains an independent conversation transcript
- Sessions persist across reconnections
- Sessions auto-reset at 4 AM (configurable server-side)

---

## 9. Message Format

Messages in `chat` events and `chat.history` responses follow this structure:

```typescript
{
  role: "user" | "assistant" | "system",
  content: ContentBlock[],
  timestamp?: number
}

// ContentBlock types
{ type: "text", text: string }
// (other types: image, file, tool_use, tool_result, etc.)
```

---

## 10. ClawWork Integration Guide

### 10.1 Connection Setup

1. Open WebSocket to `ws://localhost:18789`
2. Wait for `connect.challenge` event
3. Send `connect` request with:
   - `client.id`: `"openclaw-macos"`
   - `client.mode`: `"ui"`
   - `caps`: `["tool-events"]`
   - `auth`: appropriate credentials
4. Receive `hello-ok` with server snapshot
5. Store `auth.deviceToken` for reconnection

### 10.2 Sending a Message

```typescript
// 1. Send chat.send
ws.send(
  JSON.stringify({
    type: 'req',
    id: uuid(),
    method: 'chat.send',
    params: {
      sessionKey: `agent:main:clawwork:task:${taskId}`,
      message: 'Hello',
      deliver: false,
      idempotencyKey: uuid(),
    },
  }),
);

// 2. Listen for response
// { type: "res", id: "...", ok: true, payload: { runId: "...", sessionId: "..." } }

// 3. Listen for streaming events
// event: "chat" with state: "delta" (repeated)
// event: "agent" with stream: "tool" (if tool-events cap)
// event: "chat" with state: "final" (once)
```

### 10.3 Capabilities ClawWork Can Leverage

| Capability          | Gateway Support                        | ClawWork Feature             |
| ------------------- | -------------------------------------- | ---------------------------- |
| Multi-session       | `sessions.list`, unique sessionKeys    | Parallel task execution      |
| Streaming responses | `chat` events with delta/final         | Real-time response rendering |
| Tool visibility     | `agent` events with tool-events cap    | Tool-call progress UI        |
| Session management  | `sessions.patch`, `sessions.reset`     | Task configuration           |
| Model selection     | `models.list`, `sessions.patch(model)` | Per-task model override      |
| Agent management    | `agents.*` methods                     | Multi-agent workflows        |
| Cron scheduling     | `cron.*` methods                       | Automated recurring tasks    |
| Message history     | `chat.history`                         | Session restoration          |
| Abort               | `chat.abort`                           | Cancel running tasks         |
| Usage tracking      | `usage.status`, `usage.cost`           | Token/cost dashboard         |
| Skills              | `skills.*` methods                     | Skill management UI          |
| Exec approval       | `exec.approval.*` events/methods       | Interactive approval gates   |
| Health monitoring   | `health` events                        | Server status indicator      |
| Thinking/reasoning  | `sessions.patch(thinkingLevel)`        | Thinking mode toggle         |

### 10.4 What ClawWork Should NOT Do

- Do NOT use `deliver: true` in `chat.send` (this sends to external channels)
- Do NOT use `send` method (this is for external channel delivery)
- Do NOT create custom channel plugins
- Do NOT bypass Gateway with direct agent engine access
- Do NOT rely on server-side session filtering (filter by sessionKey client-side)

---

## 11. Source File Reference

| Domain                    | Key File                                              | Lines |
| ------------------------- | ----------------------------------------------------- | ----- |
| Frame types               | `src/gateway/protocol/schema/frames.ts`               | 165   |
| Client identity           | `src/gateway/protocol/client-info.ts`                 | 87    |
| Method registry           | `src/gateway/server-methods-list.ts`                  | 134   |
| Chat schemas              | `src/gateway/protocol/schema/logs-chat.ts`            | 84    |
| Agent schemas             | `src/gateway/protocol/schema/agent.ts`                | 138   |
| Session schemas           | `src/gateway/protocol/schema/sessions.ts`             | 140   |
| Snapshot schema           | `src/gateway/protocol/schema/snapshot.ts`             | 73    |
| Agent/model/skill schemas | `src/gateway/protocol/schema/agents-models-skills.ts` | 271   |
| Cron schemas              | `src/gateway/protocol/schema/cron.ts`                 | 376   |
| Error codes               | `src/gateway/protocol/schema/error-codes.ts`          | 24    |
| Chat streaming            | `src/gateway/server-chat.ts`                          | 643   |
| Broadcast engine          | `src/gateway/server-broadcast.ts`                     | 132   |
| Constants                 | `src/gateway/server-constants.ts`                     | 34    |
| Server startup            | `src/gateway/server.impl.ts`                          | ~1500 |
| WS message handler        | `src/gateway/server/ws-connection/message-handler.ts` | ~1300 |
| Chat RPC impl             | `src/gateway/server-methods/chat.ts`                  | ~1500 |
| Session RPC impl          | `src/gateway/server-methods/sessions.ts`              | —     |
| Command registry          | `src/auto-reply/commands-registry.data.ts`            | ~600  |
