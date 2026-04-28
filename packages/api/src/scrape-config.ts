import { z } from 'zod';

export const scrapeConfigSchema = z.object({
  type: z.literal('llm'),
  url: z.string().url(),
  frequencyDays: z.number().int().min(1).max(30).default(7),
  lastRunAt: z.string().datetime().optional(),
  lastError: z.string().optional(),
});

export type ScrapeConfig = z.infer<typeof scrapeConfigSchema>;

export function parseScrapeConfig(raw: unknown): ScrapeConfig | null {
  if (raw == null) return null;
  const parsed = scrapeConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
