// Model provider. Two backends behind one call, as SPEC section 8.1 requires:
// OpenRouter is the production policy, a direct vendor key is fine for
// development, and switching is an environment variable rather than a rewrite.
//
// Server-only. The key is read from the environment here and never returned,
// logged or included in an error message.

export type Backend = "openrouter" | "anthropic";

export interface CompletionRequest {
  /** OpenRouter-style id, e.g. "anthropic/claude-opus-5". */
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Probes must be reproducible run to run as far as the vendor allows. */
  temperature?: number;
}

export interface CompletionResult {
  model: string;
  text: string;
  /** Present when the vendor reports it; used for cost accounting, not logic. */
  usage?: { input: number; output: number };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly model: string,
    readonly status?: number,
  ) {
    // Never interpolate the key or the raw auth header into this.
    super(message);
    this.name = "ProviderError";
  }
}

export function activeBackend(): Backend {
  const forced = process.env.G0_BACKEND;
  if (forced === "openrouter" || forced === "anthropic") return forced;
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "openrouter";
}

export function backendConfigured(): boolean {
  return activeBackend() === "openrouter"
    ? Boolean(process.env.OPENROUTER_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY);
}

function keyFor(backend: Backend): string {
  const k =
    backend === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.ANTHROPIC_API_KEY;
  if (!k) {
    throw new ProviderError(
      `No key configured for backend "${backend}". Set ${
        backend === "openrouter" ? "OPENROUTER_API_KEY" : "ANTHROPIC_API_KEY"
      } in the server environment.`,
      "-",
    );
  }
  return k;
}

/** OpenRouter ids carry a vendor prefix; the Anthropic API wants the bare id. */
function bareModel(model: string): string {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

async function callOpenRouter(req: CompletionRequest): Promise<CompletionResult> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${keyFor("openrouter")}`,
      "content-type": "application/json",
      "x-title": "g0-prompt-evaluator",
    },
    body: JSON.stringify({
      model: req.model,
      temperature: req.temperature ?? 0,
      max_tokens: req.maxTokens ?? 1600,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    }),
  });

  if (!res.ok) {
    throw new ProviderError(
      `OpenRouter returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
      req.model,
      res.status,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (data.error) throw new ProviderError(`OpenRouter: ${data.error.message}`, req.model);

  return {
    model: req.model,
    text: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

async function callAnthropic(req: CompletionRequest): Promise<CompletionResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": keyFor("anthropic"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: bareModel(req.model),
      max_tokens: req.maxTokens ?? 1600,
      temperature: req.temperature ?? 0,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
  });

  if (!res.ok) {
    throw new ProviderError(
      `Anthropic returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
      req.model,
      res.status,
    );
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  return {
    model: req.model,
    text: (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(""),
    usage: data.usage
      ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 }
      : undefined,
  };
}

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  return activeBackend() === "anthropic" ? callAnthropic(req) : callOpenRouter(req);
}

/**
 * Models are configurable so a run can be reproduced or repriced without a
 * code change, but the defaults are the decision in SPEC section 4.
 */
export const MODELS = {
  /** The cross-vendor consensus pair. */
  consensus: [
    process.env.G0_MODEL_A ?? "anthropic/claude-opus-5",
    process.env.G0_MODEL_B ?? "openai/gpt-5.6-sol",
  ],
  /**
   * Probe 1 needs N=3. The third is a third vendor on purpose: agreement
   * between two models that share data and post-training is not independent,
   * which is the whole argument in section 4.
   */
  probe1: [
    process.env.G0_MODEL_A ?? "anthropic/claude-opus-5",
    process.env.G0_MODEL_B ?? "openai/gpt-5.6-sol",
    process.env.G0_MODEL_C ?? "google/gemini-3.1-pro-preview",
  ],
} as const;

/** Pulls the first JSON object out of a completion that may be fenced or prefaced. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`);
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
