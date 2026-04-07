import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Mail, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@guide/components/ui/button";
import { Input } from "@guide/components/ui/input";
import { Label } from "@guide/components/ui/label";
import { supabase } from "@guide/integrations/supabase/client";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/guide`,
      },
    });

    setSubmitting(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-accent">
        <div className="w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-accent-foreground">Guide</h1>
          </div>

          <div className="bg-card rounded-xl p-8 shadow-lg text-center space-y-4">
            <CheckCircle className="w-12 h-12 text-primary mx-auto" />
            <h2 className="text-lg font-semibold">Check your email</h2>
            <p className="text-sm text-muted-foreground">
              We sent a magic link to <strong>{email}</strong>. Click the link in the email to sign in.
            </p>
            <Button variant="outline" className="w-full mt-4" onClick={() => setSent(false)}>
              Try a different email
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-accent">
      <div className="w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-accent-foreground">Guide</h1>
          <p className="text-accent-foreground/60 mt-1">Product Installation Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-xl p-8 shadow-lg space-y-5">
          <div>
            <Label htmlFor="email" className="text-sm font-medium">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@aga.com.au"
              className="mt-1.5"
              required
            />
          </div>

          <Button type="submit" className="w-full font-semibold" disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
            Send Magic Link
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            No public registration. Contact your admin for access.
          </p>
        </form>
      </div>
    </div>
  );
}
