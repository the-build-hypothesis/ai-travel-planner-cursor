import { randomId, nowIso } from "../shared/crypto";
import { estimateLlmCost, estimatePlacesCost } from "../shared/pricing";
import type { Env } from "./env";

export interface UsageOwner {
  ownerType: "user" | "guest" | "system" | "unattributed";
  ownerUserId?: string | null;
  ownerGuestId?: string | null;
  tripId?: string | null;
}

export async function recordLlmUsage(
  env: Env,
  opts: UsageOwner & {
    model: string;
    operationType: string;
    status: string;
    inputTokens: number;
    outputTokens: number;
    durationMs?: number;
    errorInfo?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const provider = opts.provider ?? "openai";
  const { cost, pricing } = estimateLlmCost(
    provider,
    opts.model,
    opts.inputTokens,
    opts.outputTokens,
  );
  await env.DB.prepare(
    `INSERT INTO usage_records (
      id, timestamp, provider, model_or_endpoint, operation_type,
      owner_type, owner_user_id, owner_guest_id, trip_id, status,
      input_tokens, output_tokens, billable_units, estimated_cost, currency,
      pricing_version, duration_ms, error_info, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(),
      nowIso(),
      provider,
      opts.model,
      opts.operationType,
      opts.ownerType,
      opts.ownerUserId ?? null,
      opts.ownerGuestId ?? null,
      opts.tripId ?? null,
      opts.status,
      opts.inputTokens,
      opts.outputTokens,
      opts.inputTokens + opts.outputTokens,
      cost,
      pricing.currency,
      pricing.version,
      opts.durationMs ?? null,
      opts.errorInfo ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    )
    .run();
  return { cost, pricing };
}

export async function recordPlacesUsage(
  env: Env,
  opts: UsageOwner & {
    endpoint: string;
    operationType: string;
    status: string;
    units?: number;
    durationMs?: number;
    errorInfo?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const units = opts.units ?? 1;
  const { cost, pricing } = estimatePlacesCost(opts.endpoint, units);
  await env.DB.prepare(
    `INSERT INTO usage_records (
      id, timestamp, provider, model_or_endpoint, operation_type,
      owner_type, owner_user_id, owner_guest_id, trip_id, status,
      input_tokens, output_tokens, billable_units, estimated_cost, currency,
      pricing_version, duration_ms, error_info, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(),
      nowIso(),
      "google_places",
      opts.endpoint,
      opts.operationType,
      opts.ownerType,
      opts.ownerUserId ?? null,
      opts.ownerGuestId ?? null,
      opts.tripId ?? null,
      opts.status,
      null,
      null,
      units,
      cost,
      pricing.currency,
      pricing.version,
      opts.durationMs ?? null,
      opts.errorInfo ?? null,
      opts.metadata
        ? JSON.stringify({ ...opts.metadata, sku: pricing.sku })
        : JSON.stringify({ sku: pricing.sku }),
    )
    .run();
  return { cost, pricing };
}

export async function recordOpsEvent(
  env: Env,
  opts: {
    kind: string;
    severity?: string;
    message: string;
    tripId?: string | null;
    ownerUserId?: string | null;
    ownerGuestId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await env.DB.prepare(
    `INSERT INTO ops_events (id, timestamp, kind, severity, message, trip_id, owner_user_id, owner_guest_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId(),
      nowIso(),
      opts.kind,
      opts.severity ?? "error",
      opts.message,
      opts.tripId ?? null,
      opts.ownerUserId ?? null,
      opts.ownerGuestId ?? null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
    )
    .run();
}
