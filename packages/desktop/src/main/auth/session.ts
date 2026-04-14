import { readConfig, updateConfig, writeConfig } from '../workspace/config.js';
import type { AppConfig, AuthProviderConfig, AuthSessionConfig } from '../workspace/config.js';

export interface AuthSessionState {
  authenticated: boolean;
  user?: {
    userId?: string;
    userName?: string;
    email?: string;
    displayName?: string;
    provider?: string;
  };
  expiresAt?: string;
  authEnabled: boolean;
  ssoEnabled: boolean;
  serviceConfigured: boolean;
}

export function getAuthConfig(config?: AppConfig | null): AuthProviderConfig {
  const c = config ?? readConfig();
  return c?.auth ?? {};
}

export function getAuthSession(config?: AppConfig | null): AuthSessionConfig | null {
  const c = config ?? readConfig();
  return c?.authSession ?? null;
}

export function setAuthSession(session: AuthSessionConfig): void {
  updateConfig({ authSession: session });
}

export function clearAuthSession(): void {
  const current = readConfig();
  if (!current) return;
  const next: AppConfig = { ...current, authSession: undefined };
  writeConfig(next);
}

function isTokenValid(session: AuthSessionConfig | null): boolean {
  if (!session?.token) return false;
  if (!session.expiresAt) return true;
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs > Date.now() + 5000;
}

export function getAuthStatus(): AuthSessionState {
  const config = readConfig();
  const auth = getAuthConfig(config);
  const enabled = auth.enabled === true;
  const serviceConfigured = Boolean(auth.serviceUrl && auth.serviceUrl.trim());
  const ssoEnabled = Boolean(auth.ssoProvider && auth.ssoProvider.trim());

  if (!enabled) {
    return {
      authenticated: true,
      authEnabled: false,
      ssoEnabled,
      serviceConfigured,
    };
  }

  const session = getAuthSession(config);
  const authenticated = isTokenValid(session);
  return {
    authenticated,
    user: session
      ? {
          userId: session.userId,
          userName: session.userName,
          email: session.email,
          displayName: session.displayName,
          provider: session.provider,
        }
      : undefined,
    expiresAt: session?.expiresAt,
    authEnabled: true,
    ssoEnabled,
    serviceConfigured,
  };
}

export function assertAuthToken(): { ok: true; token: string } | { ok: false; error: string; errorCode: string } {
  const status = getAuthStatus();
  if (!status.authEnabled) return { ok: true, token: '' };
  if (!status.authenticated) {
    return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
  }
  const token = getAuthSession()?.token;
  if (!token) {
    return { ok: false, error: 'authentication required', errorCode: 'AUTH_REQUIRED' };
  }
  return { ok: true, token };
}
