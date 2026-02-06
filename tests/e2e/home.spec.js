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
