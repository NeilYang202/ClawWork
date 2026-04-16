import { ipcMain } from 'electron';
import { eq } from 'drizzle-orm';
import { getGatewayClient, getAllGatewayClients, reconnectGateway } from '../ws/index.js';
import { readConfig, ensureDeviceId } from '../workspace/config.js';
import {
  isClawWorkSession,
  isSubagentSession,
  parseTaskIdFromSessionKey,
  parseAgentIdFromSessionKey,
} from '@clawwork/shared';
import { parseToolArgs } from '@clawwork/core';
import type {
  ApprovalDecision,
  ChatAttachment,
  ConfigPatchParams,
  ConfigSetParams,
  ExecApprovalResolveParams,
  SkillInstallParams,
  SkillSearchParams,
  SkillUpdateParams,
} from '@clawwork/shared';
import { getDebugLogger } from '../debug/index.js';
import type { GatewayClient } from '../ws/gateway-client.js';
import { assertAuthToken, getAuthStatus, getCurrentUserName, isCurrentUserAdmin } from '../auth/session.js';
import { getCachedRuntimeAccessControl } from '../auth/runtime-config.js';
import { buildUploadInjection, uploadAttachmentsToObs } from '../obs/upload.js';
import type { UploadedFileRef } from '../obs/upload.js';
import { getDb, isDbReady } from '../db/index.js';
import { tasks, taskRoomSessions } from '../db/schema.js';

async function gatewayRpc(
  gatewayId: string,
  fn: (gw: GatewayClient) => Promise<Record<string, unknown> | void>,
  opts?: { requireAuth?: boolean },
): Promise<{
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
}> {
  if (opts?.requireAuth !== false) {
    const auth = assertAuthToken();
    if (!auth.ok) return { ok: false, error: auth.error, errorCode: auth.errorCode };
  }
  const gw = getGatewayClient(gatewayId);
  if (!gw?.isConnected) return { ok: false, error: 'gateway not connected', errorCode: 'GATEWAY_NOT_CONNECTED' };
  try {
    const result = await fn(gw);
    return result ? { ok: true, result } : { ok: true };
  } catch (err) {
    const typed = err as Error & { code?: string; details?: Record<string, unknown> };
    return {
      ok: false,
      error: typed.message ?? 'unknown error',
      errorCode: typed.code,
      errorDetails: typed.details,
    };
  }
}

interface GatewaySessionRow {
  key: string;
  sessionId?: string;
  updatedAt: number | null;
  derivedTitle?: string;
  label?: string;
  displayName?: string;
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  reasoningLevel?: string;
  fastMode?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
}

interface SessionsListPayload {
  sessions?: GatewaySessionRow[];
}

interface ChatHistoryMessage {
  role: string;
  content: {
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    arguments?: unknown;
    result?: unknown;
  }[];
  timestamp?: number;
}

interface ChatHistoryPayload {
  messages?: ChatHistoryMessage[];
  sessionId?: string;
}

const INTERNAL_ASSISTANT_MARKERS = new Set(['NO_REPLY']);
const uploadedRefsBySession = new Map<string, UploadedFileRef[]>();
const PROFILE_DOC_NAMES = new Set(['IDENTITY.md', 'USER.md', 'SOUL.md']);

interface AgentCatalogPayload {
  defaultId?: string;
  agents?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

function resolveAllowedAgents(gatewayId: string): Set<string> | null {
  const auth = getAuthStatus();
  if (!auth.authEnabled) return null;
  if (isCurrentUserAdmin()) return null;
  const ac = getCachedRuntimeAccessControl();
  if (!ac || ac.enabled === false) return new Set();
  const user = getCurrentUserName();
  if (!user) return new Set();
  const bindings = ac.bindings ?? [];
  const matched = bindings
    .filter((b) => b.gatewayId === gatewayId && b.username.trim().toLowerCase() === user)
    .map((b) => b.agentId);
  return new Set(matched);
}

function assertAgentAllowed(
  gatewayId: string,
  agentId: string,
): { ok: true } | { ok: false; error: string; errorCode: string } {
  const allowed = resolveAllowedAgents(gatewayId);
  if (allowed === null) return { ok: true };
  if (allowed.has(agentId)) return { ok: true };
  return { ok: false, error: 'agent is not allowed for current user', errorCode: 'AGENT_FORBIDDEN' };
}

function assertInfraManageAllowed(): { ok: true } | { ok: false; error: string; errorCode: string } {
  const auth = getAuthStatus();
  if (!auth.authEnabled) return { ok: true };
  if (isCurrentUserAdmin()) return { ok: true };
  return { ok: false, error: 'admin required', errorCode: 'ADMIN_REQUIRED' };
}

function resolveCurrentUserSingleBinding(
  gatewayId?: string,
): { ok: true; gatewayId: string; agentId: string } | { ok: false; error: string; errorCode: string } {
  const auth = getAuthStatus();
  if (!auth.authEnabled) {
    return { ok: false, error: 'auth not enabled', errorCode: 'AUTH_NOT_ENABLED' };
  }
  if (!auth.authenticated) {
    return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
  }
  const user = getCurrentUserName();
  if (!user) {
    return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
  }
  const ac = getCachedRuntimeAccessControl();
  if (!ac || ac.enabled === false) {
    return { ok: false, error: 'access control not configured', errorCode: 'ACCESS_CONTROL_NOT_CONFIGURED' };
  }
  const normalizedUser = user.trim().toLowerCase();
  const matched = (ac.bindings ?? []).filter((b) => {
    if (b.username.trim().toLowerCase() !== normalizedUser) return false;
    if (gatewayId && b.gatewayId !== gatewayId) return false;
    return Boolean(b.gatewayId && b.agentId);
  });
  if (matched.length === 0) {
    return { ok: false, error: 'no agent binding for current user', errorCode: 'AGENT_BINDING_NOT_FOUND' };
  }
  if (matched.length > 1) {
    return { ok: false, error: 'multiple agent bindings for current user', errorCode: 'AGENT_BINDING_CONFLICT' };
  }
  return { ok: true, gatewayId: matched[0].gatewayId, agentId: matched[0].agentId };
}

function filterAgentCatalog(gatewayId: string, payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = resolveAllowedAgents(gatewayId);
  if (allowed === null) return payload;
  const data = payload as AgentCatalogPayload;
  const original = data.agents ?? [];
  const agents = original.filter((agent) => allowed.has(agent.id));
  const defaultId = agents.some((a) => a.id === data.defaultId) ? data.defaultId : (agents[0]?.id ?? '');
  return { ...payload, agents, defaultId };
}

function filterSessionsByAgent(gatewayId: string, sessions: GatewaySessionRow[]): GatewaySessionRow[] {
  const allowed = resolveAllowedAgents(gatewayId);
  if (allowed === null) return sessions;
  return sessions.filter((session) => allowed.has(parseAgentIdFromSessionKey(session.key)));
}

function canAccessTaskId(taskId: string | null): boolean {
  const auth = getAuthStatus();
  if (!auth.authEnabled) return true;
  if (isCurrentUserAdmin()) return true;
  if (!auth.authenticated) return false;
  const user = getCurrentUserName();
  if (!user || !taskId || !isDbReady()) return false;
  const db = getDb();
  const row = db.select({ ownerUser: tasks.ownerUser }).from(tasks).where(eq(tasks.id, taskId)).get();
  return row?.ownerUser === user;
}

function canAccessSessionKey(sessionKey: string): boolean {
  const taskId = parseTaskIdFromSessionKey(sessionKey);
  if (taskId) return canAccessTaskId(taskId);
  if (!isSubagentSession(sessionKey)) return false;

  const auth = getAuthStatus();
  if (!auth.authEnabled) return true;
  if (isCurrentUserAdmin()) return true;
  if (!auth.authenticated) return false;
  const user = getCurrentUserName();
  if (!user || !isDbReady()) return false;
  const db = getDb();
  const room = db
    .select({ taskId: taskRoomSessions.taskId })
    .from(taskRoomSessions)
    .where(eq(taskRoomSessions.sessionKey, sessionKey))
    .get();
  if (!room?.taskId) return false;
  return canAccessTaskId(room.taskId);
}

function assertSessionAllowed(
  gatewayId: string,
  sessionKey: string,
): { ok: true } | { ok: false; error: string; errorCode: string } {
  if (isSubagentSession(sessionKey)) {
    if (canAccessSessionKey(sessionKey)) return { ok: true };
    return { ok: false, error: 'session is not allowed for current user', errorCode: 'SESSION_FORBIDDEN' };
  }

  const agentGuard = assertAgentAllowed(gatewayId, parseAgentIdFromSessionKey(sessionKey));
  if (!agentGuard.ok) return agentGuard;
  if (canAccessSessionKey(sessionKey)) return { ok: true };
  return { ok: false, error: 'session is not allowed for current user', errorCode: 'SESSION_FORBIDDEN' };
}

function filterSessionsByOwner(sessions: GatewaySessionRow[]): GatewaySessionRow[] {
  return sessions.filter((session) => canAccessTaskId(parseTaskIdFromSessionKey(session.key)));
}

/** Parsed tool call for transport to renderer */
interface ParsedToolCall {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  args?: Record<string, unknown>;
  result?: string;
  startedAt: string;
  completedAt?: string;
}

export function registerWsHandlers(): void {
  ipcMain.handle(
    'ws:send-message',
    async (
      _event,
      payload: {
        gatewayId: string;
        sessionKey: string;
        content: string;
        attachments?: ChatAttachment[];
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) {
        return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      }
      const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
      if (!sessionGuard.ok) return sessionGuard;
      const taskId = parseTaskIdFromSessionKey(payload.sessionKey) ?? undefined;
      getDebugLogger().info({
        domain: 'ipc',
        event: 'ipc.ws.send-message.requested',
        gatewayId: payload.gatewayId,
        sessionKey: payload.sessionKey,
        taskId,
        data: { contentLength: payload.content.length, attachmentCount: payload.attachments?.length ?? 0 },
      });
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) {
        getDebugLogger().error({
          domain: 'ipc',
          event: 'ipc.ws.send-message.failed',
          gatewayId: payload.gatewayId,
          sessionKey: payload.sessionKey,
          taskId,
          error: { message: 'gateway not connected' },
        });
        return { ok: false, error: 'gateway not connected', errorCode: 'GATEWAY_NOT_CONNECTED' };
      }
      try {
        let contentToSend = payload.content;
        const attachments = payload.attachments ?? [];
        const config = readConfig();
        const uploaded = await uploadAttachmentsToObs({
          serviceUrl: config?.auth?.serviceUrl,
          gatewayId: payload.gatewayId,
          sessionKey: payload.sessionKey,
          attachments,
          token: authGuard.token || undefined,
        });
        const previous = uploadedRefsBySession.get(payload.sessionKey) ?? [];
        const merged = uploaded.length > 0 ? [...previous, ...uploaded] : previous;
        if (uploaded.length > 0) uploadedRefsBySession.set(payload.sessionKey, merged);
        const injection = buildUploadInjection(merged);
        if (injection) {
          contentToSend = `${injection}\n\n${contentToSend}`;
        }

        await gw.sendChatMessage(payload.sessionKey, contentToSend, payload.attachments);
        getDebugLogger().info({
          domain: 'ipc',
          event: 'ipc.ws.send-message.completed',
          gatewayId: payload.gatewayId,
          sessionKey: payload.sessionKey,
          taskId,
          ok: true,
        });
        return { ok: true };
      } catch (err) {
        const typed = err as Error & { code?: string; details?: Record<string, unknown> };
        const msg = typed.message ?? 'unknown error';
        getDebugLogger().error({
          domain: 'ipc',
          event: 'ipc.ws.send-message.failed',
          gatewayId: payload.gatewayId,
          sessionKey: payload.sessionKey,
          taskId,
          error: { message: msg, code: typed.code },
        });
        return { ok: false, error: msg, errorCode: typed.code, errorDetails: typed.details };
      }
    },
  );

  ipcMain.handle(
    'ws:chat-history',
    async (
      _event,
      payload: {
        gatewayId: string;
        sessionKey: string;
        limit?: number;
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
      if (!sessionGuard.ok) return sessionGuard;
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) {
        return { ok: false, error: 'gateway not connected' };
      }
      try {
        const result = await gw.getChatHistory(payload.sessionKey, payload.limit);
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    'ws:list-sessions',
    async (
      _event,
      payload: {
        gatewayId: string;
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) {
        return { ok: false, error: 'gateway not connected' };
      }
      try {
        const raw = (await gw.listSessions()) as SessionsListPayload;
        const sessions = filterSessionsByOwner(filterSessionsByAgent(payload.gatewayId, raw.sessions ?? []));
        return { ok: true, result: { ...raw, sessions } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle('ws:list-sessions-by-spawner', async (_event, payload: { gatewayId: string; spawnedBy: string }) => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
    if (!canAccessTaskId(parseTaskIdFromSessionKey(payload.spawnedBy))) {
      return { ok: true, result: { sessions: [] } };
    }
    const gw = getGatewayClient(payload.gatewayId);
    if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
    try {
      const raw = (await gw.listSessionsBySpawner(payload.spawnedBy)) as SessionsListPayload;
      const sessions = raw.sessions ?? [];
      return { ok: true, result: { ...raw, sessions } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
    }
  });

  ipcMain.handle(
    'ws:create-session',
    async (_event, payload: { gatewayId: string; key: string; agentId: string; message?: string }) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const agentGuard = assertAgentAllowed(payload.gatewayId, payload.agentId);
      if (!agentGuard.ok) return agentGuard;
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
      try {
        const result = await gw.createSession({
          key: payload.key,
          agentId: payload.agentId,
          message: payload.message,
        });
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
      }
    },
  );

  ipcMain.handle('ws:gateway-status', () => {
    const auth = getAuthStatus();
    if (auth.authEnabled && !auth.authenticated) return {};
    const clients = getAllGatewayClients();
    const statusMap: Record<string, { connected: boolean; name: string; error?: string; serverVersion?: string }> = {};
    for (const [id, client] of clients) {
      statusMap[id] = {
        connected: client.isConnected,
        name: client.name,
        error: client.lastConnectionError ?? undefined,
        serverVersion: client.version,
      };
    }
    return statusMap;
  });

  ipcMain.handle('ws:sync-sessions', async () => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
    const clients = getAllGatewayClients();
    getDebugLogger().info({
      domain: 'ipc',
      event: 'ipc.ws.sync-sessions.started',
      data: { gatewayCount: clients.size },
    });

    const discovered: {
      gatewayId: string;
      taskId: string;
      sessionKey: string;
      title: string;
      updatedAt: string;
      agentId: string;
      model?: string;
      modelProvider?: string;
      thinkingLevel?: string;
      inputTokens?: number;
      outputTokens?: number;
      contextTokens?: number;
      messages: { role: string; content: string; timestamp: string; toolCalls: ParsedToolCall[] }[];
    }[] = [];

    for (const [gatewayId, gw] of clients) {
      if (!gw.isConnected) continue;
      try {
        const deviceId = ensureDeviceId();
        const allowedAgents = resolveAllowedAgents(gatewayId);
        const raw = (await gw.listSessions()) as unknown as SessionsListPayload;
        const allSessions = raw.sessions ?? [];
        const ours = allSessions.filter((s) => isClawWorkSession(s.key, deviceId));

        for (const s of ours) {
          if (allowedAgents && !allowedAgents.has(parseAgentIdFromSessionKey(s.key))) continue;
          const taskId = parseTaskIdFromSessionKey(s.key);
          if (!taskId) continue;
          if (!canAccessTaskId(taskId)) continue;

          const historyRaw = (await gw.getChatHistory(s.key, 200)) as unknown as ChatHistoryPayload;
          const rawMsgs = historyRaw.messages ?? [];

          const toolResultMap = new Map<string, string>();
          for (const m of rawMsgs) {
            if (m.role === 'toolResult') {
              for (const b of m.content ?? []) {
                if (b.type === 'toolResult' && b.id && b.result !== undefined) {
                  toolResultMap.set(b.id, typeof b.result === 'string' ? b.result : JSON.stringify(b.result));
                }
              }
            }
          }

          const msgs = rawMsgs
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => {
              const textContent = (m.content ?? [])
                .filter((b) => b.type === 'text' && b.text)
                .map((b) => b.text!)
                .join('');

              const toolCalls: ParsedToolCall[] = (m.content ?? [])
                .filter((b) => b.type === 'toolCall' && b.id && b.name)
                .map((b) => {
                  const tcId = b.id!;
                  const resultText = toolResultMap.get(tcId);
                  return {
                    id: tcId,
                    name: b.name!,
                    status: (resultText !== undefined ? 'done' : 'running') as ParsedToolCall['status'],
                    args:
                      typeof b.arguments === 'object' && b.arguments !== null
                        ? (b.arguments as Record<string, unknown>)
                        : typeof b.arguments === 'string'
                          ? parseToolArgs(b.arguments)
                          : undefined,
                    result: resultText,
                    startedAt: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
                    completedAt:
                      resultText !== undefined
                        ? m.timestamp
                          ? new Date(m.timestamp).toISOString()
                          : new Date().toISOString()
                        : undefined,
                  };
                });

              return {
                role: m.role,
                content: textContent,
                timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
                toolCalls,
              };
            })
            .filter((m) => {
              if (!m.content && m.toolCalls.length === 0) return false;
              if (m.role === 'assistant' && INTERNAL_ASSISTANT_MARKERS.has(m.content.trim())) return false;
              return true;
            });

          const firstUserMsg = msgs.find((m) => m.role === 'user' && m.content);
          const titleFromMsg = firstUserMsg ? firstUserMsg.content.slice(0, 30) : '';

          discovered.push({
            gatewayId,
            taskId,
            sessionKey: s.key,
            title: s.derivedTitle ?? s.label ?? titleFromMsg,
            updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : new Date().toISOString(),
            agentId: parseAgentIdFromSessionKey(s.key),
            model: s.model,
            modelProvider: s.modelProvider,
            thinkingLevel: s.thinkingLevel,
            inputTokens: s.inputTokens,
            outputTokens: s.outputTokens,
            contextTokens: s.contextTokens,
            messages: msgs,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        getDebugLogger().error({
          domain: 'ipc',
          event: 'ipc.ws.sync-sessions.gateway-failed',
          gatewayId,
          error: { message: msg },
        });
      }
    }

    getDebugLogger().info({
      domain: 'ipc',
      event: 'ipc.ws.sync-sessions.completed',
      data: { discoveredCount: discovered.length },
    });
    return { ok: true, discovered };
  });

  ipcMain.handle('ws:models-list', async (_event, payload: { gatewayId: string }) => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
    const gw = getGatewayClient(payload.gatewayId);
    if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
    try {
      const result = await gw.listModels();
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
    }
  });

  ipcMain.handle('ws:agents-list', async (_event, payload: { gatewayId: string }) =>
    gatewayRpc(payload.gatewayId, async (gw) => {
      const raw = await gw.listAgents();
      return filterAgentCatalog(payload.gatewayId, raw);
    }),
  );

  ipcMain.handle(
    'ws:agents-create',
    async (
      _event,
      payload: { gatewayId: string; name: string; workspace: string; emoji?: string; avatar?: string },
    ) => {
      const guard = assertInfraManageAllowed();
      if (!guard.ok) return guard;
      return gatewayRpc(payload.gatewayId, (gw) =>
        gw.createAgent({
          name: payload.name,
          workspace: payload.workspace,
          emoji: payload.emoji,
          avatar: payload.avatar,
        }),
      );
    },
  );

  ipcMain.handle(
    'ws:agents-update',
    async (
      _event,
      payload: {
        gatewayId: string;
        agentId: string;
        name?: string;
        workspace?: string;
        model?: string;
        avatar?: string;
      },
    ) => {
      const guard = assertInfraManageAllowed();
      if (!guard.ok) return guard;
      return gatewayRpc(payload.gatewayId, (gw) =>
        gw.updateAgent({
          agentId: payload.agentId,
          name: payload.name,
          workspace: payload.workspace,
          model: payload.model,
          avatar: payload.avatar,
        }),
      );
    },
  );

  ipcMain.handle(
    'ws:agents-delete',
    async (_event, payload: { gatewayId: string; agentId: string; deleteFiles?: boolean }) => {
      const guard = assertInfraManageAllowed();
      if (!guard.ok) return guard;
      return gatewayRpc(payload.gatewayId, (gw) =>
        gw.deleteAgent({ agentId: payload.agentId, deleteFiles: payload.deleteFiles }),
      );
    },
  );

  ipcMain.handle('ws:agents-files-list', async (_event, payload: { gatewayId: string; agentId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.listAgentFiles(payload.agentId)),
  );

  ipcMain.handle('ws:agents-files-get', async (_event, payload: { gatewayId: string; agentId: string; name: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getAgentFile(payload.agentId, payload.name)),
  );

  ipcMain.handle(
    'ws:agents-files-set',
    async (_event, payload: { gatewayId: string; agentId: string; name: string; content: string }) => {
      const guard = assertInfraManageAllowed();
      if (!guard.ok) return guard;
      return gatewayRpc(payload.gatewayId, (gw) => gw.setAgentFile(payload.agentId, payload.name, payload.content));
    },
  );

  ipcMain.handle('ws:profile-agent-doc-get', async (_event, payload: { name: string }) => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return authGuard;
    const name = payload.name?.trim();
    if (!PROFILE_DOC_NAMES.has(name)) {
      return { ok: false, error: 'unsupported profile doc', errorCode: 'PROFILE_DOC_UNSUPPORTED' };
    }
    const binding = resolveCurrentUserSingleBinding();
    if (!binding.ok) return binding;
    return gatewayRpc(binding.gatewayId, (gw) => gw.getAgentFile(binding.agentId, name));
  });

  ipcMain.handle('ws:profile-agent-doc-set', async (_event, payload: { name: string; content: string }) => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return authGuard;
    const name = payload.name?.trim();
    if (!PROFILE_DOC_NAMES.has(name)) {
      return { ok: false, error: 'unsupported profile doc', errorCode: 'PROFILE_DOC_UNSUPPORTED' };
    }
    const binding = resolveCurrentUserSingleBinding();
    if (!binding.ok) return binding;
    return gatewayRpc(binding.gatewayId, (gw) => gw.setAgentFile(binding.agentId, name, payload.content ?? ''));
  });

  ipcMain.handle(
    'ws:session-patch',
    async (
      _event,
      payload: {
        gatewayId: string;
        sessionKey: string;
        patch: Record<string, unknown>;
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
      if (!sessionGuard.ok) return sessionGuard;
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
      try {
        const result = await gw.patchSession({ key: payload.sessionKey, ...payload.patch });
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle('ws:list-gateways', async () => {
    const auth = getAuthStatus();
    if (auth.authEnabled && !auth.authenticated) return [];
    const config = readConfig();
    const clients = getAllGatewayClients();
    return (config?.gateways ?? []).map((gw) => ({
      ...gw,
      connected: clients.get(gw.id)?.isConnected ?? false,
    }));
  });

  ipcMain.handle('ws:abort-chat', async (_event, payload: { gatewayId: string; sessionKey: string }) => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
    const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
    if (!sessionGuard.ok) return sessionGuard;
    const gw = getGatewayClient(payload.gatewayId);
    if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
    try {
      await gw.abortChat(payload.sessionKey);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle(
    'ws:tools-catalog',
    async (
      _event,
      payload: {
        gatewayId: string;
        agentId?: string;
      },
    ) => gatewayRpc(payload.gatewayId, (gw) => gw.getToolsCatalog(payload.agentId)),
  );

  ipcMain.handle(
    'ws:skills-status',
    async (
      _event,
      payload: {
        gatewayId: string;
        agentId?: string;
      },
    ) => gatewayRpc(payload.gatewayId, (gw) => gw.getSkillsStatus(payload.agentId)),
  );

  ipcMain.handle('ws:skills-search', async (_event, payload: { gatewayId: string } & SkillSearchParams) => {
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.searchSkills(params));
  });

  ipcMain.handle('ws:skills-detail', async (_event, payload: { gatewayId: string; slug: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getSkillDetail(payload.slug)),
  );

  ipcMain.handle('ws:skills-install', async (_event, payload: { gatewayId: string } & SkillInstallParams) => {
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.installSkill(params));
  });

  ipcMain.handle('ws:skills-update', async (_event, payload: { gatewayId: string } & SkillUpdateParams) => {
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.updateSkill(params));
  });

  ipcMain.handle('ws:skills-bins', async (_event, payload: { gatewayId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getSkillBins()),
  );

  ipcMain.handle('ws:config-get', async (_event, payload: { gatewayId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getConfig()),
  );

  ipcMain.handle('ws:config-set', async (_event, payload: { gatewayId: string } & ConfigSetParams) => {
    const guard = assertInfraManageAllowed();
    if (!guard.ok) return guard;
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.setConfig(params));
  });

  ipcMain.handle('ws:config-patch', async (_event, payload: { gatewayId: string } & ConfigPatchParams) => {
    const guard = assertInfraManageAllowed();
    if (!guard.ok) return guard;
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.patchConfig(params));
  });

  ipcMain.handle('ws:config-schema', async (_event, payload: { gatewayId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getConfigSchema()),
  );

  ipcMain.handle('ws:config-schema-lookup', async (_event, payload: { gatewayId: string; path: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.lookupConfigSchema(payload.path)),
  );

  ipcMain.handle('ws:usage-status', async (_event, payload: { gatewayId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getUsageStatus()),
  );

  ipcMain.handle(
    'ws:usage-cost',
    async (
      _event,
      payload: {
        gatewayId: string;
        startDate?: string;
        endDate?: string;
        days?: number;
      },
    ) =>
      gatewayRpc(payload.gatewayId, (gw) =>
        gw.getUsageCost({
          startDate: payload.startDate,
          endDate: payload.endDate,
          days: payload.days,
        }),
      ),
  );

  ipcMain.handle('ws:session-usage', async (_event, payload: { gatewayId: string; sessionKey: string }) => {
    const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
    if (!sessionGuard.ok) return sessionGuard;
    return gatewayRpc(payload.gatewayId, (gw) => gw.getSessionUsage({ key: payload.sessionKey }));
  });

  ipcMain.handle(
    'ws:exec-approval-resolve',
    async (
      _event,
      payload: ExecApprovalResolveParams & {
        gatewayId: string;
      },
    ) => {
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
      try {
        await gw.sendReq('exec.approval.resolve', {
          id: payload.id,
          decision: payload.decision as ApprovalDecision,
        });
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    'ws:session-reset',
    async (
      _event,
      payload: {
        gatewayId: string;
        sessionKey: string;
        reason?: 'new' | 'reset';
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
      if (!sessionGuard.ok) return sessionGuard;
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
      try {
        await gw.resetSession(payload.sessionKey, payload.reason);
        uploadedRefsBySession.delete(payload.sessionKey);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    'ws:session-delete',
    async (
      _event,
      payload: {
        gatewayId: string;
        sessionKey: string;
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
      if (!sessionGuard.ok) return sessionGuard;
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
      try {
        await gw.deleteSession(payload.sessionKey, true);
        uploadedRefsBySession.delete(payload.sessionKey);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(
    'ws:session-compact',
    async (
      _event,
      payload: {
        gatewayId: string;
        sessionKey: string;
        maxLines?: number;
      },
    ) => {
      const authGuard = assertAuthToken();
      if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
      const sessionGuard = assertSessionAllowed(payload.gatewayId, payload.sessionKey);
      if (!sessionGuard.ok) return sessionGuard;
      const gw = getGatewayClient(payload.gatewayId);
      if (!gw?.isConnected) return { ok: false, error: 'gateway not connected' };
      try {
        await gw.compactSession(payload.sessionKey, payload.maxLines);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle('ws:reconnect-gateway', (_event, payload: { gatewayId: string }) => {
    const authGuard = assertAuthToken();
    if (!authGuard.ok) return { ok: false, error: authGuard.error, errorCode: authGuard.errorCode };
    reconnectGateway(payload.gatewayId);
    return { ok: true };
  });

  ipcMain.handle('ws:cron-list', async (_event, payload: { gatewayId: string; [k: string]: unknown }) => {
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.listCronJobs(params));
  });

  ipcMain.handle('ws:cron-status', async (_event, payload: { gatewayId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.getCronStatus()),
  );

  ipcMain.handle('ws:cron-add', async (_event, payload: { gatewayId: string; [k: string]: unknown }) => {
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.addCronJob(params));
  });

  ipcMain.handle(
    'ws:cron-update',
    async (_event, payload: { gatewayId: string; jobId: string; patch: Record<string, unknown> }) =>
      gatewayRpc(payload.gatewayId, (gw) => gw.updateCronJob(payload.jobId, payload.patch)),
  );

  ipcMain.handle('ws:cron-remove', async (_event, payload: { gatewayId: string; jobId: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.removeCronJob(payload.jobId)),
  );

  ipcMain.handle('ws:cron-run', async (_event, payload: { gatewayId: string; jobId: string; mode?: string }) =>
    gatewayRpc(payload.gatewayId, (gw) => gw.runCronJob(payload.jobId, payload.mode)),
  );

  ipcMain.handle('ws:cron-runs', async (_event, payload: { gatewayId: string; [k: string]: unknown }) => {
    const { gatewayId, ...params } = payload;
    return gatewayRpc(gatewayId, (gw) => gw.listCronRuns(params));
  });
}
