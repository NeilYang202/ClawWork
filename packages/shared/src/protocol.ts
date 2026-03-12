// ============================================================
// WebSocket Protocol Types
// Defines the wire format between Channel Plugin and Desktop App
// ============================================================

import type { ToolCallStatus } from './types.js';

// ------------------------------------------------------------
// Plugin → Desktop (Outbound from OpenClaw)
// ------------------------------------------------------------

export interface WsTextMessage {
  type: 'text';
  sessionKey: string;
  content: string;
  messageId?: string;
}

export interface WsMediaMessage {
  type: 'media';
  sessionKey: string;
  mediaPath: string;
  mediaType: string;
  fileName?: string;
}

export interface WsToolCallMessage {
  type: 'tool_call';
  sessionKey: string;
  toolCallId: string;
  toolName: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  result?: string;
}

export interface WsStreamChunk {
  type: 'stream_chunk';
  sessionKey: string;
  content: string;
  done: boolean;
}

// ------------------------------------------------------------
// Desktop → Plugin (Inbound to OpenClaw)
// ------------------------------------------------------------

export interface WsUserMessage {
  type: 'user_message';
  sessionKey: string;
  content: string;
}

export interface WsCreateSession {
  type: 'create_session';
  sessionKey: string;
}

// ------------------------------------------------------------
// Bidirectional
// ------------------------------------------------------------

export interface WsHeartbeat {
  type: 'heartbeat';
  timestamp: string;
}

export interface WsError {
  type: 'error';
  sessionKey?: string;
  code: string;
  message: string;
}

// ------------------------------------------------------------
// Union type for all WebSocket messages
// ------------------------------------------------------------

export type WsMessage =
  | WsTextMessage
  | WsMediaMessage
  | WsToolCallMessage
  | WsStreamChunk
  | WsUserMessage
  | WsCreateSession
  | WsHeartbeat
  | WsError;

// Type guard helpers
export function isOutboundMessage(
  msg: WsMessage,
): msg is WsTextMessage | WsMediaMessage | WsToolCallMessage | WsStreamChunk {
  return ['text', 'media', 'tool_call', 'stream_chunk'].includes(msg.type);
}

export function isInboundMessage(
  msg: WsMessage,
): msg is WsUserMessage | WsCreateSession {
  return ['user_message', 'create_session'].includes(msg.type);
}
