import { create } from 'zustand';
import type { ApprovalDecision, ExecApprovalRequest } from '@clawwork/shared';

type PendingApproval = ExecApprovalRequest & { gatewayId: string };

const expireTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useApprovalStore = create<{
  pendingApprovals: PendingApproval[];
  addApproval: (gatewayId: string, req: ExecApprovalRequest) => void;
  removeApproval: (id: string) => void;
  resolveApproval: (id: string, decision: ApprovalDecision) => void;
}>((set, get) => ({
  pendingApprovals: [],

  addApproval(gatewayId, req) {
    if (get().pendingApprovals.some((a) => a.id === req.id)) return;
    set((s) => ({ pendingApprovals: [...s.pendingApprovals, { ...req, gatewayId }] }));
    const ttl = req.expiresAtMs - Date.now();
    if (ttl > 0) {
      expireTimers.set(
        req.id,
        setTimeout(() => {
          expireTimers.delete(req.id);
          get().removeApproval(req.id);
        }, ttl),
      );
    }
  },

  removeApproval(id) {
    clearTimeout(expireTimers.get(id));
    expireTimers.delete(id);
    set((s) => ({ pendingApprovals: s.pendingApprovals.filter((a) => a.id !== id) }));
  },

  resolveApproval(id, decision) {
    const approval = get().pendingApprovals.find((a) => a.id === id);
    if (!approval) return;
    window.clawwork.resolveExecApproval(approval.gatewayId, id, decision).catch(() => {});
    get().removeApproval(id);
  },
}));
