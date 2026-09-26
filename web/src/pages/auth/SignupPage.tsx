import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { authApi } from "@/services/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface SignupFormValues {
  invitation_token: string;
  email: string;
  password: string;
}

// #42: rebuilt to close two problems in the old SignupPage --
// (1) it was never routed (see App.tsx), and (2) it let the submitter pick
// their own `role`, including `admin` -- a privilege-escalation hazard. This
// form has exactly three fields (invitation token, email, password); no
// role selector exists anywhere on the page, enforced server-side too
// (Auth::Registration never reads a `role` param even if one is sent).
export default function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  // #38's anti-enumeration design returns the exact same message for an
  // invalid/expired/used invitation token and for a duplicate email -- this
  // is deliberate (so the form can't be used to enumerate accounts), so this
  // page never tries to show a more specific message than the backend gives.
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormValues>({
    defaultValues: {
      // The rake task that mints invitations prints a registration URL
      // shaped like `/signup?token=<token>` (see api/lib/tasks/invitations.rake) --
      // prefill from it when present, but keep the field editable so someone
      // who lost the query param can paste their token in directly.
      invitation_token: searchParams.get("token") ?? "",
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: SignupFormValues) => {
    setError(null);
    setLoading(true);
    try {
      await authApi.signup(data);
      navigate("/login", { state: { justRegistered: true } });
    } catch (e: any) {
      setError(
        e?.response?.data?.errors?.[0]?.message ??
          "Registration could not be completed. Please try again."
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
          <p className="text-sm text-muted-foreground mt-1">Create an account</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="invitation_token">Invitation token</Label>
            <Input
              id="invitation_token"
              autoComplete="off"
              {...register("invitation_token", {
                required: "Invitation token is required",
              })}
            />
            {errors.invitation_token && (
              <p className="text-xs text-destructive">{errors.invitation_token.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              {...register("email", {
                required: "Email is required",
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: "Enter a valid email address",
                },
              })}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register("password", {
                required: "Password is required",
              })}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Sign up
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
