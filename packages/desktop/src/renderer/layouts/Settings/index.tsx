import { useEffect, useState, type ComponentType } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { motion as motionPresets, motionDuration } from '@/styles/design-tokens';
import WindowTitlebar from '@/components/semantic/WindowTitlebar';
import SettingsNav, { type SettingsSection } from './SettingsNav';
import GeneralSection from './sections/GeneralSection';
import SystemSection from './sections/SystemSection';
import GatewaysSection from './sections/GatewaysSection';
import AgentsSection from './sections/AgentsSection';
import SkillsSection from './sections/SkillsSection';
import UserManagementSection from './sections/UserManagementSection';
import GatewayManagementSection from './sections/GatewayManagementSection';
import AgentBindingSection from './sections/AgentBindingSection';
import SsoConfigSection from './sections/SsoConfigSection';
import ObsConfigSection from './sections/ObsConfigSection';
import AboutSection from './sections/AboutSection';

const SECTION_COMPONENTS: Record<SettingsSection, ComponentType> = {
  general: GeneralSection,
  system: SystemSection,
  gateways: GatewaysSection,
  agents: AgentsSection,
  skills: SkillsSection,
  'user-management': UserManagementSection,
  'gateway-management': GatewayManagementSection,
  'agent-binding': AgentBindingSection,
  'sso-config': SsoConfigSection,
  'obs-config': ObsConfigSection,
  about: AboutSection,
};

export default function Settings() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [isAdmin, setIsAdmin] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(true);

  useEffect(() => {
    window.clawwork
      .getAuthStatus()
      .then((status) => {
        setIsAdmin(Boolean(status.user?.isAdmin));
        setAuthEnabled(status.authEnabled !== false);
      })
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    if (activeSection === 'gateways' || activeSection === 'agents') setActiveSection('general');
    if (
      !isAdmin &&
      (activeSection === 'user-management' ||
        activeSection === 'gateway-management' ||
        activeSection === 'agent-binding' ||
        activeSection === 'sso-config' ||
        activeSection === 'obs-config')
    ) {
      setActiveSection('general');
    }
  }, [isAdmin, authEnabled, activeSection]);

  const SectionComponent = SECTION_COMPONENTS[activeSection];

  return (
    <motion.div {...motionPresets.fadeIn} className="flex flex-col h-full">
      <WindowTitlebar
        left={<h2 className="type-section-title text-[var(--text-primary)]">{t('common.settings')}</h2>}
      />

      <div className="flex flex-1 min-h-0">
        <SettingsNav active={activeSection} onChange={setActiveSection} showAdmin={isAdmin} />

        <div className="flex-1 overflow-y-auto px-8 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: motionDuration.normal }}
            >
              <SectionComponent />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
