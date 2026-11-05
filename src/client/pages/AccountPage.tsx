import { useState, type FormEvent } from "react";
import { api, type PublicUser } from "../api";

export function AccountPage({
  user,
  onUpdate,
}: {
  user: PublicUser;
  onUpdate: (u: PublicUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.updateAccount(displayName);
      onUpdate(r.user);
      setMessage("Profile updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password changed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
    }
  }

  async function resend() {
    try {
      await api.resendVerification();
      setMessage("Verification email sent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend");
    }
  }

  return (
    <div className="panel auth-card" style={{ width: "min(520px, calc(100% - 2rem))" }}>
      <h1>Account</h1>
      <p className="lead">{user.email}</p>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <p>
        Email status:{" "}
        {user.emailVerified ? (
          <span className="badge">Verified</span>
        ) : (
          <>
            <span className="badge warn">Unverified</span>{" "}
            <button className="btn secondary" type="button" onClick={resend}>
              Resend verification
            </button>
          </>
        )}
      </p>
      <form onSubmit={saveProfile}>
        <div className="field">
          <label>Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <button className="btn secondary">Save profile</button>
      </form>
      <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "1.4rem 0" }} />
      <form onSubmit={changePassword}>
        <div className="field">
          <label>Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>New password</label>
          <input
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn">Change password</button>
      </form>
    </div>
  );
}
