import { readConfig, updateConfig, writeConfig } from '../workspace/config.js';
import type { AppConfig, AuthProviderConfig, AuthSessionConfig } from '../workspace/config.js';
import {
  clearRuntimeClientConfig,
  getCachedPublicClientConfig,
  getCachedRuntimeAccessControl,
} from './runtime-config.js';

interface AuthSessionState {
  authenticated: boolean;
  user?: {
    userId?: string;
    userName?: string;
    email?: string;
    displayName?: string;
    provider?: string;
    isAdmin?: boolean;
    roles?: string[];
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
  clearRuntimeClientConfig();
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
  const enabled = auth.enabled !== false;
  const serviceConfigured = Boolean(auth.serviceUrl && auth.serviceUrl.trim());
  const ssoEnabled = getCachedPublicClientConfig().ssoEnabled;

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
          isAdmin: session.isAdmin,
          roles: session.roles,
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

export function getCurrentUserName(): string | null {
  const session = getAuthSession();
  const raw = session?.userName ?? session?.email;
  if (!raw) return null;
  return raw.trim().toLowerCase();
}

export function isCurrentUserAdmin(): boolean {
  const session = getAuthSession();
  if (session?.isAdmin) return true;
  const user = getCurrentUserName();
  if (!user) return false;
  const admins = getCachedRuntimeAccessControl()?.adminUsers ?? [];
  return admins.some((item) => item.trim().toLowerCase() === user);
}
