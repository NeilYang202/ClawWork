import { ipcMain } from 'electron';
import {
  createAdminUser,
  deleteAdminUser,
  getAdminClientConfig,
  getAdminUsers,
  loginWithPassword,
  pollSso,
  startSso,
  updateAdminUser,
  updateAdminClientConfig,
} from '../auth/client.js';
import { clearAuthSession, getAuthConfig, getAuthSession, getAuthStatus, setAuthSession } from '../auth/session.js';
import { refreshPublicClientConfig, refreshRuntimeClientConfig } from '../auth/runtime-config.js';
import { syncManagedGatewaysFromRuntimeConfig } from '../auth/runtime-gateway-sync.js';

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:status', async () => {
    await refreshPublicClientConfig();
    const token = getAuthSession()?.token ?? '';
    if (token) {
      await refreshRuntimeClientConfig(token);
      syncManagedGatewaysFromRuntimeConfig();
    }
    return getAuthStatus();
  });

  ipcMain.handle('auth:public-config', async (_event, params?: { serviceUrl?: string }) => {
    const auth = getAuthConfig();
    if (params?.serviceUrl?.trim()) {
      auth.serviceUrl = params.serviceUrl.trim();
    }
    try {
      const result = await refreshPublicClientConfig();
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'load public config failed' };
    }
  });

  ipcMain.handle('auth:login-password', async (_event, params: { username: string; password: string }) => {
    const auth = getAuthConfig();
    if (auth.enabled === false) return { ok: true, result: getAuthStatus() };
    try {
      const session = await loginWithPassword(auth, params);
      setAuthSession(session);
      await refreshRuntimeClientConfig(session.token ?? '');
      syncManagedGatewaysFromRuntimeConfig();
      return { ok: true, result: getAuthStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'login failed' };
    }
  });

  ipcMain.handle('auth:sso-start', async () => {
    const auth = getAuthConfig();
    if (auth.enabled === false) return { ok: false, error: 'auth not enabled' };
    if (!auth.ssoProvider) return { ok: false, error: 'sso provider not configured' };
    try {
      const result = await startSso(auth);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sso start failed' };
    }
  });

  ipcMain.handle('auth:sso-poll', async (_event, params: { deviceCode: string }) => {
    const auth = getAuthConfig();
    if (auth.enabled === false) return { ok: false, error: 'auth not enabled' };
    try {
      const result = await pollSso(auth, params);
      if (result.done && result.session) {
        setAuthSession(result.session);
        await refreshRuntimeClientConfig(result.session.token ?? '');
        syncManagedGatewaysFromRuntimeConfig();
      }
      return { ok: true, result: { done: result.done, status: result.done ? getAuthStatus() : undefined } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sso poll failed' };
    }
  });

  ipcMain.handle('auth:logout', () => {
    clearAuthSession();
    return { ok: true, result: getAuthStatus() };
  });

  ipcMain.handle('auth:admin-config-get', async () => {
    const auth = getAuthConfig();
    const token = getAuthSession()?.token;
    if (!token) return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
    try {
      const result = await getAdminClientConfig(auth, token);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'load admin config failed' };
    }
  });

  ipcMain.handle('auth:admin-config-update', async (_event, payload: Record<string, unknown>) => {
    const auth = getAuthConfig();
    const token = getAuthSession()?.token;
    if (!token) return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
    try {
      const result = await updateAdminClientConfig(auth, token, payload as never);
      await refreshRuntimeClientConfig(token);
      syncManagedGatewaysFromRuntimeConfig();
      await refreshPublicClientConfig();
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'save admin config failed' };
    }
  });

  ipcMain.handle('auth:admin-users-list', async () => {
    const auth = getAuthConfig();
    const token = getAuthSession()?.token;
    if (!token) return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
    try {
      const result = await getAdminUsers(auth, token);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'load users failed' };
    }
  });

  ipcMain.handle(
    'auth:admin-users-create',
    async (
      _event,
      payload: { username: string; password: string; email?: string; displayName?: string; isAdmin?: boolean },
    ) => {
      const auth = getAuthConfig();
      const token = getAuthSession()?.token;
      if (!token) return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
      try {
        const result = await createAdminUser(auth, token, payload);
        await refreshRuntimeClientConfig(token);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'create user failed' };
      }
    },
  );

  ipcMain.handle('auth:admin-users-delete', async (_event, payload: { userId: string }) => {
    const auth = getAuthConfig();
    const token = getAuthSession()?.token;
    if (!token) return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
    try {
      await deleteAdminUser(auth, token, payload.userId);
      await refreshRuntimeClientConfig(token);
      return { ok: true, result: { ok: true } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'delete user failed' };
    }
  });

  ipcMain.handle(
    'auth:admin-users-update',
    async (
      _event,
      payload: {
        userId: string;
        password?: string;
        email?: string;
        displayName?: string;
        isAdmin?: boolean;
        isActive?: boolean;
      },
    ) => {
      const auth = getAuthConfig();
      const token = getAuthSession()?.token;
      if (!token) return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
      try {
        const { userId, ...patch } = payload;
        const result = await updateAdminUser(auth, token, userId, patch);
        await refreshRuntimeClientConfig(token);
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'update user failed' };
      }
    },
  );
}
