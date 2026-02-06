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

async function selectTextInBook(page) {
  const frame = page.frameLocator('iframe');
  const textBlock = frame.locator('p, span, div').first();
  await textBlock.waitFor();
  await textBlock.dblclick();
  await expect(page.getByTestId('selection-toolbar')).toBeVisible();
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

test('translation uses mymemory and shows result', async ({ page }) => {
  await page.route('https://api.mymemory.translated.net/get**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        responseStatus: 200,
        responseData: { translatedText: 'Translated text' }
      })
    });
  });

  await openFixtureBook(page);
  await selectTextInBook(page);

  const toolbar = page.getByTestId('selection-toolbar');
  await toolbar.getByRole('button', { name: 'Translate' }).click();

  await expect(page.getByTestId('translation-panel')).toBeVisible();
  await expect(page.getByText('Translated text')).toBeVisible();
});

test('translation requires source language with mymemory', async ({ page }) => {
  await page.route('https://api.mymemory.translated.net/get**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        responseStatus: 200,
        responseData: { translatedText: 'Bonjour' }
      })
    });
  });

  await openFixtureBook(page);
  await selectTextInBook(page);

  const toolbar = page.getByTestId('selection-toolbar');
  await toolbar.getByRole('button', { name: 'Translate' }).click();

  const panel = page.getByTestId('translation-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('combobox').first()).toBeVisible();
  await expect(panel.getByRole('option', { name: /Auto detect/i })).toHaveCount(0);
});
