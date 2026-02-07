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

test('search clear removes in-book search markers', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 10000 }).toBe('0/0');
});

test('search sets first result active and Enter cycles through results', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await expect(searchInput).toHaveCSS('color', 'rgb(0, 0, 0)');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');

  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);
  await expect(page.getByRole('button', { name: /Result 1/i }).first()).toHaveClass(/border-yellow/);

  const firstProgress = await page.getByTestId('search-progress').textContent();
  const total = Number((firstProgress || '0/0').split('/')[1] || 0);
  expect(total).toBeGreaterThanOrEqual(1);

  await page.getByTitle('Next result').click();
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 10000 }).not.toBe(firstProgress);

  const progressBeforeEnter = await page.getByTestId('search-progress').textContent();
  await searchInput.press('Enter');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 10000 }).not.toBe(progressBeforeEnter);
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
  await selectTextInBook(page);
  const toolbar = page.getByTestId('selection-toolbar');
  await toolbar.getByRole('button', { name: 'Dictionary' }).click();
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

test('reader iframe does not remount during background stats updates', async ({ page }) => {
  await openFixtureBook(page);
  const iframe = page.locator('iframe').first();
  const initialFrameId = await iframe.evaluate((el) => {
    const id = `reader-${Date.now()}-${Math.random()}`;
    el.dataset.instanceId = id;
    return id;
  });

  // Keep the tab active so reading stats background updates run.
  await page.mouse.move(200, 200);

  // Reading stats update runs every 15s. Ensure it does not remount the reader iframe.
  await page.waitForTimeout(17000);
  await page.mouse.move(220, 220);
  const currentFrameId = await page.locator('iframe').first().evaluate((el) => el.dataset.instanceId || '');
  expect(currentFrameId).toBe(initialFrameId);
});

test('theme toggle works repeatedly in reader', async ({ page }) => {
  await openFixtureBook(page);

  const iframe = page.frameLocator('iframe');
  const getBodyBg = async () =>
    iframe.locator('body').first().evaluate((el) => getComputedStyle(el).backgroundColor);

  const initialBg = await getBodyBg();

  await page.getByTestId('theme-toggle').click();
  const toggledBg = await getBodyBg();
  expect(toggledBg).not.toBe(initialBg);

  await page.getByTestId('theme-toggle').click();
  const revertedBg = await getBodyBg();
  expect(revertedBg).toBe(initialBg);
});

test('sepia mode toggles warm reading background', async ({ page }) => {
  await openFixtureBook(page);

  const iframe = page.frameLocator('iframe');
  const getBodyBg = async () =>
    iframe.locator('body').first().evaluate((el) => getComputedStyle(el).backgroundColor);

  const initialBg = await getBodyBg();

  await page.getByTestId('sepia-toggle').click();
  await expect.poll(getBodyBg).toBe('rgb(248, 239, 210)');

  await page.getByTestId('sepia-toggle').click();
  await expect.poll(getBodyBg).toBe(initialBg);
});

test('menu button opens chapter contents and chapter selection closes panel', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByRole('button', { name: /Open chapters/i }).click();
  const panel = page.getByTestId('chapters-panel');
  await expect(panel).toBeVisible();

  await expect
    .poll(async () => panel.getByTestId('toc-item').count(), { timeout: 15000 })
    .toBeGreaterThan(0);

  await panel.getByTestId('toc-item').first().click();
  await expect(page.getByTestId('chapters-panel')).toHaveCount(0);
});
