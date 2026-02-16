import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from './prisma.js';
import { config } from './config.js';
import { comparePassword, hashPassword, signToken } from './auth.js';
import { requireAuth, requireBookAccess, isSafeRelativePath } from './middleware.js';
import { clampPercent, ensureEpubHash, statusFromProgress, toBookResponse } from './utils.js';

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: '10mb' }));

fs.mkdirSync(config.uploadsDir, { recursive: true });

const sanitize = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.epub') || '.epub';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${sanitize(file.originalname)}${ext}`);
  }
});
const upload = multer({ storage });
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

const getBaseUrl = (req) => {
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
};

const includeBookGraph = {
  userBooks: true
};

const includeShareGraph = {
  book: true,
  fromUser: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
  toUser: { select: { id: true, email: true, displayName: true, avatarUrl: true } }
};

const toUserResponse = (user) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName || null,
  avatarUrl: user.avatarUrl || null
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/auth/register', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    displayName: z.string().min(1)
  });

  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const email = parsed.data.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: (parsed.data.displayName || '').trim()
    }
  });

  const token = signToken(user);
  return res.status(201).json({
    token,
    user: toUserResponse(user)
  });
});

app.post('/auth/login', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await comparePassword(parsed.data.password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken(user);
  return res.json({
    token,
    user: toUserResponse(user)
  });
});

app.get('/auth/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { id: true, email: true, displayName: true, avatarUrl: true, createdAt: true }
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: toUserResponse(user) });
});

app.get('/users/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { id: true, email: true, displayName: true, avatarUrl: true }
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: toUserResponse(user) });
});

app.patch('/users/me', requireAuth, async (req, res) => {
  const schema = z.object({
    displayName: z.string().min(1).max(120)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: { displayName: parsed.data.displayName.trim() },
    select: { id: true, email: true, displayName: true, avatarUrl: true }
  });
  return res.json({ user: toUserResponse(user) });
});

app.post('/users/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Avatar file is required' });
  const mime = (req.file.mimetype || '').toLowerCase();
  if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Avatar must be an image' });
  const avatarUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: { avatarUrl },
    select: { id: true, email: true, displayName: true, avatarUrl: true }
  });
  return res.json({ user: toUserResponse(user) });
});

app.get('/books', requireAuth, async (req, res) => {
  const rows = await prisma.userBook.findMany({
    where: { userId: req.auth.userId },
    include: { book: true },
    orderBy: { updatedAt: 'desc' }
  });

  const baseUrl = getBaseUrl(req);
  const books = rows.map((row) => toBookResponse({ ...row.book, userBooks: [row] }, req.auth.userId, baseUrl));
  return res.json({ books });
});

app.post('/books', requireAuth, upload.single('file'), async (req, res) => {
  const schema = z.object({
    bookId: z.string().optional(),
    epubHash: z.string().optional(),
    title: z.string().min(1).optional(),
    author: z.string().optional(),
    language: z.string().optional(),
    cover: z.string().optional(),
    filePath: z.string().optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  let targetBook = null;
  if (parsed.data.bookId) {
    targetBook = await prisma.book.findUnique({ where: { id: parsed.data.bookId } });
  }
  if (!targetBook && parsed.data.epubHash) {
    targetBook = await prisma.book.findUnique({ where: { epubHash: parsed.data.epubHash } });
  }

  if (!targetBook) {
    const fallbackHash = ensureEpubHash(parsed.data.epubHash, `${parsed.data.title || ''}-${Date.now()}`);
    const filePath = req.file
      ? path.relative(config.uploadsDir, req.file.path).replace(/\\/g, '/')
      : (isSafeRelativePath(parsed.data.filePath || '') ? parsed.data.filePath : null);

    targetBook = await prisma.book.create({
      data: {
        epubHash: fallbackHash,
        title: parsed.data.title || 'Untitled',
        author: parsed.data.author || null,
        language: parsed.data.language || null,
        cover: parsed.data.cover || null,
        filePath
      }
    });
  } else if (req.file && targetBook.filePath) {
    const abs = path.resolve(config.uploadsDir, targetBook.filePath);
    try {
      fs.unlinkSync(abs);
    } catch {
      // ignore missing
    }
    targetBook = await prisma.book.update({
      where: { id: targetBook.id },
      data: {
        filePath: path.relative(config.uploadsDir, req.file.path).replace(/\\/g, '/'),
        title: parsed.data.title || targetBook.title,
        author: parsed.data.author || targetBook.author,
        language: parsed.data.language || targetBook.language,
        cover: parsed.data.cover || targetBook.cover
      }
    });
  }

  const userBook = await prisma.userBook.upsert({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId: targetBook.id
      }
    },
    update: {},
    create: {
      userId: req.auth.userId,
      bookId: targetBook.id,
      status: 'TO_READ',
      progressPercent: 0,
      progressCfi: null,
      lastOpenedAt: null
    }
  });

  const baseUrl = getBaseUrl(req);
  return res.status(201).json({
    book: toBookResponse({ ...targetBook, userBooks: [userBook] }, req.auth.userId, baseUrl)
  });
});

app.get('/books/:bookId', requireAuth, requireBookAccess, async (req, res) => {
  const book = await prisma.book.findUnique({
    where: { id: req.params.bookId },
    include: includeBookGraph
  });
  if (!book) return res.status(404).json({ error: 'Book not found' });
  return res.json({ book: toBookResponse(book, req.auth.userId, getBaseUrl(req)) });
});

app.get('/books/:bookId/file', requireAuth, requireBookAccess, async (req, res) => {
  const book = await prisma.book.findUnique({ where: { id: req.params.bookId } });
  if (!book || !book.filePath) return res.status(404).json({ error: 'File not found' });
  if (!isSafeRelativePath(book.filePath)) return res.status(400).json({ error: 'Invalid file path' });
  const absolutePath = path.resolve(config.uploadsDir, book.filePath);
  if (!absolutePath.startsWith(path.resolve(config.uploadsDir))) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  return res.sendFile(absolutePath);
});

app.patch('/books/:bookId/progress', requireAuth, requireBookAccess, async (req, res) => {
  const schema = z.object({
    progressPercent: z.number().min(0).max(100),
    progressCfi: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const updated = await prisma.userBook.update({
    where: { id: req.userBook.id },
    data: {
      progressPercent: clampPercent(parsed.data.progressPercent),
      progressCfi: parsed.data.progressCfi || null,
      status: statusFromProgress(parsed.data.progressPercent),
      lastOpenedAt: new Date()
    },
    include: { book: true }
  });

  return res.json({
    book: toBookResponse({ ...updated.book, userBooks: [updated] }, req.auth.userId, getBaseUrl(req))
  });
});

app.get('/books/:bookId/highlights', requireAuth, requireBookAccess, async (req, res) => {
  const highlights = await prisma.highlight.findMany({
    where: { bookId: req.params.bookId },
    include: {
      createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
  return res.json({ highlights });
});

app.post('/books/:bookId/highlights', requireAuth, requireBookAccess, async (req, res) => {
  const schema = z.object({
    cfiRange: z.string().min(1),
    text: z.string().min(1),
    note: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    contextPrefix: z.string().optional().nullable(),
    contextSuffix: z.string().optional().nullable(),
    chapterHref: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  await prisma.highlight.upsert({
    where: {
      bookId_cfiRange_createdByUserId: {
        bookId: req.params.bookId,
        cfiRange: parsed.data.cfiRange,
        createdByUserId: req.auth.userId
      }
    },
    update: {
      text: parsed.data.text,
      note: parsed.data.note || null,
      color: parsed.data.color || null,
      contextPrefix: parsed.data.contextPrefix || null,
      contextSuffix: parsed.data.contextSuffix || null,
      chapterHref: parsed.data.chapterHref || null
    },
    create: {
      bookId: req.params.bookId,
      createdByUserId: req.auth.userId,
      cfiRange: parsed.data.cfiRange,
      text: parsed.data.text,
      note: parsed.data.note || null,
      color: parsed.data.color || null,
      contextPrefix: parsed.data.contextPrefix || null,
      contextSuffix: parsed.data.contextSuffix || null,
      chapterHref: parsed.data.chapterHref || null
    }
  });

  const highlights = await prisma.highlight.findMany({
    where: { bookId: req.params.bookId },
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' }
  });

  return res.status(201).json({ highlights });
});

app.patch('/highlights/:highlightId', requireAuth, async (req, res) => {
  const schema = z.object({
    note: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    text: z.string().optional(),
    contextPrefix: z.string().optional().nullable(),
    contextSuffix: z.string().optional().nullable(),
    chapterHref: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const existing = await prisma.highlight.findUnique({ where: { id: req.params.highlightId } });
  if (!existing) return res.status(404).json({ error: 'Highlight not found' });
  if (existing.createdByUserId !== req.auth.userId) {
    return res.status(403).json({ error: 'You can edit only your own highlights' });
  }

  const access = await prisma.userBook.findUnique({
    where: { userId_bookId: { userId: req.auth.userId, bookId: existing.bookId } }
  });
  if (!access) return res.status(403).json({ error: 'No access to this book' });

  await prisma.highlight.update({
    where: { id: existing.id },
    data: {
      note: parsed.data.note === undefined ? existing.note : parsed.data.note,
      color: parsed.data.color === undefined ? existing.color : parsed.data.color,
      text: parsed.data.text === undefined ? existing.text : parsed.data.text,
      contextPrefix: parsed.data.contextPrefix === undefined ? existing.contextPrefix : parsed.data.contextPrefix,
      contextSuffix: parsed.data.contextSuffix === undefined ? existing.contextSuffix : parsed.data.contextSuffix,
      chapterHref: parsed.data.chapterHref === undefined ? existing.chapterHref : parsed.data.chapterHref
    }
  });

  const highlights = await prisma.highlight.findMany({
    where: { bookId: existing.bookId },
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' }
  });

  return res.json({ highlights });
});

app.delete('/highlights/:highlightId', requireAuth, async (req, res) => {
  const existing = await prisma.highlight.findUnique({ where: { id: req.params.highlightId } });
  if (!existing) return res.status(404).json({ error: 'Highlight not found' });
  if (existing.createdByUserId !== req.auth.userId) {
    return res.status(403).json({ error: 'You can delete only your own highlights' });
  }

  await prisma.highlight.delete({ where: { id: existing.id } });
  const highlights = await prisma.highlight.findMany({
    where: { bookId: existing.bookId },
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' }
  });

  return res.json({ highlights });
});

app.get('/books/:bookId/notes', requireAuth, requireBookAccess, async (req, res) => {
  const notes = await prisma.note.findMany({
    where: { bookId: req.params.bookId },
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' }
  });
  return res.json({ notes });
});

app.post('/books/:bookId/notes', requireAuth, requireBookAccess, async (req, res) => {
  const schema = z.object({
    text: z.string().min(1),
    cfi: z.string().optional().nullable(),
    message: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const note = await prisma.note.create({
    data: {
      bookId: req.params.bookId,
      createdByUserId: req.auth.userId,
      text: parsed.data.text,
      cfi: parsed.data.cfi || null,
      message: parsed.data.message || null
    },
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } }
  });

  return res.status(201).json({ note });
});

app.patch('/notes/:noteId', requireAuth, async (req, res) => {
  const schema = z.object({
    text: z.string().min(1).optional(),
    cfi: z.string().optional().nullable(),
    message: z.string().optional().nullable()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const existing = await prisma.note.findUnique({ where: { id: req.params.noteId } });
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  if (existing.createdByUserId !== req.auth.userId) {
    return res.status(403).json({ error: 'You can edit only your own notes' });
  }

  const note = await prisma.note.update({
    where: { id: existing.id },
    data: {
      text: parsed.data.text === undefined ? existing.text : parsed.data.text,
      cfi: parsed.data.cfi === undefined ? existing.cfi : parsed.data.cfi,
      message: parsed.data.message === undefined ? existing.message : parsed.data.message
    },
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } }
  });

  return res.json({ note });
});

app.delete('/notes/:noteId', requireAuth, async (req, res) => {
  const existing = await prisma.note.findUnique({ where: { id: req.params.noteId } });
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  if (existing.createdByUserId !== req.auth.userId) {
    return res.status(403).json({ error: 'You can delete only your own notes' });
  }

  await prisma.note.delete({ where: { id: existing.id } });
  return res.json({ ok: true });
});

app.post('/shares/books', requireAuth, async (req, res) => {
  const schema = z.object({
    bookId: z.string().optional(),
    epubHash: z.string().optional(),
    toEmail: z.string().email(),
    message: z.string().optional()
  }).refine((v) => !!v.bookId || !!v.epubHash, {
    message: 'bookId or epubHash is required'
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  let book = null;
  if (parsed.data.bookId) book = await prisma.book.findUnique({ where: { id: parsed.data.bookId } });
  if (!book && parsed.data.epubHash) book = await prisma.book.findUnique({ where: { epubHash: parsed.data.epubHash } });
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const senderAccess = await prisma.userBook.findUnique({
    where: { userId_bookId: { userId: req.auth.userId, bookId: book.id } }
  });
  if (!senderAccess) return res.status(403).json({ error: 'No access to this book' });

  const toEmail = parsed.data.toEmail.toLowerCase().trim();
  const recipient = await prisma.user.findUnique({ where: { email: toEmail } });
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
  if (recipient.id === req.auth.userId) return res.status(400).json({ error: 'Cannot share with yourself' });

  const share = await prisma.bookShare.upsert({
    where: {
      bookId_fromUserId_toUserId: {
        bookId: book.id,
        fromUserId: req.auth.userId,
        toUserId: recipient.id
      }
    },
    update: {
      status: 'PENDING',
      acceptedAt: null,
      message: parsed.data.message || null
    },
    create: {
      bookId: book.id,
      fromUserId: req.auth.userId,
      toUserId: recipient.id,
      message: parsed.data.message || null,
      status: 'PENDING'
    },
    include: includeShareGraph
  });

  return res.status(201).json({ share });
});

app.get('/shares/inbox', requireAuth, async (req, res) => {
  const shares = await prisma.bookShare.findMany({
    where: {
      toUserId: req.auth.userId,
      status: 'PENDING'
    },
    include: includeShareGraph,
    orderBy: { createdAt: 'desc' }
  });

  return res.json({ shares });
});

app.post('/shares/:shareId/accept', requireAuth, async (req, res) => {
  const share = await prisma.bookShare.findUnique({
    where: { id: req.params.shareId },
    include: includeShareGraph
  });
  if (!share) return res.status(404).json({ error: 'Share not found' });
  if (share.toUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (share.status === 'REJECTED') return res.status(400).json({ error: 'Share rejected' });

  const accepted = await prisma.$transaction(async (tx) => {
    const next = await tx.bookShare.update({
      where: { id: share.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: share.acceptedAt || new Date()
      },
      include: includeShareGraph
    });

    await tx.userBook.upsert({
      where: {
        userId_bookId: {
          userId: req.auth.userId,
          bookId: share.bookId
        }
      },
      update: {},
      create: {
        userId: req.auth.userId,
        bookId: share.bookId,
        status: 'TO_READ',
        progressPercent: 0,
        progressCfi: null,
        lastOpenedAt: null
      }
    });

    return next;
  });

  return res.json({ share: accepted });
});

app.post('/shares/:shareId/reject', requireAuth, async (req, res) => {
  const share = await prisma.bookShare.findUnique({ where: { id: req.params.shareId } });
  if (!share) return res.status(404).json({ error: 'Share not found' });
  if (share.toUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });

  const updated = await prisma.bookShare.update({
    where: { id: share.id },
    data: { status: 'REJECTED' },
    include: includeShareGraph
  });

  return res.json({ share: updated });
});

app.use((err, _req, res) => {
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  await prisma.$connect();
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Ariadne server listening on 0.0.0.0:${config.port}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
