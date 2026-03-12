import { useEffect, useRef } from 'react';
import { parseTaskIdFromSessionKey } from '@clawwork/shared';
import { toast } from 'sonner';
import { useMessageStore } from '../stores/messageStore';
import { useTaskStore } from '../stores/taskStore';
import { useUiStore } from '../stores/uiStore';

interface ChatContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

interface ChatMessage {
  role?: string;
  content?: ChatContentBlock[];
}

interface ChatEventPayload {
  sessionKey: string;
  runId?: string;
  state?: 'delta' | 'final' | 'aborted' | 'error';
  /** Gateway wraps content blocks inside message */
  message?: ChatMessage;
  /** Fallback: top-level content (older protocol?) */
  content?: ChatContentBlock[];
  text?: string;
}

/**
 * Subscribes to Gateway events and dispatches into Zustand stores.
 * Mount once at App root level.
 */
export function useGatewayEventDispatcher(): void {
  const addMessage = useMessageStore((s) => s.addMessage);
  const appendStreamDelta = useMessageStore((s) => s.appendStreamDelta);
  const finalizeStream = useMessageStore((s) => s.finalizeStream);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const updateTaskTitle = useTaskStore((s) => s.updateTaskTitle);
  const markUnread = useUiStore((s) => s.markUnread);

  useEffect(() => {
    const handler = (data: { event: string; payload: Record<string, unknown> }): void => {
      if (data.event !== 'chat') return;

      const payload = data.payload as unknown as ChatEventPayload;
      const { sessionKey, state } = payload;
      if (!sessionKey) return;

      const taskId = parseTaskIdFromSessionKey(sessionKey);
      if (!taskId) return;

      // Mark unread if this is a background task
      if (taskId !== activeTaskId) {
        markUnread(taskId);
      }

      if (state === 'delta') {
        const text = extractText(payload);
        if (text) {
          appendStreamDelta(taskId, text);
        }
      } else if (state === 'final') {
        finalizeStream(taskId);
        autoTitleIfNeeded(taskId, updateTaskTitle);
      } else if (state === 'error' || state === 'aborted') {
        finalizeStream(taskId);
        if (state === 'error') {
          const errText = extractText(payload) || '请求出错';
          addMessage(taskId, 'system', errText);
        }
      }
    };

    window.clawwork.onGatewayEvent(handler);
    return () => {
      window.clawwork.removeAllListeners('gateway-event');
    };
  }, [activeTaskId, addMessage, appendStreamDelta, finalizeStream, markUnread, updateTaskTitle]);

  const wasConnectedRef = useRef(true);
  useEffect(() => {
    const setGwStatus = useUiStore.getState().setGatewayStatus;
    window.clawwork.gatewayStatus().then((s) => {
      const status = s.connected ? 'connected' as const : 'disconnected' as const;
      setGwStatus(status);
      wasConnectedRef.current = s.connected;
    });
    window.clawwork.onGatewayStatus((s) => {
      const next = s.connected ? 'connected' as const : s.error ? 'disconnected' as const : 'connecting' as const;
      setGwStatus(next);
      if (s.connected && !wasConnectedRef.current) {
        toast.success('Gateway reconnected');
      } else if (!s.connected && wasConnectedRef.current) {
        toast.warning('Gateway disconnected', { description: 'Attempting to reconnect...' });
      }
      wasConnectedRef.current = s.connected;
    });
    return () => { window.clawwork.removeAllListeners('gateway-status'); };
  }, []);
}

function extractText(payload: ChatEventPayload): string {
  // Gateway wraps content in payload.message.content[]
  const blocks = payload.message?.content ?? payload.content;
  if (blocks) {
    return blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('');
  }
  return payload.text ?? '';
}

function autoTitleIfNeeded(
  taskId: string,
  updateTaskTitle: (id: string, title: string) => void,
): void {
  const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
  if (task && !task.title) {
    const msgs = useMessageStore.getState().messagesByTask[taskId] ?? [];
    const firstAssistant = msgs.find((m) => m.role === 'assistant');
    if (firstAssistant) {
      const title = firstAssistant.content.slice(0, 30).replace(/\n/g, ' ').trim();
      if (title) {
        updateTaskTitle(taskId, title + (firstAssistant.content.length > 30 ? '…' : ''));
      }
    }
  }
}
