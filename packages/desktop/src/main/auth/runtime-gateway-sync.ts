import { readConfig, writeConfig } from '../workspace/config.js';
import type { GatewayServerConfig } from '../workspace/config.js';
import { getCachedRuntimeGateways } from './runtime-config.js';
import { reloadAllGatewaysFromConfig } from '../ws/index.js';

function normalizeGateway(input: GatewayServerConfig): GatewayServerConfig {
  return {
    id: input.id,
    name: input.name,
    url: input.url,
    token: input.token,
    password: input.password,
    pairingCode: input.pairingCode,
    authMode: input.authMode,
    isDefault: input.isDefault,
    color: input.color,
  };
}

function sameGateway(a: GatewayServerConfig, b: GatewayServerConfig): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.url === b.url &&
    (a.token ?? '') === (b.token ?? '') &&
    (a.password ?? '') === (b.password ?? '') &&
    (a.pairingCode ?? '') === (b.pairingCode ?? '') &&
    (a.authMode ?? '') === (b.authMode ?? '') &&
    Boolean(a.isDefault) === Boolean(b.isDefault) &&
    (a.color ?? '') === (b.color ?? '')
  );
}

export function syncManagedGatewaysFromRuntimeConfig(): void {
  const config = readConfig();
  if (!config) return;
  const runtimeGateways = getCachedRuntimeGateways();
  if (!runtimeGateways.length) return;
  const nextGateways = runtimeGateways.map((gateway) => normalizeGateway(gateway));
  const nextDefault = nextGateways.find((item) => item.isDefault)?.id ?? nextGateways[0]?.id;
  const prevGateways = config.gateways ?? [];
  const sameLength = prevGateways.length === nextGateways.length;
  const sameOrderAndValue = sameLength && prevGateways.every((item, index) => sameGateway(item, nextGateways[index]));
  const sameDefault = (config.defaultGatewayId ?? '') === (nextDefault ?? '');
  if (sameOrderAndValue && sameDefault) return;
  config.gateways = nextGateways;
  config.defaultGatewayId = nextDefault;
  writeConfig(config);
  reloadAllGatewaysFromConfig();
}
