import { test, expect } from '@playwright/test';
import path from 'path';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/fixture.epub');

async function openCollectionsPage(page) {
  await page.getByTestId('library-collections-trigger').click();
  await expect(page.getByTestId('collections-board')).toBeVisible();
}

async function openLibraryPage(page) {
  await page.getByTestId('sidebar-my-library').click();
  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();
}

async function createShelf(page, name) {
  await openCollectionsPage(page);
  await page.getByTestId('collection-add-toggle').click();
  await page.getByTestId('collection-create-input').fill(name);
  await page.getByTestId('collection-create-button').click();
  await expect(page.getByTestId('collection-item-name').filter({ hasText: name })).toBeVisible();
}

async function assignFirstBookToShelf(page, name) {
  await page.getByTestId('library-view-list').click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();
  await page.getByTestId('book-collection-picker-toggle').first().click();
  const picker = page.getByTestId('book-collection-picker').first();
  await expect(picker).toBeVisible();
  const shelfRow = picker.locator('label').filter({ hasText: name }).first();
  await expect(shelfRow).toBeVisible();
  await shelfRow.locator('input[type="checkbox"]').click({ force: true });
  await expect(page.getByTestId('book-collection-chip').filter({ hasText: name }).first()).toBeVisible();
}

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

  const favoritesQuickFilter = page.getByTestId('library-quick-filter-favorites');
  await favoritesQuickFilter.click();
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();
  await expect(favoritesQuickFilter).toHaveAttribute('aria-pressed', 'true');

  await favoritesQuickFilter.click();
  await expect(favoritesQuickFilter).toHaveAttribute('aria-pressed', 'false');
  await expect(bookLink).toBeVisible();

  await bookLink.hover();
  await bookLink.locator('button[title="Favorite"]').click({ force: true });

  await favoritesQuickFilter.click();
  await expect(favoritesQuickFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(bookLink).toBeVisible();
});

test('collections create and assign flow works', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await createShelf(page, 'Classics');
  await openLibraryPage(page);
  await assignFirstBookToShelf(page, 'Classics');
  await openCollectionsPage(page);
  await expect(page.getByTestId('collections-directory-layout')).toBeVisible();
  await expect(page.getByTestId('collection-item-name').filter({ hasText: 'Classics' })).toBeVisible();
  await expect(page.getByTestId('collections-detail-panel').getByTestId('collection-column-book')).toHaveCount(1);
});

test('collections page supports optional board mode with balanced columns', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await createShelf(page, 'Shelf One');
  await createShelf(page, 'Shelf Two');
  await openLibraryPage(page);
  await assignFirstBookToShelf(page, 'Shelf One');
  await openCollectionsPage(page);

  await page.getByTestId('collections-view-board').click();
  await expect(page.getByTestId('collections-board-overview')).toBeVisible();
  const boardColumnCount = await page.getByTestId('collections-board-column').count();
  expect(boardColumnCount).toBeGreaterThan(0);

  await expect(page.getByTestId('collection-column')).toHaveCount(2);
  await expect(page.getByTestId('collection-column').filter({ hasText: 'Shelf One' })).toBeVisible();
  await expect(page.getByTestId('collection-column').filter({ hasText: 'Shelf Two' })).toBeVisible();
  await expect(page.getByTestId('collection-column').filter({ hasText: 'Shelf One' }).getByTestId('collection-column-book')).toHaveCount(1);
  await expect(page.getByTestId('collection-column').filter({ hasText: 'Shelf Two' }).getByText('No books in this collection yet.')).toBeVisible();
});

test('collections detail can add books directly to selected collection', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await createShelf(page, 'Add Target');
  await openCollectionsPage(page);
  await expect(page.getByTestId('collections-detail-panel').getByTestId('collection-column-book')).toHaveCount(0);

  await page.getByTestId('collection-detail-add-book').click();
  const addBooksModal = page.getByTestId('collection-add-books-modal');
  await expect(addBooksModal).toBeVisible();
  await expect(addBooksModal.getByTestId('collection-add-books-item')).toHaveCount(1);

  await addBooksModal.getByTestId('collection-add-books-confirm').first().click();
  await expect(page.getByTestId('collections-detail-panel').getByTestId('collection-column-book')).toHaveCount(1);
  await expect(addBooksModal.getByTestId('collection-add-books-item')).toHaveCount(0);
});

test('collection rename updates filter options and chips', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await createShelf(page, 'Old Shelf');
  await openLibraryPage(page);
  await assignFirstBookToShelf(page, 'Old Shelf');

  await openCollectionsPage(page);
  await page.getByTestId('collection-rename-button').first().click();
  await page.getByTestId('collection-rename-input').first().fill('New Shelf');
  await page.getByTestId('collection-rename-save').first().click();
  await expect(page.getByTestId('collection-item-name').filter({ hasText: 'New Shelf' })).toBeVisible();
  await expect(page.getByTestId('collection-item-name').filter({ hasText: 'Old Shelf' })).toHaveCount(0);
  await openLibraryPage(page);
  await expect(page.getByTestId('book-collection-chip').filter({ hasText: 'New Shelf' }).first()).toBeVisible();
});

test('collection delete clears assignment and resets active collection filter', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await createShelf(page, 'Delete Me');
  await openLibraryPage(page);
  await assignFirstBookToShelf(page, 'Delete Me');

  await openCollectionsPage(page);
  await page.getByTestId('collection-delete-button').first().click();
  await expect(page.getByTestId('collection-item-name').filter({ hasText: 'Delete Me' })).toHaveCount(0);
  await openLibraryPage(page);
  await expect(page.getByTestId('book-collection-chip').filter({ hasText: 'Delete Me' })).toHaveCount(0);
});

test('collections and assignments persist after reload', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await createShelf(page, 'Persistent Shelf');
  await openLibraryPage(page);
  await assignFirstBookToShelf(page, 'Persistent Shelf');

  await page.reload();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await openCollectionsPage(page);
  await expect(page.getByTestId('collection-item-name').filter({ hasText: 'Persistent Shelf' })).toBeVisible();
  await openLibraryPage(page);
  await expect(page.getByTestId('book-collection-chip').filter({ hasText: 'Persistent Shelf' }).first()).toBeVisible();
});

test('newly added book shows a temporary yellow halo highlight', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();
  await expect(bookLink).toHaveClass(/ring-amber-400/);

  await page.waitForTimeout(10200);
  await expect(bookLink).not.toHaveClass(/ring-amber-400/);
});

test('duplicate book upload prompts and keep both creates a second copy', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await fileInput.setInputFiles(fixturePath);
  const modal = page.getByText('Duplicate book detected');
  await expect(modal).toBeVisible();
  await page.getByTestId('duplicate-keep-both').click();

  await expect(page.getByRole('link', { name: /Test Book \(Duplicate 1\)/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Test Book/i })).toHaveCount(2);
});

test('bulk upload applies duplicate rules per file and increments duplicate suffix', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');

  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await fileInput.setInputFiles([fixturePath, fixturePath, fixturePath]);

  for (const duplicateIndex of [1, 2, 3]) {
    const duplicateModalTitle = page.getByText('Duplicate book detected');
    await expect(duplicateModalTitle).toBeVisible({ timeout: 20000 });
    await page.getByTestId('duplicate-keep-both').click();
    await expect(page.getByRole('link', { name: new RegExp(`Test Book \\(Duplicate ${duplicateIndex}\\)`, 'i') }).first()).toBeVisible({ timeout: 20000 });
  }

  await expect(page.getByRole('link', { name: /Test Book/i })).toHaveCount(4);
});

test('upload metadata parsing falls back when worker is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
    try {
      Object.defineProperty(window, 'Worker', {
        value: undefined,
        configurable: true,
      });
    } catch (err) {
      window.Worker = undefined;
    }
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
});

test('book info popover shows epub metadata', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-view-list').click();
  const listContainer = page.getByTestId('library-books-list');
  await expect(listContainer).toBeVisible();
  await listContainer.getByTestId('book-info').first().click({ force: true });

  const popover = page.getByTestId('book-info-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByText('Book info')).toBeVisible();
  await expect(popover.getByText('EPUB metadata')).toBeVisible();

  const keys = await popover.getByTestId('book-info-metadata-key').allTextContents();
  const normalized = keys.map((text) => text.trim().toLowerCase()).filter(Boolean);

  expect(normalized[0]).toBe('title');
  if (normalized.length > 1) {
    expect(['creator', 'author']).toContain(normalized[1]);
  }
  if (normalized.length > 2) {
    expect(normalized[2]).toBe('language');
  }

  await expect(popover.getByText('identifier', { exact: true })).toHaveCount(0);
  await expect(popover.getByText('modified', { exact: true })).toHaveCount(0);
  await expect(popover.getByText('Language: English')).toHaveCount(1);
});

test('book info popover hover opens metadata without navigating away', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-view-list').click();
  const listContainer = page.getByTestId('library-books-list');
  await expect(listContainer).toBeVisible();

  const infoButton = listContainer.getByTestId('book-info').first();
  await infoButton.hover();

  const popover = page.getByTestId('book-info-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByText('Book info')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();
});

test('book info hover works from grid cards without triggering navigation', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  const firstCard = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(firstCard).toBeVisible();

  await firstCard.hover();
  const infoButton = firstCard.getByTestId('book-info');
  await expect(infoButton).toBeVisible();
  await infoButton.hover();

  const popover = page.getByTestId('book-info-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByText('Book info')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('book info popover sanitizes html metadata values to plain text', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const patched = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const storeName = db.objectStoreNames.contains('keyvaluepairs')
          ? 'keyvaluepairs'
          : db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }

        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const cursorRequest = store.openCursor();
        let didPatch = false;

        cursorRequest.onerror = () => reject(cursorRequest.error);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;

          const row = cursor.value;
          const bookLike = row?.value && typeof row.value === 'object' ? row.value : row;
          if (bookLike && typeof bookLike === 'object' && bookLike.title === 'Test Book') {
            if (row?.value && typeof row.value === 'object') {
              row.value.epubMetadata = {
                ...(row.value.epubMetadata || {}),
                description: '<div><p><strong>THE SUNDAY TIMES</strong><br>&amp; immersive at times</p></div>'
              };
              cursor.update(row);
            } else {
              row.epubMetadata = {
                ...(row.epubMetadata || {}),
                description: '<div><p><strong>THE SUNDAY TIMES</strong><br>&amp; immersive at times</p></div>'
              };
              cursor.update(row);
            }
            didPatch = true;
          }
          cursor.continue();
        };

        tx.oncomplete = () => {
          db.close();
          resolve(didPatch);
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  expect(patched).toBeTruthy();

  await page.getByTestId('library-view-list').click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();
  const listRow = page.getByRole('link', { name: /Test Book/i }).first();
  await listRow.getByTitle('Favorite').click({ force: true });
  await expect(page.getByTestId('library-quick-filter-favorites')).toContainText('1');
  await listRow.getByTitle('Favorite').click({ force: true });
  await expect(page.getByTestId('library-quick-filter-favorites')).toContainText('0');
  await listRow.getByTestId('book-info').click({ force: true });

  const popover = page.getByTestId('book-info-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByText('THE SUNDAY TIMES')).toBeVisible();
  await expect(popover.getByText('& immersive at times')).toBeVisible();
  await expect(popover.getByText('<div>')).toHaveCount(0);
  await expect(popover.getByText('<strong>')).toHaveCount(0);
});

test('library toolbar is sticky and reset button clears search status and flag filters', async ({ page }) => {
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
  const favoritesQuickFilter = page.getByTestId('library-quick-filter-favorites');

  await searchInput.fill('no-match-token-xyz');
  await filterSelect.selectOption('in-progress');
  await favoritesQuickFilter.click();
  await sortSelect.selectOption('title-asc');
  await expect(page.getByTestId('library-reset-filters-button')).toBeVisible();
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();

  await page.getByTestId('library-reset-filters-button').click();
  await expect(searchInput).toHaveValue('');
  await expect(filterSelect).toHaveValue('all');
  await expect(sortSelect).toHaveValue('last-read-desc');
  await expect(favoritesQuickFilter).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('library-reset-filters-button')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
});

test('library toolbar controls stay aligned to the search bar height', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });

  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const controls = {
    search: page.getByTestId('library-search'),
    filter: page.getByTestId('library-filter'),
    sort: page.getByTestId('library-sort')
  };

  await Promise.all(Object.values(controls).map((locator) => expect(locator).toBeVisible()));

  const heights = await Promise.all(
    Object.values(controls).map(async (locator) => {
      const box = await locator.boundingBox();
      return box?.height || 0;
    })
  );

  const searchHeight = heights[0];
  heights.slice(1).forEach((height) => {
    expect(Math.abs(height - searchHeight)).toBeLessThanOrEqual(2);
  });
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
  await expect(page.getByTestId('book-meta-language').first()).toContainText(/English/i);
  await expect(page.getByTestId('book-meta-pages').first()).toContainText(/\d+\s*pages/i);
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
  await expect(page.getByTestId('library-quick-filter-favorites')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('library-filter')).toHaveValue('all');
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

test('status and flag filters can be combined', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  const bookLink = page.getByRole('link', { name: /Test Book/i }).first();
  await expect(bookLink).toBeVisible();

  await page.getByTestId('book-toggle-to-read').first().click({ force: true });
  await bookLink.hover();
  await bookLink.locator('button[title="Favorite"]').click({ force: true });

  const filterSelect = page.getByTestId('library-filter');
  const favoritesQuickFilter = page.getByTestId('library-quick-filter-favorites');
  await filterSelect.selectOption('to-read');
  await favoritesQuickFilter.click();

  await expect(filterSelect).toHaveValue('to-read');
  await expect(favoritesQuickFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(bookLink).toBeVisible();
});

test('notes center edits note and syncs to reader highlights panel', async ({ page }) => {
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
  await page.waitForTimeout(1200);

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
            const noteEntry = {
              cfiRange: 'epubcfi(/6/2[seed-note]!/4/2/2,/4/2/10)',
              text: 'Seeded highlight sentence',
              color: 'yellow',
              note: 'Initial note from reader'
            };
            const existingIndex = highlights.findIndex((item) => item?.cfiRange === noteEntry.cfiRange);
            if (existingIndex >= 0) {
              highlights[existingIndex] = { ...highlights[existingIndex], ...noteEntry };
            } else {
              highlights.push(noteEntry);
            }
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
  await page.reload();
  await expect.poll(async () => page.getByText('Test Book').count(), { timeout: 15000 }).toBeGreaterThan(0);

  await page.getByTestId('library-notes-center-toggle').click();
  await expect(page.getByTestId('notes-center-panel')).toBeVisible();
  await expect(page.getByTestId('notes-center-item').first()).toBeVisible();

  await page.getByTestId('notes-center-edit').first().click();
  await page.getByTestId('notes-center-textarea').first().fill('Updated note from Notes Center');
  await page.getByTestId('notes-center-save').first().click();
  await expect(page.getByText('Updated note from Notes Center')).toBeVisible();

  await page.getByTestId('notes-center-open-reader').first().click();
  await expect(page).toHaveURL(/panel=highlights/);
  await expect(page.getByTestId('highlights-panel')).toBeVisible();
  await expect(page.getByText('Updated note from Notes Center')).toBeVisible();
});

test('notes and highlights sections hide home-only library content', async ({ page }) => {
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
  await expect(page.getByTestId('library-toolbar-sticky')).toBeVisible();

  const href = await bookLink.getAttribute('href');
  const bookId = href ? new URL(href, 'http://localhost').searchParams.get('id') : null;
  expect(bookId).toBeTruthy();
  await page.evaluate((id) => {
    localStorage.setItem('library-started-book-ids', JSON.stringify([id]));
  }, bookId);
  await page.reload();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await expect(page.getByTestId('continue-reading-rail')).toBeVisible();

  await page.getByTestId('library-notes-center-toggle').click();
  await expect(page.getByTestId('notes-center-panel')).toBeVisible();
  await expect(page.getByTestId('continue-reading-rail')).toHaveCount(0);
  await expect(page.getByTestId('library-toolbar-sticky')).toHaveCount(0);
  await expect(page.getByTestId('library-books-grid')).toHaveCount(0);
  await expect(page.getByTestId('library-books-list')).toHaveCount(0);

  await page.getByTestId('library-highlights-center-toggle').click();
  await expect(page.getByTestId('highlights-center-panel')).toBeVisible();
  await expect(page.getByTestId('continue-reading-rail')).toHaveCount(0);
  await expect(page.getByTestId('library-toolbar-sticky')).toHaveCount(0);
  await expect(page.getByTestId('library-books-grid')).toHaveCount(0);
  await expect(page.getByTestId('library-books-list')).toHaveCount(0);

  await page.getByTestId('sidebar-my-library').click();
  await expect(page.getByTestId('library-toolbar-sticky')).toBeVisible();
  await expect(page.getByTestId('library-books-grid')).toBeVisible();
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

test('library view grid toggle restores grid mode', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);

  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await expect(page.getByTestId('library-view-grid')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('library-books-grid')).toBeVisible();

  await page.getByTestId('library-view-list').click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();

  await page.getByTestId('library-view-grid').click();
  await expect(page.getByTestId('library-view-grid')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('library-books-grid')).toBeVisible();
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

test('library cards remove quick action row and still open reader on click', async ({ page }) => {
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

  await expect(page.getByTestId('quick-action-resume')).toHaveCount(0);
  await expect(page.getByTestId('quick-action-highlights')).toHaveCount(0);
  await expect(page.getByTestId('quick-action-bookmarks')).toHaveCount(0);

  await bookLink.click();
  await expect(page).toHaveURL(/\/read\?id=/);
  await expect(page.getByRole('button', { name: /Open chapters/i })).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await page.getByTestId('library-view-list').click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();
  await expect(page.getByTestId('quick-action-resume')).toHaveCount(0);
  await expect(page.getByTestId('quick-action-highlights')).toHaveCount(0);
  await expect(page.getByTestId('quick-action-bookmarks')).toHaveCount(0);

  await page.getByRole('link', { name: /Test Book/i }).first().click();
  await expect(page).toHaveURL(/\/read\?id=/);
  await expect(page.getByRole('button', { name: /Open chapters/i })).toBeVisible();
});

test('notes center shows empty state and zero count when no notes exist', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();
  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-notes-center-toggle').click();
  await expect(page.getByTestId('notes-center-panel')).toBeVisible();
  await expect(page.getByTestId('notes-center-count')).toContainText('0 notes shown');
  await expect(page.getByTestId('notes-center-empty')).toBeVisible();
});

test('notes center cancel keeps the existing note unchanged', async ({ page }) => {
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
  await page.waitForTimeout(1200);

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
              cfiRange: 'epubcfi(/6/2[seed-note-cancel]!/4/2/2,/4/2/10)',
              text: 'Seeded note text anchor',
              color: '#fcd34d',
              note: 'Original note content'
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

  await page.reload();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-notes-center-toggle').click();
  await expect(page.getByTestId('notes-center-panel')).toBeVisible();
  await expect(page.getByTestId('notes-center-note-text').first()).toContainText('Original note content');

  await page.getByTestId('notes-center-edit').first().click();
  await page.getByTestId('notes-center-textarea').first().fill('Changed but cancelled');
  await page.getByTestId('notes-center-cancel').first().click();

  await expect(page.getByTestId('notes-center-textarea')).toHaveCount(0);
  await expect(page.getByTestId('notes-center-note-text').first()).toContainText('Original note content');
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
  await expect(page.getByTestId('trash-toggle-button')).toBeVisible();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await expect(page.getByTestId('book-restore').first()).toBeVisible();

  await page.getByTestId('book-restore').first().click();
  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-move-trash').first().click();
  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-delete-forever').first().click();
  await expect(page.getByText('Trash is empty.')).toBeVisible();
});

test('trash manual selection keeps checkboxes checked and toggles select-all label', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByText('Duplicate book detected')).toBeVisible();
  await page.getByTestId('duplicate-keep-both').click();
  await expect(page.getByRole('link', { name: /Test Book/i })).toHaveCount(2);

  await page.getByTestId('library-view-list').click();
  await expect(page.getByTestId('library-books-list')).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByTestId('book-move-trash').first().click();
  await page.getByTestId('book-move-trash').first().click();

  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByTestId('trash-retention-note')).toBeVisible();

  const selectAllButton = page.getByTestId('trash-select-all');
  await expect(selectAllButton).toContainText('Select all');
  await expect(page.getByText('0 selected')).toBeVisible();

  const trashCheckboxes = page.locator('[data-testid^="trash-book-select-input-"]');
  await expect(trashCheckboxes).toHaveCount(2);

  await trashCheckboxes.nth(0).click();
  await expect(trashCheckboxes.nth(0)).toBeChecked();
  await expect(page.getByText('1 selected')).toBeVisible();
  await expect(selectAllButton).toContainText('Select all');

  await trashCheckboxes.nth(1).click();
  await expect(trashCheckboxes.nth(0)).toBeChecked();
  await expect(trashCheckboxes.nth(1)).toBeChecked();
  await expect(page.getByText('2 selected')).toBeVisible();
  await expect(selectAllButton).toContainText('Unselect all');
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

test('book card exposes last session label field', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await page.waitForTimeout(1200);

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
            const now = Date.now();
            const end = new Date(now - (2 * 24 * 60 * 60 * 1000));
            const start = new Date(end.getTime() - (2 * 60 * 1000));
            const readingSessions = [{
              startAt: start.toISOString(),
              endAt: end.toISOString(),
              seconds: 120
            }];
            const nextPayload = {
              ...payload,
              hasStarted: true,
              progress: Math.max(Number(payload.progress) || 0, 5),
              readingTime: Math.max(Number(payload.readingTime) || 0, 120),
              readingSessions
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

  await page.reload();
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
  await expect(page.getByTestId('book-last-session').first()).toContainText(/min|h/i);
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

test('global search shows scanning state and found book cover rendering', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await fileInput.setInputFiles(fixturePath);
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  const searchInput = page.getByTestId('library-search');
  await searchInput.fill('the');

  await expect(page.getByTestId('global-search-panel')).toBeVisible();
  const scanningIndicator = page.getByTestId('global-search-scanning');
  if (await scanningIndicator.count()) {
    await expect(scanningIndicator).toBeVisible();
  }
  await expect
    .poll(async () => page.getByTestId('global-search-found-book-cover').count(), { timeout: 25000 })
    .toBeGreaterThan(0);
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

test('persistent search index is stored in IndexedDB and includes uploaded book entries', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-search').fill('test');
  await expect(page.getByTestId('global-search-panel')).toBeVisible();

  await expect
    .poll(async () => page.evaluate(() => new Promise((resolve) => {
      const request = indexedDB.open('SmartReaderLib');
      request.onerror = () => resolve(0);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('searchIndex')) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction('searchIndex', 'readonly');
        const store = tx.objectStore('searchIndex');
        const getRequest = store.get('global');
        getRequest.onerror = () => {
          db.close();
          resolve(0);
        };
        getRequest.onsuccess = () => {
          const snapshot = getRequest.result;
          const count = snapshot?.books ? Object.keys(snapshot.books).length : 0;
          db.close();
          resolve(count);
        };
      };
    })), { timeout: 15000 })
    .toBeGreaterThan(0);

  const snapshot = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('SmartReaderLib');
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('searchIndex')) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction('searchIndex', 'readonly');
      const store = tx.objectStore('searchIndex');
      const getRequest = store.get('global');
      getRequest.onerror = () => {
        db.close();
        resolve(null);
      };
      getRequest.onsuccess = () => {
        const value = getRequest.result || null;
        db.close();
        resolve(value);
      };
    };
  }));

  expect(snapshot).toBeTruthy();
  expect(snapshot.version).toBe(1);
  const indexedEntries = Object.values(snapshot.books || {});
  expect(indexedEntries.length).toBeGreaterThan(0);
  const firstEntry = indexedEntries[0];
  expect(typeof firstEntry.fullText).toBe('string');
  expect(firstEntry.fullText).toContain('test book');
});

test('persistent content index is stored in IndexedDB with section text entries', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('library-search').fill('valley');
  await expect
    .poll(async () => page.getByTestId('global-search-result-content').count(), { timeout: 25000 })
    .toBeGreaterThan(0);

  const contentIndexInfo = await page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open('SmartReaderLib');
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('contentSearch')) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction('contentSearch', 'readonly');
      const store = tx.objectStore('contentSearch');
      const manifestReq = store.get('__manifest__');
      manifestReq.onerror = () => {
        db.close();
        resolve(null);
      };
      manifestReq.onsuccess = () => {
        const manifest = manifestReq.result;
        const firstBookId = manifest?.books ? Object.keys(manifest.books)[0] : null;
        if (!firstBookId) {
          db.close();
          resolve({
            manifestVersion: manifest?.version || 0,
            indexedBooks: 0,
            sectionCount: 0
          });
          return;
        }
        const recordReq = store.get(`book:${firstBookId}`);
        recordReq.onerror = () => {
          db.close();
          resolve(null);
        };
        recordReq.onsuccess = () => {
          const record = recordReq.result;
          db.close();
          resolve({
            manifestVersion: manifest?.version || 0,
            indexedBooks: Object.keys(manifest?.books || {}).length,
            sectionCount: Array.isArray(record?.sections) ? record.sections.length : 0,
            hasText: Array.isArray(record?.sections)
              ? record.sections.some((section) => typeof section?.text === 'string' && section.text.length > 0)
              : false
          });
        };
      };
    };
  }));

  expect(contentIndexInfo).toBeTruthy();
  expect(contentIndexInfo.manifestVersion).toBe(1);
  expect(contentIndexInfo.indexedBooks).toBeGreaterThan(0);
  expect(contentIndexInfo.sectionCount).toBeGreaterThan(0);
  expect(contentIndexInfo.hasText).toBeTruthy();
});

test('empty state reset button clears filters and restores results', async ({ page }) => {
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
  await searchInput.fill('no-match-token-for-empty-reset');
  await expect(page.getByText('No books found matching your criteria.')).toBeVisible();
  await expect(page.getByTestId('library-empty-reset-filters-button')).toBeVisible();

  await page.getByTestId('library-empty-reset-filters-button').click();
  await expect(searchInput).toHaveValue('');
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();
});

test('account section renders profile form even after opening trash view', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.goto('/');

  const fileInput = page.locator('input[type="file"][accept=".epub"]');
  await fileInput.setInputFiles(fixturePath);
  await expect(page.getByRole('link', { name: /Test Book/i }).first()).toBeVisible();

  await page.getByTestId('trash-toggle-button').click();
  await expect(page.getByTestId('trash-retention-note')).toBeVisible();

  await page.getByTestId('library-account-trigger').click();
  await expect(page.getByTestId('library-account-panel')).toBeVisible();
  await expect(page.getByTestId('library-account-first-name')).toBeVisible();
  await expect(page.getByTestId('library-account-email')).toHaveValue('dreamerissame@gmail.com');
  await expect(page.getByTestId('library-account-language')).toBeVisible();
  await expect(page.getByTestId('library-account-email-notifications')).toBeVisible();
  await expect(page.getByTestId('library-account-save')).toBeVisible();
  await expect(page.getByTestId('library-toolbar-sticky')).toHaveCount(0);
  await expect(page.getByTestId('library-books-grid')).toHaveCount(0);
});
