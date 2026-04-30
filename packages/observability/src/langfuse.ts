import { Langfuse } from 'langfuse';

let _client: Langfuse | null = null;
let _disabled = false;

export function getLangfuse(): Langfuse | null {
  if (_disabled) return null;
  if (_client) return _client;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    _disabled = true;
    return null;
  }

  _client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASEURL,
  });
  return _client;
}

export async function flushLangfuse(): Promise<void> {
  const c = _client;
  if (!c) return;
  try {
    await c.flushAsync();
  } catch {
    // Never let observability failures break the caller.
  }
}

export const __test = {
  set(client: unknown): void {
    _client = client as Langfuse | null;
    _disabled = client == null;
  },
  reset(): void {
    _client = null;
    _disabled = false;
  },
};
