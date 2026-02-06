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
  await page.getByTitle('Favorite').first().click({ force: true });

  await filterSelect.selectOption('favorites');
  await expect(bookLink).toBeVisible();
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
