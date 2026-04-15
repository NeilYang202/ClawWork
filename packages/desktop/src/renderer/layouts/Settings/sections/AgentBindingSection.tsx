import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { AgentInfo } from '@clawwork/shared';
import SettingGroup from '@/components/semantic/SettingGroup';
import SettingRow from '@/components/semantic/SettingRow';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ConfirmDialog from '@/components/semantic/ConfirmDialog';
import { useDialogGuard } from '@/hooks/useDialogGuard';
import { cn } from '@/lib/utils';

interface BindingRow {
  username: string;
  gatewayId: string;
  agentId: string;
}

interface AdminUserRow {
  id: string;
  username: string;
}

interface ManagedGatewayRow {
  id: string;
  name: string;
}

interface AdminConfigPayload {
  obs: Record<string, unknown>;
  sso: Record<string, unknown>;
  accessControl: {
    enabled: boolean;
    adminUsers: string[];
    bindings: BindingRow[];
  };
  gateways: ManagedGatewayRow[];
}

const inputClass = cn(
  'h-[var(--density-control-height-lg)] rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3',
  'text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]',
);

export default function AgentBindingSection() {
  const { t } = useTranslation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [rawConfig, setRawConfig] = useState<AdminConfigPayload | null>(null);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [agentsByGateway, setAgentsByGateway] = useState<Record<string, AgentInfo[]>>({});
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [draftUser, setDraftUser] = useState('');
  const [draftGateway, setDraftGateway] = useState('');
  const [draftAgent, setDraftAgent] = useState('');

  const isDirty = draftUser.length > 0 || draftGateway.length > 0 || draftAgent.length > 0;
  const { confirmOpen, guardedOpenChange, contentProps, confirmDiscard, cancelDiscard } = useDialogGuard({
    isDirty: () => isDirty,
    onConfirmClose: () => setAddOpen(false),
  });

  const load = useCallback(async () => {
    const authStatus = await window.clawwork.getAuthStatus();
    const admin = Boolean(authStatus.user?.isAdmin);
    setIsAdmin(admin);
    if (!admin) return;
    const [cfgRes, usersRes] = await Promise.all([window.clawwork.getAdminConfig(), window.clawwork.listAdminUsers()]);
    if (cfgRes.ok && cfgRes.result) {
      const cfg = cfgRes.result as unknown as AdminConfigPayload;
      setRawConfig(cfg);
      setBindings(cfg.accessControl?.bindings ?? []);
      const gateways = cfg.gateways ?? [];
      const nextAgentsByGateway: Record<string, AgentInfo[]> = {};
      for (const gateway of gateways) {
        const res = await window.clawwork.listAgents(gateway.id);
        if (res.ok && res.result) {
          const data = res.result as { agents?: AgentInfo[] };
          nextAgentsByGateway[gateway.id] = data.agents ?? [];
        }
      }
      setAgentsByGateway(nextAgentsByGateway);
      if (gateways[0]) {
        setDraftGateway(gateways[0].id);
        setDraftAgent(nextAgentsByGateway[gateways[0].id]?.[0]?.id ?? '');
      }
    }
    if (usersRes.ok && usersRes.result) {
      setUsers((usersRes.result as AdminUserRow[]).map((item) => ({ id: item.id, username: item.username })));
      if ((usersRes.result as AdminUserRow[])[0]) setDraftUser((usersRes.result as AdminUserRow[])[0].username);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bindings;
    return bindings.filter((binding) =>
      `${binding.username} ${binding.gatewayId} ${binding.agentId}`.toLowerCase().includes(q),
    );
  }, [bindings, query]);

  const save = useCallback(async () => {
    if (!rawConfig) return;
    const sanitizedBindings = bindings.filter((binding) => binding.username && binding.gatewayId && binding.agentId);
    const res = await window.clawwork.updateAdminConfig({
      ...rawConfig,
      accessControl: { ...rawConfig.accessControl, bindings: sanitizedBindings },
    });
    if (!res.ok || !res.result) {
      toast.error(res.error ?? t('settings.adminSaveFailed'));
      return;
    }
    const next = res.result as unknown as AdminConfigPayload;
    setRawConfig(next);
    setBindings(next.accessControl?.bindings ?? []);
    toast.success(t('settings.adminSaved'));
  }, [rawConfig, bindings, t]);

  const addBinding = useCallback(() => {
    if (!draftUser || !draftGateway || !draftAgent) {
      toast.error(t('settings.adminSaveFailed'));
      return;
    }
    setBindings((prev) => [...prev, { username: draftUser, gatewayId: draftGateway, agentId: draftAgent }]);
    setAddOpen(false);
  }, [draftUser, draftGateway, draftAgent, t]);

  if (!isAdmin) {
    return (
      <div className="type-label rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--text-muted)]">
        {t('settings.adminOnly')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingGroup>
        <SettingRow label={t('settings.userAgentBinding')}>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} />
            {t('common.add')}
          </Button>
        </SettingRow>
        <div className="px-5 pb-4">
          <input
            className={inputClass}
            placeholder={t('leftNav.searchTasks')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="px-5 pb-4">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
            {filtered.map((row, index) => (
              <div
                key={`${row.username}-${row.gatewayId}-${row.agentId}-${index}`}
                className="grid grid-cols-1 gap-2 md:grid-cols-4"
              >
                <input className={inputClass} value={row.username} readOnly />
                <input className={inputClass} value={row.gatewayId} readOnly />
                <input className={inputClass} value={row.agentId} readOnly />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBindings((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 size={14} />
                  {t('common.remove')}
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 pb-4">
          <Button onClick={() => void save()} className="gap-2">
            <Save size={14} />
            {t('auth.saveConfig')}
          </Button>
        </div>
      </SettingGroup>

      <Dialog open={addOpen} onOpenChange={guardedOpenChange}>
        <DialogContent {...contentProps}>
          <DialogHeader>
            <DialogTitle>{t('settings.userAgentBinding')}</DialogTitle>
            <DialogDescription>{t('common.add')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            <select className={inputClass} value={draftUser} onChange={(e) => setDraftUser(e.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.username}>
                  {user.username}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={draftGateway}
              onChange={(e) => {
                const gatewayId = e.target.value;
                setDraftGateway(gatewayId);
                setDraftAgent(agentsByGateway[gatewayId]?.[0]?.id ?? '');
              }}
            >
              {(rawConfig?.gateways ?? []).map((gateway) => (
                <option key={gateway.id} value={gateway.id}>
                  {gateway.name}
                </option>
              ))}
            </select>
            <select className={inputClass} value={draftAgent} onChange={(e) => setDraftAgent(e.target.value)}>
              {(agentsByGateway[draftGateway] ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name ?? agent.id}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => guardedOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={addBinding}>{t('common.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmOpen}
        title={t('common.discardChangesTitle')}
        description={t('common.discardChangesDesc')}
        confirmLabel={t('common.discard')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}
