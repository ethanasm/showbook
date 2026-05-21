/**
 * `withLlmRetry` — single entry point for "call Groq, get back parsed,
 * Zod-validated JSON" across the six extraction helpers in `groq.ts`.
 *
 * Owns:
 * - `traceLLM` wrapping (Langfuse trace + Groq usage extraction)
 * - JSON parsing of the choice content
 * - Zod-schema validation
 * - 429/Retry-After retry loop — previously only `extractShowFromEmail`
 *   had this, the other five callers were silently surfacing 429s as
 *   first-attempt failures.
 *
 * Each failure mode throws a distinct Error subclass so callers can
 * decide whether to surface the failure as a thrown error, a `null`
 * return, or a default empty value without resorting to error-message
 * pattern matching.
 */

import type { z } from 'zod';
import { groqUsage, traceLLM } from '@showbook/observability';

// ─────────────────────────────────────────────────────────────────────
// Error taxonomy
// ─────────────────────────────────────────────────────────────────────

/** Final attempt threw (network blip, 429 retries exhausted, etc). */
export class LlmCallError extends Error {
  public readonly underlyingCause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmCallError';
    this.underlyingCause = cause;
  }
}

/** Choice content was empty / missing. */
export class LlmEmptyResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmEmptyResponseError';
  }
}

/** Choice content wasn't valid JSON. */
export class LlmParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmParseError';
  }
}

/** Parsed JSON didn't satisfy the caller's Zod schema. */
export class LlmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmValidationError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface GroqLikeCompletion {
  choices: Array<{ message: { content: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function pickContent(result: GroqLikeCompletion): string | null {
  return result.choices[0]?.message?.content ?? null;
}

// ─────────────────────────────────────────────────────────────────────
// withLlmRetry
// ─────────────────────────────────────────────────────────────────────

export interface WithLlmRetryOptions<T> {
  /** Trace name surfaced to Langfuse, e.g. `groq.parseShowInput`. */
  name: string;
  /** Model identifier. Also passed to `traceLLM` so cost rollups
   *  match the actual call. */
  model: string;
  /** Input we want Langfuse to record. For vision calls this is the
   *  image-marker stub, never the raw bytes. */
  tracedInput: unknown;
  /** Model parameters surfaced in the trace (response_format,
   *  temperature, reasoning_effort, etc). */
  modelParameters: Record<string, unknown>;
  /** Free-form metadata for the trace. `attempt` is appended
   *  automatically so retried calls are searchable. */
  metadata?: Record<string, unknown>;
  /** The function that actually executes the Groq SDK call. */
  run: () => Promise<GroqLikeCompletion>;
  /** Zod schema the parsed JSON must satisfy. */
  schema: z.ZodSchema<T>;
  /** Maximum number of 429-induced retries. The total attempt count is
   *  `retries + 1`. Non-429 errors are not retried — they throw
   *  `LlmCallError` immediately. Default: 0 (single attempt). */
  retries?: number;
}

/**
 * Execute a Groq call, retrying on 429 with `Retry-After` honoured.
 * On success: returns the Zod-validated payload. On any failure:
 * throws one of the error classes above so the caller can branch on
 * type instead of error-message string-matching.
 */
export async function withLlmRetry<T>(opts: WithLlmRetryOptions<T>): Promise<T> {
  const retries = opts.retries ?? 0;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let result: GroqLikeCompletion;
    try {
      result = await traceLLM({
        name: opts.name,
        model: opts.model,
        input: opts.tracedInput,
        modelParameters: opts.modelParameters,
        metadata: { ...(opts.metadata ?? {}), attempt },
        run: opts.run,
        extractUsage: groqUsage,
        extractOutput: pickContent,
      });
    } catch (err) {
      lastError = err;
      const e = err as { status?: number; headers?: { get?: (k: string) => string | null } };
      if (e.status === 429 && attempt < retries) {
        const retryAfter = e.headers?.get?.('retry-after');
        const waitMs = retryAfter ? Math.ceil(parseFloat(retryAfter) * 1000) : 300;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new LlmCallError(`Groq call failed (${opts.name})`, err);
    }

    const content = pickContent(result);
    if (!content) {
      throw new LlmEmptyResponseError(`No response from Groq (${opts.name})`);
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new LlmParseError(
        `Failed to parse Groq response as JSON: ${content.slice(0, 200)}`,
      );
    }

    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LlmValidationError(
        `Groq response failed schema validation: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  // Unreachable: the loop either returns or throws. The fallback keeps
  // TypeScript's control-flow analysis happy without weakening the
  // function's return type.
  throw new LlmCallError(
    `withLlmRetry exhausted retries (${opts.name})`,
    lastError,
  );
}
