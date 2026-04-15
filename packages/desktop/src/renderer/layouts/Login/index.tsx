import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogIn, Settings2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import logo from '@/assets/logo.png';
import { cn } from '@/lib/utils';

interface AuthStatus {
  authenticated: boolean;
  user?: {
    userId?: string;
    userName?: string;
    email?: string;
    displayName?: string;
    provider?: string;
    isAdmin?: boolean;
  };
  expiresAt?: string;
  authEnabled: boolean;
  ssoEnabled: boolean;
  serviceConfigured: boolean;
}

interface LoginProps {
  onAuthenticated: (status: AuthStatus) => void;
}

export default function Login({ onAuthenticated }: LoginProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error, setError] = useState('');
  const [userCode, setUserCode] = useState('');
  const [deviceCode, setDeviceCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [polling, setPolling] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [authServiceUrl, setAuthServiceUrl] = useState('');
  const [authServiceUrlDraft, setAuthServiceUrlDraft] = useState('');
  const [ssoEnabled, setSsoEnabled] = useState(false);

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.trim().length > 0 && !loading,
    [username, password, loading],
  );

  useEffect(() => {
    window.clawwork
      .getSettings()
      .then((settings) => {
        if (!settings) return;
        const url = settings.auth?.serviceUrl ?? '';
        setAuthServiceUrl(url);
        setAuthServiceUrlDraft(url);
        if (url.trim()) {
          window.clawwork
            .getAuthPublicConfig(url)
            .then((res) => {
              if (res.ok && res.result) setSsoEnabled(Boolean((res.result as { ssoEnabled?: boolean }).ssoEnabled));
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!polling || !deviceCode) return;
    const tick = async () => {
      const res = await window.clawwork.pollSsoLogin(deviceCode);
      if (!res.ok) {
        setError(res.error ?? t('auth.loginFailed'));
        setPolling(false);
        return;
      }
      const result = res.result as { done?: boolean; status?: AuthStatus } | undefined;
      if (result?.done && result.status?.authenticated) {
        setPolling(false);
        onAuthenticated(result.status);
        return;
      }
      timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [deviceCode, polling, onAuthenticated, t]);

  const saveAuthUrl = async (): Promise<boolean> => {
    const nextUrl = authServiceUrl.trim();
    if (!nextUrl) {
      setError(t('auth.authServiceRequired'));
      return false;
    }
    const current = await window.clawwork.getSettings();
    const res = await window.clawwork.updateSettings({
      auth: {
        ...(current?.auth ?? {}),
        enabled: current?.auth?.enabled ?? true,
        serviceUrl: nextUrl,
      },
    });
    if (!res.ok) {
      setError(t('auth.saveConfigFailed'));
      return false;
    }
    const publicCfg = await window.clawwork.getAuthPublicConfig(nextUrl);
    if (publicCfg.ok && publicCfg.result) {
      setSsoEnabled(Boolean((publicCfg.result as { ssoEnabled?: boolean }).ssoEnabled));
    }
    return true;
  };

  const handleSaveServerConfig = async (): Promise<void> => {
    setError('');
    const nextUrl = authServiceUrlDraft.trim();
    if (!nextUrl) {
      setError(t('auth.authServiceRequired'));
      return;
    }
    setAuthServiceUrl(nextUrl);
    const ok = await saveAuthUrl();
    if (!ok) return;
    setConfigModalOpen(false);
  };

  const handlePasswordLogin = async (): Promise<void> => {
    if (!canSubmit) return;
    setError('');
    const ok = await saveAuthUrl();
    if (!ok) return;
    setLoading(true);
    const res = await window.clawwork.loginWithPassword(username.trim(), password);
    setLoading(false);
    if (!res.ok || !res.result) {
      setError(res.error ?? t('auth.loginFailed'));
      return;
    }
    onAuthenticated(res.result as AuthStatus);
  };

  const handleSsoStart = async (): Promise<void> => {
    setError('');
    const ok = await saveAuthUrl();
    if (!ok) return;
    setSsoLoading(true);
    const res = await window.clawwork.startSsoLogin();
    setSsoLoading(false);
    if (!res.ok || !res.result) {
      setError(res.error ?? t('auth.ssoStartFailed'));
      return;
    }
    const result = res.result as { verificationUri?: string; userCode?: string; deviceCode?: string };
    if (!result.deviceCode || !result.verificationUri) {
      setError(t('auth.ssoStartFailed'));
      return;
    }
    setVerificationUri(result.verificationUri);
    setUserCode(result.userCode ?? '');
    setDeviceCode(result.deviceCode);
    setPolling(true);
    window.open(result.verificationUri, '_blank');
  };

  const inputClass = cn(
    'h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3.5',
    'text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-accent)]',
  );

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)] px-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-[var(--shadow-floating-layered)]">
        <div className="flex flex-col items-center space-y-3 text-center">
          <img src={logo} alt="Dbcwork" className="h-14 w-14 rounded-2xl" />
          <h1 className="type-section-title text-[var(--text-primary)]">{t('auth.title')}</h1>
          <p className="type-body text-[var(--text-muted)]">{t('auth.subtitle')}</p>
        </div>

        <div className="space-y-2">
          <label className="type-label block text-[var(--text-muted)]">{t('auth.username')}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />

          <label className="type-label block text-[var(--text-muted)]">{t('auth.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handlePasswordLogin();
            }}
          />
        </div>

        {error && (
          <div className="type-label rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-[var(--danger)]">
            {error}
          </div>
        )}

        {verificationUri && (
          <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2">
            <p className="type-label text-[var(--text-primary)]">{t('auth.ssoHint')}</p>
            {userCode && <p className="type-label font-mono text-[var(--accent)]">{userCode}</p>}
            <a
              className="type-label text-[var(--info)] underline"
              href={verificationUri}
              target="_blank"
              rel="noreferrer"
            >
              {verificationUri}
            </a>
          </div>
        )}

        <div className="space-y-2">
          <button
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)] disabled:opacity-60"
            onClick={() => void handlePasswordLogin()}
            disabled={!canSubmit}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            {t('auth.login')}
          </button>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setConfigModalOpen(true)}
              className="glow-focus inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2.5 type-support text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Settings2 size={12} />
              {t('auth.serverConfig')}
            </button>
          </div>
          {ssoEnabled && (
            <button
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] disabled:opacity-60"
              onClick={() => void handleSsoStart()}
              disabled={ssoLoading || polling}
            >
              {ssoLoading || polling ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {polling ? t('auth.waitingSso') : t('auth.loginWithSso')}
            </button>
          )}
        </div>
      </div>
      {configModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] px-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 shadow-[var(--shadow-floating-layered)]">
            <h2 className="type-section-title mb-3 text-[var(--text-primary)]">{t('auth.serverConfig')}</h2>
            <div className="space-y-2">
              <label className="type-label block text-[var(--text-muted)]">{t('auth.authServiceUrl')}</label>
              <input
                value={authServiceUrlDraft}
                onChange={(e) => setAuthServiceUrlDraft(e.target.value)}
                className={inputClass}
                placeholder="https://auth.example.com"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="glow-focus h-10 rounded-lg border border-[var(--border)] px-4 type-label text-[var(--text-primary)]"
                onClick={() => {
                  setAuthServiceUrlDraft(authServiceUrl);
                  setConfigModalOpen(false);
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="glow-focus h-10 rounded-lg bg-[var(--accent)] px-4 type-label text-[var(--accent-foreground)]"
                onClick={() => void handleSaveServerConfig()}
              >
                {t('auth.saveConfig')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
