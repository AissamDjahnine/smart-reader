import path from 'path';
import { verifyToken } from './auth.js';
import { prisma } from './prisma.js';
import { ensureBookEntitlement } from './loanPolicy.js';

const resolveToken = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
  return '';
};

export const requireAuth = (req, res, next) => {
  try {
    const token = resolveToken(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = verifyToken(token);
    req.auth = { userId: payload.sub, email: payload.email, token };
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

export const requireBookAccess = async (req, res, next) => {
  const { bookId } = req.params;
  if (!bookId) return res.status(400).json({ error: 'bookId required' });
  const { userBook } = await ensureBookEntitlement(prisma, {
    userId: req.auth.userId,
    bookId
  });

  if (!userBook) return res.status(403).json({ error: 'No access to this book' });
  if (userBook.isDeleted) {
    return res.status(410).json({
      error: 'Book is in trash. Restore it first.',
      code: 'BOOK_IN_TRASH'
    });
  }
  req.userBook = userBook;
  return next();
};

export const isSafeRelativePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = path.normalize(value).replace(/\\/g, '/');
  return !normalized.startsWith('../') && !normalized.includes('/../');
};
