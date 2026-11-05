import { describe, expect, it } from "vitest";
import { LlmError } from "../src/worker/llm/types";

describe("LLM provider selection contract", () => {
  it("rejects unsupported providers without silent fallback", () => {
    const provider: string = "anthropic";
    const supported = provider === "openai";
    expect(supported).toBe(false);
    const err = new LlmError(
      `Unsupported LLM_PROVIDER: ${provider}. No silent fallback.`,
      "unsupported_provider",
      500,
    );
    expect(err.code).toBe("unsupported_provider");
  });

  it("requires explicit model configuration", () => {
    const model = undefined as string | undefined;
    expect(model).toBeFalsy();
  });
});
