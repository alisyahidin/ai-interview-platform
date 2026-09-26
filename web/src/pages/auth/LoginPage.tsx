import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSetAtom } from "jotai";
import { authAtom, saveToken } from "@/stores/authAtom";
import { authApi } from "@/services/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // #42: SignupPage sends this signal on successful registration so the
  // login page can confirm the account was actually created.
  const justRegistered = Boolean((location.state as { justRegistered?: boolean } | null)?.justRegistered);
  const setAuth = useSetAtom(authAtom);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // #43: block the request client-side on empty fields rather than relying
    // solely on the browser's native `required` validation, which jsdom/test
    // environments don't reliably enforce.
    if (!email.trim() || !password.trim()) {
      setError("Enter both your email and password.");
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      const token = res.data.token;
      saveToken(token);
      setAuth({ token });
      navigate("/assessments");
    } catch (e: any) {
      // #43: surface whatever message the backend actually returns for a
      // failed login (see Auth::Authentication's "Invalid email or
      // password" -- never invent per-field specificity it doesn't give us)
      // rather than a hardcoded string, with a generic fallback if the
      // response has none.
      setError(
        e?.response?.data?.errors?.[0]?.message ?? "Invalid email or password."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">AI Interview</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
        </div>

        {/* #43: states plainly who this page is for, per #35's AC9 --
            internal assessors/staff only. Candidates never have a password
            to enter here; they reach their interview via the invite link
            emailed to them (Session#invite_token), so this is informational
            copy, not a link to a self-service candidate path that doesn't
            exist. Styled to match the informational block on Phase 4's
            candidate-facing NoticeScreen (bg-muted/50 rounded-lg p-4 text-sm). */}
        <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-1">
          <p>This sign-in is for internal assessors and staff.</p>
          <p>Candidates: use the interview link emailed to you instead.</p>
        </div>

        {justRegistered && (
          <p className="text-sm text-center text-emerald-600 bg-emerald-50 rounded-md py-2 px-3">
            Account created. Please sign in.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Sign in
          </Button>
        </form>

      </div>
    </div>
  );
}
