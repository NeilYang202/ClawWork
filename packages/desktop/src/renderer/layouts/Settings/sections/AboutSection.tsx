import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SettingGroup from '@/components/semantic/SettingGroup';
import SettingRow from '@/components/semantic/SettingRow';

export default function AboutSection() {
  const { t } = useTranslation();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);

  useEffect(() => {
    window.clawwork
      .getAppVersion()
      .then(setCurrentVersion)
      .catch((err: unknown) => {
        console.error('[AboutSection] getAppVersion failed:', err);
      });
  }, []);

  return (
    <div>
      <h3 className="type-section-title mb-4 text-[var(--text-primary)]">{t('settings.about')}</h3>
      <SettingGroup>
        <SettingRow label={t('settings.version')}>
          <span className="type-mono-data text-[var(--text-primary)]">
            {currentVersion ? `v${currentVersion}` : '—'}
          </span>
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
