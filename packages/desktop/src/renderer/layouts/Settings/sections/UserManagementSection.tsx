import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
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

interface AdminUserRow {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  isAdmin: boolean;
  isActive: boolean;
}

const inputClass = cn(
  'h-[var(--density-control-height-lg)] rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3',
  'text-[var(--text-primary)] outline-none focus:border-[var(--border-accent)]',
);

export default function UserManagementSection() {
  const { t } = useTranslation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [query, setQuery] = useState('');
  const [passwordDraftByUserId, setPasswordDraftByUserId] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUserIsAdmin, setNewUserIsAdmin] = useState(false);

  const isDirty =
    newUsername.trim().length > 0 ||
    newPassword.trim().length > 0 ||
    newEmail.trim().length > 0 ||
    newDisplayName.trim().length > 0 ||
    newUserIsAdmin;
  const { confirmOpen, guardedOpenChange, contentProps, confirmDiscard, cancelDiscard } = useDialogGuard({
    isDirty: () => isDirty,
    onConfirmClose: () => setAddOpen(false),
  });

  const load = useCallback(async () => {
    const authStatus = await window.clawwork.getAuthStatus();
    const admin = Boolean(authStatus.user?.isAdmin);
    setIsAdmin(admin);
    if (!admin) return;
    const usersRes = await window.clawwork.listAdminUsers();
    if (usersRes.ok && usersRes.result) {
      setUsers(usersRes.result as AdminUserRow[]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [u.username, u.email ?? '', u.displayName ?? '', u.isAdmin ? 'admin' : 'user']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [users, query]);

  const createUser = useCallback(async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      toast.error(t('settings.adminSaveFailed'));
      return;
    }
    const res = await window.clawwork.createAdminUser({
      username: newUsername.trim(),
      password: newPassword,
      email: newEmail.trim() || undefined,
      displayName: newDisplayName.trim() || undefined,
      isAdmin: newUserIsAdmin,
    });
    if (!res.ok || !res.result) {
      toast.error(res.error ?? t('settings.adminSaveFailed'));
      return;
    }
    setUsers((prev) => [res.result as AdminUserRow, ...prev]);
    setNewUsername('');
    setNewPassword('');
    setNewEmail('');
    setNewDisplayName('');
    setNewUserIsAdmin(false);
    setAddOpen(false);
    toast.success(t('common.add'));
  }, [newUsername, newPassword, newEmail, newDisplayName, newUserIsAdmin, t]);

  const resetUserPassword = useCallback(
    async (user: AdminUserRow) => {
      const draft = passwordDraftByUserId[user.id]?.trim() ?? '';
      if (!draft) {
        toast.error(t('settings.adminSaveFailed'));
        return;
      }
      const res = await window.clawwork.updateAdminUser({ userId: user.id, password: draft });
      if (!res.ok || !res.result) {
        toast.error(res.error ?? t('settings.adminSaveFailed'));
        return;
      }
      setPasswordDraftByUserId((prev) => ({ ...prev, [user.id]: '' }));
      toast.success(t('settings.adminSaved'));
    },
    [passwordDraftByUserId, t],
  );

  const toggleUserActive = useCallback(
    async (user: AdminUserRow) => {
      const res = await window.clawwork.updateAdminUser({ userId: user.id, isActive: !user.isActive });
      if (!res.ok || !res.result) {
        toast.error(res.error ?? t('settings.adminSaveFailed'));
        return;
      }
      const updated = res.result as AdminUserRow;
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t('settings.adminSaved'));
    },
    [t],
  );

  const removeUser = useCallback(
    async (user: AdminUserRow) => {
      const ok = window.confirm(`${t('common.remove')}: ${user.username}?`);
      if (!ok) return;
      const res = await window.clawwork.deleteAdminUser(user.id);
      if (!res.ok) {
        toast.error(res.error ?? t('settings.adminSaveFailed'));
        return;
      }
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
      toast.success(t('common.remove'));
    },
    [t],
  );

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
        <SettingRow label={t('settings.adminCreateUser')}>
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
            {filtered.map((u) => (
              <div
                key={u.id}
                className="type-label space-y-2 rounded-md border border-[var(--border)] px-3 py-2 text-[var(--text-primary)]"
              >
                <div className="flex items-center justify-between">
                  <span>{u.username}</span>
                  <span className="text-[var(--text-muted)]">
                    {u.isAdmin ? t('settings.userRoleAdmin') : t('settings.userRoleUser')} /{' '}
                    {u.isActive ? t('settings.userStatusActive') : t('settings.userStatusDisabled')}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input
                    className={inputClass}
                    type="password"
                    placeholder={t('settings.adminResetPassword')}
                    value={passwordDraftByUserId[u.id] ?? ''}
                    onChange={(e) => setPasswordDraftByUserId((prev) => ({ ...prev, [u.id]: e.target.value }))}
                  />
                  <Button variant="outline" size="sm" onClick={() => void resetUserPassword(u)}>
                    {t('settings.adminResetPassword')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void toggleUserActive(u)}>
                    {u.isActive ? t('settings.adminDisableUser') : t('settings.adminEnableUser')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void removeUser(u)}>
                    {t('common.remove')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingGroup>

      <Dialog open={addOpen} onOpenChange={guardedOpenChange}>
        <DialogContent {...contentProps}>
          <DialogHeader>
            <DialogTitle>{t('settings.adminCreateUser')}</DialogTitle>
            <DialogDescription>{t('settings.adminCreateUser')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            <input
              className={inputClass}
              placeholder={t('auth.username')}
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
            />
            <input
              className={inputClass}
              type="password"
              placeholder={t('auth.password')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder={t('auth.email')}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder={t('auth.displayName')}
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
            />
            <label className="type-label flex items-center gap-2 text-[var(--text-primary)]">
              <input type="checkbox" checked={newUserIsAdmin} onChange={(e) => setNewUserIsAdmin(e.target.checked)} />
              {t('settings.admin')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => guardedOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void createUser()}>{t('common.add')}</Button>
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
