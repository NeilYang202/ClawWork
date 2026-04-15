import { ensureDeviceId } from '../workspace/config.js';
import type { AuthProviderConfig, AuthSessionConfig } from '../workspace/config.js';

interface AuthUser {
  id?: string;
  username?: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  roles?: string[];
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

interface PublicClientConfig {
  ssoEnabled: boolean;
  ssoProvider?: string;
}

interface AdminClientConfig {
  obs: {
    enabled: boolean;
    endpoint?: string;
    bucket?: string;
    basePath?: string;
    accessKey?: string;
    secretKey?: string;
    region?: string;
  };
  sso: {
    enabled: boolean;
    provider?: string;
    adDomain?: string;
  };
  accessControl: {
    enabled: boolean;
    adminUsers: string[];
    bindings: Array<{ username: string; gatewayId: string; agentId: string }>;
  };
  gateways: Array<{
    id: string;
    name: string;
    url: string;
    token?: string;
    password?: string;
    pairingCode?: string;
    authMode?: 'token' | 'password' | 'pairingCode';
    isDefault?: boolean;
    color?: string;
  }>;
}

interface RuntimeClientConfig {
  accessControl: AdminClientConfig['accessControl'];
  gateways: AdminClientConfig['gateways'];
}

interface AdminUser {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  isActive: boolean;
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

async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const err = (payload.error as string) || `request failed: ${response.status}`;
    throw new Error(err);
  }
  return payload as T;
}

async function putJson<T>(url: string, body: Record<string, unknown>, token: string): Promise<T> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
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

async function patchJson<T>(url: string, body: Record<string, unknown>, token: string): Promise<T> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
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

async function deleteJson(url: string, token: string): Promise<void> {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const err = (payload.error as string) || `request failed: ${response.status}`;
    throw new Error(err);
  }
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
    isAdmin: result.user?.isAdmin === true || (result.user?.roles ?? []).includes('admin'),
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
      isAdmin: result.user?.isAdmin === true || (result.user?.roles ?? []).includes('admin'),
    },
  };
}

export async function getPublicClientConfig(auth: AuthProviderConfig): Promise<PublicClientConfig> {
  const baseUrl = ensureServiceUrl(auth);
  return getJson<PublicClientConfig>(`${baseUrl}/api/client/public-config`);
}

export async function getRuntimeClientConfig(auth: AuthProviderConfig, token: string): Promise<RuntimeClientConfig> {
  const baseUrl = ensureServiceUrl(auth);
  return getJson<RuntimeClientConfig>(`${baseUrl}/api/client/runtime-config`, token);
}

export async function getAdminClientConfig(auth: AuthProviderConfig, token: string): Promise<AdminClientConfig> {
  const baseUrl = ensureServiceUrl(auth);
  return getJson<AdminClientConfig>(`${baseUrl}/api/admin/config`, token);
}

export async function updateAdminClientConfig(
  auth: AuthProviderConfig,
  token: string,
  payload: AdminClientConfig,
): Promise<AdminClientConfig> {
  const baseUrl = ensureServiceUrl(auth);
  return putJson<AdminClientConfig>(
    `${baseUrl}/api/admin/config`,
    payload as unknown as Record<string, unknown>,
    token,
  );
}

export async function getAdminUsers(auth: AuthProviderConfig, token: string): Promise<AdminUser[]> {
  const baseUrl = ensureServiceUrl(auth);
  return getJson<AdminUser[]>(`${baseUrl}/api/admin/users`, token);
}

export async function createAdminUser(
  auth: AuthProviderConfig,
  token: string,
  payload: { username: string; password: string; email?: string; displayName?: string; isAdmin?: boolean },
): Promise<AdminUser> {
  const baseUrl = ensureServiceUrl(auth);
  return postJson<AdminUser>(`${baseUrl}/api/admin/users`, payload as Record<string, unknown>, token);
}

export async function updateAdminUser(
  auth: AuthProviderConfig,
  token: string,
  userId: string,
  payload: { password?: string; email?: string; displayName?: string; isAdmin?: boolean; isActive?: boolean },
): Promise<AdminUser> {
  const baseUrl = ensureServiceUrl(auth);
  return patchJson<AdminUser>(`${baseUrl}/api/admin/users/${encodeURIComponent(userId)}`, payload, token);
}

export async function deleteAdminUser(auth: AuthProviderConfig, token: string, userId: string): Promise<void> {
  const baseUrl = ensureServiceUrl(auth);
  await deleteJson(`${baseUrl}/api/admin/users/${encodeURIComponent(userId)}`, token);
}
