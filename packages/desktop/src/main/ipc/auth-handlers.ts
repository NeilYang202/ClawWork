import { ipcMain } from 'electron';
import { loginWithPassword, pollSso, startSso } from '../auth/client.js';
import { clearAuthSession, getAuthConfig, getAuthStatus, setAuthSession } from '../auth/session.js';

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:status', () => getAuthStatus());

  ipcMain.handle('auth:login-password', async (_event, params: { username: string; password: string }) => {
    const auth = getAuthConfig();
    if (auth.enabled !== true) return { ok: true, result: getAuthStatus() };
    try {
      const session = await loginWithPassword(auth, params);
      setAuthSession(session);
      return { ok: true, result: getAuthStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'login failed' };
    }
  });

  ipcMain.handle('auth:sso-start', async () => {
    const auth = getAuthConfig();
    if (auth.enabled !== true) return { ok: false, error: 'auth not enabled' };
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
    if (auth.enabled !== true) return { ok: false, error: 'auth not enabled' };
    try {
      const result = await pollSso(auth, params);
      if (result.done && result.session) {
        setAuthSession(result.session);
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
}
