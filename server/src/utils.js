import crypto from 'crypto';

export const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

export const statusFromProgress = (value) => {
  const n = clampPercent(value);
  if (n <= 0) return 'TO_READ';
  if (n >= 100) return 'FINISHED';
  return 'IN_PROGRESS';
};

export const toBookResponse = (book, currentUserId, baseUrl = '') => {
  const userBook = Array.isArray(book?.userBooks)
    ? book.userBooks.find((entry) => entry.userId === currentUserId) || book.userBooks[0]
    : null;
  return {
    id: book.id,
    epubHash: book.epubHash,
    title: book.title,
    author: book.author || 'Unknown Author',
    language: book.language || '',
    cover: book.cover || null,
    filePath: book.filePath || null,
    fileUrl: baseUrl ? `${baseUrl}/books/${book.id}/file` : null,
    progress: userBook?.progressPercent || 0,
    lastLocation: userBook?.progressCfi || '',
    userBook: userBook
      ? {
          id: userBook.id,
          status: userBook.status,
          progressPercent: userBook.progressPercent,
          progressCfi: userBook.progressCfi,
          lastOpenedAt: userBook.lastOpenedAt,
          isDeleted: Boolean(userBook.isDeleted),
          deletedAt: userBook.deletedAt || null
        }
      : null
  };
};

export const ensureEpubHash = (hash, fallback) => {
  const normalized = (hash || '').toString().trim();
  if (normalized) return normalized;
  return crypto.createHash('sha256').update(fallback).digest('hex');
};
