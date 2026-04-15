import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Save, Trash2 } from 'lucide-react';
import SettingGroup from '@/components/semantic/SettingGroup';
import SettingRow from '@/components/semantic/SettingRow';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ManagedGatewayRow {
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

interface AdminConfigPayload {
  obs: Record<string, unknown>;
  sso: Record<string, unknown>;
  accessControl: Record<string, unknown>;
  gateways: ManagedGatewayRow[];
}

const inputClass = cn(
  'h-[var(--density-control-height-lg)] rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3',
  'text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]',
);

export default function GatewayManagementSection() {
  const { t } = useTranslation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [rawConfig, setRawConfig] = useState<AdminConfigPayload | null>(null);
  const [gateways, setGateways] = useState<ManagedGatewayRow[]>([]);

  const load = useCallback(async () => {
    const authStatus = await window.clawwork.getAuthStatus();
    const admin = Boolean(authStatus.user?.isAdmin);
    setIsAdmin(admin);
    if (!admin) return;
    const remote = await window.clawwork.getAdminConfig();
    if (!remote.ok || !remote.result) return;
    const cfg = remote.result as unknown as AdminConfigPayload;
    setRawConfig(cfg);
    setGateways(cfg.gateways ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateGateway = useCallback((index: number, patch: Partial<ManagedGatewayRow>) => {
    setGateways((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const setGatewayDefault = useCallback((index: number) => {
    setGateways((prev) => prev.map((item, i) => ({ ...item, isDefault: i === index })));
  }, []);

  const save = useCallback(async () => {
    if (!rawConfig) return;
    const sanitized = gateways
      .filter((gateway) => gateway.id.trim() && gateway.name.trim() && gateway.url.trim())
      .map((gateway) => {
        const mode = gateway.authMode ?? 'token';
        return {
          id: gateway.id.trim(),
          name: gateway.name.trim(),
          url: gateway.url.trim(),
          authMode: mode,
          token: mode === 'token' ? gateway.token?.trim() || undefined : undefined,
          password: mode === 'password' ? gateway.password?.trim() || undefined : undefined,
          pairingCode: mode === 'pairingCode' ? gateway.pairingCode?.trim() || undefined : undefined,
          isDefault: gateway.isDefault === true,
          color: gateway.color?.trim() || undefined,
        };
      });
    if (sanitized.length > 0 && !sanitized.some((gateway) => gateway.isDefault)) sanitized[0].isDefault = true;
    const res = await window.clawwork.updateAdminConfig({ ...rawConfig, gateways: sanitized });
    if (!res.ok || !res.result) {
      toast.error(res.error ?? t('settings.adminSaveFailed'));
      return;
    }
    const next = res.result as unknown as AdminConfigPayload;
    setRawConfig(next);
    setGateways(next.gateways ?? []);
    toast.success(t('settings.adminSaved'));
  }, [rawConfig, gateways, t]);

  if (!isAdmin) {
    return (
      <div className="type-label rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--text-muted)]">
        {t('settings.adminOnly')}
      </div>
    );
  }

  return (
    <SettingGroup>
      <SettingRow label={t('settings.gateways')}>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setGateways((prev) => [
              ...prev,
              {
                id: `gw-${Date.now()}`,
                name: '',
                url: '',
                authMode: 'token',
                isDefault: prev.length === 0,
              },
            ])
          }
        >
          <Plus size={14} />
          {t('common.add')}
        </Button>
      </SettingRow>
      <div className="space-y-2 px-5 pb-4">
        {gateways.map((gateway, index) => (
          <div key={`${gateway.id}-${index}`} className="space-y-2 rounded-md border border-[var(--border)] p-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <input
                className={inputClass}
                value={gateway.id}
                placeholder={t('common.gateway')}
                onChange={(e) => updateGateway(index, { id: e.target.value })}
              />
              <input
                className={inputClass}
                value={gateway.name}
                placeholder={t('settings.gatewayNamePlaceholder')}
                onChange={(e) => updateGateway(index, { name: e.target.value })}
              />
              <input
                className={inputClass}
                value={gateway.url}
                placeholder={t('settings.gatewayUrl')}
                onChange={(e) => updateGateway(index, { url: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <select
                className={inputClass}
                value={gateway.authMode ?? 'token'}
                onChange={(e) =>
                  updateGateway(index, {
                    authMode: e.target.value as ManagedGatewayRow['authMode'],
                  })
                }
              >
                <option value="token">{t('settings.token')}</option>
                <option value="password">{t('settings.password')}</option>
                <option value="pairingCode">{t('settings.pairingCode')}</option>
              </select>
              <input
                className={inputClass}
                value={gateway.token ?? ''}
                type="password"
                placeholder={t('settings.token')}
                onChange={(e) => updateGateway(index, { token: e.target.value })}
              />
              <input
                className={inputClass}
                value={gateway.password ?? ''}
                type="password"
                placeholder={t('settings.password')}
                onChange={(e) => updateGateway(index, { password: e.target.value })}
              />
              <input
                className={inputClass}
                value={gateway.pairingCode ?? ''}
                type="password"
                placeholder={t('settings.pairingCode')}
                onChange={(e) => updateGateway(index, { pairingCode: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="type-label flex items-center gap-2 text-[var(--text-primary)]">
                <input type="checkbox" checked={gateway.isDefault === true} onChange={() => setGatewayDefault(index)} />
                {t('settings.default')}
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setGateways((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} />
                {t('common.remove')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-4">
        <Button onClick={() => void save()} className="gap-2">
          <Save size={14} />
          {t('auth.saveConfig')}
        </Button>
      </div>
    </SettingGroup>
  );
}
