import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { Itinerary } from "../api";
import L from "leaflet";

const icon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function FitBounds({
  points,
}: {
  points: Array<{ lat: number; lng: number }>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 12);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [map, points]);
  return null;
}

export function TripMap({ itinerary }: { itinerary: Itinerary | null }) {
  const points: Array<{ lat: number; lng: number; name: string; day: number }> = [];
  for (const day of itinerary?.days ?? []) {
    for (const a of day.activities) {
      if (a.location?.lat != null && a.location?.lng != null) {
        points.push({
          lat: a.location.lat,
          lng: a.location.lng,
          name: a.name,
          day: day.day,
        });
      }
    }
  }

  const center = points[0]
    ? ([points[0].lat, points[0].lng] as [number, number])
    : ([20, 0] as [number, number]);

  return (
    <div className="map-wrap">
      <MapContainer
        center={center}
        zoom={points.length ? 11 : 2}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {points.map((p, i) => (
          <Marker key={`${p.day}-${i}`} position={[p.lat, p.lng]} icon={icon}>
            <Popup>
              Day {p.day}: {p.name}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      {!points.length && (
        <div
          style={{
            position: "relative",
            top: "-230px",
            textAlign: "center",
            pointerEvents: "none",
            color: "#3a5360",
            fontWeight: 600,
          }}
        >
          Locations appear here once your itinerary includes map coordinates.
        </div>
      )}
    </div>
  );
}
