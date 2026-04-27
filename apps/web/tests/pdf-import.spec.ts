import { test, expect, type Page } from '@playwright/test';

const PDF_PATH = '/Users/ethansmith/Downloads/Sam Smith Receipt.pdf';

async function loginAsTestUser(page: Page) {
  await page.goto('/api/test/login');
  await page.waitForURL('**/home');
}

test.describe('PDF ticket import', () => {
  test('uploads PDF and populates form fields', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/add');
    await page.waitForTimeout(2000);

    // Find the PDF ticket card in the IMPORT FROM section
    const pdfCard = page.locator('text=PDF ticket');
    await expect(pdfCard).toBeVisible();

    // The hidden file input for PDF
    const fileInput = page.locator('input[type="file"][accept=".pdf"]');
    await expect(fileInput).toBeAttached();

    // Upload the PDF file
    await fileInput.setInputFiles(PDF_PATH);

    // Wait for extraction to complete (up to 30s for LLM call)
    // The card should briefly show "Extracting..." then revert
    await page.waitForTimeout(2000);

    // Wait until we no longer see "Extracting..." — meaning the mutation finished
    await expect(page.locator('text=Extracting...')).toBeHidden({ timeout: 30000 });

    await page.waitForTimeout(1000);

    // Take screenshot after extraction
    await page.screenshot({
      path: 'test-results/screenshots/pdf-import-after-extract.png',
      fullPage: true,
    });

    // Check the headliner input got populated
    const headlinerInput = page.locator('input[placeholder*="artist"], input[placeholder*="search"]').first();
    const headlinerValue = await headlinerInput.inputValue();
    console.log(`Headliner field value: "${headlinerValue}"`);

    // Check all form field values
    const bodyText = await page.textContent('body');
    const hasSamSmith = bodyText?.toLowerCase().includes('sam smith');
    console.log(`Page contains "Sam Smith": ${hasSamSmith}`);

    // Verify no error message is shown
    const hasError = await page.locator('text=/Failed to extract|Could not extract/i').isVisible().catch(() => false);
    expect(hasError).toBe(false);

    // At minimum, SOME field should have been populated (headliner, venue, date, etc.)
    // Check that the form is no longer empty
    const allInputs = page.locator('input[type="text"], input[type="date"], input[type="number"]');
    const inputCount = await allInputs.count();
    let filledCount = 0;
    for (let i = 0; i < inputCount; i++) {
      const val = await allInputs.nth(i).inputValue();
      if (val && val.length > 0) filledCount++;
    }
    console.log(`Filled inputs: ${filledCount} out of ${inputCount}`);
    expect(filledCount).toBeGreaterThan(0);

    await page.screenshot({
      path: 'test-results/screenshots/pdf-import-form-populated.png',
      fullPage: true,
    });
  });
});
