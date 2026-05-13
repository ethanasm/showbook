import { test } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { loginAndSeedAsWorker } from "./helpers/auth";

// Capture the pre-hydration SSR paint at three widths. This is what a
// real phone sees for ~100ms during cold loads before React's effects
// run — the window in which the user's original bug screenshot was
// taken. Steady-state captures (responsive-audit.spec.ts) cannot show
// this delta because by the time Playwright screenshots, hydration has
// already flipped `useIsMobile` to the right value.
//
// To freeze the SSR state we route-intercept the page request and
// strip every `<script>` tag from the response. The HTML + CSS still
// renders, but no JS ever executes, so the page never re-renders to
// the post-hydration layout. Tracks the user's reported screenshot,
// where the GetStartedHub card and HeroCard show the desktop row
// layout on a 390px viewport.

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "half", width: 720, height: 900 },
];

test("responsive ssr-only paint - home variants", async ({
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const tag = process.env.SCREENSHOT_TAG ?? "audit";
  const outDir = path.join(
    __dirname,
    "..",
    "test-results",
    "responsive-audit",
    tag,
  );
  mkdirSync(outDir, { recursive: true });

  const authedCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const authedPage = await authedCtx.newPage();
  await loginAndSeedAsWorker(authedPage);
  const cookies = await authedCtx.cookies();
  const workerIdx = testInfo.parallelIndex;

  for (const w of WIDTHS) {
    for (const variant of ["home", "home-noFollows-1"]) {
      // Re-seed for noFollows so GetStartedHub renders.
      if (variant === "home-noFollows-1") {
        await authedPage.request.get(
          `/api/test/seed?worker=${workerIdx}&noFollows=1`,
        );
      } else {
        await authedPage.request.get(`/api/test/seed?worker=${workerIdx}`);
      }

      // Build a fresh context per shot so route handlers don't leak.
      const ctx = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: w.width, height: w.height },
      });
      await ctx.addCookies(cookies);
      // Strip every script tag from the document response so JS never
      // executes — freezes the page in its pre-hydration paint.
      await ctx.route("**/home*", async (route) => {
        const response = await route.fetch();
        const original = await response.text();
        const stripped = original.replace(
          /<script\b[^>]*>[\s\S]*?<\/script>/gi,
          "",
        );
        await route.fulfill({
          status: response.status(),
          headers: response.headers(),
          body: stripped,
          contentType: "text/html; charset=utf-8",
        });
      });
      const page = await ctx.newPage();
      await page.goto("/home");
      await page.waitForLoadState("domcontentloaded");
      // Tiny settle so the CSS has applied to the SSR HTML.
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(outDir, `${tag}-${w.name}-ssr-${variant}.png`),
        fullPage: true,
      });
      await ctx.close();
    }
  }

  await authedCtx.close();
});
