/**
 * Per-caller feature-flag resolution. Used by the web app to decide
 * whether to render the new `SetlistIntelShowTabs` layout (gated as
 * `DEV_ONLY` while the redesign is dogfooded by the developer) and any
 * future `DEV_ONLY` flag. Returns ON/OFF for every flag — the client
 * cache keeps the response across navigations, so a flip from
 * `DEV_ONLY` → `ON` doesn't require a deploy.
 */
import { eq } from 'drizzle-orm';
import { users } from '@showbook/db';
import {
  FeatureFlag,
  isFeatureOnFor,
  type FeatureFlagKey,
} from '@showbook/shared';
import { isAdminEmail } from '../admin';
import { protectedProcedure, router } from '../trpc';

export const featureFlagsRouter = router({
  /**
   * Returns `{ <flagKey>: boolean }` resolved for the caller. The dev
   * predicate is `isAdminEmail(user.email)` — operators in
   * `ADMIN_EMAILS` see DEV_ONLY flags as on.
   */
  forCurrentUser: protectedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, ctx.session.user.id))
      .limit(1);
    const isDev = isAdminEmail(user?.email);
    const out: Record<FeatureFlagKey, boolean> = {} as Record<FeatureFlagKey, boolean>;
    for (const key of Object.keys(FeatureFlag) as FeatureFlagKey[]) {
      out[key] = isFeatureOnFor(key, isDev);
    }
    return out;
  }),
});
