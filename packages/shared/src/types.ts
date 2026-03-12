// ============================================================
// ClawWork Core Types
// Shared between Desktop App and Channel Plugin
// ============================================================

/** Task status lifecycle: active → completed → archived */
export type TaskStatus = 'active' | 'completed' | 'archived';

/** Message sender role */
export type MessageRole = 'user' | 'assistant' | 'system';

/** Artifact content type */
export type ArtifactType = 'file' | 'code' | 'image' | 'link' | 'structured_data';

/** Tool call execution status */
export type ToolCallStatus = 'running' | 'done' | 'error';

// ------------------------------------------------------------
// Core Entities
// ------------------------------------------------------------

export interface Task {
  id: string;
  sessionKey: string;
  sessionId: string;
  title: string;
  status: TaskStatus;
  createdAt: string; // ISO 8601
  updatedAt: string;
  tags: string[];
  artifactDir: string;
}

export interface Message {
  id: string;
  taskId: string;
  role: MessageRole;
  content: string;
  artifacts: Artifact[];
  toolCalls: ToolCall[];
  timestamp: string; // ISO 8601
}

export interface Artifact {
  id: string;
  taskId: string;
  messageId: string;
  type: ArtifactType;
  name: string;
  filePath: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  status: ToolCallStatus;
  args?: Record<string, unknown>;
  result?: string;
  startedAt: string;
  completedAt?: string;
}

// ------------------------------------------------------------
// Progress tracking (extracted from AI responses)
// ------------------------------------------------------------

export interface ProgressStep {
  label: string;
  status: 'pending' | 'in_progress' | 'completed';
}
