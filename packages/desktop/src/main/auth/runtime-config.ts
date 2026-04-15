import { getPublicClientConfig, getRuntimeClientConfig } from './client.js';
import { getAuthConfig } from './session.js';

interface RuntimeAccessControlConfig {
  enabled?: boolean;
  adminUsers?: string[];
  bindings?: Array<{ username: string; gatewayId: string; agentId: string }>;
}

interface RuntimeGatewayConfig {
  id: string;
  name: string;
  url: string;
  token?: string;
  password?: string;
  pairingCode?: string;
  authMode?: 'token' | 'password' | 'pairingCode';
  isDefault?: boolean;
  color?: string;
}

let cachedPublicConfig: { ssoEnabled: boolean; ssoProvider?: string } = { ssoEnabled: false };
let cachedRuntimeConfig: { accessControl?: RuntimeAccessControlConfig; gateways?: RuntimeGatewayConfig[] } = {};

export function getCachedPublicClientConfig(): { ssoEnabled: boolean; ssoProvider?: string } {
  return cachedPublicConfig;
}

export function getCachedRuntimeAccessControl(): RuntimeAccessControlConfig | null {
  return cachedRuntimeConfig.accessControl ?? null;
}

export function getCachedRuntimeGateways(): RuntimeGatewayConfig[] {
  return cachedRuntimeConfig.gateways ?? [];
}

export async function refreshPublicClientConfig(): Promise<{ ssoEnabled: boolean; ssoProvider?: string }> {
  const auth = getAuthConfig();
  if (!auth.serviceUrl?.trim()) {
    cachedPublicConfig = { ssoEnabled: false };
    return cachedPublicConfig;
  }
  try {
    cachedPublicConfig = await getPublicClientConfig(auth);
  } catch {
    cachedPublicConfig = { ssoEnabled: false };
  }
  return cachedPublicConfig;
}

export async function refreshRuntimeClientConfig(token: string): Promise<void> {
  const auth = getAuthConfig();
  if (!auth.serviceUrl?.trim() || !token) {
    cachedRuntimeConfig = {};
    return;
  }
  try {
    cachedRuntimeConfig = await getRuntimeClientConfig(auth, token);
  } catch {
    cachedRuntimeConfig = {};
  }
}

export function clearRuntimeClientConfig(): void {
  cachedRuntimeConfig = {};
}
