import { test, expect } from '@playwright/test';
import path from 'path';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/fixture.epub');
const footnoteFixturePath = path.resolve(process.cwd(), 'test-books/footnote-demo.epub');

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

async function openFixtureBookInScrolledMode(page) {
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
          if (!didSeed && payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
            const nextPayload = {
              ...payload,
              readerSettings: {
                ...(payload.readerSettings || {}),
                flow: 'scrolled',
                theme: 'light',
                fontSize: 100,
                fontFamily: 'publisher'
              }
            };
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
  await frame.locator('body').click({ position: { x: 360, y: 24 } });
  await expect(page.getByTestId('selection-toolbar')).toHaveCount(0);
});

test('dictionary action shows icon in selection toolbar', async ({ page }) => {
  await openFixtureBook(page);
  await selectTextInBook(page);

  const toolbar = page.getByTestId('selection-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole('button', { name: 'Dictionary' }).locator('svg')
  ).toHaveCount(1);
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

test('footnote preview opens from marker and supports jump/close', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(footnoteFixturePath);
  const bookLink = page.getByRole('link', { name: /Footnote Demo/i }).first();
  await expect(bookLink).toBeVisible();
  await bookLink.click();
  await expect(page.getByTestId('reader-search-toggle')).toBeVisible();

  const frame = page.frameLocator('iframe');
  const marker = frame.locator('a', { hasText: '[1]' }).first();
  await expect(marker).toBeVisible();
  const preview = page.getByTestId('footnote-preview-panel');
  let opened = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await marker.click();
    if (await preview.isVisible()) {
      opened = true;
      break;
    }
    await page.waitForTimeout(200);
  }

  expect(opened).toBeTruthy();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('This is footnote number one');

  await preview.getByRole('button', { name: 'Open full note' }).click();
  await expect(preview).toHaveCount(0);

  await marker.click();
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
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
  await expect(page.getByTestId('search-highlight-count')).toHaveText('1');

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 10000 }).toBe('0/0');
  await expect(page.getByTestId('search-highlight-count')).toHaveText('0');
});

test('search renders in-book markers while results are active', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');

  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);
  await expect(page.getByTestId('search-highlight-count')).toHaveText('1');
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

test('search highlighting does not remove saved highlights', async ({ page }) => {
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
                cfiRange: 'epubcfi(/6/2[seed-highlight-persist]!/4/2/2,/4/2/14)',
                text: 'Seeded persisted highlight',
                color: '#fcd34d'
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
  await expect(page.getByTestId('highlight-item')).toHaveCount(1);
  await page.mouse.click(16, 16);
  await expect(page.getByTestId('highlights-panel')).toHaveCount(0);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 10000 }).toBe('0/0');
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search inside this book...')).toHaveCount(0);

  await page.getByTestId('reader-highlights-toggle').click();
  await expect(page.getByTestId('highlight-item')).toHaveCount(1);
});

test('Ctrl/Cmd+F opens reader search and focuses input, Escape closes it', async ({ page }) => {
  await openFixtureBook(page);

  const searchInput = page.getByPlaceholder('Search inside this book...');
  await expect(searchInput).toHaveCount(0);

  await page.keyboard.press('Control+f');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(searchInput).toHaveCount(0);
});

test('ArrowRight and ArrowLeft navigate in paginated book mode', async ({ page }) => {
  await openFixtureBook(page);

  const currentCfi = page.getByTestId('reader-current-cfi');
  await expect.poll(async () => (await currentCfi.textContent())?.trim() || '', { timeout: 10000 }).not.toBe('');
  const initialCfi = ((await currentCfi.textContent()) || '').trim();

  const frame = page.frameLocator('iframe');
  await frame.locator('body').click({ position: { x: 80, y: 80 } });

  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await currentCfi.textContent())?.trim() || '', { timeout: 10000 }).not.toBe(initialCfi);
  const nextCfi = ((await currentCfi.textContent()) || '').trim();

  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await currentCfi.textContent())?.trim() || '', { timeout: 10000 }).not.toBe(nextCfi);
});

test('ArrowUp and ArrowDown scroll in infinite mode', async ({ page }) => {
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
          if (!didSeed && payload && payload.title === 'Test Book' && Object.prototype.hasOwnProperty.call(payload, 'data')) {
            const nextPayload = {
              ...payload,
              readerSettings: {
                ...(payload.readerSettings || {}),
                flow: 'scrolled',
                theme: 'light',
                fontSize: 100,
                fontFamily: 'publisher'
              }
            };
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
  const currentCfi = page.getByTestId('reader-current-cfi');
  await expect.poll(async () => (await currentCfi.textContent())?.trim() || '', { timeout: 10000 }).not.toBe('');
  const initialCfi = ((await currentCfi.textContent()) || '').trim();

  const frame = page.frameLocator('iframe').first();
  await frame.locator('body').click({ position: { x: 80, y: 120 } });

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await currentCfi.textContent())?.trim() || '', { timeout: 10000 }).not.toBe(initialCfi);

  const downCfi = ((await currentCfi.textContent()) || '').trim();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await currentCfi.textContent())?.trim() || '', { timeout: 10000 }).not.toBe(downCfi);
});

test('holding ArrowDown increases infinite-mode scroll step', async ({ page }) => {
  await openFixtureBookInScrolledMode(page);

  const frame = page.frameLocator('iframe').first();
  await frame.locator('body').click({ position: { x: 80, y: 120 } });

  const stepValue = page.getByTestId('reader-last-arrow-scroll-step');
  await page.keyboard.press('ArrowDown');
  const singleStep = Number(((await stepValue.textContent()) || '0').trim());
  expect(singleStep).toBeGreaterThan(0);

  for (let i = 0; i < 4; i += 1) {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
        repeat: true
      }));
    });
    await page.waitForTimeout(25);
  }

  const acceleratedStep = Number(((await stepValue.textContent()) || '0').trim());
  expect(acceleratedStep).toBeGreaterThan(singleStep);

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    }));
  });
});

test('ArrowDown acceleration resets after key release', async ({ page }) => {
  await openFixtureBookInScrolledMode(page);

  const frame = page.frameLocator('iframe').first();
  await frame.locator('body').click({ position: { x: 80, y: 120 } });

  const stepValue = page.getByTestId('reader-last-arrow-scroll-step');
  await page.keyboard.press('ArrowDown');
  const baselineStep = Number(((await stepValue.textContent()) || '0').trim());
  expect(baselineStep).toBeGreaterThan(0);

  for (let i = 0; i < 3; i += 1) {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
        repeat: true
      }));
    });
    await page.waitForTimeout(20);
  }

  const acceleratedStep = Number(((await stepValue.textContent()) || '0').trim());
  expect(acceleratedStep).toBeGreaterThan(baselineStep);

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true
    }));
  });

  await page.keyboard.press('ArrowDown');
  const resetStep = Number(((await stepValue.textContent()) || '0').trim());
  expect(resetStep).toBeLessThanOrEqual(acceleratedStep);
});

test('clicking a search result jumps and closes the search panel', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');

  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);
  await expect(page.getByTestId('search-result-item-1')).toBeVisible();

  await page.getByTestId('search-result-item-1').click();
  await expect(searchInput).toHaveCount(0);
});

test('clicking a search result enters focus-only mode and outside click clears it', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);

  await page.getByTestId('search-result-item-1').click();
  await expect(searchInput).toHaveCount(0);
  await expect(page.getByTestId('search-focus-state')).toHaveText('focused');
  await expect(page.getByTestId('search-highlight-mode')).toHaveText('focus-only');

  await page.mouse.click(20, 20);
  await expect(page.getByTestId('search-focus-state')).toHaveText('none');
  await expect(page.getByTestId('search-highlight-mode')).toHaveText('none');
});

test('Escape clears focused search highlight when panel is closed', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);

  await page.getByTestId('search-result-item-1').click();
  await expect(page.getByTestId('search-focus-state')).toHaveText('focused');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('search-focus-state')).toHaveText('none');
  await expect(page.getByTestId('search-highlight-mode')).toHaveText('none');
});

test('search result list auto-scrolls to active item while navigating', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('the');
  await searchInput.press('Enter');

  await expect.poll(async () => {
    const value = await page.getByTestId('search-progress').textContent();
    return value || '0/0';
  }, { timeout: 15000 }).toMatch(/1\/\d+/);

  const progressText = await page.getByTestId('search-progress').textContent();
  const total = Number((progressText || '0/0').split('/')[1] || 0);
  expect(total).toBeGreaterThan(8);

  const list = page.getByTestId('search-results-list');
  const initialScrollTop = await list.evaluate((el) => el.scrollTop);

  const steps = Math.min(12, total - 1);
  for (let i = 0; i < steps; i += 1) {
    await page.getByTitle('Next result').click();
  }

  await expect.poll(async () => list.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(initialScrollTop);
});

test('reader search keeps recent queries and allows quick re-run', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTestId('reader-search-toggle').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');

  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);
  const historyItem = page.getByTestId('search-history-item-0');
  await expect(historyItem).toBeVisible();
  await expect(historyItem).toHaveText('wizard');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(searchInput).toHaveValue('');

  await historyItem.click();
  await expect(searchInput).toHaveValue('wizard');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);

  await page.getByTestId('search-history-clear').click();
  await expect(page.getByTestId('search-history-item-0')).toHaveCount(0);
});

test('annotation search keeps recent queries and allows quick re-run', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTestId('reader-annotation-search-toggle').click();
  const searchInput = page.getByPlaceholder('Search highlights, notes, bookmarks...');
  await searchInput.fill('foobar');
  await searchInput.press('Enter');
  await expect(page.getByText('No annotation matches found.')).toBeVisible();

  const historyItem = page.getByTestId('annotation-search-history-item-0');
  await expect(historyItem).toBeVisible();
  await expect(historyItem).toHaveText('foobar');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(searchInput).toHaveValue('');

  await historyItem.click();
  await expect(searchInput).toHaveValue('foobar');
  await expect(page.getByText('No annotation matches found.')).toBeVisible();

  await page.getByTestId('annotation-search-history-clear').click();
  await expect(page.getByTestId('annotation-search-history-item-0')).toHaveCount(0);
});

test('reader jump shows back-to-previous-spot chip and returns on click', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByTitle('Search').click();
  const searchInput = page.getByPlaceholder('Search inside this book...');
  await searchInput.fill('wizard');
  await searchInput.press('Enter');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).toMatch(/1\/\d+/);

  const progressText = await page.getByTestId('search-progress').textContent();
  const total = Number((progressText || '0/0').split('/')[1] || 0);
  expect(total).toBeGreaterThan(1);

  await page.getByTitle('Next result').click();

  const returnChip = page.getByTestId('return-to-spot-chip');
  await expect(returnChip).toBeVisible();
  await expect(returnChip).toContainText('Back to previous spot');

  await page.getByTestId('return-to-spot-action').click();
  await expect(returnChip).toHaveCount(0);
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

test('dictionary ignores responses after panel is closed', async ({ page }) => {
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

    if (word === 'gamma') {
      await new Promise((resolve) => setTimeout(resolve, 900));
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
  await dictInput.fill('gamma');
  await dictInput.press('Enter');

  await dictInput.locator('..').getByRole('button').click();
  await expect(page.getByPlaceholder('Look up a word...')).toHaveCount(0);

  await page.waitForTimeout(1100);
  await expect(page.getByText('Definition for gamma')).toHaveCount(0);
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

test('colorblind palette toggle remaps highlight colors and AI action tone', async ({ page }) => {
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
              cfiRange: 'epubcfi(/6/2[seed-daltonian]!/4/2/2,/4/2/10)',
              text: 'Seeded highlight for color mode remap',
              color: '#fcd34d'
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
  await expect(page.getByTestId('highlight-item')).toHaveCount(1);
  const panel = page.getByTestId('highlights-panel');
  const colorBar = panel.getByTestId('highlight-item-color-bar').first();
  await expect(colorBar).toBeVisible();
  await expect(page.getByTestId('reader-color-palette-mode')).toHaveText('standard');

  const readAiToneColor = async () =>
    page.getByTestId('ai-explain-disabled').evaluate((el) => window.getComputedStyle(el).color);
  const readColorBar = async () =>
    colorBar.evaluate((el) => window.getComputedStyle(el).backgroundColor);

  const standardAiColor = await readAiToneColor();
  const standardBarColor = await readColorBar();

  await page.evaluate(() => {
    document.querySelector('[data-testid="colorblind-palette-toggle"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
  await expect(page.getByTestId('reader-color-palette-mode')).toHaveText('daltonian');
  await expect.poll(readColorBar).not.toBe(standardBarColor);
  await expect.poll(readAiToneColor).not.toBe(standardAiColor);

  await page.evaluate(() => {
    document.querySelector('[data-testid="colorblind-palette-toggle"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
  await expect(page.getByTestId('reader-color-palette-mode')).toHaveText('standard');
  await expect.poll(readColorBar).toBe(standardBarColor);
  await expect.poll(readAiToneColor).toBe(standardAiColor);
});

test('menu button opens chapter contents and chapter selection closes panel', async ({ page }) => {
  await openFixtureBook(page);

  await page.getByRole('button', { name: /Open chapters/i }).click();
  const panel = page.getByTestId('chapters-panel');
  await expect(panel).toBeVisible();

  await expect
    .poll(async () => panel.getByTestId('toc-item').count(), { timeout: 30000 })
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
  await expect(panel.getByText('0 selected')).toBeVisible();

  const exportButton = panel.getByRole('button', { name: 'Export Selected' });
  await expect(exportButton).toBeDisabled();

  const firstItem = panel.getByTestId('highlight-item').first();
  await firstItem.locator('button[title="Select highlight"]').click();
  await expect(panel.getByText('1 selected')).toBeVisible();
  await expect(exportButton).toBeEnabled();

  await panel.getByRole('button', { name: 'Select all' }).click();
  await expect(panel.getByText('2 selected')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Unselect all' })).toBeVisible();
});

test('highlight delete supports undo in reader panel', async ({ page }) => {
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
                cfiRange: 'epubcfi(/6/2[seed-hl-undo]!/4/2/2,/4/2/10)',
                text: 'Seed highlight for undo delete test',
                color: '#fcd34d'
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
  await expect(panel.getByTestId('highlight-item')).toHaveCount(1);

  await panel
    .getByTestId('highlight-item')
    .first()
    .locator('button')
    .filter({ hasText: /^Delete$/ })
    .click();
  await expect(page.getByTestId('highlight-undo-toast')).toBeVisible();
  await expect(panel.getByTestId('highlight-item')).toHaveCount(0);

  await page.getByTestId('highlight-undo-action').click();
  await expect(page.getByTestId('highlight-undo-toast')).toHaveCount(0);
  await expect(panel.getByTestId('highlight-item')).toHaveCount(1);
});

test('clicking a highlight item triggers temporary in-book flash', async ({ page }) => {
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
            const cfiRange = 'epubcfi(/6/2[seed-hl-flash]!/4/2/2,/4/2/14)';
            const highlights = [
              {
                cfiRange,
                text: 'Seed highlight for flash behavior',
                color: '#fcd34d'
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

  await panel.getByTestId('highlight-item-jump').first().click();
  await expect(panel).toHaveCount(0);

  const flashState = page.getByTestId('highlight-flash-cfi');
  await expect(flashState).not.toHaveText('', { timeout: 2000 });
  await expect.poll(async () => (await flashState.textContent())?.trim() || '', { timeout: 5000 }).toBe('');
});

test('post-highlight note prompt supports direct note entry and save', async ({ page }) => {
  await openFixtureBook(page);
  await selectTextInBook(page);

  const toolbar = page.getByTestId('selection-toolbar');
  await toolbar.getByRole('button', { name: 'Highlight' }).click();

  const notePrompt = page.getByTestId('post-highlight-note-prompt');
  await expect(notePrompt).toBeVisible();
  const noteInput = page.getByTestId('post-highlight-note-input');
  await expect(noteInput).toBeFocused();
  await expect(page.getByTestId('post-highlight-note-save')).toBeDisabled();
  await noteInput.fill('Direct prompt note');
  await expect(page.getByTestId('post-highlight-note-save')).toBeEnabled();

  await page.getByTestId('post-highlight-note-save').click();
  await expect(page.getByTestId('post-highlight-note-prompt')).toHaveCount(0);
});

test('post-highlight note prompt can be dismissed with Later', async ({ page }) => {
  await openFixtureBook(page);
  await selectTextInBook(page);

  const toolbar = page.getByTestId('selection-toolbar');
  await toolbar.getByRole('button', { name: 'Highlight' }).click();

  const notePrompt = page.getByTestId('post-highlight-note-prompt');
  await expect(notePrompt).toBeVisible();
  await notePrompt.getByRole('button', { name: 'Later' }).click();
  await expect(page.getByTestId('post-highlight-note-prompt')).toHaveCount(0);
});

test('highlight color options are ordered by last used first', async ({ page }) => {
  await openFixtureBook(page);
  await selectTextInBook(page);

  const toolbar = page.getByTestId('selection-toolbar');
  await toolbar.getByRole('button', { name: 'Colors' }).click();
  await toolbar.getByTitle('Highlight Lime').click();
  await expect(page.getByTestId('post-highlight-note-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();

  await selectTextInBook(page);
  await page.getByTestId('selection-toolbar').getByRole('button', { name: 'Colors' }).click();
  await expect(
    page.getByTestId('selection-toolbar').locator('button[title^="Highlight "]').first()
  ).toHaveAttribute('title', 'Highlight Lime');
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
