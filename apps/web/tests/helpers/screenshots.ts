import { Page } from '@playwright/test';
import path from 'path';

export async function takeScreenshot(page: Page, name: string) {
  const screenshotDir = path.join(__dirname, '../../test-results/screenshots');
  await page.screenshot({
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: true,
  });
}
