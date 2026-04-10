import { useState } from 'react';
import { Shield, Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuditAuth } from '../context/AuditAuthContext';
import { toast } from 'sonner';

export default function ComplianceLogin() {
  const { sendMagicLink } = useAuditAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to send magic link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary mb-4">
            <Shield className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">ISO 9001 Compliance</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            Sign in with your email to access your QMS documentation
          </p>
        </div>

        {sent ? (
          <div className="rounded-xl border border-success/40 bg-success/5 p-6 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success mb-3" />
            <h2 className="font-semibold text-foreground mb-1">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              We sent a magic link to <span className="font-medium text-foreground">{email}</span>.
              Click it to sign in.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-4"
              onClick={() => setSent(false)}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button
              type="submit"
              className="w-full glow-gold gap-2"
              disabled={loading || !email}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              Send Magic Link
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
