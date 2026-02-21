import { test, expect } from '@playwright/test';

const user = {
  id: 'user-1',
  email: 'test1@gmail.com',
  username: 'testmozilla',
  displayName: 'TESTMOZILLA',
  avatarUrl: null,
  loanReminderDays: 3
};

const booksPayload = [
  {
    id: 'book-1',
    title: 'Neuromancer',
    author: 'William Gibson',
    language: 'en',
    cover: null,
    progress: 0,
    lastLocation: '',
    addedAt: '2026-02-21T10:00:00.000Z',
    userBook: { lastOpenedAt: null, isDeleted: false, deletedAt: null }
  },
  {
    id: 'book-2',
    title: 'The Aesop for Children',
    author: 'Aesop',
    language: 'en',
    cover: null,
    progress: 0,
    lastLocation: '',
    addedAt: '2026-02-21T10:01:00.000Z',
    userBook: { lastOpenedAt: null, isDeleted: false, deletedAt: null }
  }
];

test('@collab collab mode keeps library books visible through transient /books failures after refresh', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('SmartReaderLib');
    localStorage.clear();
  });
  await page.reload();

  let failNextBooksRequest = false;
  let injectedBooksFailureCount = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    const method = route.request().method();

    if (pathname === '/api/auth/login' && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'fake-jwt-token', user })
      });
      return;
    }

    if (pathname === '/api/books' && method === 'GET') {
      if (failNextBooksRequest) {
        failNextBooksRequest = false;
        injectedBooksFailureCount += 1;
        await route.abort('connectionrefused');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ books: booksPayload })
      });
      return;
    }

    if (/^\/api\/books\/[^/]+\/highlights$/.test(pathname) && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ highlights: [] })
      });
      return;
    }

    if (pathname === '/api/shares/inbox' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shares: [] })
      });
      return;
    }

    if (pathname === '/api/loans/templates/default' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          template: {
            name: 'Default lending template',
            durationDays: 14,
            graceDays: 0,
            remindBeforeDays: 3,
            permissions: {
              canAddHighlights: true,
              canEditHighlights: true,
              canAddNotes: true,
              canEditNotes: true,
              annotationVisibility: 'PRIVATE',
              shareLenderAnnotations: false
            }
          }
        })
      });
      return;
    }

    if (
      [
        '/api/loans/inbox',
        '/api/loans/borrowed',
        '/api/loans/lent'
      ].includes(pathname) && method === 'GET'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ loans: [] })
      });
      return;
    }

    if (pathname === '/api/loans/audit' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [] })
      });
      return;
    }

    if (pathname === '/api/loans/renewals' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ renewals: [] })
      });
      return;
    }

    if (pathname === '/api/loans/discussions/unread' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] })
      });
      return;
    }

    if (pathname === '/api/notifications' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [] })
      });
      return;
    }

    if (pathname === '/api/friends' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ friends: [] })
      });
      return;
    }

    if (pathname === '/api/friends/requests/incoming' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requests: [] })
      });
      return;
    }

    if (pathname === '/api/friends/requests/outgoing' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ requests: [] })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });

  await page.getByPlaceholder('Email').fill('test1@gmail.com');
  await page.getByPlaceholder('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();
  await expect(page.getByText(/You have 2 books/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Neuromancer/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /The Aesop for Children/i })).toBeVisible();

  // Force a deterministic transient books failure on next refresh.
  failNextBooksRequest = true;
  await page.reload();

  await expect(page.getByRole('heading', { name: 'My Library' })).toBeVisible();
  await expect(page.getByText(/You have 2 books/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Neuromancer/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /The Aesop for Children/i })).toBeVisible();
  expect(injectedBooksFailureCount).toBe(1);

  await page.reload();

  await expect(page.getByText(/You have 2 books/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Neuromancer/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /The Aesop for Children/i })).toBeVisible();
});
