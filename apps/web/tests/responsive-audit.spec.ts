import { test } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { loginAndSeedAsWorker } from "./helpers/auth";

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "half", width: 720, height: 900 },
  { name: "full", width: 1280, height: 900 },
];

const ROUTES = [
  "/home",
  // Variant: same home page but with all venue follows dropped, so the
  // GetStartedHub card variant renders (the surface the user reported as
  // broken). Special-cased in the loop below.
  "/home?noFollows=1",
  "/upcoming",
  "/logbook",
  "/discover",
  "/venues",
  "/artists",
  "/map",
  "/preferences",
];

const HIDE_DEV_INDICATOR = `
  [data-nextjs-toast],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-menu],
  nextjs-portal { display: none !important; }
`;

function slugify(route: string) {
  const t = route.replace(/^\//, "").replace(/\/$/, "");
  return t.length === 0 ? "home" : t.replace(/[^a-zA-Z0-9]+/g, "-");
}

// Capture full-page screenshots of every route at three widths so the
// PR body can compare layout at mobile / half-page / full-page.
test("responsive audit - all widths", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const tag = process.env.SCREENSHOT_TAG ?? "audit";
  const outDir = path.join(
    __dirname,
    "..",
    "test-results",
    "responsive-audit",
    tag,
  );
  mkdirSync(outDir, { recursive: true });

  await loginAndSeedAsWorker(page);
  const workerIdx = testInfo.parallelIndex;

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w.width, height: w.height });
    for (const route of ROUTES) {
      // Re-seed with ?noFollows=1 just before /home?noFollows=1 so the
      // GetStartedHub "card" variant renders (shows present, no follow
      // graph yet) — the actual user surface that was reported broken.
      if (route === "/home?noFollows=1") {
        await page.request.get(
          `/api/test/seed?worker=${workerIdx}&noFollows=1`,
        );
      }
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await page.addStyleTag({ content: HIDE_DEV_INDICATOR });
      // Let layout settle (hydration, lazy queries).
      await page.waitForTimeout(700);
      await page.screenshot({
        path: path.join(outDir, `${tag}-${w.name}-${slugify(route)}.png`),
        fullPage: true,
      });
      testInfo.annotations.push({
        type: "captured",
        description: `${w.name} ${route}`,
      });
      // Restore the normal fixture so the next route iteration sees
      // followed venues again.
      if (route === "/home?noFollows=1") {
        await page.request.get(`/api/test/seed?worker=${workerIdx}`);
      }
    }
  }
});
