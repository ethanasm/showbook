/**
 * Unit tests for trace.ts. We don't have a Langfuse client in tests
 * (LANGFUSE_PUBLIC_KEY is unset), so the easy paths are: with-trace and
 * trace-LLM both fall through to running the supplied function. The
 * harder paths (with the client returning a fake) we exercise by
 * temporarily injecting a fake into langfuse.ts via its internal
 * `__test` seam.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { withTrace, traceLLM, groqUsage } from '../trace';
import { __test as langfuseTest } from '../langfuse';

interface RecordedCall {
  name?: string;
  input?: unknown;
  output?: unknown;
  level?: string;
}

function makeFakeLangfuse() {
  const generations: RecordedCall[] = [];
  const traces: RecordedCall[] = [];
  const fake = {
    trace(opts: { name: string }): {
      generation(o: { name: string; input: unknown }): {
        end(o: { output?: unknown; usage?: unknown; level?: string }): void;
      };
      update(o: { output?: unknown }): void;
    } {
      const t = { name: opts.name };
      traces.push(t);
      return {
        generation(o) {
          const g: RecordedCall = { name: o.name, input: o.input };
          generations.push(g);
          return {
            end(eo) {
              g.output = eo.output;
              g.level = eo.level;
            },
          };
        },
        update(o) {
          t.output = o.output;
        },
      };
    },
    generation(o: { name: string; input: unknown }) {
      const g: RecordedCall = { name: o.name, input: o.input };
      generations.push(g);
      return {
        end(eo: { output?: unknown; usage?: unknown; level?: string }) {
          g.output = eo.output;
          g.level = eo.level;
        },
      };
    },
  };
  return { fake, generations, traces };
}

beforeEach(() => {
  langfuseTest.reset();
});

describe('withTrace (no client)', () => {
  it('runs the function unchanged when Langfuse is not configured', async () => {
    const result = await withTrace('foo', async () => 42);
    assert.equal(result, 42);
  });

  it('propagates errors when no client', async () => {
    await assert.rejects(
      withTrace('foo', async () => {
        throw new Error('bang');
      }),
      /bang/,
    );
  });
});

describe('withTrace (with fake client)', () => {
  it('records output on success', async () => {
    const { fake, traces } = makeFakeLangfuse();
    langfuseTest.set(fake);
    const result = await withTrace('the-trace', async () => 'ok');
    assert.equal(result, 'ok');
    assert.equal(traces.length, 1);
    assert.equal(traces[0]?.name, 'the-trace');
    assert.equal(traces[0]?.output, 'ok');
  });

  it('records error on failure but rethrows', async () => {
    const { fake, traces } = makeFakeLangfuse();
    langfuseTest.set(fake);
    await assert.rejects(
      withTrace('failing', async () => {
        throw new Error('die');
      }),
      /die/,
    );
    assert.equal(traces.length, 1);
    const out = traces[0]?.output as { error: string } | undefined;
    assert.match(out?.error ?? '', /die/);
  });
});

describe('traceLLM (no client)', () => {
  it('runs and returns the result unchanged', async () => {
    const result = await traceLLM({
      name: 'gen',
      model: 'm1',
      input: 'in',
      run: async () => ({ choices: [{ message: { content: 'x' } }] }),
    });
    assert.deepEqual(result, { choices: [{ message: { content: 'x' } }] });
  });

  it('propagates errors when no client', async () => {
    await assert.rejects(
      traceLLM({
        name: 'gen',
        model: 'm1',
        input: 'in',
        run: async () => {
          throw new Error('llm-fail');
        },
      }),
      /llm-fail/,
    );
  });
});

describe('traceLLM (with fake client)', () => {
  it('creates a top-level generation when no parent trace', async () => {
    const { fake, generations } = makeFakeLangfuse();
    langfuseTest.set(fake);
    await traceLLM({
      name: 'top',
      model: 'm',
      input: 'i',
      run: async () => ({ usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }),
      extractUsage: groqUsage,
    });
    assert.equal(generations.length, 1);
    assert.equal(generations[0]?.name, 'top');
  });

  it('nests generation under withTrace parent', async () => {
    const { fake, traces, generations } = makeFakeLangfuse();
    langfuseTest.set(fake);
    await withTrace('parent', async () => {
      await traceLLM({
        name: 'child',
        model: 'm',
        input: 'i',
        run: async () => ({}),
      });
    });
    assert.equal(traces.length, 1);
    assert.equal(generations.length, 1);
    assert.equal(generations[0]?.name, 'child');
  });

  it('records ERROR level on failure', async () => {
    const { fake, generations } = makeFakeLangfuse();
    langfuseTest.set(fake);
    await assert.rejects(
      traceLLM({
        name: 'bad',
        model: 'm',
        input: 'i',
        run: async () => {
          throw new Error('explode');
        },
      }),
      /explode/,
    );
    assert.equal(generations[0]?.level, 'ERROR');
  });

  it('uses extractOutput when provided', async () => {
    const { fake, generations } = makeFakeLangfuse();
    langfuseTest.set(fake);
    await traceLLM({
      name: 'e',
      model: 'm',
      input: 'i',
      run: async () => ({ payload: 'X', _meta: 'hide' }),
      extractOutput: (o: { payload: string }) => o.payload,
    });
    assert.equal(generations[0]?.output, 'X');
  });
});

describe('groqUsage', () => {
  it('returns undefined when no usage', () => {
    assert.equal(groqUsage({} as never), undefined);
  });

  it('maps groq snake_case to camelCase', () => {
    const u = groqUsage({
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    });
    assert.deepEqual(u, { promptTokens: 5, completionTokens: 10, totalTokens: 15 });
  });

  it('handles missing fields', () => {
    const u = groqUsage({ usage: { total_tokens: 7 } });
    assert.deepEqual(u, {
      promptTokens: undefined,
      completionTokens: undefined,
      totalTokens: 7,
    });
  });
});
