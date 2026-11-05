import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, type ChatMessage, type Trip } from "../api";
import { TripMap } from "../components/TripMap";

export function TripPage() {
  const { id } = useParams();
  const location = useLocation() as { state?: { initialMessage?: string } };
  const [trip, setTrip] = useState<Trip | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"itinerary" | "map">("itinerary");
  const bootstrapped = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getTrip(id)
      .then(async (r) => {
        setTrip(r.trip);
        setMessages(r.messages);
        if (!bootstrapped.current && location.state?.initialMessage) {
          bootstrapped.current = true;
          await send(location.state.initialMessage, r.trip.id, r.messages);
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(message: string, tripId = id!, prior = messages) {
    setBusy(true);
    setError(null);
    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    setMessages([...prior, optimistic]);
    try {
      const result = await api.chat(tripId, message);
      setTrip(result.trip);
      const refreshed = await api.getTrip(tripId);
      setMessages(refreshed.messages);
      setTrip(refreshed.trip);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
      setMessages(prior);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const msg = input.trim();
    setInput("");
    await send(msg);
  }

  async function removeActivity(day: number, activityId: string) {
    if (!trip) return;
    try {
      const { itinerary } = await api.editActivity(trip.id, {
        action: "remove",
        day,
        activityId,
      });
      setTrip({ ...trip, itinerary });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit failed");
    }
  }

  if (error && !trip) {
    return (
      <div className="panel auth-card">
        <div className="error">{error}</div>
        <Link to="/trips">Back to trips</Link>
      </div>
    );
  }

  if (!trip) return <p className="muted">Loading trip…</p>;

  return (
    <div className="planner">
      <section className="panel chat-pane">
        <div className="pane-header">
          <div>
            <h2>{trip.title}</h2>
            <div className="muted" style={{ fontSize: "0.9rem" }}>
              {trip.destination || "Destination TBD"}
              {trip.durationDays ? ` · ${trip.durationDays} days` : ""}
              {trip.ownerType === "guest" ? " · Guest trip" : ""}
            </div>
          </div>
          <Link className="btn secondary" to="/trips">
            All trips
          </Link>
        </div>
        <div className="messages">
          {!messages.length && (
            <div className="empty">
              Tell me about your trip and I’ll build a personalized itinerary.
            </div>
          )}
          {messages
            .filter((m) => m.role !== "system")
            .map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
          {busy && (
            <div className="bubble assistant">
              Planning<span className="loading-dots" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        {error && <div className="error" style={{ margin: "0 0.9rem" }}>{error}</div>}
        <form className="composer" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask for changes, restaurants, a lighter day three…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSubmit(e);
              }
            }}
          />
          <button className="btn" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </section>

      <section className="panel plan-pane">
        <div className="pane-header">
          <h2>Itinerary</h2>
          <div className="tabs" style={{ margin: 0 }}>
            <button
              className={`tab ${tab === "itinerary" ? "active" : ""}`}
              onClick={() => setTab("itinerary")}
              type="button"
            >
              Days
            </button>
            <button
              className={`tab ${tab === "map" ? "active" : ""}`}
              onClick={() => setTab("map")}
              type="button"
            >
              Map
            </button>
          </div>
        </div>
        <div className="plan-body">
          {tab === "map" ? (
            <TripMap itinerary={trip.itinerary} />
          ) : !trip.itinerary?.days?.length ? (
            <div className="empty">
              Your day-by-day plan will appear here after the assistant generates an
              itinerary.
            </div>
          ) : (
            <>
              {trip.itinerary.summary && <p>{trip.itinerary.summary}</p>}
              {trip.itinerary.estimatedTotalCost != null && (
                <p className="muted">
                  Estimated total: {trip.itinerary.currency ?? "USD"}{" "}
                  {trip.itinerary.estimatedTotalCost.toLocaleString()}{" "}
                  <span className="badge warn">estimate</span>
                </p>
              )}
              <TripMap itinerary={trip.itinerary} />
              {trip.itinerary.days.map((day) => (
                <article key={day.day} className="day-card">
                  <h3>
                    Day {day.day}
                    {day.title ? ` — ${day.title}` : ""}
                  </h3>
                  {day.summary && <p className="muted">{day.summary}</p>}
                  {day.activities.map((a) => (
                    <div key={a.id} className="activity">
                      <div className="time">
                        {a.startTime || "—"}
                        {a.endTime ? `–${a.endTime}` : ""}
                      </div>
                      <div>
                        <strong>{a.name}</strong>
                        {a.description && <div className="meta">{a.description}</div>}
                        {a.location?.name && (
                          <div className="meta">{a.location.name}</div>
                        )}
                        {a.estimatedCost != null && (
                          <div className="meta">
                            ~{trip.itinerary?.currency ?? "USD"} {a.estimatedCost}{" "}
                            {a.costIsEstimate !== false && (
                              <span className="badge warn">estimate</span>
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => removeActivity(day.day, a.id)}
                        title="Remove activity"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </article>
              ))}
              {!!trip.itinerary.tips?.length && (
                <div className="day-card">
                  <h3>Tips</h3>
                  <ul>
                    {trip.itinerary.tips.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                {trip.itinerary.costDisclaimer ||
                  "Costs are estimates unless marked as verified."}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
