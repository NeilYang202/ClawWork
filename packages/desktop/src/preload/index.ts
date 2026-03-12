import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import type { ClawWorkAPI } from './clawwork';

function buildApi(): ClawWorkAPI {
  return {
    sendMessage: (sessionKey: string, content: string) =>
      ipcRenderer.invoke('ws:send-message', { sessionKey, content }),
    chatHistory: (sessionKey: string, limit?: number) =>
      ipcRenderer.invoke('ws:chat-history', { sessionKey, limit }),
    listSessions: () =>
      ipcRenderer.invoke('ws:list-sessions'),
    gatewayStatus: () =>
      ipcRenderer.invoke('ws:gateway-status'),

    onAgentMessage: (callback) => {
      ipcRenderer.on('agent-message', (_event, msg) => callback(msg));
    },
    onGatewayEvent: (callback) => {
      ipcRenderer.on('gateway-event', (_event, data) => callback(data));
    },
    onGatewayStatus: (callback) => {
      ipcRenderer.on('gateway-status', (_event, status) => callback(status));
    },
    onPluginStatus: (callback) => {
      ipcRenderer.on('plugin-status', (_event, status) => callback(status));
    },

    saveArtifact: (params: {
      taskId: string;
      sourcePath: string;
      messageId: string;
      fileName?: string;
      mediaType?: string;
    }) => ipcRenderer.invoke('artifact:save', params),
    listArtifacts: (taskId?: string) =>
      ipcRenderer.invoke('artifact:list', { taskId }),
    getArtifact: (id: string) =>
      ipcRenderer.invoke('artifact:get', { id }),
    readArtifactFile: (localPath: string) =>
      ipcRenderer.invoke('artifact:read-file', { localPath }),
    onArtifactSaved: (callback: (artifact: unknown) => void) => {
      ipcRenderer.on('artifact:saved', (_event, artifact) => callback(artifact));
    },

    isWorkspaceConfigured: () =>
      ipcRenderer.invoke('workspace:is-configured') as Promise<boolean>,
    getWorkspacePath: () =>
      ipcRenderer.invoke('workspace:get-path') as Promise<string | null>,
    getDefaultWorkspacePath: () =>
      ipcRenderer.invoke('workspace:get-default') as Promise<string>,
    browseWorkspace: () =>
      ipcRenderer.invoke('workspace:browse') as Promise<string | null>,
    setupWorkspace: (path: string) =>
      ipcRenderer.invoke('workspace:setup', path),

    getSettings: () =>
      ipcRenderer.invoke('settings:get'),
    updateSettings: (partial: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:update', partial),

    globalSearch: (query: string) =>
      ipcRenderer.invoke('search:global', query),

    removeAllListeners: (channel: string) => {
      ipcRenderer.removeAllListeners(channel);
    },
  };
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('clawwork', buildApi());
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore fallback for non-isolated context
  window.electron = electronAPI;
  // @ts-ignore
  window.clawwork = buildApi();
}
