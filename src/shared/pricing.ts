/** Pricing assumptions used for estimated cost accounting. */

export interface LlmPricing {
  provider: string;
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  currency: string;
  version: string;
}

export interface PlacesPricing {
  sku: string;
  costPerRequest: number;
  currency: string;
  version: string;
}

export const PRICING_VERSION = "2025-11-v1";

const LLM_PRICES: Record<string, LlmPricing> = {
  "openai:gpt-4o-mini": {
    provider: "openai",
    model: "gpt-4o-mini",
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    currency: "USD",
    version: PRICING_VERSION,
  },
  "openai:gpt-4o": {
    provider: "openai",
    model: "gpt-4o",
    inputPer1M: 2.5,
    outputPer1M: 10,
    currency: "USD",
    version: PRICING_VERSION,
  },
  "openai:gpt-4.1-mini": {
    provider: "openai",
    model: "gpt-4.1-mini",
    inputPer1M: 0.4,
    outputPer1M: 1.6,
    currency: "USD",
    version: PRICING_VERSION,
  },
  "openai:gpt-4.1": {
    provider: "openai",
    model: "gpt-4.1",
    inputPer1M: 2.0,
    outputPer1M: 8.0,
    currency: "USD",
    version: PRICING_VERSION,
  },
};

const DEFAULT_LLM: LlmPricing = {
  provider: "openai",
  model: "unknown",
  inputPer1M: 0.15,
  outputPer1M: 0.6,
  currency: "USD",
  version: PRICING_VERSION,
};

export const PLACES_PRICES: Record<string, PlacesPricing> = {
  "places.googleapis.com/v1/places:searchText": {
    sku: "Places API Text Search (New) Essentials",
    costPerRequest: 0.032,
    currency: "USD",
    version: PRICING_VERSION,
  },
  "places.googleapis.com/v1/places:searchNearby": {
    sku: "Places API Nearby Search (New) Essentials",
    costPerRequest: 0.032,
    currency: "USD",
    version: PRICING_VERSION,
  },
  "places.googleapis.com/details": {
    sku: "Places API Place Details (New) Essentials",
    costPerRequest: 0.017,
    currency: "USD",
    version: PRICING_VERSION,
  },
  "maps.googleapis.com/maps/api/geocode": {
    sku: "Geocoding API",
    costPerRequest: 0.005,
    currency: "USD",
    version: PRICING_VERSION,
  },
  default: {
    sku: "Google Places / Maps (unspecified)",
    costPerRequest: 0.017,
    currency: "USD",
    version: PRICING_VERSION,
  },
};

export function getLlmPricing(provider: string, model: string): LlmPricing {
  const key = `${provider}:${model}`;
  return LLM_PRICES[key] ?? { ...DEFAULT_LLM, provider, model };
}

export function estimateLlmCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): { cost: number; pricing: LlmPricing } {
  const pricing = getLlmPricing(provider, model);
  const cost =
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M;
  return { cost: roundCost(cost), pricing };
}

export function getPlacesPricing(endpoint: string): PlacesPricing {
  return PLACES_PRICES[endpoint] ?? PLACES_PRICES.default;
}

export function estimatePlacesCost(
  endpoint: string,
  units = 1,
): { cost: number; pricing: PlacesPricing } {
  const pricing = getPlacesPricing(endpoint);
  return { cost: roundCost(pricing.costPerRequest * units), pricing };
}

export function roundCost(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
