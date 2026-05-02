import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loginAndSeedAsWorker, workerShowId } from './helpers/auth';

async function loginAndSeed(page: Page) {
  await loginAndSeedAsWorker(page);
}

async function gotoRadioheadMSG(page: Page): Promise<string> {
  const id = await workerShowId(page, {
    headliner: 'Radiohead',
    venueName: 'Madison Square Garden',
    state: 'past',
  });
  if (!id) throw new Error('Radiohead @ MSG show not seeded');
  await page.goto(`/shows/${id}`);
  await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 120000 });
  await expect(page.getByTestId('media-section')).toBeVisible({ timeout: 120000 });
  return id;
}

test.describe('media upload UX', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('uploads a screenshot photo, renders a video tile, and handles unsupported files', async ({
    page,
  }, testInfo) => {
    await gotoRadioheadMSG(page);

    const screenshotPath = testInfo.outputPath('media-upload-source.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('media-desktop-empty', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    await page.getByTestId('media-photo-input').setInputFiles(screenshotPath);
    await expect(page.getByTestId('media-gallery').locator('img')).toHaveCount(1, {
      timeout: 20000,
    });
    await expect(page.getByTestId('media-quota')).toContainText('/ 300 MB show');

    await page.setViewportSize({ width: 760, height: 860 });
    const halfWidthPath = testInfo.outputPath('media-half-width.png');
    await page.screenshot({ path: halfWidthPath, fullPage: true });
    await testInfo.attach('media-half-width', {
      path: halfWidthPath,
      contentType: 'image/png',
    });

    const fixtureDir = testInfo.outputPath('fixtures');
    await mkdir(fixtureDir, { recursive: true });
    const videoPath = path.join(fixtureDir, 'tiny.mp4');
    await writeFile(
      videoPath,
      Buffer.from([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
        0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
        0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
        0x00, 0x00, 0x00, 0x08, 0x6d, 0x64, 0x61, 0x74,
      ]),
    );
    await page.getByTestId('media-video-input').setInputFiles(videoPath);
    await expect(page.getByTestId('media-gallery').locator('video')).toHaveCount(1, {
      timeout: 20000,
    });

    const badFilePath = path.join(fixtureDir, 'not-an-image.txt');
    await writeFile(badFilePath, 'not an image');
    await page.getByTestId('media-photo-input').setInputFiles(badFilePath);
    await expect(page.getByTestId('media-upload-error')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePath = testInfo.outputPath('media-mobile.png');
    await page.screenshot({ path: mobilePath, fullPage: true });
    await testInfo.attach('media-mobile', {
      path: mobilePath,
      contentType: 'image/png',
    });
  });
});
