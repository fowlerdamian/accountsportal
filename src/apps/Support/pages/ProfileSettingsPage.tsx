import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

const AVATAR_COLOURS = [
  '#C0392B', '#1A6FA8', '#2E7D32', '#D4860A',
  '#6B3FA0', '#0E7C7B', '#8D3B2B', '#3D5A80',
  '#7B1FA2', '#00695C', '#E65100', '#283593',
];

export default function ProfileSettingsPage() {
  const { teamMember, user, isWarehouse, refreshTeamMember } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(teamMember?.name || '');
  const [email, setEmail] = useState(teamMember?.email || '');
  const [selectedColour, setSelectedColour] = useState(teamMember?.avatar_colour || '#5A5A5A');
  const [saving, setSaving] = useState(false);

  if (!teamMember || !user) return null;

  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const hasChanges =
    name !== teamMember.name ||
    email !== teamMember.email ||
    selectedColour !== teamMember.avatar_colour;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      toast.error('Please enter a valid email');
      return;
    }

    setSaving(true);
    try {
      const { error: profileError } = await supabase
        .from('team_members')
        .update({
          name: name.trim(),
          email: email.trim(),
          avatar_colour: selectedColour,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      if (email.trim() !== teamMember.email) {
        const { error: authError } = await supabase.auth.updateUser({
          email: email.trim(),
        });
        if (authError) {
          toast.error('Profile updated but email change failed: ' + authError.message);
          await refreshTeamMember();
          setSaving(false);
          return;
        }
        toast.success('Profile updated. Check your new email to confirm the change.');
      } else {
        toast.success('Profile updated');
      }

      await refreshTeamMember();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const inner = (
    <div className="max-w-lg">
      <button
        onClick={() => navigate(isWarehouse ? '/warehouse' : -1 as any)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <h1 className="text-lg font-heading text-foreground mb-6">Profile Settings</h1>

      {/* Avatar preview */}
      <div className="mb-8 flex items-center gap-4">
        <div
          className="h-16 w-16 flex items-center justify-center text-xl font-heading text-foreground"
          style={{ backgroundColor: selectedColour, borderRadius: '2px' }}
        >
          {initials}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{name || teamMember.name}</p>
          <p className="text-xs text-muted-foreground">{teamMember.role}</p>
        </div>
      </div>

      {/* Avatar colour picker */}
      <div className="mb-6">
        <label className="text-xs font-heading uppercase tracking-widest text-muted-foreground mb-2 block">
          Avatar Colour
        </label>
        <div className="flex flex-wrap gap-2">
          {AVATAR_COLOURS.map(colour => (
            <button
              key={colour}
              onClick={() => setSelectedColour(colour)}
              className={cn(
                'h-8 w-8 transition-all',
                selectedColour === colour
                  ? 'ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110'
                  : 'hover:scale-105'
              )}
              style={{ backgroundColor: colour, borderRadius: '2px' }}
              title={colour}
            />
          ))}
        </div>
      </div>

      {/* Name field */}
      <div className="mb-4">
        <label className="text-xs font-heading uppercase tracking-widest text-muted-foreground mb-1.5 block">
          Display Name
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          placeholder="Your name"
          maxLength={100}
        />
      </div>

      {/* Email field */}
      <div className="mb-6">
        <label className="text-xs font-heading uppercase tracking-widest text-muted-foreground mb-1.5 block">
          Email Address
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full bg-background border border-input text-sm px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
          placeholder="your@email.com"
          maxLength={255}
        />
        {email.trim() !== teamMember.email && email.trim() && (
          <p className="text-[11px] text-muted-foreground mt-1">
            You'll receive a confirmation email at the new address.
          </p>
        )}
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={!hasChanges || saving}
        className={cn(
          'px-4 py-2.5 text-sm font-body border transition-colors',
          hasChanges && !saving
            ? 'border-foreground text-foreground hover:bg-foreground hover:text-background'
            : 'border-border text-muted-foreground cursor-not-allowed'
        )}
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  );

  // Warehouse users access this outside AppLayout, so wrap in a standalone page
  if (isWarehouse) {
    return (
      <div className="min-h-screen bg-background px-6 py-8">
        {inner}
      </div>
    );
  }

  return inner;
}
