import { test, expect } from '@playwright/test';
import path from 'path';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/fixture.epub');

test('library sort and filter controls work with favorites', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  const sortSelect = page.getByTestId('library-sort');
  const filterSelect = page.getByTestId('library-filter');

  await sortSelect.selectOption('title-asc');
  await expect(sortSelect).toHaveValue('title-asc');

  await filterSelect.selectOption('favorites');
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await filterSelect.selectOption('all');
  await expect(bookLink).toBeVisible();

  await bookLink.hover();
  await bookLink.locator('button[title="Favorite"]').click({ force: true });

  await filterSelect.selectOption('favorites');
  await expect(bookLink).toBeVisible();
});

test('library toolbar is sticky and retry resets search filter and sort', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const toolbar = page.getByTestId('library-toolbar-sticky');
  await expect(toolbar).toBeVisible();
  const toolbarPosition = await toolbar.evaluate((el) => getComputedStyle(el).position);
  expect(toolbarPosition).toBe('sticky');

  const searchInput = page.getByTestId('library-search');
  const filterSelect = page.getByTestId('library-filter');
  const sortSelect = page.getByTestId('library-sort');

  await searchInput.fill('no-match-token-xyz');
  await filterSelect.selectOption('favorites');
  await sortSelect.selectOption('title-asc');
  await expect(page.getByTestId('library-retry-button')).toBeVisible();
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await page.getByTestId('library-retry-button').click();
  await expect(searchInput).toHaveValue('');
  await expect(filterSelect).toHaveValue('all');
  await expect(sortSelect).toHaveValue('last-read-desc');
  await expect(page.getByTestId('library-retry-button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
});

test('library card shows language and estimated pages metadata', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await expect(page.getByTestId('book-meta-language').first()).toContainText(/Language: English/i);
  await expect(page.getByTestId('book-meta-pages').first()).toContainText(/Pages:\s*\d+/i);
});

test('library quick filter chips show counts and apply filters', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await expect(page.getByTestId('library-quick-filters')).toBeVisible();
  await expect(page.getByTestId('library-quick-filter-to-read-count')).toHaveText('0');
  await expect(page.getByTestId('library-quick-filter-in-progress-count')).toHaveText('0');
  await expect(page.getByTestId('library-quick-filter-finished-count')).toHaveText('0');
  await expect(page.getByTestId('library-quick-filter-favorites-count')).toHaveText('0');

  await bookLink.hover();
  await page.getByTestId('book-toggle-to-read').first().click({ force: true });
  await expect(page.getByTestId('library-quick-filter-to-read-count')).toHaveText('1');

  await page.getByTestId('library-quick-filter-to-read').click();
  await expect(page.getByTestId('library-filter')).toHaveValue('to-read');
  await expect(bookLink).toBeVisible();

  await page.getByTestId('library-filter').selectOption('all');
  await bookLink.hover();
  await bookLink.locator('button[title="Favorite"]').click({ force: true });
  await expect(page.getByTestId('library-quick-filter-favorites-count')).toHaveText('1');

  await page.getByTestId('library-quick-filter-favorites').click();
  await expect(page.getByTestId('library-filter')).toHaveValue('favorites');
  await expect(bookLink).toBeVisible();

  await expect(page.getByTestId('library-quick-filter-in-progress-count')).toHaveText('0');
  await expect(page.getByTestId('library-quick-filter-finished-count')).toHaveText('0');
  await page.getByTestId('library-quick-filter-in-progress').click();
  await expect(page.getByTestId('library-filter')).toHaveValue('in-progress');
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await page.getByTestId('library-quick-filter-finished').click();
  await expect(page.getByTestId('library-filter')).toHaveValue('finished');
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();
});

test('to read tag is manual and filter follows the tag state', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await expect(page.getByTestId('book-to-read-tag')).toHaveCount(0);

  const filterSelect = page.getByTestId('library-filter');
  await filterSelect.selectOption('to-read');
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await filterSelect.selectOption('all');
  await expect(bookLink).toBeVisible();

  await page.getByTestId('book-toggle-to-read').first().click();
  await expect(page.getByTestId('book-to-read-tag').first()).toBeVisible();

  await filterSelect.selectOption('to-read');
  await expect(bookLink).toBeVisible();

  await filterSelect.selectOption('all');
  await page.getByTestId('book-toggle-to-read').first().click();
  await expect(page.getByTestId('book-to-read-tag')).toHaveCount(0);

  await filterSelect.selectOption('to-read');
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();
});

test('library view toggle persists after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await expect(page.getByTestId('library-books-grid')).toBeVisible();

  const listToggle = page.getByTestId('library-view-list');
  await listToggle.click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();
  await expect(listToggle).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.getByTestId('library-books-list')).toBeVisible();
  await expect(page.getByTestId('library-view-list')).toHaveAttribute('aria-pressed', 'true');
});

test('continue reading rail appears for started books and hides in filtered mode', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await expect(page.getByTestId('continue-reading-rail')).toHaveCount(0);

  await bookLink.click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();
  await page.waitForTimeout(600);

  await page.goto('/');
  await expect.poll(async () => page.getByTestId('continue-reading-rail').count()).toBeGreaterThan(0);
  const rail = page.getByTestId('continue-reading-rail');
  await expect(page.getByTestId('continue-reading-card')).toHaveCount(1);

  await page.getByRole('button', { name: 'View in-progress' }).click();
  await expect(page.getByTestId('library-filter')).toHaveValue('in-progress');
  await expect(page.getByTestId('continue-reading-rail')).toHaveCount(0);
});

test('quick card actions open reader highlights and bookmarks panels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('quick-action-highlights').first().click();
  await expect(page).toHaveURL(/panel=highlights/);
  await expect(page.getByTestId('highlights-panel')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('quick-action-bookmarks').first().click();
  await expect(page).toHaveURL(/panel=bookmarks/);
  await expect(page.getByTestId('bookmarks-panel')).toBeVisible();
});

test('reading streak badge updates after starting a book', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const streakBadge = page.getByTestId('library-streak-badge');
  await expect(streakBadge).toBeVisible();
  await expect(streakBadge).toContainText('No streak yet');

  await page.getByRole('link', { name: /Test Book/i }).first().click();
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();
  await page.waitForTimeout(500);

  await page.goto('/');
  await expect(page.getByTestId('library-streak-badge')).toContainText('1-day streak');
});

test('trash icon supports move to trash, restore, and permanent delete', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-view-list').click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-move-trash').first().click();
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByTestId('trash-retention-note')).toContainText('30 days');
  await expect(page.getByTestId('trash-back-button')).toBeVisible();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await expect(page.getByTestId('book-restore').first()).toBeVisible();

  await page.getByTestId('book-restore').first().click();
  await page.getByTestId('trash-back-button').click();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-move-trash').first().click();
  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-delete-forever').first().click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
});

test('trash items older than 30 days are auto-purged on load', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-view-list').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-move-trash').first().click();

  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('SmartReaderLib');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const storeName = db.objectStoreNames.contains('keyvaluepairs')
        ? 'keyvaluepairs'
        : db.objectStoreNames[0];

      if (!storeName) {
        db.close();
        resolve();
        return;
      }

      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const cursorRequest = store.openCursor();
      const oldIso = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)).toISOString();

      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;

        const row = cursor.value;
        if (row && typeof row === 'object') {
          if (row.value && typeof row.value === 'object' && row.value.title === 'Test Book') {
            row.value.deletedAt = oldIso;
            row.value.isDeleted = true;
            cursor.update(row);
          } else if (row.title === 'Test Book') {
            row.deletedAt = oldIso;
            row.isDeleted = true;
            cursor.update(row);
          }
        }
        cursor.continue();
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  }));

  await page.reload();
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
});

test('library shows reading session timeline after active reading', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await bookLink.click();

  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();
  await page.waitForTimeout(17000);

  await page.goto('/');
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const sessionSummary = page.getByTestId('book-session-summary').first();
  await expect(sessionSummary).toContainText(/Last session:/i);
  await expect(sessionSummary).toContainText(/min|h/i);
  await expect(sessionSummary).not.toContainText(/7d sessions/i);
  await expect(sessionSummary).not.toContainText(/\(0 days ago\)/i);
});

test('global search panel shows grouped results and opens book from result', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  const searchInput = page.getByTestId('library-search');

  await searchInput.fill('no-match-token-xyz');
  await expect(page.getByTestId('global-search-panel')).toBeVisible();
  await expect(page.getByTestId('global-search-empty')).toBeVisible();

  await searchInput.fill('test book');
  await expect(page.getByTestId('global-search-group-books')).toHaveCount(0);
  await expect(page.getByTestId('global-search-found-books')).toBeVisible();
  await expect(page.getByTestId('global-search-found-book-card').first()).toBeVisible();

  await page.getByTestId('global-search-found-book-card').first().click();
  await expect(page).toHaveURL(/\/read\?id=/);
  await expect(page).toHaveURL(/q=test\+book/);
  await expect(page.getByPlaceholder('Search inside this book...')).toHaveValue('test book');
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();
});

test('global search includes in-book content matches', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const searchInput = page.getByTestId('library-search');
  await searchInput.fill('valley');

  await expect
    .poll(async () => page.getByTestId('global-search-group-content').count(), { timeout: 25000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId('global-search-group-books')).toHaveCount(0);
  await expect(page.getByTestId('global-search-found-books')).toBeVisible();
  const firstFoundCard = page.getByTestId('global-search-found-book-card').first();
  await expect(firstFoundCard).toBeVisible();
  await expect(firstFoundCard.getByTestId('global-search-found-book-title')).toBeVisible();
  await expect(firstFoundCard.getByTestId('global-search-found-book-author')).toBeVisible();
  await expect(firstFoundCard.getByTestId('book-meta-language')).toHaveCount(0);
  await expect(firstFoundCard.getByText('Resume')).toHaveCount(0);
  await expect(page.getByTestId('global-search-result-content').first()).toBeVisible();

  const firstRow = page.getByTestId('global-search-content-book-row').first();
  const contentPanel = firstRow.getByTestId('global-search-group-content');
  const cardPanel = firstRow.getByTestId('global-search-found-book-card');
  const [contentRect, cardRect] = await Promise.all([
    contentPanel.boundingBox(),
    cardPanel.boundingBox()
  ]);
  expect(contentRect).not.toBeNull();
  expect(cardRect).not.toBeNull();
  expect((cardRect?.x || 0)).toBeGreaterThan((contentRect?.x || 0));
  const heightDelta = Math.abs((cardRect?.height || 0) - (contentRect?.height || 0));
  expect(heightDelta).toBeLessThanOrEqual(10);

  await page.getByTestId('global-search-result-content').first().click();
  await expect(page).toHaveURL(/\/read\?id=/);
  await expect(page).toHaveURL(/cfi=/);
  await expect(page).toHaveURL(/q=valley/);
  await expect(page.getByPlaceholder('Search inside this book...')).toHaveValue('valley');
  await expect.poll(async () => page.getByTestId('search-progress').textContent(), { timeout: 15000 }).not.toBe('0/0');
  await expect(page.getByRole('button', { name: /Explain Page/i })).toBeVisible();
});

test('global search results panel is scrollable and can show more than capped content matches', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const searchInput = page.getByTestId('library-search');
  await searchInput.fill('the');

  await expect
    .poll(async () => page.getByTestId('global-search-result-content').count(), { timeout: 25000 })
    .toBeGreaterThan(4);

  const scrollPanel = page.getByTestId('global-search-group-content-scroll').first();
  await expect(scrollPanel).toBeVisible();
  const overflowY = await scrollPanel.evaluate((el) => getComputedStyle(el).overflowY);
  expect(['auto', 'scroll']).toContain(overflowY);
});
