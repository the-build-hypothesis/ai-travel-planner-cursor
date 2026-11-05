import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type PublicUser } from "./api";
import { AccountPage } from "./pages/AccountPage";
import { AdminApp } from "./pages/admin/AdminApp";
import { AuthPages } from "./pages/AuthPages";
import { HomePage } from "./pages/HomePage";
import { TripPage } from "./pages/TripPage";
import { TripsPage } from "./pages/TripsPage";

export function App() {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await api.logout();
    setUser(null);
    navigate("/");
  }

  return (
    <Routes>
      <Route path="/admin/*" element={<AdminApp />} />
      <Route
        path="*"
        element={
          <div className="shell">
            <header className="topbar">
              <Link to="/" className="brand">
                AI Travel <span>Planner</span>
              </Link>
              <nav className="nav-actions">
                <Link className="btn ghost" to="/trips">
                  My trips
                </Link>
                {user ? (
                  <>
                    <Link className="btn secondary" to="/account">
                      {user.displayName || user.email}
                    </Link>
                    <button className="btn secondary" onClick={logout}>
                      Log out
                    </button>
                  </>
                ) : (
                  <>
                    <Link className="btn secondary" to="/login">
                      Log in
                    </Link>
                    <Link className="btn" to="/register">
                      Sign up
                    </Link>
                  </>
                )}
              </nav>
            </header>
            <Routes>
              <Route path="/" element={<HomePage user={user ?? null} />} />
              <Route path="/trips" element={<TripsPage />} />
              <Route path="/trips/:id" element={<TripPage />} />
              <Route
                path="/login"
                element={<AuthPages mode="login" onAuth={setUser} />}
              />
              <Route
                path="/register"
                element={<AuthPages mode="register" onAuth={setUser} />}
              />
              <Route path="/forgot-password" element={<AuthPages mode="forgot" />} />
              <Route path="/reset-password" element={<AuthPages mode="reset" />} />
              <Route path="/verify-email" element={<AuthPages mode="verify" />} />
              <Route
                path="/account"
                element={
                  user === undefined ? (
                    <p className="muted">Loading…</p>
                  ) : user ? (
                    <AccountPage user={user} onUpdate={setUser} />
                  ) : (
                    <Navigate to="/login" replace />
                  )
                }
              />
            </Routes>
            <footer className="footer">
              Conversational trip planning with estimated costs clearly labeled. Guest
              plans stay on this device until you create an account.
            </footer>
          </div>
        }
      />
    </Routes>
  );
}
