import { test, expect } from '@playwright/test';
import { loginAndSeedAsWorker } from './helpers/auth';

function lum(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: number[], b: number[]) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const parse = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

test('light-theme fills keep readable foregrounds', async ({ page }) => {
  test.setTimeout(180000);
  await loginAndSeedAsWorker(page);
  await page.goto('/preferences');
  await page.waitForLoadState('networkidle');
  await page.getByRole('main').getByRole('button', { name: 'Light', exact: true }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const routes = ['/preferences', '/upcoming', '/discover', '/home'];
  const bad: string[] = [];
  for (const r of routes) {
    await page.goto(r);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1200);
    const results = await page.$$eval('*', (nodes) =>
      nodes
        .filter((n) => (n.textContent ?? '').trim().length > 0 && n.children.length === 0)
        .map((n) => {
          const cs = getComputedStyle(n);
          let bg = cs.backgroundColor;
          let el: Element | null = n;
          while (el && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
            el = el.parentElement;
            if (!el) break;
            bg = getComputedStyle(el).backgroundColor;
          }
          return { color: cs.color, bg, text: (n.textContent ?? '').trim().slice(0, 30) };
        }),
    );
    for (const x of results) {
      const c = parse(x.color), b = parse(x.bg);
      if (c.length < 3 || b.length < 3) continue;
      const cr = ratio(c, b);
      if (cr < 1.6) bad.push(`${r} "${x.text}" ${x.color} on ${x.bg} = ${cr.toFixed(2)}`);
    }
  }
  console.log('LOWCONTRAST_COUNT:', bad.length);
  for (const b of bad.slice(0, 25)) console.log('LOWCONTRAST:', b);
});
