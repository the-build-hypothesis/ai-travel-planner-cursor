import type { Env } from "../env";
import { OpenAiProvider } from "./openai";
import type { LlmChatRequest, LlmChatResult, LlmProvider } from "./types";
import { LlmError } from "./types";

export * from "./types";

export function getConfiguredProvider(env: Env): { provider: LlmProvider; model: string } {
  const name = (env.LLM_PROVIDER || "openai").toLowerCase();
  const model = env.LLM_MODEL;
  if (!model) {
    throw new LlmError("LLM_MODEL is not configured", "config_missing", 500);
  }
  if (name === "openai") {
    return { provider: new OpenAiProvider(), model };
  }
  throw new LlmError(
    `Unsupported LLM_PROVIDER: ${name}. No silent fallback.`,
    "unsupported_provider",
    500,
  );
}

export async function runChat(
  env: Env,
  req: Omit<LlmChatRequest, "model"> & { model?: string },
): Promise<LlmChatResult> {
  const { provider, model } = getConfiguredProvider(env);
  if (!env.OPENAI_API_KEY && provider.name === "openai") {
    throw new LlmError("OPENAI_API_KEY is not configured", "config_missing", 500);
  }
  const apiKey = env.OPENAI_API_KEY ?? "";
  return provider.chat({ ...req, model: req.model ?? model }, apiKey);
}
