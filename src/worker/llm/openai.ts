import type { LlmChatRequest, LlmChatResult, LlmProvider } from "./types";
import { LlmError } from "./types";

export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";

  async chat(req: LlmChatRequest, apiKey: string): Promise<LlmChatResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);

    try {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
      };
      if (req.responseFormat === "json_object") {
        body.response_format = { type: "json_object" };
      }

      let attempt = 0;
      let lastErr: unknown;
      while (attempt < 3) {
        attempt++;
        try {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (res.status === 429 || res.status >= 500) {
            const text = await res.text();
            if (attempt < 3) {
              await sleep(400 * attempt);
              continue;
            }
            throw new LlmError(
              `OpenAI temporary error: ${res.status}`,
              "provider_unavailable",
              res.status,
              true,
            );
          }

          if (!res.ok) {
            const text = await res.text();
            throw new LlmError(
              `OpenAI error: ${res.status} ${text.slice(0, 200)}`,
              "provider_error",
              res.status,
              false,
            );
          }

          const data = (await res.json()) as {
            model?: string;
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          const content = data.choices?.[0]?.message?.content ?? "";
          return {
            content,
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            model: data.model ?? req.model,
            provider: this.name,
            raw: data,
          };
        } catch (err) {
          lastErr = err;
          if (err instanceof LlmError && !err.retryable) throw err;
          if (attempt >= 3) break;
          await sleep(400 * attempt);
        }
      }
      if (lastErr instanceof LlmError) throw lastErr;
      if (lastErr instanceof Error && lastErr.name === "AbortError") {
        throw new LlmError("LLM request timed out", "timeout", 504, true);
      }
      throw new LlmError(
        lastErr instanceof Error ? lastErr.message : "LLM request failed",
        "unknown",
        500,
        false,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
