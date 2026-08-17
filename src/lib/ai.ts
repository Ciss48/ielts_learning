/**
 * Provider-agnostic OpenAI-compatible chat client — server / CLI only.
 *
 * Groq is the default and known-good provider; any OpenAI-compatible gateway
 * works by changing `AI_BASE_URL`. Credentials are read ONLY through
 * `config.ts` (CLAUDE.md invariant) and the module is deliberately
 * dependency-free: plain `fetch`, no SDK.
 */

import { config } from "@/lib/config";

/** Chat-completions message content parts, as the OpenAI wire format defines them. */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatChoice {
  message?: { content?: string | null };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

const MAX_ATTEMPTS = 3;
/** Backoff before attempt 2 and 3. Doubles each time. */
const BASE_BACKOFF_MS = 1_500;

/**
 * Provider limit we always respect. The task file recorded 5 for Groq vision;
 * the live model (`qwen/qwen3.6-27b`) rejects anything above 3 with
 * "Too many images provided. This model supports up to 3 images", so 3 is the
 * real ceiling and the safe default for an unknown OpenAI-compatible gateway.
 */
export const MAX_IMAGES_PER_CALL = 3;

/**
 * Output cap per call.
 *
 * This is not just a safety limit: Groq charges `input + max_completion_tokens`
 * against the tokens-per-minute quota at admission time, so an over-generous
 * cap makes every request fail with a rate-limit error rather than merely
 * costing more. 4096 leaves room for one 150-DPI page of input inside the
 * free tier's 8k/minute window, and is ample for a page of transcription once
 * reasoning is off.
 */
const MAX_COMPLETION_TOKENS = 4_096;

/** Options a caller may override per request. */
export interface ChatOptions {
  /**
   * Raises (or lowers) the output cap for one call. The default exists to keep
   * a vision request inside a per-minute token window; a plain-text call has no
   * image to pay for, so transcribing several pages at once needs — and can
   * afford — a much larger completion budget.
   */
  maxCompletionTokens?: number;
}

/** Hold the next request when fewer than this many tokens are left this window. */
const LOW_TOKEN_BUDGET = 6_000;

/**
 * Ceiling on any single wait, whether it comes from `retry-after` or from the
 * rate-limit headers. A provider that asks for an hour is telling us the budget
 * is exhausted, and silently sleeping on it looks exactly like a hung process —
 * failing fast with the number it asked for is far more useful.
 */
const MAX_WAIT_MS = 90_000;

/** Abort a single request that produces no response at all in this long. */
const REQUEST_TIMEOUT_MS = 180_000;

function requireApiKey(): string {
  if (!config.ai.apiKey) {
    throw new Error(
      "AI_API_KEY is not set in .env.local — the AI client cannot make a request.",
    );
  }
  return config.ai.apiKey;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A 4xx that is not a timeout or a rate limit is a request-shaped problem (bad
 * key, bad model, too many images); retrying it just burns quota, so it fails
 * fast. Groq reports a token-per-minute overrun as 413 with a
 * `rate_limit_exceeded` code rather than 429, so the body decides, not just the
 * status.
 */
function isRetryable(status: number, body: string): boolean {
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return status === 413 && body.includes("rate_limit_exceeded");
}

/**
 * Self-throttling. The provider publishes what is left of the current window in
 * response headers; when the budget runs low we hold the next request until the
 * window resets rather than firing it and eating a rate-limit error. This is
 * module-level state on purpose: every caller shares one token budget.
 */
let nextAllowedAt = 0;

/** Groq durations look like `7.66s`, `2m59.56s` or a plain number of seconds. */
function parseDuration(value: string | null): number | null {
  if (!value) return null;

  const plain = Number(value);
  if (Number.isFinite(plain)) return plain * 1000;

  const match = value.match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 1000;
}

function noteRateLimitHeaders(headers: Headers): void {
  const remaining = Number(headers.get("x-ratelimit-remaining-tokens"));
  const reset = parseDuration(headers.get("x-ratelimit-reset-tokens"));
  if (!Number.isFinite(remaining) || reset === null) return;

  // Below this, the next transcription request would not fit in the window.
  if (remaining < LOW_TOKEN_BUDGET) {
    nextAllowedAt = Date.now() + Math.min(reset + 1_000, MAX_WAIT_MS);
  }
}

async function waitForBudget(): Promise<void> {
  const waitMs = Math.min(nextAllowedAt - Date.now(), MAX_WAIT_MS);
  if (waitMs > 0) await sleep(waitMs);
}

/**
 * Reasoning models spend output tokens on a <think> block before answering.
 * Transcription needs no reasoning, and those tokens come straight out of the
 * rate-limit budget, so it is switched off where the provider supports it.
 * Not every OpenAI-compatible gateway knows the parameter — the first provider
 * that rejects it turns it off for the rest of the process.
 */
let sendReasoningEffort = true;

function rejectsReasoningEffort(status: number, body: string): boolean {
  return status === 400 && body.includes("reasoning_effort");
}

async function chat(
  content: ContentPart[],
  maxCompletionTokens: number = MAX_COMPLETION_TOKENS,
): Promise<string> {
  const apiKey = requireApiKey();
  const url = `${config.ai.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    await waitForBudget();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: config.ai.model,
          messages: [{ role: "user", content }],
          // Transcription must be deterministic and must not be paraphrased.
          temperature: 0,
          max_completion_tokens: maxCompletionTokens,
          ...(sendReasoningEffort ? { reasoning_effort: "none" } : {}),
        }),
        // Without this a stalled connection hangs the CLI forever.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level failure: always worth another go.
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new Error(`AI request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
    }

    noteRateLimitHeaders(response.headers);

    if (response.ok) {
      const json = (await response.json()) as ChatResponse;
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim() === "") {
        throw new Error(
          `AI returned no message content (model ${config.ai.model}).`,
        );
      }
      return text;
    }

    // Read the body for the error message; never log the key.
    const body = await response.text().catch(() => "");
    lastError = `HTTP ${response.status} ${response.statusText} — ${body.slice(0, 500)}`;

    // A provider that does not know `reasoning_effort` gets one more try
    // without it, and this attempt is not counted against the retry budget.
    if (sendReasoningEffort && rejectsReasoningEffort(response.status, body)) {
      sendReasoningEffort = false;
      attempt -= 1;
      continue;
    }

    if (!isRetryable(response.status, body) || attempt === MAX_ATTEMPTS) {
      throw new Error(`AI request failed: ${lastError}`);
    }

    // A rate limit tells us how long to wait; anything else backs off. The wait
    // is capped — see MAX_WAIT_MS — so an exhausted budget surfaces as an error
    // rather than as an apparently frozen process.
    const retryAfter = parseDuration(response.headers.get("retry-after"));
    const requested = retryAfter ?? BASE_BACKOFF_MS * 2 ** (attempt - 1);
    if (requested > MAX_WAIT_MS) {
      throw new Error(
        `AI request failed: the provider asked us to wait ${Math.round(requested / 1000)}s, ` +
          `which exceeds the ${MAX_WAIT_MS / 1000}s cap — the token budget is exhausted. ${lastError}`,
      );
    }
    await sleep(requested);
  }

  throw new Error(`AI request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

/**
 * One OpenAI-compatible chat call. `images` are PNG buffers, sent as
 * `image_url` data-URLs. Throws on non-200 after 3 retries with backoff.
 */
export async function visionChat(prompt: string, images: Buffer[]): Promise<string> {
  if (images.length > MAX_IMAGES_PER_CALL) {
    throw new Error(
      `visionChat was given ${images.length} images; the provider limit is ${MAX_IMAGES_PER_CALL}.`,
    );
  }

  const content: ContentPart[] = [
    { type: "text", text: prompt },
    ...images.map((image): ContentPart => ({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${image.toString("base64")}` },
    })),
  ];

  return chat(content);
}

export async function textChat(
  prompt: string,
  options: ChatOptions = {},
): Promise<string> {
  return chat([{ type: "text", text: prompt }], options.maxCompletionTokens);
}

/** Strips ```json fences and parses; throws with the raw string on failure. */
export function parseModelJson<T>(raw: string): T {
  // Reasoning models emit a <think>…</think> block first. It is prose, but it
  // often contains braces and quoted JSON sketches, so it has to go before any
  // brace-based scan — otherwise the fallback below locks onto the wrong span.
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // An unterminated <think> means the response was truncated mid-reasoning.
  if (/<think>/i.test(text)) {
    throw new Error(
      "Model response ended inside its <think> block — the completion was cut off before any JSON.",
    );
  }

  // Models wrap JSON in fences however they like: ```json, ``` or none.
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fence) {
    text = fence[1].trim();
  } else {
    // Some responses wrap the object in a sentence at either end; fall back to
    // the outermost {...} / [...] span.
    const start = text.search(/[{[]/);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(
      `Model did not return valid JSON (${err instanceof Error ? err.message : String(err)}).\n` +
        `--- raw response ---\n${raw}\n--- end raw response ---`,
    );
  }
}
