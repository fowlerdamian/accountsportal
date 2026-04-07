import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { X } from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'warehouse';
  avatar_colour: string;
  status: 'invited' | 'active' | 'deactivated';
  last_seen_at: string | null;
  created_at: string;
}

// Inline confirmation state
type ConfirmAction = { type: 'deactivate' | 'reactivate' | 'change_role'; memberId: string; memberName: string; newRole?: string } | null;

export default function TeamSettingsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'admin' | 'warehouse'>('staff');
  const [inviteError, setInviteError] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const { data: teamMembers = [], isLoading } = useQuery({
    queryKey: ['team-members-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as TeamMember[];
    },
  });

  const adminCount = teamMembers.filter(m => m.role === 'admin' && m.status === 'active').length;

  const invokeFn = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('team-admin', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const inviteMutation = useMutation({
    mutationFn: () => invokeFn({ action: 'invite', name: inviteName, email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      toast.success(`Invite sent to ${inviteEmail}`);
      setDrawerOpen(false);
      setInviteName('');
      setInviteEmail('');
      setInviteRole('staff');
      setInviteError('');
      queryClient.invalidateQueries({ queryKey: ['team-members-admin'] });
    },
    onError: (err: Error) => {
      if (err.message.includes('already registered')) {
        setInviteError('This email is already registered.');
      } else {
        toast.error(err.message);
      }
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (memberId: string) => invokeFn({ action: 'deactivate', memberId }),
    onSuccess: () => {
      toast.success(`${confirmAction?.memberName} has been deactivated`);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['team-members-admin'] });
    },
    onError: (err: Error) => { toast.error(err.message); setConfirmAction(null); },
  });

  const reactivateMutation = useMutation({
    mutationFn: ({ memberId, email }: { memberId: string; email: string }) =>
      invokeFn({ action: 'reactivate', memberId, email }),
    onSuccess: () => {
      const member = teamMembers.find(m => m.id === confirmAction?.memberId);
      toast.success(`${confirmAction?.memberName} has been reactivated — a new login link has been sent to ${member?.email}`);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['team-members-admin'] });
    },
    onError: (err: Error) => { toast.error(err.message); setConfirmAction(null); },
  });

  const resendInviteMutation = useMutation({
    mutationFn: (email: string) => invokeFn({ action: 'resend_invite', email }),
    onSuccess: (_, email) => { toast.success(`Invite resent to ${email}`); },
    onError: (err: Error) => toast.error(err.message),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ memberId, newRole }: { memberId: string; newRole: string }) =>
      invokeFn({ action: 'change_role', memberId, newRole }),
    onSuccess: () => {
      toast.success(`Role updated for ${confirmAction?.memberName}`);
      setConfirmAction(null);
      queryClient.invalidateQueries({ queryKey: ['team-members-admin'] });
    },
    onError: (err: Error) => { toast.error(err.message); setConfirmAction(null); },
  });

  if (!isAdmin) return <Navigate to="/support" replace />;

  const isLastAdmin = (member: TeamMember) => member.role === 'admin' && adminCount <= 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-heading">TEAM</h2>
        <button
          onClick={() => setDrawerOpen(true)}
          className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Invite team member
        </button>
      </div>

      <div className="bg-card border border-border">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading team...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-heading tracking-wider text-muted-foreground">MEMBER</th>
                <th className="text-left px-4 py-3 text-xs font-heading tracking-wider text-muted-foreground">ROLE</th>
                <th className="text-left px-4 py-3 text-xs font-heading tracking-wider text-muted-foreground">STATUS</th>
                <th className="text-left px-4 py-3 text-xs font-heading tracking-wider text-muted-foreground">LAST SEEN</th>
                <th className="text-right px-4 py-3 text-xs font-heading tracking-wider text-muted-foreground">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member, i) => {
                const isDeactivated = member.status === 'deactivated';
                const showConfirm = confirmAction?.memberId === member.id;

                return (
                  <motion.tr
                    key={member.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: isDeactivated ? 0.5 : 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-7 w-7 flex items-center justify-center text-[10px] font-medium text-foreground"
                          style={{ backgroundColor: member.avatar_colour, borderRadius: '2px' }}
                        >
                          {member.name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <p className="text-foreground">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2 py-0.5 text-[11px] font-medium border capitalize',
                        member.status === 'active' ? 'bg-status-resolved/15 text-status-resolved border-status-resolved/30' :
                        member.status === 'invited' ? 'bg-status-warning/15 text-status-warning border-status-warning/30' :
                        'bg-status-neutral/15 text-status-neutral border-status-neutral/30'
                      )}>
                        {member.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {member.last_seen_at
                        ? formatDistanceToNow(new Date(member.last_seen_at), { addSuffix: true })
                        : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {showConfirm ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground mr-1">
                            {confirmAction.type === 'deactivate' && `Deactivate ${member.name}? They will lose access immediately.`}
                            {confirmAction.type === 'reactivate' && `Reactivate ${member.name}?`}
                            {confirmAction.type === 'change_role' && `Change ${member.name} to ${confirmAction.newRole}?`}
                          </span>
                          <button
                            onClick={() => {
                              if (confirmAction.type === 'deactivate') deactivateMutation.mutate(member.id);
                              if (confirmAction.type === 'reactivate') reactivateMutation.mutate({ memberId: member.id, email: member.email });
                              if (confirmAction.type === 'change_role') changeRoleMutation.mutate({ memberId: member.id, newRole: confirmAction.newRole! });
                            }}
                            className="text-xs bg-primary text-primary-foreground px-2 py-1 hover:opacity-90"
                          >
                            {confirmAction.type === 'deactivate' ? 'Yes, deactivate' : 'Confirm'}
                          </button>
                          <button onClick={() => setConfirmAction(null)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-3">
                          {member.status === 'invited' && (
                            <>
                              <button
                                onClick={() => resendInviteMutation.mutate(member.email)}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                Resend invite
                              </button>
                              <button
                                onClick={() => setConfirmAction({ type: 'deactivate', memberId: member.id, memberName: member.name })}
                                className="text-xs text-status-urgent/70 hover:text-status-urgent transition-colors"
                              >
                                Deactivate
                              </button>
                            </>
                          )}
                          {member.status === 'active' && (
                            <>
                              <div className="relative group">
                                <button
                                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  Change role ▾
                                </button>
                                <div className="absolute right-0 top-full mt-1 bg-card border border-border shadow-lg z-10 hidden group-hover:block min-w-[100px]">
                                  {(['admin', 'staff', 'warehouse'] as const)
                                    .filter(r => r !== member.role)
                                    .map(r => (
                                      <button
                                        key={r}
                                        onClick={() => {
                                          if (isLastAdmin(member) && r !== 'admin') {
                                            toast.error('You cannot remove the last admin. Assign another admin first.');
                                            return;
                                          }
                                          setConfirmAction({ type: 'change_role', memberId: member.id, memberName: member.name, newRole: r });
                                        }}
                                        className="block w-full text-left px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 capitalize transition-colors"
                                      >
                                        {r}
                                      </button>
                                    ))}
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  if (isLastAdmin(member)) {
                                    toast.error('You cannot remove the last admin. Assign another admin first.');
                                    return;
                                  }
                                  setConfirmAction({ type: 'deactivate', memberId: member.id, memberName: member.name });
                                }}
                                className="text-xs text-status-urgent/70 hover:text-status-urgent transition-colors"
                              >
                                Deactivate
                              </button>
                            </>
                          )}
                          {member.status === 'deactivated' && (
                            <button
                              onClick={() => setConfirmAction({ type: 'reactivate', memberId: member.id, memberName: member.name })}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-background border-l border-border z-50 flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                <h3 className="text-sm font-heading tracking-wider">INVITE TEAM MEMBER</h3>
                <button onClick={() => setDrawerOpen(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 px-6 py-6 space-y-5">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Full name</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={e => setInviteName(e.target.value)}
                    placeholder="e.g. Sarah Chen"
                    className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Work email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => { setInviteEmail(e.target.value); setInviteError(''); }}
                    placeholder="sarah@company.com"
                    className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                  />
                  {inviteError && <p className="text-xs text-destructive mt-1">{inviteError}</p>}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">Role</label>
                  <div className="flex gap-2">
                    {(['staff', 'admin', 'warehouse'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => setInviteRole(r)}
                        className={cn(
                          'px-4 py-2 text-sm border capitalize transition-colors',
                          inviteRole === r ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:border-[hsl(0,0%,25%)]'
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-border">
                <button
                  onClick={() => inviteMutation.mutate()}
                  disabled={!inviteName.trim() || !inviteEmail.trim() || inviteMutation.isPending}
                  className={cn(
                    'w-full bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 transition-opacity',
                    (!inviteName.trim() || !inviteEmail.trim()) && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  {inviteMutation.isPending ? 'Sending...' : 'Send invite'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
