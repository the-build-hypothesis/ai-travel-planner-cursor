export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmChatRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  timeoutMs?: number;
}

export interface LlmChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  raw?: unknown;
}

export interface LlmProvider {
  readonly name: string;
  chat(req: LlmChatRequest, apiKey: string): Promise<LlmChatResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
