import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type TripSummary } from "../api";

export function TripsPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .listTrips()
      .then((r) => setTrips(r.trips))
      .catch((e) => setError(e.message));
  }, []);

  async function create() {
    setBusy(true);
    try {
      const { trip } = await api.createTrip({});
      navigate(`/trips/${trip.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create trip");
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="pane-header" style={{ padding: "0 0 1rem", border: "none" }}>
        <div>
          <h1 style={{ margin: 0 }}>Your trips</h1>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            Guest trips are stored server-side for this browser. Sign up to keep them
            across devices.
          </p>
        </div>
        <button className="btn" onClick={create} disabled={busy}>
          New trip
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!trips.length ? (
        <div className="panel empty">No trips yet. Start from the home page.</div>
      ) : (
        <div className="trip-list">
          {trips.map((t) => (
            <Link key={t.id} to={`/trips/${t.id}`} className="panel trip-item">
              <div>
                <strong>{t.title}</strong>
                <div className="muted">
                  {t.destination || "No destination"} · {t.itineraryDayCount} days planned ·{" "}
                  updated {new Date(t.updatedAt).toLocaleString()}
                </div>
              </div>
              <span className="badge">{t.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
