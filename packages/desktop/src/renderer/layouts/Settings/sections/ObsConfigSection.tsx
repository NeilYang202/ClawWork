import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import SettingGroup from '@/components/semantic/SettingGroup';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdminConfigPayload {
  obs: {
    enabled?: boolean;
    endpoint?: string;
    bucket?: string;
    basePath?: string;
    accessKey?: string;
    secretKey?: string;
  };
  sso: Record<string, unknown>;
  accessControl: Record<string, unknown>;
  gateways: Array<Record<string, unknown>>;
}

const inputClass = cn(
  'h-[var(--density-control-height-lg)] rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3',
  'text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]',
);

export default function ObsConfigSection() {
  const { t } = useTranslation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [rawConfig, setRawConfig] = useState<AdminConfigPayload | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [basePath, setBasePath] = useState('desktop');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');

  const load = useCallback(async () => {
    const authStatus = await window.clawwork.getAuthStatus();
    const admin = Boolean(authStatus.user?.isAdmin);
    setIsAdmin(admin);
    if (!admin) return;
    const remote = await window.clawwork.getAdminConfig();
    if (!remote.ok || !remote.result) return;
    const cfg = remote.result as unknown as AdminConfigPayload;
    setRawConfig(cfg);
    setEnabled(cfg.obs?.enabled ?? true);
    setEndpoint(cfg.obs?.endpoint ?? '');
    setBucket(cfg.obs?.bucket ?? '');
    setBasePath(cfg.obs?.basePath ?? 'desktop');
    setAccessKey(cfg.obs?.accessKey ?? '');
    setSecretKey(cfg.obs?.secretKey ?? '');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!rawConfig) return;
    const res = await window.clawwork.updateAdminConfig({
      ...rawConfig,
      obs: {
        enabled,
        endpoint: endpoint.trim() || undefined,
        bucket: bucket.trim() || undefined,
        basePath: basePath.trim() || undefined,
        accessKey: accessKey.trim() || undefined,
        secretKey: secretKey.trim() || undefined,
      },
    });
    if (!res.ok || !res.result) {
      toast.error(res.error ?? t('settings.adminSaveFailed'));
      return;
    }
    setRawConfig(res.result as unknown as AdminConfigPayload);
    toast.success(t('settings.adminSaved'));
  }, [rawConfig, enabled, endpoint, bucket, basePath, accessKey, secretKey, t]);

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
          placeholder={t('auth.obsServiceUrl')}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('auth.obsBucket')}
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('auth.obsBasePath')}
          value={basePath}
          onChange={(e) => setBasePath(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('auth.obsAccessKey')}
          value={accessKey}
          onChange={(e) => setAccessKey(e.target.value)}
        />
        <input
          className={inputClass}
          type="password"
          placeholder={t('auth.obsSecretKey')}
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
        />
        <label className="type-label flex items-center gap-2 text-[var(--text-primary)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('auth.enableObs')}
        </label>
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
