import type { Env } from "./env";
import { recordOpsEvent, recordPlacesUsage } from "./usage";

export interface PlaceResult {
  placeId?: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  types?: string[];
  openNow?: boolean;
  priceLevel?: string;
  verified: boolean;
  source: "google_places" | "unavailable";
}

export async function searchPlaces(
  env: Env,
  opts: {
    query: string;
    locationBias?: { lat: number; lng: number; radiusMeters?: number };
    ownerType: "user" | "guest" | "system" | "unattributed";
    ownerUserId?: string | null;
    ownerGuestId?: string | null;
    tripId?: string | null;
  },
): Promise<{ places: PlaceResult[]; note?: string }> {
  if (!env.GOOGLE_MAPS_API_KEY) {
    return {
      places: [],
      note: "Google Places API is not configured. Recommendations may be unverified suggestions.",
    };
  }

  const endpoint = "places.googleapis.com/v1/places:searchText";
  const started = Date.now();
  try {
    const body: Record<string, unknown> = {
      textQuery: opts.query,
      languageCode: "en",
      maxResultCount: 8,
    };
    if (opts.locationBias) {
      body.locationBias = {
        circle: {
          center: {
            latitude: opts.locationBias.lat,
            longitude: opts.locationBias.lng,
          },
          radius: opts.locationBias.radiusMeters ?? 8000,
        },
      };
    }

    const res = await fetch(`https://${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.currentOpeningHours,places.priceLevel",
      },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - started;
    if (!res.ok) {
      const text = await res.text();
      await recordPlacesUsage(env, {
        endpoint,
        operationType: "text_search",
        status: "error",
        durationMs,
        errorInfo: text.slice(0, 300),
        ownerType: opts.ownerType,
        ownerUserId: opts.ownerUserId,
        ownerGuestId: opts.ownerGuestId,
        tripId: opts.tripId,
      });
      await recordOpsEvent(env, {
        kind: "places_error",
        message: `Places search failed: ${res.status}`,
        tripId: opts.tripId,
        ownerUserId: opts.ownerUserId,
        ownerGuestId: opts.ownerGuestId,
      });
      return {
        places: [],
        note: "Place lookup failed. Showing unverified suggestions only.",
      };
    }

    const data = (await res.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        rating?: number;
        types?: string[];
        currentOpeningHours?: { openNow?: boolean };
        priceLevel?: string;
      }>;
    };

    await recordPlacesUsage(env, {
      endpoint,
      operationType: "text_search",
      status: "ok",
      durationMs,
      ownerType: opts.ownerType,
      ownerUserId: opts.ownerUserId,
      ownerGuestId: opts.ownerGuestId,
      tripId: opts.tripId,
    });

    const places: PlaceResult[] = (data.places ?? []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: p.formattedAddress,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating,
      types: p.types,
      openNow: p.currentOpeningHours?.openNow,
      priceLevel: p.priceLevel,
      verified: true,
      source: "google_places" as const,
    }));

    return { places };
  } catch (err) {
    await recordPlacesUsage(env, {
      endpoint,
      operationType: "text_search",
      status: "error",
      durationMs: Date.now() - started,
      errorInfo: err instanceof Error ? err.message : "unknown",
      ownerType: opts.ownerType,
      ownerUserId: opts.ownerUserId,
      ownerGuestId: opts.ownerGuestId,
      tripId: opts.tripId,
    });
    return {
      places: [],
      note: "Place lookup unavailable. Recommendations may be estimates.",
    };
  }
}

export async function geocodeDestination(
  env: Env,
  destination: string,
  owner: {
    ownerType: "user" | "guest" | "system" | "unattributed";
    ownerUserId?: string | null;
    ownerGuestId?: string | null;
    tripId?: string | null;
  },
): Promise<{ lat: number; lng: number; formatted?: string } | null> {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  const endpoint = "maps.googleapis.com/maps/api/geocode";
  const started = Date.now();
  try {
    const url = `https://${endpoint}/json?address=${encodeURIComponent(destination)}&key=${env.GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const durationMs = Date.now() - started;
    const data = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };
    await recordPlacesUsage(env, {
      endpoint,
      operationType: "geocode",
      status: data.status === "OK" ? "ok" : "error",
      durationMs,
      ownerType: owner.ownerType,
      ownerUserId: owner.ownerUserId,
      ownerGuestId: owner.ownerGuestId,
      tripId: owner.tripId,
      errorInfo: data.status === "OK" ? undefined : data.status,
    });
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc) return null;
    return {
      lat: loc.lat,
      lng: loc.lng,
      formatted: data.results?.[0]?.formatted_address,
    };
  } catch {
    return null;
  }
}
