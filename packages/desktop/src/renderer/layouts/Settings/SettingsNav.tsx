import { motion } from 'framer-motion';
import { Settings2, MonitorDot, Blocks, Info, Users, Server, Link2, ShieldCheck, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { motionSpring } from '@/styles/design-tokens';

export type SettingsSection =
  | 'general'
  | 'system'
  | 'gateways'
  | 'agents'
  | 'skills'
  | 'user-management'
  | 'gateway-management'
  | 'agent-binding'
  | 'sso-config'
  | 'obs-config'
  | 'about';

const NAV_ITEMS: { key: SettingsSection; icon: typeof Settings2; labelKey: string }[] = [
  { key: 'general', icon: Settings2, labelKey: 'settings.general' },
  { key: 'system', icon: MonitorDot, labelKey: 'settings.system' },
  { key: 'skills', icon: Blocks, labelKey: 'settings.skills' },
  { key: 'user-management', icon: Users, labelKey: 'settings.user' },
  { key: 'gateway-management', icon: Server, labelKey: 'settings.gateways' },
  { key: 'agent-binding', icon: Link2, labelKey: 'settings.agent' },
  { key: 'sso-config', icon: ShieldCheck, labelKey: 'auth.sso' },
  { key: 'obs-config', icon: HardDrive, labelKey: 'auth.obs' },
  { key: 'about', icon: Info, labelKey: 'settings.about' },
];

export default function SettingsNav({
  active,
  onChange,
  showAdmin,
}: {
  active: SettingsSection;
  onChange: (section: SettingsSection) => void;
  showAdmin: boolean;
}) {
  const { t } = useTranslation();
  const items = NAV_ITEMS.filter((item) => {
    if (
      !showAdmin &&
      (item.key === 'user-management' ||
        item.key === 'gateway-management' ||
        item.key === 'agent-binding' ||
        item.key === 'sso-config' ||
        item.key === 'obs-config')
    ) {
      return false;
    }
    return true;
  });

  return (
    <nav className="w-44 flex-shrink-0 border-r border-[var(--border-subtle)] py-4 px-3 space-y-1">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'glow-focus type-label relative flex items-center gap-2.5 w-full h-9 px-3 rounded-lg transition-colors cursor-pointer',
              isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {isActive && (
              <motion.div
                layoutId="settings-nav-active"
                className="absolute inset-0 rounded-lg bg-[var(--bg-hover)] border border-[var(--border-subtle)]"
                transition={motionSpring.snappy}
              />
            )}
            <Icon size={16} className="relative z-10 flex-shrink-0" />
            <span className="relative z-10">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
