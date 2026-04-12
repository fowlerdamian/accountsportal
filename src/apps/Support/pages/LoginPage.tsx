import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode]         = useState<'password' | 'magic'>('password');
  const [loading, setLoading]   = useState(false);
  const [sent, setSent]         = useState(false);
  const { session, isWarehouse, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && session) {
      navigate(isWarehouse ? '/support/warehouse' : '/support', { replace: true });
    }
  }, [session, isWarehouse, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);

    if (mode === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setLoading(false);
      if (error) {
        toast.error(
          error.message === 'Invalid login credentials'
            ? 'Incorrect email or password.'
            : error.message
        );
      }
      // On success, useEffect above handles redirect
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin + '/support' },
      });
      setLoading(false);
      if (error) {
        if (error.message.toLowerCase().includes('signups not allowed') || error.message.toLowerCase().includes('not allowed')) {
          toast.error('No account found — ask your admin for an invite');
        } else {
          toast.error(error.message);
        }
        return;
      }
      setSent(true);
      toast.success('Check your inbox for a sign-in link');
    }
  };

  if (isLoading) return null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm bg-card border border-border p-8"
      >
        <div className="flex justify-center mb-4">
          <img src="/icons/icon-192.png" alt="Support Hub" className="h-12 w-12" />
        </div>
        <h1 className="text-lg font-heading tracking-wider mb-1 text-center text-foreground">SUPPORT HUB</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          {sent ? 'Magic link sent — check your email' : 'Sign in with your team email'}
        </p>

        {sent ? (
          <div className="text-center space-y-4">
            <p className="text-xs text-muted-foreground">
              We sent a sign-in link to <span className="text-foreground font-medium">{email}</span>
            </p>
            <button
              onClick={() => setSent(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
              autoComplete="email"
              className="w-full bg-background border border-input text-foreground text-sm px-3 py-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
            />

            {mode === 'password' && (
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                required
                autoComplete="current-password"
                className="w-full bg-background border border-input text-foreground text-sm px-3 py-2.5 placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
              />
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === 'password' ? 'Signing in…' : 'Sending link…'}
                </>
              ) : (
                mode === 'password' ? 'Sign In' : 'Send magic link'
              )}
            </button>

            <button
              type="button"
              onClick={() => setMode(m => m === 'password' ? 'magic' : 'password')}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              {mode === 'password' ? 'Sign in with a magic link instead' : 'Sign in with password instead'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
