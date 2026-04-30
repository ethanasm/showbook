import { AsyncLocalStorage } from 'node:async_hooks';
import { getLangfuse } from './langfuse';

type TraceClient = ReturnType<NonNullable<ReturnType<typeof getLangfuse>>['trace']>;

interface TraceContext {
  trace: TraceClient;
}

const als = new AsyncLocalStorage<TraceContext>();

export interface TraceAttrs {
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

/**
 * Run `fn` inside a Langfuse trace. If Langfuse is not configured, runs `fn`
 * unchanged. Any `traceLLM` calls inside `fn` auto-nest under this trace.
 */
export async function withTrace<T>(
  name: string,
  fn: () => Promise<T>,
  attrs: TraceAttrs = {},
): Promise<T> {
  const client = getLangfuse();
  if (!client) return fn();

  const trace = client.trace({
    name,
    userId: attrs.userId,
    sessionId: attrs.sessionId,
    metadata: attrs.metadata,
    tags: attrs.tags,
  });

  return als.run({ trace }, async () => {
    try {
      const out = await fn();
      try {
        trace.update({ output: summarize(out) });
      } catch {
        // ignore
      }
      return out;
    } catch (err) {
      try {
        trace.update({
          output: { error: err instanceof Error ? err.message : String(err) },
          metadata: { ...attrs.metadata, errored: true },
        });
      } catch {
        // ignore
      }
      throw err;
    }
  });
}

export interface TraceLLMArgs<TIn, TOut> {
  name: string;
  model: string;
  input: TIn;
  modelParameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** The LLM call. Return value is recorded as `output` and (if `usage` is on it) usage tokens. */
  run: () => Promise<TOut>;
  /** Optional extractor for usage tokens from the result (Groq/OpenAI shape `result.usage`). */
  extractUsage?: (out: TOut) => { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
  /** Optional extractor for the textual output (defaults to the full result). */
  extractOutput?: (out: TOut) => unknown;
}

export async function traceLLM<TIn, TOut>(args: TraceLLMArgs<TIn, TOut>): Promise<TOut> {
  const client = getLangfuse();
  if (!client) return args.run();

  const ctx = als.getStore();
  const parent = ctx?.trace;

  const generation = parent
    ? parent.generation({
        name: args.name,
        model: args.model,
        input: args.input,
        modelParameters: args.modelParameters as Record<string, string | number | boolean | string[] | null> | undefined,
        metadata: args.metadata,
      })
    : client.generation({
        name: args.name,
        model: args.model,
        input: args.input,
        modelParameters: args.modelParameters as Record<string, string | number | boolean | string[] | null> | undefined,
        metadata: args.metadata,
      });

  try {
    const out = await args.run();
    const usage = args.extractUsage?.(out);
    const output = args.extractOutput ? args.extractOutput(out) : summarize(out);
    try {
      generation.end({
        output,
        usage: usage
          ? {
              input: usage.promptTokens,
              output: usage.completionTokens,
              total: usage.totalTokens,
            }
          : undefined,
      });
    } catch {
      // ignore
    }
    return out;
  } catch (err) {
    try {
      generation.end({
        level: 'ERROR',
        statusMessage: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Default usage extractor for Groq / OpenAI-shaped completion responses.
 */
export function groqUsage(result: {
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}): { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined {
  if (!result?.usage) return undefined;
  return {
    promptTokens: result.usage.prompt_tokens,
    completionTokens: result.usage.completion_tokens,
    totalTokens: result.usage.total_tokens,
  };
}

function summarize(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > 4000 ? value.slice(0, 4000) + '…' : value;
  return value;
}
