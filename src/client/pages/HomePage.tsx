import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type PublicUser } from "../api";

const EXAMPLE =
  "Plan a five-day family vacation to Tokyo in April. We have two adults and two children, ages 10 and 14. Our budget is $5,000 excluding flights. We enjoy technology, Japanese food, gaming, and cultural attractions.";

export function HomePage({ user }: { user: PublicUser | null }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function startTrip(message: string) {
    setBusy(true);
    setError(null);
    try {
      const { trip } = await api.createTrip({});
      navigate(`/trips/${trip.id}`, { state: { initialMessage: message } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start trip");
      setBusy(false);
    }
  }

  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="brand">
            AI Travel <span>Planner</span>
          </div>
          <h1>Describe the trip. Watch the itinerary take shape.</h1>
          <p>
            A conversational planner for families, couples, and curious travelers —
            with day-by-day schedules, maps, and plans you can refine and save.
          </p>
          <div className="nav-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() => startTrip(EXAMPLE)}
            >
              Try the Tokyo example
            </button>
            {!user && (
              <button className="btn secondary" onClick={() => navigate("/register")}>
                Create a free account
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="panel" style={{ padding: "1.2rem" }}>
        <h2 style={{ marginTop: 0 }}>Start planning</h2>
        <p className="muted">
          No account required. Guests can create, refine, and reopen trips in this
          browser.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="composer" style={{ border: "none", padding: 0 }}>
          <textarea
            rows={4}
            placeholder="Tell me where you want to go, who is traveling, and what matters most…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            className="btn"
            disabled={busy || !prompt.trim()}
            onClick={() => startTrip(prompt.trim())}
          >
            {busy ? "Starting…" : "Plan this trip"}
          </button>
        </div>
      </section>
    </>
  );
}
