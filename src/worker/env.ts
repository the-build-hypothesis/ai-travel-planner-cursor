export interface Env {
  DB: D1Database;
  RATE_LIMIT: KVNamespace;
  ASSETS: Fetcher;
  EMAIL?: SendEmail;
  APP_NAME?: string;
  APP_PUBLIC_URL?: string;
  LLM_PROVIDER?: string;
  LLM_MODEL?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_MAPS_API_KEY?: string;
  EMAIL_FROM?: string;
  SESSION_SECRET?: string;
}

/** Minimal type for Cloudflare Email Workers send binding. */
export interface SendEmail {
  send(message: EmailMessageLike): Promise<void>;
}

export interface EmailMessageLike {
  // Cloudflare EmailMessage constructed in email.ts
}

export interface AppContext {
  env: Env;
  request: Request;
  publicUrl: string;
}
