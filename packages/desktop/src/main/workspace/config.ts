import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { CONFIG_FILE_NAME, DEFAULT_WORKSPACE_DIR } from '@clawwork/shared';

export interface AppConfig {
  workspacePath: string;
  theme?: 'dark' | 'light';
  gatewayUrl?: string;
}

function configFilePath(): string {
  return join(app.getPath('userData'), CONFIG_FILE_NAME);
}

export function getDefaultWorkspacePath(): string {
  return join(homedir(), DEFAULT_WORKSPACE_DIR);
}

export function readConfig(): AppConfig | null {
  const cfgPath = configFilePath();
  if (!existsSync(cfgPath)) return null;
  try {
    const raw = readFileSync(cfgPath, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: AppConfig): void {
  const cfgPath = configFilePath();
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const current = readConfig() ?? { workspacePath: getDefaultWorkspacePath() };
  const merged = { ...current, ...partial };
  writeConfig(merged);
  return merged;
}

export function getWorkspacePath(): string | null {
  return readConfig()?.workspacePath ?? null;
}

export function isWorkspaceConfigured(): boolean {
  return getWorkspacePath() !== null;
}
