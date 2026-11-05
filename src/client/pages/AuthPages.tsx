import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type PublicUser } from "../api";

export function AuthPages({
  mode,
  onAuth,
}: {
  mode: "login" | "register" | "forgot" | "reset" | "verify";
  onAuth?: (user: PublicUser | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    if (mode === "verify") {
      const token = params.get("token");
      if (!token) {
        setError("Missing verification token.");
        return;
      }
      setBusy(true);
      api
        .verifyEmail(token)
        .then((r) => {
          setMessage(r.message);
          if (!r.ok) setError(r.message);
        })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }
  }, [mode, params]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "login") {
        const r = await api.login({ email, password });
        onAuth?.(r.user);
        navigate("/trips");
      } else if (mode === "register") {
        const r = await api.register({ email, password, displayName: displayName || undefined });
        onAuth?.(r.user);
        setMessage("Account created. Check your email to verify, then keep planning.");
        navigate("/trips");
      } else if (mode === "forgot") {
        const r = await api.forgotPassword(email);
        setMessage(r.message);
      } else if (mode === "reset") {
        const token = params.get("token");
        if (!token) throw new Error("Missing reset token");
        const r = await api.resetPassword(token, password);
        if (!r.ok) throw new Error(r.message);
        setMessage(r.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<typeof mode, string> = {
    login: "Welcome back",
    register: "Create your account",
    forgot: "Forgot password",
    reset: "Choose a new password",
    verify: "Email verification",
  };

  return (
    <div className="panel auth-card">
      <h1>{titles[mode]}</h1>
      <p className="lead">
        {mode === "register"
          ? "Guest trips on this browser will move to your account."
          : mode === "login"
            ? "Access saved trips from any device."
            : "We’ll keep your account secure."}
      </p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      {mode !== "verify" && (
        <form onSubmit={onSubmit}>
          {mode !== "reset" && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
          {mode === "register" && (
            <div className="field">
              <label htmlFor="name">Display name</label>
              <input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}
          {(mode === "login" || mode === "register" || mode === "reset") && (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <button className="btn" disabled={busy} style={{ width: "100%" }}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : mode === "register"
                  ? "Sign up"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Update password"}
          </button>
        </form>
      )}

      <div style={{ marginTop: "1rem" }} className="muted">
        {mode === "login" && (
          <>
            <Link to="/forgot-password">Forgot password?</Link>
            {" · "}
            <Link to="/register">Create an account</Link>
          </>
        )}
        {mode === "register" && <Link to="/login">Already have an account?</Link>}
        {(mode === "forgot" || mode === "reset" || mode === "verify") && (
          <Link to="/login">Back to login</Link>
        )}
      </div>
    </div>
  );
}
