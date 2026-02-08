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

test('selection toolbar closes automatically when selection is cleared', async ({ page }) => {
  await openFixtureBook(page);
  await selectTextInBook(page);

  const frame = page.frameLocator('iframe');
  await frame.locator('body').click({ position: { x: 24, y: 24 } });
  await expect(page.getByTestId('selection-toolbar')).toHaveCount(0);
});

test('ai toolbar actions are visibly disabled and orange', async ({ page }) => {
  await openFixtureBook(page);

  const explain = page.getByTestId('ai-explain-disabled');
  const story = page.getByTestId('ai-story-disabled');

  await expect(explain).toBeVisible();
  await expect(story).toBeVisible();
  await expect(explain).toBeDisabled();
  await expect(story).toBeDisabled();
  await expect(explain).toHaveClass(/text-orange-700/);
  await expect(explain).toHaveClass(/bg-orange-50/);
  await expect(story).toHaveClass(/text-orange-700/);
  await expect(story).toHaveClass(/bg-orange-50/);
});


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

test('reader utility icon colors match theme controls when idle', async ({ page }) => {
  await openFixtureBook(page);

  const colorOf = async (locator) =>
    locator.evaluate((el) => window.getComputedStyle(el).color);

  const themeColor = await colorOf(page.getByTestId('theme-toggle'));
  const searchColor = await colorOf(page.getByTestId('reader-search-toggle'));
  const highlightsColor = await colorOf(page.getByTestId('reader-highlights-toggle'));
  const bookmarksColor = await colorOf(page.getByTestId('reader-bookmarks-toggle'));

  expect(searchColor).toBe(themeColor);
  expect(highlightsColor).toBe(themeColor);
  expect(bookmarksColor).toBe(themeColor);
});

test('highlights panel uses readable text contrast in light theme', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  const seeded = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const storeName = db.objectStoreNames.contains('keyvaluepairs') ? 'keyvaluepairs' : db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();
        let didSeed = false;
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value;
          const payload = row?.value && typeof row.value === 'object' ? row.value : row;
          const isTargetBook = payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data');
          if (!didSeed && isTargetBook) {
            const highlights = Array.isArray(payload.highlights) ? [...payload.highlights] : [];
            highlights.push({
              cfiRange: 'epubcfi(/6/2[seed-highlight]!/4/2/2,/4/2/10)',
              text: 'Readable contrast excerpt for highlights panel',
              color: '#bef264'
            });
            const nextPayload = { ...payload, highlights };
            if (row?.value && typeof row.value === 'object') {
              cursor.update({ ...row, value: nextPayload });
            } else {
              cursor.update(nextPayload);
            }
            didSeed = true;
          }
          cursor.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(didSeed);
        };
      };
    });
  });
  expect(seeded).toBeTruthy();

  await bookLink.click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();

  await page.getByTestId('reader-highlights-toggle').click();
  const panel = page.getByTestId('highlights-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('highlight-item-text').first()).toBeVisible();

  const excerptColor = await panel.getByTestId('highlight-item-text').first()
    .evaluate((el) => window.getComputedStyle(el).color);
  const labelColor = await panel.getByTestId('highlight-item-label').first()
    .evaluate((el) => window.getComputedStyle(el).color);

  expect(excerptColor).toBe('rgb(31, 41, 55)');
  expect(labelColor).toBe('rgb(75, 85, 99)');
});

test('highlights panel renders saved highlight note text', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  const seeded = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const storeName = db.objectStoreNames.contains('keyvaluepairs') ? 'keyvaluepairs' : db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();
        let didSeed = false;
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value;
          const payload = row?.value && typeof row.value === 'object' ? row.value : row;
          const isTargetBook = payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data');
          if (!didSeed && isTargetBook) {
            const highlights = [
              {
                cfiRange: 'epubcfi(/6/2[seed-hl-note]!/4/2/2,/4/2/14)',
                text: 'Seeded note highlight text',
                color: '#fcd34d',
                note: 'Stored highlight note text'
              }
            ];
            const nextPayload = { ...payload, highlights };
            if (row?.value && typeof row.value === 'object') {
              cursor.update({ ...row, value: nextPayload });
            } else {
              cursor.update(nextPayload);
            }
            didSeed = true;
          }
          cursor.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(didSeed);
        };
      };
    });
  });
  expect(seeded).toBeTruthy();

  await bookLink.click();
  await expect(page.getByRole('button', { name: /Open chapters/i })).toBeVisible();
  await page.getByTestId('reader-highlights-toggle').click();

  const panel = page.getByTestId('highlights-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('highlight-item-note').first()).toContainText('Stored highlight note text');
});

test('bookmarks panel uses readable text contrast in light theme', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  const seeded = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const storeName = db.objectStoreNames.contains('keyvaluepairs') ? 'keyvaluepairs' : db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();
        let didSeed = false;
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value;
          const payload = row?.value && typeof row.value === 'object' ? row.value : row;
          const isTargetBook = payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data');
          if (!didSeed && isTargetBook) {
            const bookmarks = Array.isArray(payload.bookmarks) ? [...payload.bookmarks] : [];
            bookmarks.push({
              cfi: 'epubcfi(/6/2[seed-bookmark]!/4/2/2)',
              label: 'Section 1',
              text: 'Readable bookmark excerpt for light theme contrast',
              href: 'Text/section1.xhtml'
            });
            const nextPayload = { ...payload, bookmarks };
            if (row?.value && typeof row.value === 'object') {
              cursor.update({ ...row, value: nextPayload });
            } else {
              cursor.update(nextPayload);
            }
            didSeed = true;
          }
          cursor.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(didSeed);
        };
      };
    });
  });
  expect(seeded).toBeTruthy();

  await bookLink.click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();

  await page.getByTestId('reader-bookmarks-toggle').click();
  const panel = page.getByTestId('bookmarks-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('bookmark-item-text').first()).toBeVisible();

  const excerptColor = await panel.getByTestId('bookmark-item-text').first()
    .evaluate((el) => window.getComputedStyle(el).color);
  const labelColor = await panel.getByTestId('bookmark-item-label').first()
    .evaluate((el) => window.getComputedStyle(el).color);

  expect(excerptColor).toBe('rgb(31, 41, 55)');
  expect(labelColor).toBe('rgb(75, 85, 99)');
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

test('highlights selection controls drive export availability', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  const seeded = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const storeName = db.objectStoreNames.contains('keyvaluepairs') ? 'keyvaluepairs' : db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();
        let didSeed = false;
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value;
          const payload = row?.value && typeof row.value === 'object' ? row.value : row;
          const isTargetBook = payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data');
          if (!didSeed && isTargetBook) {
            const highlights = [
              {
                cfiRange: 'epubcfi(/6/2[seed-hl-1]!/4/2/2,/4/2/8)',
                text: 'Seed highlight one for export state test',
                color: '#fcd34d'
              },
              {
                cfiRange: 'epubcfi(/6/2[seed-hl-2]!/4/2/10,/4/2/18)',
                text: 'Seed highlight two for export state test',
                color: '#bef264'
              }
            ];
            const nextPayload = { ...payload, highlights };
            if (row?.value && typeof row.value === 'object') {
              cursor.update({ ...row, value: nextPayload });
            } else {
              cursor.update(nextPayload);
            }
            didSeed = true;
          }
          cursor.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(didSeed);
        };
      };
    });
  });
  expect(seeded).toBeTruthy();

  await bookLink.click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();

  await page.getByTestId('reader-highlights-toggle').click();
  const panel = page.getByTestId('highlights-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('2 highlights')).toBeVisible();
  await expect(panel.getByText('2 selected')).toBeVisible();

  const exportButton = panel.getByRole('button', { name: 'Export Selected' });
  await expect(exportButton).toBeEnabled();

  await panel.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(panel.getByText('0 selected')).toBeVisible();
  await expect(exportButton).toBeDisabled();

  const firstItem = panel.getByTestId('highlight-item').first();
  await firstItem.locator('button[title=\"Select highlight\"]').click();
  await expect(panel.getByText('1 selected')).toBeVisible();
  await expect(exportButton).toBeEnabled();

  await panel.getByRole('button', { name: 'Select all' }).click();
  await expect(panel.getByText('2 selected')).toBeVisible();
});

test('bookmarks panel supports jump-close and delete flow', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  const seeded = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const storeName = db.objectStoreNames.contains('keyvaluepairs') ? 'keyvaluepairs' : db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();
        let didSeed = false;
        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const row = cursor.value;
          const payload = row?.value && typeof row.value === 'object' ? row.value : row;
          const isTargetBook = payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data');
          if (!didSeed && isTargetBook) {
            const bookmarks = [
              {
                cfi: 'epubcfi(/6/2[seed-bookmark-jump]!/4/2/2)',
                label: 'Section 1',
                text: 'Seeded bookmark for jump and delete test',
                href: 'Text/section1.xhtml'
              }
            ];
            const nextPayload = { ...payload, bookmarks };
            if (row?.value && typeof row.value === 'object') {
              cursor.update({ ...row, value: nextPayload });
            } else {
              cursor.update(nextPayload);
            }
            didSeed = true;
          }
          cursor.continue();
        };
        tx.oncomplete = () => {
          db.close();
          resolve(didSeed);
        };
      };
    });
  });
  expect(seeded).toBeTruthy();

  await bookLink.click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();

  await page.getByTestId('reader-bookmarks-toggle').click();
  const panel = page.getByTestId('bookmarks-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('1 bookmark')).toBeVisible();
  await expect(panel.getByTestId('bookmark-item').first()).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Add Bookmark' })).toBeVisible();

  await panel.getByTestId('bookmark-item').first().locator('button.text-left').click();
  await expect(page.getByTestId('bookmarks-panel')).toHaveCount(0);

  await page.getByTestId('reader-bookmarks-toggle').click();
  const reopened = page.getByTestId('bookmarks-panel');
  await expect(reopened).toBeVisible();
  await reopened.getByRole('button', { name: 'Delete' }).first().click({ force: true });
  await expect
    .poll(async () => reopened.getByTestId('bookmark-item').count(), { timeout: 10000 })
    .toBe(0);
});
