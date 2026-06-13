import { z } from 'zod';
import { assertPublicHttpUrlSync } from './url-guard';

export const scrapeConfigSchema = z.object({
  type: z.literal('llm'),
  url: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          assertPublicHttpUrlSync(u);
          return true;
        } catch {
          return false;
        }
      },
      {
        message:
          'URL must be http(s) and must not target a localhost / private / link-local address',
      },
    ),
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
