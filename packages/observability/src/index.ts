export { logger, child, getLogger, flushLogger } from './logger';
export { getLangfuse, flushLangfuse } from './langfuse';
export { withTrace, traceLLM, groqUsage } from './trace';
export type { TraceAttrs, TraceLLMArgs } from './trace';

import { flushLangfuse } from './langfuse';
import { flushLogger } from './logger';

/**
 * Flush all observability sinks (Langfuse + pino transport workers). Call at the
 * end of short-lived entry points (job handlers, scripts) so traces and tail
 * log lines aren't dropped when the process exits.
 */
export async function flushObservability(): Promise<void> {
  await Promise.all([flushLangfuse(), flushLogger()]);
}
