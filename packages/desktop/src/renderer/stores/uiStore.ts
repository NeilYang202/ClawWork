import { create } from 'zustand';

type MainView = 'chat' | 'files';

type Theme = 'dark' | 'light';

type GatewayConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface UiState {
  rightPanelOpen: boolean;
  toggleRightPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;

  mainView: MainView;
  setMainView: (view: MainView) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  theme: Theme;
  setTheme: (theme: Theme) => void;

  gatewayStatus: GatewayConnectionStatus;
  setGatewayStatus: (status: GatewayConnectionStatus) => void;

  /** taskIds with unread messages (background tasks that received new content) */
  unreadTaskIds: Set<string>;
  markUnread: (taskId: string) => void;
  clearUnread: (taskId: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  rightPanelOpen: false,
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  mainView: 'chat',
  setMainView: (view) => set({ mainView: view }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  theme: 'dark',
  setTheme: (theme) => set({ theme }),

  gatewayStatus: 'connecting',
  setGatewayStatus: (status) => set({ gatewayStatus: status }),

  unreadTaskIds: new Set(),
  markUnread: (taskId) =>
    set((s) => {
      const next = new Set(s.unreadTaskIds);
      next.add(taskId);
      return { unreadTaskIds: next };
    }),
  clearUnread: (taskId) =>
    set((s) => {
      const next = new Set(s.unreadTaskIds);
      next.delete(taskId);
      return { unreadTaskIds: next };
    }),
}));
