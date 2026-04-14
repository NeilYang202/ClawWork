import { useEffect, useMemo, useState } from 'react';
import { Loader2, LogIn, ShieldCheck } from 'lucide-react';
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

  const canSubmit = useMemo(() => username.trim().length > 0 && password.trim().length > 0 && !loading, [
    username,
    password,
    loading,
  ]);

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

  const handlePasswordLogin = async (): Promise<void> => {
    if (!canSubmit) return;
    setLoading(true);
    setError('');
    const res = await window.clawwork.loginWithPassword(username.trim(), password);
    setLoading(false);
    if (!res.ok || !res.result) {
      setError(res.error ?? t('auth.loginFailed'));
      return;
    }
    onAuthenticated(res.result as AuthStatus);
  };

  const handleSsoStart = async (): Promise<void> => {
    setSsoLoading(true);
    setError('');
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
    'h-[var(--density-control-height-lg)] rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3.5',
    'text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--border-accent)]',
  );

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)] px-6">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 shadow-[var(--shadow-floating-layered)]">
        <div className="flex flex-col items-center space-y-3 text-center">
          <img src={logo} alt="ClawWork" className="h-14 w-14 rounded-2xl" />
          <h1 className="type-section-title text-[var(--text-primary)]">{t('auth.title')}</h1>
          <p className="type-body text-[var(--text-muted)]">{t('auth.subtitle')}</p>
        </div>

        <div className="space-y-3">
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
          <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {verificationUri && (
          <div className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2">
            <p className="text-sm text-[var(--text-primary)]">{t('auth.ssoHint')}</p>
            {userCode && <p className="font-mono text-sm text-[var(--accent)]">{userCode}</p>}
            <a
              className="text-xs text-[var(--info)] underline"
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
          <button
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] disabled:opacity-60"
            onClick={() => void handleSsoStart()}
            disabled={ssoLoading || polling}
          >
            {ssoLoading || polling ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            {polling ? t('auth.waitingSso') : t('auth.loginWithSso')}
          </button>
        </div>
      </div>
    </div>
  );
}
