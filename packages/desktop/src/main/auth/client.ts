import { ensureDeviceId } from '../workspace/config.js';
import type { AuthProviderConfig, AuthSessionConfig } from '../workspace/config.js';

interface AuthUser {
  id?: string;
  username?: string;
  email?: string;
  displayName?: string;
}

interface LoginResult {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  provider?: string;
  user?: AuthUser;
}

interface SsoStartResult {
  verificationUri: string;
  userCode?: string;
  deviceCode?: string;
  expiresIn?: number;
  intervalMs?: number;
}

interface SsoPollResult {
  done: boolean;
  token?: string;
  refreshToken?: string;
  expiresAt?: string;
  provider?: string;
  user?: AuthUser;
}

function normalizeBaseUrl(serviceUrl: string): string {
  return serviceUrl.replace(/\/+$/, '');
}

function ensureServiceUrl(auth: AuthProviderConfig): string {
  const raw = auth.serviceUrl?.trim();
  if (!raw) throw new Error('auth service url not configured');
  return normalizeBaseUrl(raw);
}

async function postJson<T>(url: string, body: Record<string, unknown>, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const err = (payload.error as string) || `request failed: ${response.status}`;
    throw new Error(err);
  }

  return payload as T;
}

export async function loginWithPassword(
  auth: AuthProviderConfig,
  params: { username: string; password: string },
): Promise<AuthSessionConfig> {
  const baseUrl = ensureServiceUrl(auth);
  const result = await postJson<LoginResult>(`${baseUrl}/api/auth/login`, {
    username: params.username,
    password: params.password,
    realm: auth.realm,
    adDomain: auth.adDomain,
    provider: 'password',
    deviceId: ensureDeviceId(),
  });

  if (!result.token) throw new Error('token missing in login response');

  return {
    token: result.token,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
    userId: result.user?.id,
    userName: result.user?.username,
    email: result.user?.email,
    displayName: result.user?.displayName,
    provider: result.provider ?? 'password',
  };
}

export async function startSso(auth: AuthProviderConfig): Promise<SsoStartResult> {
  const baseUrl = ensureServiceUrl(auth);
  return postJson<SsoStartResult>(`${baseUrl}/api/auth/sso/start`, {
    provider: auth.ssoProvider,
    realm: auth.realm,
    adDomain: auth.adDomain,
    deviceId: ensureDeviceId(),
  });
}

export async function pollSso(
  auth: AuthProviderConfig,
  params: { deviceCode: string },
): Promise<{ done: boolean; session?: AuthSessionConfig }> {
  const baseUrl = ensureServiceUrl(auth);
  const result = await postJson<SsoPollResult>(`${baseUrl}/api/auth/sso/poll`, {
    provider: auth.ssoProvider,
    deviceCode: params.deviceCode,
    deviceId: ensureDeviceId(),
  });

  if (!result.done) return { done: false };
  if (!result.token) throw new Error('token missing in sso poll response');

  return {
    done: true,
    session: {
      token: result.token,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      userId: result.user?.id,
      userName: result.user?.username,
      email: result.user?.email,
      displayName: result.user?.displayName,
      provider: result.provider ?? auth.ssoProvider ?? 'sso',
    },
  };
}
