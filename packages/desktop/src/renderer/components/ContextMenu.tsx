import { useState, useCallback, type MouseEvent } from 'react';
import type { TaskStatus } from '@clawwork/shared';
import i18n from '../i18n';

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuState {
  isOpen: boolean;
  taskId: string;
  taskStatus: TaskStatus;
}

const INITIAL_STATE: MenuState = {
  isOpen: false,
  taskId: '',
  taskStatus: 'active',
};

export interface SessionActions {
  compact: (taskId: string) => void;
  reset: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  isConnected: (taskId: string) => boolean;
}

export function useTaskContextMenu(
  updateStatus: (id: string, status: TaskStatus) => void,
  sessionActions?: SessionActions,
) {
  const [state, setState] = useState<MenuState>(INITIAL_STATE);

  const openMenu = useCallback((e: MouseEvent, taskId: string, taskStatus: TaskStatus) => {
    e.preventDefault();
    setState({ isOpen: true, taskId, taskStatus });
  }, []);

  const closeMenu = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false }));
  }, []);

  const items: MenuItem[] = [];
  const connected = state.isOpen && sessionActions ? sessionActions.isConnected(state.taskId) : false;

  if (state.taskStatus === 'active') {
    items.push({
      label: i18n.t('contextMenu.markCompleted'),
      action: () => updateStatus(state.taskId, 'completed'),
    });
  } else if (state.taskStatus === 'completed') {
    items.push({
      label: i18n.t('contextMenu.reactivate'),
      action: () => updateStatus(state.taskId, 'active'),
    });
  }

  if (sessionActions) {
    items.push({
      label: i18n.t('contextMenu.compactSession'),
      action: () => sessionActions.compact(state.taskId),
      disabled: !connected,
    });
    items.push({
      label: i18n.t('contextMenu.resetSession'),
      action: () => sessionActions.reset(state.taskId),
      disabled: !connected,
    });
    items.push({
      label: i18n.t('contextMenu.deleteTask'),
      action: () => sessionActions.deleteTask(state.taskId),
      danger: true,
    });
  }

  if (state.taskStatus === 'active' || state.taskStatus === 'completed') {
    items.push({
      label: i18n.t('contextMenu.archive'),
      action: () => updateStatus(state.taskId, 'archived'),
      danger: true,
    });
  }

  return {
    items,
    taskId: state.taskId,
    taskStatus: state.taskStatus,
    isOpen: state.isOpen,
    openMenu,
    closeMenu,
  };
}
