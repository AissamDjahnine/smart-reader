import { test, expect } from '@playwright/test';
import path from 'path';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/fixture.epub');

async function openFixtureBook(page) {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await bookLink.click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();
}

test('search clear cancels results', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');

  // Clear quickly to simulate cancelling an in-flight search.
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.waitForTimeout(1500);

  await expect(page.getByText(/0 results/)).toBeVisible();
  await expect(page.getByText('Result 1')).toHaveCount(0);
});

test('dictionary ignores stale responses', async ({ page }) => {
  await page.route('https://api.dictionaryapi.dev/api/v2/entries/en/**', async (route) => {
    const url = route.request().url();
    const word = decodeURIComponent(url.split('/').pop() || '').toLowerCase();
    const payload = {
      word,
      phonetic: `/${word}/`,
      meanings: [
        { partOfSpeech: 'noun', definitions: [{ definition: `Definition for ${word}` }] }
      ]
    };

    if (word === 'alpha') {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([payload])
    });
  });

  await openFixtureBook(page);

  await page.getByTitle('Dictionary').click();
  const dictInput = page.getByPlaceholder('Look up a word...');
  await dictInput.fill('alpha');
  await dictInput.press('Enter');

  await dictInput.fill('beta');
  await dictInput.press('Enter');

  await expect(page.getByText('Definition for beta')).toBeVisible();
  await expect(page.getByText('Definition for alpha')).toHaveCount(0);
});
