import { test, expect, type Page } from '@playwright/test';

async function loginAndSeed(page: Page) {
  await page.goto('/api/test/seed');
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

async function gotoShow(page: Page, params: string) {
  const res = await page.request.get(`/api/test/show-id?${params}`);
  const { id } = await res.json();
  if (!id) throw new Error(`Show not seeded for params: ${params}`);
  await page.goto(`/shows/${id}`);
  await page.locator('text=Loading show…').waitFor({ state: 'detached', timeout: 15000 });
  return id as string;
}

test.describe('Show detail — notes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAndSeed(page);
  });

  test('renders the notes section when the show has notes', async ({ page }) => {
    await gotoShow(
      page,
      'headliner=Radiohead&venueName=Madison+Square+Garden&state=past',
    );

    const section = page.getByTestId('notes-section');
    await expect(section).toBeVisible();
    await expect(section.getByText('Notes')).toBeVisible();

    const content = page.getByTestId('notes-content');
    await expect(content).toContainText('Thom dedicated Videotape');
    await expect(content).toContainText('LCD opening set');
  });

  test('omits the notes section when the show has no notes', async ({ page }) => {
    await gotoShow(
      page,
      'headliner=LCD+Soundsystem&venueName=Brooklyn+Steel&state=past',
    );

    await expect(page.getByTestId('notes-section')).toHaveCount(0);
  });
});
