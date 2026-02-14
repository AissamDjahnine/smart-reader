import { describe, it, expect } from 'vitest';
import { buildContinueReadingBooks } from '../../src/pages/library/continueReading';

const isDuplicateTitleBook = (book) => /\(duplicate\s+\d+\)/i.test(book?.title || '');
const isBookStarted = (book) => {
  const progress = Number(book?.progress || 0);
  return progress > 0 || Boolean(book?.lastRead);
};
const normalizeNumber = (value) => Number(value || 0);
const normalizeTime = (value) => {
  const ts = new Date(value || 0).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

describe('buildContinueReadingBooks', () => {
  it('filters deleted, duplicates, and completed books', () => {
    const now = new Date('2026-02-14T00:00:00.000Z').getTime();
    const books = [
      { id: 'keep', title: 'Normal', progress: 30, readingTime: 300, lastRead: '2026-02-13T00:00:00.000Z' },
      { id: 'dup', title: 'Normal (Duplicate 1)', progress: 40, readingTime: 400, lastRead: '2026-02-13T00:00:00.000Z' },
      { id: 'done', title: 'Finished', progress: 100, readingTime: 1200, lastRead: '2026-02-13T00:00:00.000Z' },
      { id: 'deleted', title: 'Deleted', progress: 50, readingTime: 1200, isDeleted: true, lastRead: '2026-02-13T00:00:00.000Z' }
    ];

    const result = buildContinueReadingBooks({
      books,
      isDuplicateTitleBook,
      isBookStarted,
      normalizeNumber,
      normalizeTime,
      nowMs: now
    });

    expect(result.map((book) => book.id)).toEqual(['keep']);
  });

  it('orders by combined priority and computes remaining seconds', () => {
    const now = new Date('2026-02-14T00:00:00.000Z').getTime();
    const books = [
      { id: 'old-high-progress', title: 'A', progress: 90, readingTime: 900, lastRead: '2026-02-01T00:00:00.000Z' },
      { id: 'recent-mid-progress', title: 'B', progress: 45, readingTime: 450, lastRead: '2026-02-13T12:00:00.000Z' }
    ];

    const result = buildContinueReadingBooks({
      books,
      isDuplicateTitleBook,
      isBookStarted,
      normalizeNumber,
      normalizeTime,
      nowMs: now
    });

    expect(result[0].id).toBe('recent-mid-progress');
    expect(result[0].__estimatedRemainingSeconds).toBeGreaterThan(0);
    expect(result[1].id).toBe('old-high-progress');
  });
});
