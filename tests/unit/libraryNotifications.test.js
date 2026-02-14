import { describe, it, expect } from 'vitest';
import { buildLibraryNotifications } from '../../src/pages/library/libraryNotifications';

describe('buildLibraryNotifications', () => {
  it('adds duplicate cleanup notification when duplicate titles exist', () => {
    const items = buildLibraryNotifications({
      activeBooks: [{ id: '1', title: 'Book A (Duplicate 1)', author: 'X', progress: 10 }],
      streakCount: 0,
      readToday: true,
      todayKey: '2026-02-14',
      nowIso: new Date('2026-02-14T10:00:00Z').toISOString(),
      normalizeNumber: (v) => Number(v) || 0,
      getEstimatedRemainingSeconds: () => 999999,
      formatEstimatedTimeLeft: () => '20 min left',
      getCalendarDayDiff: () => 0,
      isBookToRead: () => false,
      isBookStarted: () => true,
      isDuplicateTitleBook: (b) => /\(duplicate\s+\d+\)/i.test(b.title || ''),
      stripDuplicateTitleSuffix: (t) => (t || '').replace(/\s*\(duplicate\s+\d+\)\s*$/i, '').trim()
    });

    expect(items.some((n) => n.kind === 'duplicate-cleanup')).toBe(true);
  });
});
