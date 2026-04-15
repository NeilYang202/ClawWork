import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import SettingGroup from '@/components/semantic/SettingGroup';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdminConfigPayload {
  obs: Record<string, unknown>;
  sso: { enabled?: boolean; provider?: string; adDomain?: string };
  accessControl: Record<string, unknown>;
  gateways: Array<Record<string, unknown>>;
}

const inputClass = cn(
  'h-[var(--density-control-height-lg)] rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3',
  'text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]',
);

export default function SsoConfigSection() {
  const { t } = useTranslation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [rawConfig, setRawConfig] = useState<AdminConfigPayload | null>(null);
  const [provider, setProvider] = useState('');
  const [adDomain, setAdDomain] = useState('');

  const load = useCallback(async () => {
    const authStatus = await window.clawwork.getAuthStatus();
    const admin = Boolean(authStatus.user?.isAdmin);
    setIsAdmin(admin);
    if (!admin) return;
    const remote = await window.clawwork.getAdminConfig();
    if (!remote.ok || !remote.result) return;
    const cfg = remote.result as unknown as AdminConfigPayload;
    setRawConfig(cfg);
    setProvider(cfg.sso?.provider ?? '');
    setAdDomain(cfg.sso?.adDomain ?? '');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!rawConfig) return;
    const res = await window.clawwork.updateAdminConfig({
      ...rawConfig,
      sso: {
        enabled: Boolean(provider.trim()),
        provider: provider.trim() || undefined,
        adDomain: adDomain.trim() || undefined,
      },
    });
    if (!res.ok || !res.result) {
      toast.error(res.error ?? t('settings.adminSaveFailed'));
      return;
    }
    setRawConfig(res.result as unknown as AdminConfigPayload);
    toast.success(t('settings.adminSaved'));
  }, [rawConfig, provider, adDomain, t]);

  if (!isAdmin) {
    return (
      <div className="type-label rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--text-muted)]">
        {t('settings.adminOnly')}
      </div>
    );
  }

  return (
    <SettingGroup>
      <div className="grid grid-cols-1 gap-2 px-5 py-4">
        <input
          className={inputClass}
          placeholder={t('auth.ssoProvider')}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('auth.adDomain')}
          value={adDomain}
          onChange={(e) => setAdDomain(e.target.value)}
        />
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
