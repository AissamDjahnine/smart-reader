import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
import {
  LOAN_EXPORT_WINDOW_DAYS,
  ensureBookEntitlement,
  resolveLoanAnnotationScope,
  buildAnnotationAccessWhere,
  requireBorrowCapability,
  expireLoanIfNeeded
} from './loanPolicy.js';
import { formatNotification, toJson, upsertUserNotification } from './notifications.js';

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

const includeLoanGraph = {
  book: true,
  lender: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
  borrower: { select: { id: true, email: true, displayName: true, avatarUrl: true } }
};
const TRASH_RETENTION_DAYS = 30;

const toLoanResponse = (loan) => ({
  id: loan.id,
  status: loan.status,
  message: loan.message || null,
  durationDays: loan.durationDays,
  graceDays: loan.graceDays,
  requestedAt: loan.requestedAt,
  acceptedAt: loan.acceptedAt || null,
  dueAt: loan.dueAt || null,
  returnedAt: loan.returnedAt || null,
  revokedAt: loan.revokedAt || null,
  expiredAt: loan.expiredAt || null,
  exportAvailableUntil: loan.exportAvailableUntil || null,
  createdUserBookOnAccept: Boolean(loan.createdUserBookOnAccept),
  permissions: {
    canAddHighlights: loan.canAddHighlights,
    canEditHighlights: loan.canEditHighlights,
    canAddNotes: loan.canAddNotes,
    canEditNotes: loan.canEditNotes,
    annotationVisibility: loan.annotationVisibility,
    shareLenderAnnotations: Boolean(loan.shareLenderAnnotations)
  },
  book: loan.book ? toBookResponse({ ...loan.book, userBooks: [] }, null, '') : null,
  lender: loan.lender ? toUserResponse(loan.lender) : null,
  borrower: loan.borrower ? toUserResponse(loan.borrower) : null
});

const buildLoanAuditDetails = (value = null) => {
  if (!value) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const addLoanAuditEvent = async (tx, payload) => {
  const {
    loanId,
    actorUserId = null,
    targetUserId = null,
    action,
    details = null
  } = payload;
  await tx.loanAuditEvent.create({
    data: {
      loanId,
      actorUserId,
      targetUserId,
      action,
      detailsJson: buildLoanAuditDetails(details)
    }
  });
};


const toUserResponse = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username || null,
  displayName: user.displayName || null,
  avatarUrl: user.avatarUrl || null,
  loanReminderDays: Number.isInteger(user.loanReminderDays) ? user.loanReminderDays : 3
});

const normalizeUsername = (value = '') => {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return normalized.slice(0, 32);
};

const buildUsernameBaseFromUser = ({ displayName = '', email = '' }) => {
  const fromDisplayName = normalizeUsername(displayName);
  if (fromDisplayName.length >= 3) return fromDisplayName;
  const emailLocal = String(email || '').split('@')[0] || 'reader';
  const fromEmail = normalizeUsername(emailLocal);
  if (fromEmail.length >= 3) return fromEmail;
  return `reader-${Math.random().toString(36).slice(2, 8)}`;
};

const ensureUniqueUsername = async (db, preferredUsername, excludeUserId = null) => {
  const baseRaw = normalizeUsername(preferredUsername);
  const base = baseRaw.length >= 3 ? baseRaw : `reader-${Math.random().toString(36).slice(2, 8)}`;
  let candidate = base;
  let suffix = 1;

  while (suffix <= 999) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true }
    });
    if (!existing || (excludeUserId && existing.id === excludeUserId)) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (candidate.length > 32) {
      candidate = `${base.slice(0, Math.max(3, 32 - String(suffix).length - 1))}-${suffix}`;
    }
  }

  return `${base.slice(0, 24)}-${Date.now().toString(36).slice(-6)}`;
};

const toFriendRequestResponse = (request) => ({
  id: request.id,
  status: request.status,
  createdAt: request.createdAt,
  updatedAt: request.updatedAt,
  respondedAt: request.respondedAt || null,
  fromUser: request.fromUser ? toUserResponse(request.fromUser) : null,
  toUser: request.toUser ? toUserResponse(request.toUser) : null
});

const toFriendshipResponse = ({ friendship, currentUserId }) => {
  const friendUser = friendship.userAId === currentUserId ? friendship.userB : friendship.userA;
  return {
    id: friendship.id,
    createdAt: friendship.createdAt,
    friend: friendUser ? toUserResponse(friendUser) : null
  };
};

const sortPair = (leftUserId, rightUserId) => (
  leftUserId < rightUserId ? [leftUserId, rightUserId] : [rightUserId, leftUserId]
);

const areUsersBlocked = async (db, leftUserId, rightUserId) => {
  if (!leftUserId || !rightUserId) return false;
  const block = await db.friendBlock.findFirst({
    where: {
      OR: [
        { blockerUserId: leftUserId, blockedUserId: rightUserId },
        { blockerUserId: rightUserId, blockedUserId: leftUserId }
      ]
    },
    select: { id: true }
  });
  return Boolean(block);
};

const ensureNotBlocked = async (db, leftUserId, rightUserId) => {
  const blocked = await areUsersBlocked(db, leftUserId, rightUserId);
  if (blocked) {
    return {
      ok: false,
      status: 403,
      error: 'Action blocked due to a block relationship'
    };
  }
  return { ok: true };
};

const ensureFriendPrivacySetting = async (db, ownerUserId, friendUserId) => {
  if (!ownerUserId || !friendUserId || ownerUserId === friendUserId) return null;
  const existing = await db.friendPrivacySetting.findUnique({
    where: {
      ownerUserId_friendUserId: {
        ownerUserId,
        friendUserId
      }
    }
  });
  if (existing) return existing;
  return db.friendPrivacySetting.create({
    data: {
      ownerUserId,
      friendUserId
    }
  });
};

const getFriendshipByUsers = async (db, leftUserId, rightUserId) => {
  const [userAId, userBId] = sortPair(leftUserId, rightUserId);
  return db.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } }
  });
};

const requireFriendship = async (db, leftUserId, rightUserId) => {
  const friendship = await getFriendshipByUsers(db, leftUserId, rightUserId);
  if (!friendship) {
    return {
      ok: false,
      status: 403,
      error: 'Friendship required'
    };
  }
  return { ok: true, friendship };
};

const getFriendPrivacyForViewer = async (db, ownerUserId, viewerUserId) => {
  const setting = await ensureFriendPrivacySetting(db, ownerUserId, viewerUserId);
  return {
    canViewLibrary: Boolean(setting?.canViewLibrary ?? true),
    canBorrow: Boolean(setting?.canBorrow ?? true),
    canViewActivity: Boolean(setting?.canViewActivity ?? true)
  };
};

const parseExpectedRevision = (req) => {
  const header = req.headers['if-match-revision'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
};

const ensureLoanTemplate = async (db, userId) => {
  const existing = await db.userLoanTemplate.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.userLoanTemplate.create({
    data: {
      userId
    }
  });
};

const toTemplateResponse = (row) => ({
  id: row.id,
  name: row.name,
  durationDays: row.durationDays,
  graceDays: row.graceDays,
  remindBeforeDays: row.remindBeforeDays,
  permissions: {
    canAddHighlights: row.canAddHighlights,
    canEditHighlights: row.canEditHighlights,
    canAddNotes: row.canAddNotes,
    canEditNotes: row.canEditNotes,
    annotationVisibility: row.annotationVisibility,
    shareLenderAnnotations: Boolean(row.shareLenderAnnotations)
  }
});

const toLoanReviewMessageResponse = (row) => ({
  id: row.id,
  loanId: row.loanId,
  rating: row.rating,
  comment: row.comment,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  author: row.author ? toUserResponse(row.author) : null
});

const parseJsonSafe = (value = null) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

const toLoanAuditEventResponse = (event) => ({
  id: event.id,
  action: event.action,
  createdAt: event.createdAt,
  details: parseJsonSafe(event.detailsJson),
  actorUser: event.actorUser ? toUserResponse(event.actorUser) : null,
  targetUser: event.targetUser ? toUserResponse(event.targetUser) : null,
  loan: event.loan ? toLoanResponse(event.loan) : null
});

const ensureLoanParticipant = (loan, userId) => loan && (loan.borrowerId === userId || loan.lenderId === userId);

const getLoanDiscussionSummary = async (db, loanId, userId) => {
  const [lastReadRow, latestMessage] = await Promise.all([
    db.loanDiscussionReadState.findUnique({
      where: { loanId_userId: { loanId, userId } },
      select: { lastReadAt: true }
    }),
    db.loanReviewMessage.findFirst({
      where: { loanId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    })
  ]);

  const unreadCount = await db.loanReviewMessage.count({
    where: {
      loanId,
      authorUserId: { not: userId },
      ...(lastReadRow?.lastReadAt ? { createdAt: { gt: lastReadRow.lastReadAt } } : {})
    }
  });

  return {
    unreadCount,
    lastReadAt: lastReadRow?.lastReadAt || null,
    lastMessageAt: latestMessage?.createdAt || null
  };
};

const startOfDayUtc = (value = new Date()) => {
  const day = new Date(value);
  day.setUTCHours(0, 0, 0, 0);
  return day;
};

const computeStreakDaysFromRows = (rows = []) => {
  const daySet = new Set(
    rows
      .map((row) => startOfDayUtc(row?.dayDate).getTime())
      .filter((value) => Number.isFinite(value))
  );
  if (!daySet.size) return 0;

  let streak = 0;
  let cursor = startOfDayUtc(new Date()).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  while (daySet.has(cursor)) {
    streak += 1;
    cursor -= oneDayMs;
  }
  if (streak > 0) return streak;
  cursor = startOfDayUtc(new Date(Date.now() - oneDayMs)).getTime();
  while (daySet.has(cursor)) {
    streak += 1;
    cursor -= oneDayMs;
  }
  return streak;
};

const emitLoanNotification = async (db, payload) => {
  const {
    userId,
    eventKey,
    kind,
    title,
    message,
    loanId = null,
    actionType = null,
    actionTargetId = null,
    meta = null
  } = payload;
  await upsertUserNotification(db, {
    userId,
    eventKey,
    loanId,
    kind,
    title,
    message,
    payloadJson: toJson(meta),
    actionType,
    actionTargetId
  });
};

const purgeExpiredUserTrash = async (db, userId, retentionDays = TRASH_RETENTION_DAYS) => {
  if (!userId) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const { count } = await db.userBook.deleteMany({
    where: {
      userId,
      isDeleted: true,
      deletedAt: { not: null, lte: cutoff }
    }
  });
  return count || 0;
};

const toRenewalResponse = (row) => ({
  id: row.id,
  loanId: row.loanId,
  status: row.status,
  requestedExtraDays: row.requestedExtraDays,
  previousDueAt: row.previousDueAt,
  proposedDueAt: row.proposedDueAt,
  decisionMessage: row.decisionMessage || null,
  requestedAt: row.requestedAt,
  reviewedAt: row.reviewedAt || null,
  requester: row.requester ? toUserResponse(row.requester) : null,
  reviewer: row.reviewer ? toUserResponse(row.reviewer) : null,
  lender: row.lender ? toUserResponse(row.lender) : null,
  borrower: row.borrower ? toUserResponse(row.borrower) : null,
  loan: row.loan ? toLoanResponse(row.loan) : null
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
  const username = await ensureUniqueUsername(prisma, buildUsernameBaseFromUser({
    displayName: parsed.data.displayName,
    email
  }));
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      username,
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
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true, createdAt: true }
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: toUserResponse(user) });
});

app.get('/users/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.userId },
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true }
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ user: toUserResponse(user) });
});

app.patch('/users/me', requireAuth, async (req, res) => {
  const schema = z.object({
    displayName: z.string().min(1).max(120),
    loanReminderDays: z.number().int().min(0).max(30).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: {
      displayName: parsed.data.displayName.trim(),
      loanReminderDays: parsed.data.loanReminderDays === undefined ? undefined : parsed.data.loanReminderDays
    },
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true }
  });
  return res.json({ user: toUserResponse(user) });
});

app.patch('/users/me/username', requireAuth, async (req, res) => {
  const schema = z.object({
    username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload. Username must be 3-32 chars using letters, numbers, dot, underscore, or dash.'
    });
  }

  const requestedUsername = normalizeUsername(parsed.data.username);
  if (requestedUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters after normalization' });
  }

  const existing = await prisma.user.findUnique({
    where: { username: requestedUsername },
    select: { id: true }
  });
  if (existing && existing.id !== req.auth.userId) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: { username: requestedUsername },
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true }
  });

  return res.json({ user: toUserResponse(user) });
});

app.get('/users/search', requireAuth, async (req, res) => {
  const query = String(req.query?.q || '').trim();
  if (!query) return res.json({ users: [] });

  const blockedRows = await prisma.friendBlock.findMany({
    where: {
      OR: [
        { blockerUserId: req.auth.userId },
        { blockedUserId: req.auth.userId }
      ]
    },
    select: {
      blockerUserId: true,
      blockedUserId: true
    }
  });
  const blockedUserIds = new Set();
  blockedRows.forEach((row) => {
    if (row.blockerUserId !== req.auth.userId) blockedUserIds.add(row.blockerUserId);
    if (row.blockedUserId !== req.auth.userId) blockedUserIds.add(row.blockedUserId);
  });

  const users = await prisma.user.findMany({
    where: {
      id: { not: req.auth.userId, notIn: [...blockedUserIds] },
      OR: [
        { id: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
        { username: { contains: query, mode: 'insensitive' } }
      ]
    },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      loanReminderDays: true
    },
    orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
    take: 20
  });

  return res.json({ users: users.map(toUserResponse) });
});

app.post('/users/me/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Avatar file is required' });
  const mime = (req.file.mimetype || '').toLowerCase();
  if (!mime.startsWith('image/')) return res.status(400).json({ error: 'Avatar must be an image' });
  const avatarUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;

  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: { avatarUrl },
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true }
  });
  return res.json({ user: toUserResponse(user) });
});

app.post('/friends/requests', requireAuth, async (req, res) => {
  const schema = z.object({
    toUserId: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const fromUserId = req.auth.userId;
  const toUserId = parsed.data.toUserId;
  if (fromUserId === toUserId) {
    return res.status(400).json({ error: 'Cannot send friend request to yourself' });
  }

  const recipient = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true }
  });
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  const blockCheck = await ensureNotBlocked(prisma, fromUserId, toUserId);
  if (!blockCheck.ok) return res.status(blockCheck.status).json({ error: blockCheck.error });

  const [userAId, userBId] = sortPair(fromUserId, toUserId);
  const existingFriendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true }
  });
  if (existingFriendship) return res.status(409).json({ error: 'Already friends' });

  const existingRequest = await prisma.friendRequest.findUnique({
    where: {
      fromUserId_toUserId: {
        fromUserId,
        toUserId
      }
    }
  });
  if (existingRequest && existingRequest.status === 'PENDING') {
    return res.status(409).json({ error: 'Friend request already pending' });
  }

  const inversePendingRequest = await prisma.friendRequest.findUnique({
    where: {
      fromUserId_toUserId: {
        fromUserId: toUserId,
        toUserId: fromUserId
      }
    }
  });
  if (inversePendingRequest && inversePendingRequest.status === 'PENDING') {
    return res.status(409).json({ error: 'This user already sent you a friend request' });
  }

  const friendRequest = existingRequest
    ? await prisma.friendRequest.update({
      where: { id: existingRequest.id },
      data: {
        status: 'PENDING',
        respondedAt: null
      },
      include: {
        fromUser: true,
        toUser: true
      }
    })
    : await prisma.friendRequest.create({
      data: {
        fromUserId,
        toUserId,
        status: 'PENDING'
      },
      include: {
        fromUser: true,
        toUser: true
      }
    });

  await emitLoanNotification(prisma, {
    userId: toUserId,
    eventKey: `friend-request-${friendRequest.id}-${new Date(friendRequest.updatedAt || friendRequest.createdAt).toISOString()}`,
    kind: 'friend-request',
    title: 'New friend request',
    message: `${friendRequest.fromUser?.displayName || friendRequest.fromUser?.email || 'A reader'} sent you a friend request.`,
    actionType: 'open-friends',
    actionTargetId: friendRequest.fromUserId,
    meta: {
      requestId: friendRequest.id
    }
  });

  return res.status(201).json({
    request: toFriendRequestResponse(friendRequest)
  });
});

app.get('/friends/requests/incoming', requireAuth, async (req, res) => {
  const requests = await prisma.friendRequest.findMany({
    where: {
      toUserId: req.auth.userId,
      status: 'PENDING'
    },
    include: {
      fromUser: true,
      toUser: true
    },
    orderBy: { createdAt: 'desc' }
  });
  return res.json({ requests: requests.map(toFriendRequestResponse) });
});

app.get('/friends/requests/outgoing', requireAuth, async (req, res) => {
  const requests = await prisma.friendRequest.findMany({
    where: {
      fromUserId: req.auth.userId,
      status: 'PENDING'
    },
    include: {
      fromUser: true,
      toUser: true
    },
    orderBy: { createdAt: 'desc' }
  });
  return res.json({ requests: requests.map(toFriendRequestResponse) });
});

app.post('/friends/requests/:requestId/accept', requireAuth, async (req, res) => {
  const request = await prisma.friendRequest.findUnique({
    where: { id: req.params.requestId },
    include: { fromUser: true, toUser: true }
  });
  if (!request) return res.status(404).json({ error: 'Friend request not found' });
  if (request.toUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'PENDING') return res.status(409).json({ error: 'Friend request is not pending' });

  const blockCheck = await ensureNotBlocked(prisma, request.fromUserId, request.toUserId);
  if (!blockCheck.ok) return res.status(blockCheck.status).json({ error: blockCheck.error });

  const [userAId, userBId] = sortPair(request.fromUserId, request.toUserId);
  const result = await prisma.$transaction(async (tx) => {
    const friendship = await tx.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId },
      include: {
        userA: true,
        userB: true
      }
    });
    const updatedRequest = await tx.friendRequest.update({
      where: { id: request.id },
      data: {
        status: 'ACCEPTED',
        respondedAt: new Date()
      },
      include: {
        fromUser: true,
        toUser: true
      }
    });
    await ensureFriendPrivacySetting(tx, request.fromUserId, request.toUserId);
    await ensureFriendPrivacySetting(tx, request.toUserId, request.fromUserId);
    return { friendship, request: updatedRequest };
  });

  await emitLoanNotification(prisma, {
    userId: result.request.fromUserId,
    eventKey: `friend-request-accepted-${result.request.id}-${new Date(result.request.respondedAt || result.request.updatedAt).toISOString()}`,
    kind: 'friend-request-accepted',
    title: 'Friend request accepted',
    message: `${result.request.toUser?.displayName || result.request.toUser?.email || 'A reader'} accepted your friend request.`,
    actionType: 'open-friends',
    actionTargetId: result.request.toUserId,
    meta: {
      requestId: result.request.id
    }
  });

  return res.json({
    request: toFriendRequestResponse(result.request),
    friendship: toFriendshipResponse({ friendship: result.friendship, currentUserId: req.auth.userId })
  });
});

app.post('/friends/requests/:requestId/reject', requireAuth, async (req, res) => {
  const request = await prisma.friendRequest.findUnique({
    where: { id: req.params.requestId },
    include: { fromUser: true, toUser: true }
  });
  if (!request) return res.status(404).json({ error: 'Friend request not found' });
  if (request.toUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'PENDING') return res.status(409).json({ error: 'Friend request is not pending' });

  const updated = await prisma.friendRequest.update({
    where: { id: request.id },
    data: {
      status: 'REJECTED',
      respondedAt: new Date()
    },
    include: { fromUser: true, toUser: true }
  });

  await emitLoanNotification(prisma, {
    userId: updated.fromUserId,
    eventKey: `friend-request-rejected-${updated.id}-${new Date(updated.respondedAt || updated.updatedAt).toISOString()}`,
    kind: 'friend-request-rejected',
    title: 'Friend request declined',
    message: `${updated.toUser?.displayName || updated.toUser?.email || 'A reader'} declined your friend request.`,
    actionType: 'open-friends',
    actionTargetId: updated.toUserId,
    meta: {
      requestId: updated.id
    }
  });

  return res.json({ request: toFriendRequestResponse(updated) });
});

app.post('/friends/requests/:requestId/cancel', requireAuth, async (req, res) => {
  const request = await prisma.friendRequest.findUnique({
    where: { id: req.params.requestId },
    include: { fromUser: true, toUser: true }
  });
  if (!request) return res.status(404).json({ error: 'Friend request not found' });
  if (request.fromUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (request.status !== 'PENDING') return res.status(409).json({ error: 'Friend request is not pending' });

  const updated = await prisma.friendRequest.update({
    where: { id: request.id },
    data: {
      status: 'CANCELED',
      respondedAt: new Date()
    },
    include: { fromUser: true, toUser: true }
  });

  await emitLoanNotification(prisma, {
    userId: updated.toUserId,
    eventKey: `friend-request-cancelled-${updated.id}-${new Date(updated.respondedAt || updated.updatedAt).toISOString()}`,
    kind: 'friend-request-cancelled',
    title: 'Friend request canceled',
    message: `${updated.fromUser?.displayName || updated.fromUser?.email || 'A reader'} canceled a friend request.`,
    actionType: 'open-friends',
    actionTargetId: updated.fromUserId,
    meta: {
      requestId: updated.id
    }
  });

  return res.json({ request: toFriendRequestResponse(updated) });
});

app.get('/friends', requireAuth, async (req, res) => {
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userAId: req.auth.userId },
        { userBId: req.auth.userId }
      ]
    },
    include: {
      userA: true,
      userB: true
    },
    orderBy: { createdAt: 'desc' }
  });

  const friends = await Promise.all(
    friendships.map(async (friendship) => {
      const shaped = toFriendshipResponse({ friendship, currentUserId: req.auth.userId });
      const friendId = shaped.friend?.id;
      if (!friendId) return shaped;
      const permissions = await getFriendPrivacyForViewer(prisma, friendId, req.auth.userId);
      return {
        ...shaped,
        permissions
      };
    })
  );

  return res.json({
    friends
  });
});

app.get('/friends/leaderboard', requireAuth, async (req, res) => {
  const metricSchema = z.enum(['pagesRead', 'readingMinutes', 'finishedBooks', 'inProgressBooks', 'streakDays']);
  const metricParsed = metricSchema.safeParse(req.query?.metric || 'pagesRead');
  const metric = metricParsed.success ? metricParsed.data : 'pagesRead';

  const myId = req.auth.userId;
  const directEdges = await prisma.friendship.findMany({
    where: {
      OR: [{ userAId: myId }, { userBId: myId }]
    },
    select: { userAId: true, userBId: true }
  });

  const directFriendIds = new Set();
  directEdges.forEach((edge) => {
    if (edge.userAId !== myId) directFriendIds.add(edge.userAId);
    if (edge.userBId !== myId) directFriendIds.add(edge.userBId);
  });

  const viaMap = new Map();
  if (directFriendIds.size > 0) {
    const secondEdges = await prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: { in: [...directFriendIds] } },
          { userBId: { in: [...directFriendIds] } }
        ]
      },
      select: { userAId: true, userBId: true }
    });

    secondEdges.forEach((edge) => {
      if (directFriendIds.has(edge.userAId) && edge.userBId !== myId && !directFriendIds.has(edge.userBId)) {
        const list = viaMap.get(edge.userBId) || [];
        list.push(edge.userAId);
        viaMap.set(edge.userBId, [...new Set(list)]);
      }
      if (directFriendIds.has(edge.userBId) && edge.userAId !== myId && !directFriendIds.has(edge.userAId)) {
        const list = viaMap.get(edge.userAId) || [];
        list.push(edge.userBId);
        viaMap.set(edge.userAId, [...new Set(list)]);
      }
    });
  }

  const blockedRows = await prisma.friendBlock.findMany({
    where: {
      OR: [{ blockerUserId: myId }, { blockedUserId: myId }]
    },
    select: { blockerUserId: true, blockedUserId: true }
  });
  const blockedUserIds = new Set();
  blockedRows.forEach((row) => {
    if (row.blockerUserId !== myId) blockedUserIds.add(row.blockerUserId);
    if (row.blockedUserId !== myId) blockedUserIds.add(row.blockedUserId);
  });

  const candidateIds = new Set([myId, ...directFriendIds, ...viaMap.keys()]);
  blockedUserIds.forEach((id) => candidateIds.delete(id));
  const ids = [...candidateIds];

  const [users, readingStats, readingDays, bookStatusRows] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true }
    }),
    prisma.userReadingStat.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, totalReadingSeconds: true, totalPagesRead: true }
    }),
    prisma.userReadingDay.findMany({
      where: {
        userId: { in: ids },
        readingSeconds: { gt: 0 }
      },
      select: { userId: true, dayDate: true }
    }),
    prisma.userBook.groupBy({
      by: ['userId', 'status'],
      where: {
        userId: { in: ids },
        isDeleted: false
      },
      _count: { _all: true }
    })
  ]);

  const userById = new Map(users.map((user) => [user.id, user]));
  const statByUserId = new Map(readingStats.map((row) => [row.userId, row]));
  const readingDaysByUserId = new Map();
  readingDays.forEach((row) => {
    const list = readingDaysByUserId.get(row.userId) || [];
    list.push(row);
    readingDaysByUserId.set(row.userId, list);
  });
  const statusCountsByUserId = new Map();
  bookStatusRows.forEach((row) => {
    const existing = statusCountsByUserId.get(row.userId) || { FINISHED: 0, IN_PROGRESS: 0 };
    existing[row.status] = row._count?._all || 0;
    statusCountsByUserId.set(row.userId, existing);
  });

  const rows = ids
    .map((userId) => {
      const user = userById.get(userId);
      if (!user) return null;
      const stat = statByUserId.get(userId);
      const statusCounts = statusCountsByUserId.get(userId) || { FINISHED: 0, IN_PROGRESS: 0 };
      const minutes = Math.floor(Math.max(0, Number(stat?.totalReadingSeconds || 0)) / 60);
      const finishedBooks = Number(statusCounts.FINISHED || 0);
      const inProgressBooks = Number(statusCounts.IN_PROGRESS || 0);
      const streakDays = computeStreakDaysFromRows(readingDaysByUserId.get(userId) || []);
      const relation = userId === myId ? 'SELF' : (directFriendIds.has(userId) ? 'FRIEND' : 'FRIEND_OF_FRIEND');
      const sharedViaIds = viaMap.get(userId) || [];

      return {
        user: toUserResponse(user),
        relation,
        canAddFriend: relation === 'FRIEND_OF_FRIEND',
        mutualVia: sharedViaIds
          .map((id) => userById.get(id))
          .filter(Boolean)
          .map(toUserResponse),
        metrics: {
          pagesRead: Math.max(
            Math.max(0, Number(stat?.totalPagesRead || 0)),
            0
          ),
          readingMinutes: minutes,
          finishedBooks,
          inProgressBooks,
          streakDays
        }
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const diff = Number(right.metrics?.[metric] || 0) - Number(left.metrics?.[metric] || 0);
      if (diff !== 0) return diff;
      return (left.user?.displayName || left.user?.email || '').localeCompare(right.user?.displayName || right.user?.email || '');
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return res.json({ metric, rows, generatedAt: new Date().toISOString() });
});

app.delete('/friends/:friendUserId', requireAuth, async (req, res) => {
  const friendUserId = req.params.friendUserId;
  if (!friendUserId) return res.status(400).json({ error: 'friendUserId is required' });
  if (friendUserId === req.auth.userId) return res.status(400).json({ error: 'Cannot unfriend yourself' });

  const [userAId, userBId] = sortPair(req.auth.userId, friendUserId);
  await prisma.$transaction(async (tx) => {
    await tx.friendship.deleteMany({
      where: {
        userAId,
        userBId
      }
    });
    await tx.friendPrivacySetting.deleteMany({
      where: {
        OR: [
          { ownerUserId: req.auth.userId, friendUserId },
          { ownerUserId: friendUserId, friendUserId: req.auth.userId }
        ]
      }
    });
  });

  return res.json({ ok: true });
});

app.post('/friends/block', requireAuth, async (req, res) => {
  const schema = z.object({
    userId: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });
  if (parsed.data.userId === req.auth.userId) return res.status(400).json({ error: 'Cannot block yourself' });

  const targetUser = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true }
  });
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  const [userAId, userBId] = sortPair(req.auth.userId, parsed.data.userId);
  await prisma.$transaction(async (tx) => {
    await tx.friendBlock.upsert({
      where: {
        blockerUserId_blockedUserId: {
          blockerUserId: req.auth.userId,
          blockedUserId: parsed.data.userId
        }
      },
      update: {},
      create: {
        blockerUserId: req.auth.userId,
        blockedUserId: parsed.data.userId
      }
    });
    await tx.friendship.deleteMany({
      where: {
        userAId,
        userBId
      }
    });
    await tx.friendRequest.updateMany({
      where: {
        OR: [
          { fromUserId: req.auth.userId, toUserId: parsed.data.userId, status: 'PENDING' },
          { fromUserId: parsed.data.userId, toUserId: req.auth.userId, status: 'PENDING' }
        ]
      },
      data: {
        status: 'CANCELED',
        respondedAt: new Date()
      }
    });
    await tx.friendPrivacySetting.deleteMany({
      where: {
        OR: [
          { ownerUserId: req.auth.userId, friendUserId: parsed.data.userId },
          { ownerUserId: parsed.data.userId, friendUserId: req.auth.userId }
        ]
      }
    });
  });

  return res.json({ ok: true });
});

app.post('/friends/unblock', requireAuth, async (req, res) => {
  const schema = z.object({
    userId: z.string().min(1)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  await prisma.friendBlock.deleteMany({
    where: {
      blockerUserId: req.auth.userId,
      blockedUserId: parsed.data.userId
    }
  });
  return res.json({ ok: true });
});

app.patch('/friends/:friendUserId/privacy', requireAuth, async (req, res) => {
  const friendUserId = req.params.friendUserId;
  if (!friendUserId) return res.status(400).json({ error: 'friendUserId is required' });
  if (friendUserId === req.auth.userId) return res.status(400).json({ error: 'Cannot set privacy for yourself' });

  const schema = z.object({
    canViewLibrary: z.boolean().optional(),
    canBorrow: z.boolean().optional(),
    canViewActivity: z.boolean().optional()
  }).refine((data) => (
    data.canViewLibrary !== undefined || data.canBorrow !== undefined || data.canViewActivity !== undefined
  ), { message: 'At least one privacy field is required' });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const friendshipCheck = await requireFriendship(prisma, req.auth.userId, friendUserId);
  if (!friendshipCheck.ok) return res.status(friendshipCheck.status).json({ error: friendshipCheck.error });

  const updated = await prisma.friendPrivacySetting.upsert({
    where: {
      ownerUserId_friendUserId: {
        ownerUserId: req.auth.userId,
        friendUserId
      }
    },
    update: {
      canViewLibrary: parsed.data.canViewLibrary === undefined ? undefined : parsed.data.canViewLibrary,
      canBorrow: parsed.data.canBorrow === undefined ? undefined : parsed.data.canBorrow,
      canViewActivity: parsed.data.canViewActivity === undefined ? undefined : parsed.data.canViewActivity
    },
    create: {
      ownerUserId: req.auth.userId,
      friendUserId,
      canViewLibrary: parsed.data.canViewLibrary ?? true,
      canBorrow: parsed.data.canBorrow ?? true,
      canViewActivity: parsed.data.canViewActivity ?? true
    }
  });

  return res.json({
    privacy: {
      canViewLibrary: updated.canViewLibrary,
      canBorrow: updated.canBorrow,
      canViewActivity: updated.canViewActivity
    }
  });
});

app.get('/friends/:friendUserId/profile', requireAuth, async (req, res) => {
  const friendUserId = req.params.friendUserId;
  if (!friendUserId) return res.status(400).json({ error: 'friendUserId is required' });
  if (friendUserId === req.auth.userId) return res.status(400).json({ error: 'Use /users/me for your own profile' });

  const friendshipCheck = await requireFriendship(prisma, req.auth.userId, friendUserId);
  if (!friendshipCheck.ok) return res.status(friendshipCheck.status).json({ error: friendshipCheck.error });

  const friend = await prisma.user.findUnique({
    where: { id: friendUserId },
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true }
  });
  if (!friend) return res.status(404).json({ error: 'Friend not found' });

  const [myFriends, friendFriends, friendUserBooks, incomingPrivacy, outgoingPrivacy] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [{ userAId: req.auth.userId }, { userBId: req.auth.userId }]
      },
      select: { userAId: true, userBId: true }
    }),
    prisma.friendship.findMany({
      where: {
        OR: [{ userAId: friendUserId }, { userBId: friendUserId }]
      },
      select: { userAId: true, userBId: true }
    }),
    prisma.userBook.findMany({
      where: {
        userId: friendUserId,
        isDeleted: false
      },
      select: {
        progressPercent: true,
        status: true,
        lastOpenedAt: true
      }
    }),
    prisma.friendPrivacySetting.findUnique({
      where: {
        ownerUserId_friendUserId: {
          ownerUserId: friendUserId,
          friendUserId: req.auth.userId
        }
      }
    }),
    prisma.friendPrivacySetting.findUnique({
      where: {
        ownerUserId_friendUserId: {
          ownerUserId: req.auth.userId,
          friendUserId
        }
      }
    })
  ]);

  const toFriendIdSet = (rows, selfId) => {
    const ids = new Set();
    rows.forEach((row) => {
      const friendId = row.userAId === selfId ? row.userBId : row.userAId;
      if (friendId && friendId !== selfId) ids.add(friendId);
    });
    return ids;
  };
  const myFriendIds = toFriendIdSet(myFriends, req.auth.userId);
  const friendFriendIds = toFriendIdSet(friendFriends, friendUserId);
  let mutualCount = 0;
  friendFriendIds.forEach((id) => {
    if (myFriendIds.has(id)) mutualCount += 1;
  });

  const lastReadAt = friendUserBooks
    .map((row) => row.lastOpenedAt ? new Date(row.lastOpenedAt).getTime() : 0)
    .reduce((max, value) => (value > max ? value : max), 0);
  const startedCount = friendUserBooks.filter((row) => Number(row.progressPercent || 0) > 0).length;
  const finishedCount = friendUserBooks.filter((row) => Number(row.progressPercent || 0) >= 100).length;

  const permissionsForViewer = {
    canViewLibrary: incomingPrivacy?.canViewLibrary ?? true,
    canBorrow: incomingPrivacy?.canBorrow ?? true,
    canViewActivity: incomingPrivacy?.canViewActivity ?? true
  };
  const myPolicyForFriend = {
    canViewLibrary: outgoingPrivacy?.canViewLibrary ?? true,
    canBorrow: outgoingPrivacy?.canBorrow ?? true,
    canViewActivity: outgoingPrivacy?.canViewActivity ?? true
  };

  return res.json({
    profile: {
      user: toUserResponse(friend),
      stats: {
        totalBooks: friendUserBooks.length,
        startedBooks: startedCount,
        finishedBooks: finishedCount,
        lastReadAt: lastReadAt ? new Date(lastReadAt).toISOString() : null,
        mutualFriends: mutualCount
      },
      permissionsForViewer,
      myPolicyForFriend
    }
  });
});

app.get('/friends/:friendUserId/library', requireAuth, async (req, res) => {
  const friendUserId = req.params.friendUserId;
  if (!friendUserId) return res.status(400).json({ error: 'friendUserId is required' });
  const friendshipCheck = await requireFriendship(prisma, req.auth.userId, friendUserId);
  if (!friendshipCheck.ok) return res.status(friendshipCheck.status).json({ error: friendshipCheck.error });

  const permissions = await getFriendPrivacyForViewer(prisma, friendUserId, req.auth.userId);
  if (!permissions.canViewLibrary) return res.status(403).json({ error: 'Friend has hidden their library from you' });

  const rows = await prisma.userBook.findMany({
    where: {
      userId: friendUserId,
      isDeleted: false
    },
    include: { book: true },
    orderBy: [{ lastOpenedAt: 'desc' }, { updatedAt: 'desc' }]
  });

  const books = rows.map((row) => ({
    ...toBookResponse({ ...row.book, userBooks: [row] }, friendUserId, getBaseUrl(req)),
    isBorrowable: Boolean(permissions.canBorrow)
  }));

  return res.json({ books, permissions });
});

app.get('/friends/:friendUserId/history', requireAuth, async (req, res) => {
  const friendUserId = req.params.friendUserId;
  if (!friendUserId) return res.status(400).json({ error: 'friendUserId is required' });
  const friendshipCheck = await requireFriendship(prisma, req.auth.userId, friendUserId);
  if (!friendshipCheck.ok) return res.status(friendshipCheck.status).json({ error: friendshipCheck.error });

  const permissions = await getFriendPrivacyForViewer(prisma, friendUserId, req.auth.userId);
  if (!permissions.canViewActivity) return res.status(403).json({ error: 'Friend has hidden activity from you' });

  const [recentReads, loanEvents] = await Promise.all([
    prisma.userBook.findMany({
      where: { userId: friendUserId, isDeleted: false, lastOpenedAt: { not: null } },
      include: { book: true },
      orderBy: { lastOpenedAt: 'desc' },
      take: 12
    }),
    prisma.loanAuditEvent.findMany({
      where: {
        OR: [
          { actorUserId: friendUserId },
          { targetUserId: friendUserId }
        ]
      },
      include: {
        loan: {
          include: {
            book: true,
            lender: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
            borrower: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
          }
        },
        actorUser: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
        targetUser: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
  ]);

  return res.json({
    activity: {
      recentReads: recentReads.map((row) => ({
        book: toBookResponse({ ...row.book, userBooks: [row] }, friendUserId, getBaseUrl(req)),
        lastOpenedAt: row.lastOpenedAt,
        progressPercent: row.progressPercent
      })),
      loanEvents: loanEvents.map((event) => ({
        id: event.id,
        action: event.action,
        createdAt: event.createdAt,
        actorUser: event.actorUser ? toUserResponse(event.actorUser) : null,
        targetUser: event.targetUser ? toUserResponse(event.targetUser) : null,
        loan: event.loan ? toLoanResponse(event.loan) : null
      }))
    },
    permissions
  });
});

app.post('/friends/:friendUserId/borrow/:bookId', requireAuth, async (req, res) => {
  const friendUserId = req.params.friendUserId;
  const { bookId } = req.params;
  if (!friendUserId || !bookId) return res.status(400).json({ error: 'friendUserId and bookId are required' });
  if (friendUserId === req.auth.userId) return res.status(400).json({ error: 'Cannot borrow from yourself' });

  const friendshipCheck = await requireFriendship(prisma, req.auth.userId, friendUserId);
  if (!friendshipCheck.ok) return res.status(friendshipCheck.status).json({ error: friendshipCheck.error });
  const permissions = await getFriendPrivacyForViewer(prisma, friendUserId, req.auth.userId);
  if (!permissions.canViewLibrary) return res.status(403).json({ error: 'Friend library is not visible' });
  if (!permissions.canBorrow) return res.status(403).json({ error: 'Borrowing is disabled by this friend' });

  const lenderAccess = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: friendUserId,
        bookId
      }
    },
    include: { book: true }
  });
  if (!lenderAccess || lenderAccess.isDeleted) return res.status(404).json({ error: 'Book not available from this friend' });

  const existingActive = await prisma.bookLoan.findFirst({
    where: {
      bookId,
      lenderId: friendUserId,
      borrowerId: req.auth.userId,
      status: 'ACTIVE'
    }
  });
  if (existingActive) {
    return res.status(409).json({ error: 'You already have an active loan for this book from this friend' });
  }

  const template = await ensureLoanTemplate(prisma, friendUserId);
  const acceptedAt = new Date();
  const dueAt = new Date(acceptedAt.getTime() + template.durationDays * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const borrowerAccess = await tx.userBook.upsert({
      where: {
        userId_bookId: {
          userId: req.auth.userId,
          bookId
        }
      },
      update: {
        isDeleted: false,
        deletedAt: null
      },
      create: {
        userId: req.auth.userId,
        bookId,
        status: 'TO_READ',
        progressPercent: 0,
        progressCfi: null,
        lastOpenedAt: null,
        isDeleted: false,
        deletedAt: null
      }
    });

    const loan = await tx.bookLoan.create({
      data: {
        bookId,
        lenderId: friendUserId,
        borrowerId: req.auth.userId,
        status: 'ACTIVE',
        message: `Borrowed from friend library`,
        durationDays: template.durationDays,
        graceDays: template.graceDays,
        requestedAt: acceptedAt,
        acceptedAt,
        dueAt,
        createdUserBookOnAccept: !borrowerAccess?.id,
        canAddHighlights: template.canAddHighlights,
        canEditHighlights: template.canEditHighlights,
        canAddNotes: template.canAddNotes,
        canEditNotes: template.canEditNotes,
        annotationVisibility: template.annotationVisibility,
        shareLenderAnnotations: template.shareLenderAnnotations
      },
      include: includeLoanGraph
    });

    await addLoanAuditEvent(tx, {
      loanId: loan.id,
      actorUserId: req.auth.userId,
      targetUserId: friendUserId,
      action: 'FRIEND_BORROW_START',
      details: {
        source: 'friend-library'
      }
    });

    return loan;
  });

  await emitLoanNotification(prisma, {
    userId: req.auth.userId,
    loanId: created.id,
    eventKey: `friend-borrow-start-${created.id}`,
    kind: 'friend-borrow-start',
    title: 'Borrow started',
    message: `You borrowed "${created.book?.title || 'book'}" from ${created.lender?.displayName || created.lender?.email || 'your friend'}.`,
    actionType: 'open-borrowed',
    actionTargetId: created.id
  });
  await emitLoanNotification(prisma, {
    userId: friendUserId,
    loanId: created.id,
    eventKey: `friend-book-borrowed-${created.id}`,
    kind: 'friend-book-borrowed',
    title: 'A friend borrowed your book',
    message: `${created.borrower?.displayName || created.borrower?.email || 'A friend'} borrowed "${created.book?.title || 'your book'}".`,
    actionType: 'open-lent',
    actionTargetId: created.id
  });

  return res.status(201).json({ loan: toLoanResponse(created) });
});

app.get('/books', requireAuth, async (req, res) => {
  await purgeExpiredUserTrash(prisma, req.auth.userId);
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
    update: {
      isDeleted: false,
      deletedAt: null
    },
    create: {
      userId: req.auth.userId,
      bookId: targetBook.id,
      status: 'TO_READ',
      progressPercent: 0,
      progressCfi: null,
      lastOpenedAt: null,
      isDeleted: false,
      deletedAt: null
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

app.patch('/books/:bookId/metadata', requireAuth, requireBookAccess, async (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(512).optional(),
    author: z.string().max(512).optional().nullable(),
    language: z.string().max(64).optional().nullable(),
    cover: z.string().max(2_000_000).optional().nullable()
  }).refine((value) => (
    value.title !== undefined ||
    value.author !== undefined ||
    value.language !== undefined ||
    value.cover !== undefined
  ), { message: 'At least one metadata field is required' });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const book = await prisma.book.update({
    where: { id: req.params.bookId },
    data: {
      title: parsed.data.title === undefined ? undefined : parsed.data.title.trim(),
      author: parsed.data.author === undefined ? undefined : (parsed.data.author || null),
      language: parsed.data.language === undefined ? undefined : (parsed.data.language || null),
      cover: parsed.data.cover === undefined ? undefined : (parsed.data.cover || null)
    },
    include: includeBookGraph
  });

  return res.json({ book: toBookResponse(book, req.auth.userId, getBaseUrl(req)) });
});

app.delete('/books/:bookId', requireAuth, async (req, res) => {
  const userBook = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId: req.params.bookId
      }
    }
  });
  if (!userBook) return res.status(404).json({ error: 'Book not found in your library' });

  const activeLendingCount = await prisma.bookLoan.count({
    where: {
      bookId: req.params.bookId,
      status: 'ACTIVE',
      lenderId: req.auth.userId
    }
  });

  if (activeLendingCount > 0) {
    return res.status(409).json({
      error: 'This book is actively lent. Revoke lending first, then delete.',
      code: 'ACTIVE_LENDING_EXISTS'
    });
  }

  const activeBorrowingCount = await prisma.bookLoan.count({
    where: {
      bookId: req.params.bookId,
      status: 'ACTIVE',
      borrowerId: req.auth.userId
    }
  });
  if (activeBorrowingCount > 0) {
    return res.status(409).json({
      error: 'This book is currently borrowed. Return it first, then delete from trash.',
      code: 'ACTIVE_BORROWING_EXISTS'
    });
  }

  await prisma.userBook.delete({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId: req.params.bookId
      }
    }
  });

  await emitLoanNotification(prisma, {
    userId: req.auth.userId,
    eventKey: `book-removed-${req.params.bookId}-${Date.now()}`,
    kind: 'book-removed',
    title: 'Book removed',
    message: `A book was removed from your library permanently.`,
    actionType: 'open-library',
    actionTargetId: req.params.bookId,
    meta: {
      bookId: req.params.bookId
    }
  });

  return res.json({ ok: true });
});

app.patch('/books/:bookId/trash', requireAuth, async (req, res) => {
  const schema = z.object({
    deleted: z.boolean()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const existing = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId: req.params.bookId
      }
    },
    include: { book: true }
  });
  if (!existing) return res.status(404).json({ error: 'Book not found in your library' });

  if (parsed.data.deleted) {
    const activeLendingCount = await prisma.bookLoan.count({
      where: {
        bookId: req.params.bookId,
        status: 'ACTIVE',
        lenderId: req.auth.userId
      }
    });
    if (activeLendingCount > 0) {
      return res.status(409).json({
        error: 'This book is actively lent. Revoke lending first, then move it to trash.',
        code: 'ACTIVE_LENDING_EXISTS'
      });
    }
  }

  const now = new Date();
  const updated = await prisma.userBook.update({
    where: { id: existing.id },
    data: {
      isDeleted: parsed.data.deleted,
      deletedAt: parsed.data.deleted ? now : null
    },
    include: { book: true }
  });

  await emitLoanNotification(prisma, {
    userId: req.auth.userId,
    eventKey: parsed.data.deleted
      ? `book-trashed-${req.params.bookId}-${Date.now()}`
      : `book-restored-${req.params.bookId}-${Date.now()}`,
    kind: parsed.data.deleted ? 'book-trashed' : 'book-restored',
    title: parsed.data.deleted ? 'Moved to Trash' : 'Restored from Trash',
    message: parsed.data.deleted
      ? `${existing.book.title} moved to your Trash.`
      : `${existing.book.title} restored to your library.`,
    actionType: parsed.data.deleted ? 'open-trash' : 'open-library',
    actionTargetId: req.params.bookId,
    meta: {
      bookId: req.params.bookId
    }
  });

  return res.json({
    book: toBookResponse({ ...updated.book, userBooks: [updated] }, req.auth.userId, getBaseUrl(req))
  });
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

app.post('/books/:bookId/activity', requireAuth, requireBookAccess, async (req, res) => {
  const schema = z.object({
    secondsRead: z.number().int().min(0).max(3600).optional(),
    pagesRead: z.number().int().min(0).max(2000).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const secondsRead = Math.max(0, Number(parsed.data.secondsRead || 0));
  const pagesRead = Math.max(0, Number(parsed.data.pagesRead || 0));
  if (!secondsRead && !pagesRead) return res.json({ ok: true });

  const dayDate = startOfDayUtc(new Date());
  await prisma.$transaction(async (tx) => {
    await tx.userReadingStat.upsert({
      where: { userId: req.auth.userId },
      create: {
        userId: req.auth.userId,
        totalReadingSeconds: secondsRead,
        totalPagesRead: pagesRead
      },
      update: {
        totalReadingSeconds: { increment: secondsRead },
        totalPagesRead: { increment: pagesRead }
      }
    });

    await tx.userReadingDay.upsert({
      where: {
        userId_dayDate: {
          userId: req.auth.userId,
          dayDate
        }
      },
      create: {
        userId: req.auth.userId,
        dayDate,
        readingSeconds: secondsRead,
        pagesRead
      },
      update: {
        readingSeconds: { increment: secondsRead },
        pagesRead: { increment: pagesRead }
      }
    });
  });

  return res.json({ ok: true });
});

app.get('/books/:bookId/highlights', requireAuth, requireBookAccess, async (req, res) => {
  const where = await buildAnnotationAccessWhere(prisma, {
    bookId: req.params.bookId,
    userId: req.auth.userId
  });
  const highlights = await prisma.highlight.findMany({
    where,
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

  const capability = await requireBorrowCapability(prisma, {
    userId: req.auth.userId,
    bookId: req.params.bookId,
    capability: 'addHighlights'
  });
  if (!capability.ok) return res.status(capability.status).json({ error: capability.error });
  const { activeBorrowLoan } = capability;
  const scope = resolveLoanAnnotationScope(activeBorrowLoan);

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
      chapterHref: parsed.data.chapterHref || null,
      scope
    }
  });

  const where = await buildAnnotationAccessWhere(prisma, {
    bookId: req.params.bookId,
    userId: req.auth.userId
  });
  const highlights = await prisma.highlight.findMany({
    where,
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
  const entitlement = await ensureBookEntitlement(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId
  });
  if (!entitlement.userBook) return res.status(403).json({ error: 'No access to this book' });
  const expectedRevision = parseExpectedRevision(req);
  if (expectedRevision !== null && expectedRevision !== existing.revision) {
    return res.status(409).json({
      error: 'Highlight conflict',
      code: 'REVISION_CONFLICT',
      currentRevision: existing.revision
    });
  }

  const capability = await requireBorrowCapability(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId,
    capability: 'editHighlights'
  });
  if (!capability.ok) return res.status(capability.status).json({ error: capability.error });
  const { activeBorrowLoan } = capability;

  await prisma.highlight.update({
    where: { id: existing.id },
    data: {
      note: parsed.data.note === undefined ? existing.note : parsed.data.note,
      color: parsed.data.color === undefined ? existing.color : parsed.data.color,
      text: parsed.data.text === undefined ? existing.text : parsed.data.text,
      contextPrefix: parsed.data.contextPrefix === undefined ? existing.contextPrefix : parsed.data.contextPrefix,
      contextSuffix: parsed.data.contextSuffix === undefined ? existing.contextSuffix : parsed.data.contextSuffix,
      chapterHref: parsed.data.chapterHref === undefined ? existing.chapterHref : parsed.data.chapterHref,
      scope: activeBorrowLoan ? resolveLoanAnnotationScope(activeBorrowLoan) : existing.scope,
      revision: { increment: 1 }
    }
  });

  const where = await buildAnnotationAccessWhere(prisma, {
    bookId: existing.bookId,
    userId: req.auth.userId
  });
  const highlights = await prisma.highlight.findMany({
    where,
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
  const entitlement = await ensureBookEntitlement(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId
  });
  if (!entitlement.userBook) return res.status(403).json({ error: 'No access to this book' });
  const expectedRevision = parseExpectedRevision(req);
  if (expectedRevision !== null && expectedRevision !== existing.revision) {
    return res.status(409).json({
      error: 'Highlight conflict',
      code: 'REVISION_CONFLICT',
      currentRevision: existing.revision
    });
  }

  const capability = await requireBorrowCapability(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId,
    capability: 'editHighlights'
  });
  if (!capability.ok) return res.status(capability.status).json({ error: capability.error });

  await prisma.highlight.delete({ where: { id: existing.id } });
  const where = await buildAnnotationAccessWhere(prisma, {
    bookId: existing.bookId,
    userId: req.auth.userId
  });
  const highlights = await prisma.highlight.findMany({
    where,
    include: { createdBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' }
  });

  return res.json({ highlights });
});

app.get('/books/:bookId/notes', requireAuth, requireBookAccess, async (req, res) => {
  const where = await buildAnnotationAccessWhere(prisma, {
    bookId: req.params.bookId,
    userId: req.auth.userId
  });
  const notes = await prisma.note.findMany({
    where,
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

  const capability = await requireBorrowCapability(prisma, {
    userId: req.auth.userId,
    bookId: req.params.bookId,
    capability: 'addNotes'
  });
  if (!capability.ok) return res.status(capability.status).json({ error: capability.error });
  const { activeBorrowLoan } = capability;
  const scope = resolveLoanAnnotationScope(activeBorrowLoan);

  const note = await prisma.note.create({
    data: {
      bookId: req.params.bookId,
      createdByUserId: req.auth.userId,
      text: parsed.data.text,
      cfi: parsed.data.cfi || null,
      message: parsed.data.message || null,
      scope
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
  const entitlement = await ensureBookEntitlement(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId
  });
  if (!entitlement.userBook) return res.status(403).json({ error: 'No access to this book' });
  const expectedRevision = parseExpectedRevision(req);
  if (expectedRevision !== null && expectedRevision !== existing.revision) {
    return res.status(409).json({
      error: 'Note conflict',
      code: 'REVISION_CONFLICT',
      currentRevision: existing.revision
    });
  }

  const capability = await requireBorrowCapability(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId,
    capability: 'editNotes'
  });
  if (!capability.ok) return res.status(capability.status).json({ error: capability.error });
  const { activeBorrowLoan } = capability;

  const note = await prisma.note.update({
    where: { id: existing.id },
    data: {
      text: parsed.data.text === undefined ? existing.text : parsed.data.text,
      cfi: parsed.data.cfi === undefined ? existing.cfi : parsed.data.cfi,
      message: parsed.data.message === undefined ? existing.message : parsed.data.message,
      scope: activeBorrowLoan ? resolveLoanAnnotationScope(activeBorrowLoan) : existing.scope,
      revision: { increment: 1 }
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
  const entitlement = await ensureBookEntitlement(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId
  });
  if (!entitlement.userBook) return res.status(403).json({ error: 'No access to this book' });
  const expectedRevision = parseExpectedRevision(req);
  if (expectedRevision !== null && expectedRevision !== existing.revision) {
    return res.status(409).json({
      error: 'Note conflict',
      code: 'REVISION_CONFLICT',
      currentRevision: existing.revision
    });
  }

  const capability = await requireBorrowCapability(prisma, {
    userId: req.auth.userId,
    bookId: existing.bookId,
    capability: 'editNotes'
  });
  if (!capability.ok) return res.status(capability.status).json({ error: capability.error });

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
    return next;
  });

  return res.json({ share: accepted });
});

app.post('/shares/:shareId/borrow', requireAuth, async (req, res) => {
  const schema = z.object({
    borrowAnyway: z.boolean().default(false)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const share = await prisma.bookShare.findUnique({
    where: { id: req.params.shareId },
    include: includeShareGraph
  });
  if (!share) return res.status(404).json({ error: 'Share not found' });
  if (share.toUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (share.status === 'REJECTED') return res.status(400).json({ error: 'Share rejected' });

  const lenderAccess = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: share.fromUserId,
        bookId: share.bookId
      }
    }
  });
  if (!lenderAccess) return res.status(400).json({ error: 'Sharer no longer has access to this book' });

  const existingAccess = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId: share.bookId
      }
    }
  });
  if (existingAccess && !parsed.data.borrowAnyway) {
    return res.status(409).json({
      error: 'You already have this book',
      code: 'ALREADY_HAVE_BOOK',
      warning: 'Borrow anyway creates a loan relationship while keeping your existing library copy.'
    });
  }

  const acceptedAt = new Date();
  const dueAt = new Date(acceptedAt.getTime() + 14 * 24 * 60 * 60 * 1000);

  const result = await prisma.$transaction(async (tx) => {
    let createdAccess = false;
    if (!existingAccess) {
      await tx.userBook.create({
        data: {
          userId: req.auth.userId,
          bookId: share.bookId,
          status: 'TO_READ',
          progressPercent: 0,
          progressCfi: null,
          lastOpenedAt: null
        }
      });
      createdAccess = true;
    }

    const loan = await tx.bookLoan.create({
      data: {
        bookId: share.bookId,
        lenderId: share.fromUserId,
        borrowerId: req.auth.userId,
        message: share.message || null,
        status: 'ACTIVE',
        durationDays: 14,
        graceDays: 0,
        acceptedAt,
        dueAt,
        createdUserBookOnAccept: createdAccess,
        canAddHighlights: true,
        canEditHighlights: true,
        canAddNotes: true,
        canEditNotes: true,
        annotationVisibility: 'PRIVATE',
        shareLenderAnnotations: false
      },
      include: includeLoanGraph
    });

    const nextShare = await tx.bookShare.update({
      where: { id: share.id },
      data: { status: 'ACCEPTED', acceptedAt: share.acceptedAt || acceptedAt },
      include: includeShareGraph
    });

    await addLoanAuditEvent(tx, {
      loanId: loan.id,
      actorUserId: req.auth.userId,
      targetUserId: share.fromUserId,
      action: 'LOAN_ACCEPTED_FROM_SHARE',
      details: {
        dueAt,
        borrowAnyway: Boolean(existingAccess)
      }
    });

    return { loan, share: nextShare };
  });

  await emitLoanNotification(prisma, {
    userId: share.fromUserId,
    eventKey: `loan-accepted-from-share-${result.loan.id}`,
    kind: 'loan-accepted',
    title: 'Recommendation borrowed',
    message: `${result.loan.borrower.displayName || result.loan.borrower.email} borrowed "${result.loan.book.title}".`,
    loanId: result.loan.id,
    actionType: 'open-lent',
    actionTargetId: result.loan.id
  });

  return res.json({
    share: result.share,
    loan: toLoanResponse(result.loan)
  });
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

app.get('/loans/templates/default', requireAuth, async (req, res) => {
  const template = await ensureLoanTemplate(prisma, req.auth.userId);
  return res.json({ template: toTemplateResponse(template) });
});

app.put('/loans/templates/default', requireAuth, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).max(120).optional(),
    durationDays: z.number().int().min(1).max(365),
    graceDays: z.number().int().min(0).max(30),
    remindBeforeDays: z.number().int().min(0).max(30).default(3),
    permissions: z.object({
      canAddHighlights: z.boolean(),
      canEditHighlights: z.boolean(),
      canAddNotes: z.boolean(),
      canEditNotes: z.boolean(),
      annotationVisibility: z.enum(['PRIVATE', 'SHARED_WITH_LENDER']),
      shareLenderAnnotations: z.boolean()
    })
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const template = await ensureLoanTemplate(prisma, req.auth.userId);
  const updated = await prisma.userLoanTemplate.update({
    where: { id: template.id },
    data: {
      name: (parsed.data.name || template.name).trim(),
      durationDays: parsed.data.durationDays,
      graceDays: parsed.data.graceDays,
      remindBeforeDays: parsed.data.remindBeforeDays,
      canAddHighlights: parsed.data.permissions.canAddHighlights,
      canEditHighlights: parsed.data.permissions.canEditHighlights,
      canAddNotes: parsed.data.permissions.canAddNotes,
      canEditNotes: parsed.data.permissions.canEditNotes,
      annotationVisibility: parsed.data.permissions.annotationVisibility,
      shareLenderAnnotations: parsed.data.permissions.shareLenderAnnotations
    }
  });

  return res.json({ template: toTemplateResponse(updated) });
});

app.post('/loans/books', requireAuth, async (req, res) => {
  const schema = z.object({
    bookId: z.string().optional(),
    epubHash: z.string().optional(),
    toEmail: z.string().email(),
    message: z.string().max(2000).optional(),
    durationDays: z.number().int().min(1).max(365).optional(),
    graceDays: z.number().int().min(0).max(30).optional(),
    permissions: z.object({
      canAddHighlights: z.boolean().optional(),
      canEditHighlights: z.boolean().optional(),
      canAddNotes: z.boolean().optional(),
      canEditNotes: z.boolean().optional(),
      annotationVisibility: z.enum(['PRIVATE', 'SHARED_WITH_LENDER']).optional(),
      shareLenderAnnotations: z.boolean().optional()
    }).optional()
  }).refine((v) => !!v.bookId || !!v.epubHash, {
    message: 'bookId or epubHash is required'
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  let book = null;
  if (parsed.data.bookId) book = await prisma.book.findUnique({ where: { id: parsed.data.bookId } });
  if (!book && parsed.data.epubHash) book = await prisma.book.findUnique({ where: { epubHash: parsed.data.epubHash } });
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const lenderAccess = await prisma.userBook.findUnique({
    where: { userId_bookId: { userId: req.auth.userId, bookId: book.id } }
  });
  if (!lenderAccess) return res.status(403).json({ error: 'No access to this book' });

  const toEmail = parsed.data.toEmail.toLowerCase().trim();
  const borrower = await prisma.user.findUnique({ where: { email: toEmail } });
  if (!borrower) return res.status(404).json({ error: 'Recipient not found' });
  if (borrower.id === req.auth.userId) return res.status(400).json({ error: 'Cannot lend to yourself' });

  const template = await ensureLoanTemplate(prisma, req.auth.userId);
  const effectivePermissions = {
    canAddHighlights: parsed.data.permissions?.canAddHighlights ?? template.canAddHighlights,
    canEditHighlights: parsed.data.permissions?.canEditHighlights ?? template.canEditHighlights,
    canAddNotes: parsed.data.permissions?.canAddNotes ?? template.canAddNotes,
    canEditNotes: parsed.data.permissions?.canEditNotes ?? template.canEditNotes,
    annotationVisibility: parsed.data.permissions?.annotationVisibility ?? template.annotationVisibility,
    shareLenderAnnotations: parsed.data.permissions?.shareLenderAnnotations ?? template.shareLenderAnnotations
  };
  const effectiveDurationDays = parsed.data.durationDays ?? template.durationDays;
  const effectiveGraceDays = parsed.data.graceDays ?? template.graceDays;

  const existingPending = await prisma.bookLoan.findFirst({
    where: {
      bookId: book.id,
      lenderId: req.auth.userId,
      borrowerId: borrower.id,
      status: 'PENDING'
    }
  });
  const existingActive = await prisma.bookLoan.findFirst({
    where: {
      bookId: book.id,
      lenderId: req.auth.userId,
      borrowerId: borrower.id,
      status: 'ACTIVE'
    }
  });
  if (existingActive) {
    return res.status(409).json({
      error: 'Active loan already exists for this friend and book'
    });
  }

  const loan = existingPending
    ? await prisma.bookLoan.update({
        where: { id: existingPending.id },
        data: {
          message: parsed.data.message || null,
          durationDays: effectiveDurationDays,
          graceDays: effectiveGraceDays,
          canAddHighlights: effectivePermissions.canAddHighlights,
          canEditHighlights: effectivePermissions.canEditHighlights,
          canAddNotes: effectivePermissions.canAddNotes,
          canEditNotes: effectivePermissions.canEditNotes,
          annotationVisibility: effectivePermissions.annotationVisibility,
          shareLenderAnnotations: effectivePermissions.shareLenderAnnotations
        },
        include: includeLoanGraph
      })
    : await prisma.bookLoan.create({
        data: {
          bookId: book.id,
          lenderId: req.auth.userId,
          borrowerId: borrower.id,
          message: parsed.data.message || null,
          durationDays: effectiveDurationDays,
          graceDays: effectiveGraceDays,
          canAddHighlights: effectivePermissions.canAddHighlights,
          canEditHighlights: effectivePermissions.canEditHighlights,
          canAddNotes: effectivePermissions.canAddNotes,
          canEditNotes: effectivePermissions.canEditNotes,
          annotationVisibility: effectivePermissions.annotationVisibility,
          shareLenderAnnotations: effectivePermissions.shareLenderAnnotations
        },
        include: includeLoanGraph
      });

  await addLoanAuditEvent(prisma, {
    loanId: loan.id,
    actorUserId: req.auth.userId,
    targetUserId: borrower.id,
    action: 'LOAN_REQUESTED',
    details: {
      durationDays: loan.durationDays,
      graceDays: loan.graceDays
    }
  });

  await emitLoanNotification(prisma, {
    userId: borrower.id,
    eventKey: `loan-request-${loan.id}`,
    kind: 'loan-request',
    title: 'New loan request',
    message: `${loan.lender.displayName || loan.lender.email} offered you "${loan.book.title}".`,
    loanId: loan.id,
    actionType: 'open-inbox',
    actionTargetId: loan.id,
    meta: {
      bookId: loan.book.id
    }
  });

  return res.status(201).json({ loan: toLoanResponse(loan) });
});

app.get('/loans/inbox', requireAuth, async (req, res) => {
  const loans = await prisma.bookLoan.findMany({
    where: {
      borrowerId: req.auth.userId,
      status: 'PENDING'
    },
    include: includeLoanGraph,
    orderBy: { requestedAt: 'desc' }
  });
  return res.json({ loans: loans.map(toLoanResponse) });
});

app.post('/loans/:loanId/accept', requireAuth, async (req, res) => {
  const schema = z.object({
    borrowAnyway: z.boolean().default(false)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.borrowerId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (loan.status !== 'PENDING') return res.status(400).json({ error: 'Loan is not pending' });

  const existingAccess = await prisma.userBook.findUnique({
    where: {
      userId_bookId: {
        userId: req.auth.userId,
        bookId: loan.bookId
      }
    }
  });

  if (existingAccess && !parsed.data.borrowAnyway) {
    return res.status(409).json({
      error: 'You already have this book',
      code: 'ALREADY_HAVE_BOOK',
      warning: 'Borrow anyway creates a separate loan relationship but keeps your existing library copy.'
    });
  }

  const acceptedAt = new Date();
  const dueAt = new Date(acceptedAt.getTime() + loan.durationDays * 24 * 60 * 60 * 1000);
  const accepted = await prisma.$transaction(async (tx) => {
    let createdAccess = false;
    if (!existingAccess) {
      await tx.userBook.create({
        data: {
          userId: req.auth.userId,
          bookId: loan.bookId,
          status: 'TO_READ',
          progressPercent: 0,
          progressCfi: null,
          lastOpenedAt: null
        }
      });
      createdAccess = true;
    }

    const updated = await tx.bookLoan.update({
      where: { id: loan.id },
      data: {
        status: 'ACTIVE',
        acceptedAt,
        dueAt,
        createdUserBookOnAccept: createdAccess
      },
      include: includeLoanGraph
    });

    await addLoanAuditEvent(tx, {
      loanId: loan.id,
      actorUserId: req.auth.userId,
      targetUserId: loan.lenderId,
      action: 'LOAN_ACCEPTED',
      details: {
        dueAt,
        borrowAnyway: Boolean(existingAccess)
      }
    });

    return updated;
  });

  await emitLoanNotification(prisma, {
    userId: loan.lenderId,
    eventKey: `loan-accepted-${loan.id}`,
    kind: 'loan-accepted',
    title: 'Loan accepted',
    message: `${accepted.borrower.displayName || accepted.borrower.email} accepted "${accepted.book.title}".`,
    loanId: loan.id,
    actionType: 'open-lent',
    actionTargetId: loan.id,
    meta: {
      dueAt: accepted.dueAt
    }
  });

  return res.json({ loan: toLoanResponse(accepted) });
});

app.post('/loans/:loanId/reject', requireAuth, async (req, res) => {
  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.borrowerId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (loan.status !== 'PENDING') return res.status(400).json({ error: 'Loan is not pending' });

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.bookLoan.update({
      where: { id: loan.id },
      data: { status: 'REJECTED' },
      include: includeLoanGraph
    });
    await addLoanAuditEvent(tx, {
      loanId: loan.id,
      actorUserId: req.auth.userId,
      targetUserId: loan.lenderId,
      action: 'LOAN_REJECTED'
    });
    return next;
  });

  await emitLoanNotification(prisma, {
    userId: loan.lenderId,
    eventKey: `loan-rejected-${loan.id}`,
    kind: 'loan-rejected',
    title: 'Loan rejected',
    message: `${updated.borrower.displayName || updated.borrower.email} rejected "${updated.book.title}".`,
    loanId: loan.id,
    actionType: 'open-lent',
    actionTargetId: loan.id
  });

  return res.json({ loan: toLoanResponse(updated) });
});

app.get('/loans/borrowed', requireAuth, async (req, res) => {
  const loans = await prisma.bookLoan.findMany({
    where: { borrowerId: req.auth.userId },
    include: includeLoanGraph,
    orderBy: { requestedAt: 'desc' }
  });

  const normalized = [];
  for (const loan of loans) {
    normalized.push(await expireLoanIfNeeded(prisma, loan, {
      include: includeLoanGraph,
      cleanupBorrowerAccess: true,
      addAuditEvent: true
    }));
  }
  return res.json({ loans: normalized.map(toLoanResponse) });
});

app.get('/loans/lent', requireAuth, async (req, res) => {
  const loans = await prisma.bookLoan.findMany({
    where: { lenderId: req.auth.userId },
    include: includeLoanGraph,
    orderBy: { requestedAt: 'desc' }
  });
  return res.json({ loans: loans.map(toLoanResponse) });
});

app.get('/loans/:loanId/reviews', requireAuth, async (req, res) => {
  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (!ensureLoanParticipant(loan, req.auth.userId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const messages = await prisma.loanReviewMessage.findMany({
    where: { loanId: loan.id },
    include: {
      author: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
    },
    orderBy: { createdAt: 'asc' }
  });
  return res.json({ loan: toLoanResponse(loan), messages: messages.map(toLoanReviewMessageResponse) });
});

app.get('/loans/discussions/unread', requireAuth, async (req, res) => {
  const loans = await prisma.bookLoan.findMany({
    where: {
      OR: [
        { lenderId: req.auth.userId },
        { borrowerId: req.auth.userId }
      ],
      status: { not: 'PENDING' }
    },
    select: { id: true }
  });

  const rows = await Promise.all(
    loans.map(async (loan) => {
      const summary = await getLoanDiscussionSummary(prisma, loan.id, req.auth.userId);
      return {
        loanId: loan.id,
        unreadCount: summary.unreadCount,
        lastReadAt: summary.lastReadAt,
        lastMessageAt: summary.lastMessageAt
      };
    })
  );

  return res.json({ items: rows });
});

app.get('/loans/:loanId/discussion', requireAuth, async (req, res) => {
  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (!ensureLoanParticipant(loan, req.auth.userId)) return res.status(403).json({ error: 'Forbidden' });

  const [messages, auditEvents, summary] = await Promise.all([
    prisma.loanReviewMessage.findMany({
      where: { loanId: loan.id },
      include: {
        author: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
      },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.loanAuditEvent.findMany({
      where: { loanId: loan.id },
      include: {
        actorUser: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
        targetUser: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
        loan: { include: includeLoanGraph }
      },
      orderBy: { createdAt: 'asc' }
    }),
    getLoanDiscussionSummary(prisma, loan.id, req.auth.userId)
  ]);

  const reviewMessages = messages.map(toLoanReviewMessageResponse);
  const timeline = [
    ...auditEvents.map((event) => ({
      id: `event-${event.id}`,
      kind: 'event',
      createdAt: event.createdAt,
      event: toLoanAuditEventResponse(event)
    })),
    ...reviewMessages.map((message) => ({
      id: `review-${message.id}`,
      kind: 'review',
      createdAt: message.createdAt,
      message
    }))
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return res.json({
    loan: toLoanResponse(loan),
    readState: {
      unreadCount: summary.unreadCount,
      lastReadAt: summary.lastReadAt,
      lastMessageAt: summary.lastMessageAt
    },
    messages: reviewMessages,
    events: auditEvents.map(toLoanAuditEventResponse),
    timeline
  });
});

app.post('/loans/:loanId/discussion/read', requireAuth, async (req, res) => {
  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    select: { id: true, lenderId: true, borrowerId: true }
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (!ensureLoanParticipant(loan, req.auth.userId)) return res.status(403).json({ error: 'Forbidden' });

  const now = new Date();
  const row = await prisma.loanDiscussionReadState.upsert({
    where: {
      loanId_userId: {
        loanId: loan.id,
        userId: req.auth.userId
      }
    },
    create: {
      loanId: loan.id,
      userId: req.auth.userId,
      lastReadAt: now
    },
    update: {
      lastReadAt: now
    }
  });

  return res.json({ readState: { loanId: row.loanId, userId: row.userId, lastReadAt: row.lastReadAt } });
});

app.post('/loans/:loanId/reviews', requireAuth, async (req, res) => {
  const schema = z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().min(1).max(3000)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (!ensureLoanParticipant(loan, req.auth.userId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const message = await prisma.loanReviewMessage.create({
    data: {
      loanId: loan.id,
      authorUserId: req.auth.userId,
      rating: parsed.data.rating,
      comment: parsed.data.comment.trim()
    },
    include: {
      author: { select: { id: true, email: true, username: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
    }
  });

  const otherUserId = loan.borrowerId === req.auth.userId ? loan.lenderId : loan.borrowerId;
  await emitLoanNotification(prisma, {
    userId: otherUserId,
    eventKey: `loan-review-${message.id}`,
    kind: 'loan-review',
    title: 'New loan review',
    message: `${message.author?.displayName || message.author?.email || 'A reader'} reviewed "${loan.book?.title || 'book'}" (${message.rating}/5).`,
    loanId: loan.id,
    actionType: 'open-loan-activity',
    actionTargetId: loan.id,
    meta: {
      reviewId: message.id
    }
  });

  return res.status(201).json({ message: toLoanReviewMessageResponse(message) });
});

const includeRenewalGraph = {
  loan: { include: includeLoanGraph },
  requester: { select: { id: true, email: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
  reviewer: { select: { id: true, email: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
  lender: { select: { id: true, email: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
  borrower: { select: { id: true, email: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
};

app.get('/loans/renewals', requireAuth, async (req, res) => {
  const renewals = await prisma.loanRenewalRequest.findMany({
    where: {
      OR: [
        { lenderId: req.auth.userId },
        { borrowerId: req.auth.userId }
      ]
    },
    include: includeRenewalGraph,
    orderBy: { requestedAt: 'desc' },
    take: 200
  });
  return res.json({ renewals: renewals.map(toRenewalResponse) });
});

app.post('/loans/:loanId/renewals', requireAuth, async (req, res) => {
  const schema = z.object({
    extraDays: z.number().int().min(1).max(60),
    message: z.string().max(500).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.borrowerId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (loan.status !== 'ACTIVE') return res.status(400).json({ error: 'Loan must be active' });
  if (!loan.dueAt) return res.status(400).json({ error: 'Loan due date is missing' });

  const existingPending = await prisma.loanRenewalRequest.findFirst({
    where: {
      loanId: loan.id,
      status: 'PENDING'
    }
  });
  if (existingPending) return res.status(409).json({ error: 'A renewal request is already pending' });

  const previousDueAt = new Date(loan.dueAt);
  const proposedDueAt = new Date(previousDueAt.getTime() + parsed.data.extraDays * 24 * 60 * 60 * 1000);
  const renewal = await prisma.loanRenewalRequest.create({
    data: {
      loanId: loan.id,
      requesterUserId: req.auth.userId,
      lenderId: loan.lenderId,
      borrowerId: loan.borrowerId,
      requestedExtraDays: parsed.data.extraDays,
      previousDueAt,
      proposedDueAt,
      decisionMessage: parsed.data.message || null
    },
    include: includeRenewalGraph
  });

  await addLoanAuditEvent(prisma, {
    loanId: loan.id,
    actorUserId: req.auth.userId,
    targetUserId: loan.lenderId,
    action: 'LOAN_RENEWAL_REQUESTED',
    details: {
      renewalRequestId: renewal.id,
      requestedExtraDays: parsed.data.extraDays,
      previousDueAt,
      proposedDueAt
    }
  });

  await emitLoanNotification(prisma, {
    userId: loan.lenderId,
    eventKey: `loan-renewal-request-${renewal.id}`,
    kind: 'loan-renewal-request',
    title: 'Renewal requested',
    message: `${loan.borrower.displayName || loan.borrower.email} requested +${parsed.data.extraDays} days for "${loan.book.title}".`,
    loanId: loan.id,
    actionType: 'open-lent',
    actionTargetId: loan.id,
    meta: {
      renewalRequestId: renewal.id,
      proposedDueAt
    }
  });

  return res.status(201).json({ renewal: toRenewalResponse(renewal) });
});

app.post('/loans/renewals/:renewalId/approve', requireAuth, async (req, res) => {
  const schema = z.object({
    message: z.string().max(500).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const renewal = await prisma.loanRenewalRequest.findUnique({
    where: { id: req.params.renewalId },
    include: includeRenewalGraph
  });
  if (!renewal) return res.status(404).json({ error: 'Renewal request not found' });
  if (renewal.lenderId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (renewal.status !== 'PENDING') return res.status(400).json({ error: 'Renewal is not pending' });
  if (!renewal.loan || renewal.loan.status !== 'ACTIVE') return res.status(400).json({ error: 'Loan must be active' });

  const updated = await prisma.$transaction(async (tx) => {
    const reviewedAt = new Date();
    const nextRenewal = await tx.loanRenewalRequest.update({
      where: { id: renewal.id },
      data: {
        status: 'APPROVED',
        reviewedAt,
        reviewerUserId: req.auth.userId,
        decisionMessage: parsed.data.message || renewal.decisionMessage || null
      },
      include: includeRenewalGraph
    });

    await tx.bookLoan.update({
      where: { id: renewal.loanId },
      data: {
        dueAt: renewal.proposedDueAt,
        durationDays: renewal.loan.durationDays + renewal.requestedExtraDays,
        dueSoonNotifiedAt: null,
        overdueNotifiedAt: null
      }
    });

    await addLoanAuditEvent(tx, {
      loanId: renewal.loanId,
      actorUserId: req.auth.userId,
      targetUserId: renewal.borrowerId,
      action: 'LOAN_RENEWAL_APPROVED',
      details: {
        renewalRequestId: renewal.id,
        requestedExtraDays: renewal.requestedExtraDays,
        previousDueAt: renewal.previousDueAt,
        proposedDueAt: renewal.proposedDueAt
      }
    });

    return nextRenewal;
  });

  await emitLoanNotification(prisma, {
    userId: renewal.borrowerId,
    eventKey: `loan-renewal-approved-${renewal.id}`,
    kind: 'loan-renewal-approved',
    title: 'Renewal approved',
    message: `${renewal.lender.displayName || renewal.lender.email} approved your renewal for "${renewal.loan.book.title}".`,
    loanId: renewal.loanId,
    actionType: 'open-borrowed',
    actionTargetId: renewal.loanId,
    meta: {
      renewalRequestId: renewal.id,
      dueAt: renewal.proposedDueAt
    }
  });

  return res.json({ renewal: toRenewalResponse(updated) });
});

app.post('/loans/renewals/:renewalId/deny', requireAuth, async (req, res) => {
  const schema = z.object({
    message: z.string().max(500).optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const renewal = await prisma.loanRenewalRequest.findUnique({
    where: { id: req.params.renewalId },
    include: includeRenewalGraph
  });
  if (!renewal) return res.status(404).json({ error: 'Renewal request not found' });
  if (renewal.lenderId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (renewal.status !== 'PENDING') return res.status(400).json({ error: 'Renewal is not pending' });

  const updated = await prisma.loanRenewalRequest.update({
    where: { id: renewal.id },
    data: {
      status: 'DENIED',
      reviewedAt: new Date(),
      reviewerUserId: req.auth.userId,
      decisionMessage: parsed.data.message || renewal.decisionMessage || null
    },
    include: includeRenewalGraph
  });

  await addLoanAuditEvent(prisma, {
    loanId: renewal.loanId,
    actorUserId: req.auth.userId,
    targetUserId: renewal.borrowerId,
    action: 'LOAN_RENEWAL_DENIED',
    details: {
      renewalRequestId: renewal.id,
      requestedExtraDays: renewal.requestedExtraDays
    }
  });

  await emitLoanNotification(prisma, {
    userId: renewal.borrowerId,
    eventKey: `loan-renewal-denied-${renewal.id}`,
    kind: 'loan-renewal-denied',
    title: 'Renewal denied',
    message: `${renewal.lender.displayName || renewal.lender.email} denied your renewal for "${renewal.loan.book.title}".`,
    loanId: renewal.loanId,
    actionType: 'open-borrowed',
    actionTargetId: renewal.loanId,
    meta: {
      renewalRequestId: renewal.id
    }
  });

  return res.json({ renewal: toRenewalResponse(updated) });
});

app.post('/loans/renewals/:renewalId/cancel', requireAuth, async (req, res) => {
  const renewal = await prisma.loanRenewalRequest.findUnique({
    where: { id: req.params.renewalId },
    include: includeRenewalGraph
  });
  if (!renewal) return res.status(404).json({ error: 'Renewal request not found' });
  if (renewal.requesterUserId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (renewal.status !== 'PENDING') return res.status(400).json({ error: 'Renewal is not pending' });

  const updated = await prisma.loanRenewalRequest.update({
    where: { id: renewal.id },
    data: { status: 'CANCELLED', reviewedAt: new Date() },
    include: includeRenewalGraph
  });

  await addLoanAuditEvent(prisma, {
    loanId: renewal.loanId,
    actorUserId: req.auth.userId,
    targetUserId: renewal.lenderId,
    action: 'LOAN_RENEWAL_CANCELLED',
    details: {
      renewalRequestId: renewal.id
    }
  });

  return res.json({ renewal: toRenewalResponse(updated) });
});

const buildLoanExportPayload = async (loan, borrowerId) => {
  const [notes, highlights] = await Promise.all([
    prisma.note.findMany({
      where: { bookId: loan.bookId, createdByUserId: borrowerId },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.highlight.findMany({
      where: { bookId: loan.bookId, createdByUserId: borrowerId },
      orderBy: { createdAt: 'asc' }
    })
  ]);

  const exportData = {
    schemaVersion: "loan-export.v2",
    exportedAt: new Date().toISOString(),
    loan: {
      id: loan.id,
      status: loan.status,
      requestedAt: loan.requestedAt,
      acceptedAt: loan.acceptedAt,
      dueAt: loan.dueAt,
      returnedAt: loan.returnedAt,
      revokedAt: loan.revokedAt,
      expiredAt: loan.expiredAt
    },
    portability: {
      loanName: loan.lender.displayName || loan.lender.email,
      lenderEmail: loan.lender.email,
      borrowerEmail: loan.borrower.email
    },
    lender: {
      id: loan.lender.id,
      email: loan.lender.email,
      displayName: loan.lender.displayName || null
    },
    borrower: {
      id: loan.borrower.id,
      email: loan.borrower.email,
      displayName: loan.borrower.displayName || null
    },
    book: {
      id: loan.book.id,
      epubHash: loan.book.epubHash,
      title: loan.book.title,
      author: loan.book.author || null,
      language: loan.book.language || null
    },
    notes,
    highlights
  };
  const hash = crypto.createHash('sha256').update(JSON.stringify(exportData)).digest('hex');
  return {
    ...exportData,
    integrity: {
      algorithm: 'sha256',
      hash
    }
  };
};

app.post('/loans/:loanId/return', requireAuth, async (req, res) => {
  const schema = z.object({
    exportAnnotations: z.boolean().default(false)
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.borrowerId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (loan.status !== 'ACTIVE') return res.status(400).json({ error: 'Loan is not active' });

  const exportPayload = parsed.data.exportAnnotations
    ? await buildLoanExportPayload(loan, req.auth.userId)
    : null;

  const returned = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const exportAvailableUntil = new Date(now.getTime() + LOAN_EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const next = await tx.bookLoan.update({
      where: { id: loan.id },
      data: {
        status: 'RETURNED',
        returnedAt: now,
        exportAvailableUntil
      },
      include: includeLoanGraph
    });

    if (loan.createdUserBookOnAccept) {
      await tx.userBook.deleteMany({
        where: { userId: req.auth.userId, bookId: loan.bookId }
      });
    }

    await addLoanAuditEvent(tx, {
      loanId: loan.id,
      actorUserId: req.auth.userId,
      targetUserId: loan.lenderId,
      action: 'LOAN_RETURNED',
      details: { exported: Boolean(exportPayload) }
    });

    return next;
  });

  await emitLoanNotification(prisma, {
    userId: loan.lenderId,
    eventKey: `loan-returned-${loan.id}-${returned.returnedAt?.toISOString?.() || Date.now()}`,
    kind: 'loan-returned',
    title: 'Book returned',
    message: `${returned.borrower.displayName || returned.borrower.email} returned "${returned.book.title}".`,
    loanId: loan.id,
    actionType: 'open-lent',
    actionTargetId: loan.id
  });

  return res.json({
    loan: toLoanResponse(returned),
    export: exportPayload
  });
});

app.post('/loans/:loanId/revoke', requireAuth, async (req, res) => {
  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.lenderId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });
  if (loan.status !== 'ACTIVE') return res.status(400).json({ error: 'Loan is not active' });

  const now = new Date();
  const exportAvailableUntil = new Date(now.getTime() + LOAN_EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const revoked = await prisma.$transaction(async (tx) => {
    const next = await tx.bookLoan.update({
      where: { id: loan.id },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        exportAvailableUntil
      },
      include: includeLoanGraph
    });

    if (loan.createdUserBookOnAccept) {
      await tx.userBook.deleteMany({
        where: { userId: loan.borrowerId, bookId: loan.bookId }
      });
    }

    await addLoanAuditEvent(tx, {
      loanId: loan.id,
      actorUserId: req.auth.userId,
      targetUserId: loan.borrowerId,
      action: 'LOAN_REVOKED',
      details: {
        exportAvailableUntil
      }
    });

    return next;
  });

  await emitLoanNotification(prisma, {
    userId: loan.borrowerId,
    eventKey: `loan-revoked-${loan.id}-${revoked.revokedAt?.toISOString?.() || Date.now()}`,
    kind: 'loan-revoked',
    title: 'Loan revoked',
    message: `${revoked.lender.displayName || revoked.lender.email} revoked your access to "${revoked.book.title}". Export remains available for 14 days.`,
    loanId: loan.id,
    actionType: 'open-borrowed',
    actionTargetId: loan.id
  });

  return res.json({ loan: toLoanResponse(revoked) });
});

app.get('/loans/:loanId/export', requireAuth, async (req, res) => {
  const loan = await prisma.bookLoan.findUnique({
    where: { id: req.params.loanId },
    include: includeLoanGraph
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  if (loan.borrowerId !== req.auth.userId) return res.status(403).json({ error: 'Forbidden' });

  if (!['REVOKED', 'RETURNED', 'EXPIRED'].includes(loan.status)) {
    return res.status(400).json({ error: 'Export is available only for ended loans' });
  }
  const fallbackDeadlineSource = loan.revokedAt || loan.returnedAt || loan.expiredAt || loan.updatedAt || loan.createdAt;
  const fallbackDeadline = new Date(new Date(fallbackDeadlineSource).getTime() + LOAN_EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const deadlineMs = loan.exportAvailableUntil
    ? new Date(loan.exportAvailableUntil).getTime()
    : fallbackDeadline.getTime();
  if (!Number.isFinite(deadlineMs) || Date.now() > deadlineMs) {
    return res.status(403).json({ error: 'Export window ended' });
  }

  const payload = await buildLoanExportPayload(loan, req.auth.userId);
  return res.json({ export: payload });
});

app.get('/loans/audit', requireAuth, async (req, res) => {
  const events = await prisma.loanAuditEvent.findMany({
    where: {
      OR: [
        { actorUserId: req.auth.userId },
        { targetUserId: req.auth.userId },
        { loan: { lenderId: req.auth.userId } },
        { loan: { borrowerId: req.auth.userId } }
      ]
    },
    include: {
      actorUser: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      targetUser: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      loan: {
        include: {
          book: true,
          lender: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
          borrower: { select: { id: true, email: true, displayName: true, avatarUrl: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 300
  });

  return res.json({
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      createdAt: event.createdAt,
      details: (() => {
        try {
          return event.detailsJson ? JSON.parse(event.detailsJson) : null;
        } catch {
          return null;
        }
      })(),
      actorUser: event.actorUser ? toUserResponse(event.actorUser) : null,
      targetUser: event.targetUser ? toUserResponse(event.targetUser) : null,
      loan: {
        id: event.loan.id,
        status: event.loan.status,
        durationDays: event.loan.durationDays,
        graceDays: event.loan.graceDays,
        requestedAt: event.loan.requestedAt,
        acceptedAt: event.loan.acceptedAt,
        dueAt: event.loan.dueAt,
        returnedAt: event.loan.returnedAt,
        revokedAt: event.loan.revokedAt,
        expiredAt: event.loan.expiredAt,
        book: {
          id: event.loan.book.id,
          title: event.loan.book.title,
          author: event.loan.book.author || null,
          cover: event.loan.book.cover || null
        },
        lender: toUserResponse(event.loan.lender),
        borrower: toUserResponse(event.loan.borrower)
      }
    }))
  });
});

app.get('/notifications', requireAuth, async (req, res) => {
  const notifications = await prisma.userNotification.findMany({
    where: {
      userId: req.auth.userId,
      deletedAt: null
    },
    orderBy: { createdAt: 'desc' },
    take: 500
  });
  return res.json({ notifications: notifications.map(formatNotification) });
});

app.post('/notifications/read-all', requireAuth, async (req, res) => {
  const now = new Date();
  await prisma.userNotification.updateMany({
    where: {
      userId: req.auth.userId,
      deletedAt: null,
      readAt: null
    },
    data: {
      readAt: now
    }
  });
  return res.json({ ok: true });
});

app.patch('/notifications/:notificationId', requireAuth, async (req, res) => {
  const schema = z.object({
    read: z.boolean().optional(),
    archived: z.boolean().optional(),
    deleted: z.boolean().optional()
  });
  const parsed = schema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });

  const existing = await prisma.userNotification.findUnique({
    where: { id: req.params.notificationId }
  });
  if (!existing || existing.userId !== req.auth.userId) {
    return res.status(404).json({ error: 'Notification not found' });
  }

  const now = new Date();
  const updated = await prisma.userNotification.update({
    where: { id: existing.id },
    data: {
      readAt: parsed.data.read === undefined ? existing.readAt : (parsed.data.read ? now : null),
      archivedAt: parsed.data.archived === undefined ? existing.archivedAt : (parsed.data.archived ? now : null),
      deletedAt: parsed.data.deleted === undefined ? existing.deletedAt : (parsed.data.deleted ? now : null)
    }
  });

  return res.json({ notification: formatNotification(updated) });
});

const runLoanMaintenanceJobs = async () => {
  const activeLoans = await prisma.bookLoan.findMany({
    where: { status: 'ACTIVE' },
    include: {
      ...includeLoanGraph,
      borrower: { select: { id: true, email: true, displayName: true, avatarUrl: true, loanReminderDays: true } },
      lender: { select: { id: true, email: true, displayName: true, avatarUrl: true, loanReminderDays: true } }
    }
  });

  for (const loan of activeLoans) {
    const maybeExpired = await expireLoanIfNeeded(prisma, loan, {
      include: includeLoanGraph,
      cleanupBorrowerAccess: true,
      addAuditEvent: true
    });

    if (maybeExpired.status === 'EXPIRED') {
      await prisma.loanRenewalRequest.updateMany({
        where: {
          loanId: maybeExpired.id,
          status: 'PENDING'
        },
        data: {
          status: 'EXPIRED',
          reviewedAt: new Date()
        }
      });
      await emitLoanNotification(prisma, {
        userId: maybeExpired.borrowerId,
        eventKey: `loan-expired-${maybeExpired.id}-${new Date(maybeExpired.expiredAt || maybeExpired.updatedAt).toISOString()}`,
        kind: 'loan-expired',
        title: 'Loan expired',
        message: `Your access to "${maybeExpired.book.title}" expired. Export remains available for 14 days.`,
        loanId: maybeExpired.id,
        actionType: 'open-borrowed',
        actionTargetId: maybeExpired.id
      });
      await emitLoanNotification(prisma, {
        userId: maybeExpired.lenderId,
        eventKey: `loan-expired-lender-${maybeExpired.id}-${new Date(maybeExpired.expiredAt || maybeExpired.updatedAt).toISOString()}`,
        kind: 'loan-expired',
        title: 'Borrow expired',
        message: `${maybeExpired.borrower.displayName || maybeExpired.borrower.email} no longer has access to "${maybeExpired.book.title}" (expired).`,
        loanId: maybeExpired.id,
        actionType: 'open-lent',
        actionTargetId: maybeExpired.id
      });
      continue;
    }

    if (!loan.dueAt) continue;
    const dueMs = new Date(loan.dueAt).getTime();
    if (!Number.isFinite(dueMs)) continue;
    const diffDays = Math.ceil((dueMs - Date.now()) / (24 * 60 * 60 * 1000));
    const reminderDays = Math.max(0, Number(loan.borrower?.loanReminderDays) || 0);

    if (diffDays >= 0 && reminderDays > 0 && diffDays <= reminderDays && !loan.dueSoonNotifiedAt) {
      await emitLoanNotification(prisma, {
        userId: loan.borrowerId,
        eventKey: `loan-due-soon-${loan.id}-${new Date(loan.dueAt).toISOString()}`,
        kind: 'loan-due-soon',
        title: 'Borrow due soon',
        message: `"${loan.book.title}" is due in ${diffDays} day${diffDays === 1 ? '' : 's'}.`,
        loanId: loan.id,
        actionType: 'open-borrowed',
        actionTargetId: loan.id
      });
      await prisma.bookLoan.update({
        where: { id: loan.id },
        data: { dueSoonNotifiedAt: new Date() }
      });
    }

    if (diffDays < 0 && !loan.overdueNotifiedAt) {
      await emitLoanNotification(prisma, {
        userId: loan.borrowerId,
        eventKey: `loan-overdue-${loan.id}-${new Date(loan.dueAt).toISOString()}`,
        kind: 'loan-overdue',
        title: 'Borrow overdue',
        message: `"${loan.book.title}" is overdue. Return it or request renewal.`,
        loanId: loan.id,
        actionType: 'open-borrowed',
        actionTargetId: loan.id
      });
      await emitLoanNotification(prisma, {
        userId: loan.lenderId,
        eventKey: `loan-overdue-lender-${loan.id}-${new Date(loan.dueAt).toISOString()}`,
        kind: 'loan-overdue',
        title: 'Borrower overdue',
        message: `${loan.borrower.displayName || loan.borrower.email} is overdue on "${loan.book.title}".`,
        loanId: loan.id,
        actionType: 'open-lent',
        actionTargetId: loan.id
      });
      await prisma.bookLoan.update({
        where: { id: loan.id },
        data: { overdueNotifiedAt: new Date() }
      });
    }
  }

  const endedLoans = await prisma.bookLoan.findMany({
    where: {
      status: { in: ['REVOKED', 'RETURNED', 'EXPIRED'] },
      exportAvailableUntil: { not: null },
      endedReminderNotifiedAt: null
    },
    include: includeLoanGraph
  });
  for (const loan of endedLoans) {
    const deadlineMs = new Date(loan.exportAvailableUntil).getTime();
    if (!Number.isFinite(deadlineMs) || Date.now() > deadlineMs) continue;
    await emitLoanNotification(prisma, {
      userId: loan.borrowerId,
      eventKey: `loan-export-window-${loan.id}-${new Date(loan.exportAvailableUntil).toISOString()}`,
      kind: 'loan-export-window',
      title: 'Export available',
      message: `Export your annotations for "${loan.book.title}" before ${new Date(loan.exportAvailableUntil).toLocaleString()}.`,
      loanId: loan.id,
      actionType: 'open-borrowed',
      actionTargetId: loan.id
    });
    await prisma.bookLoan.update({
      where: { id: loan.id },
      data: { endedReminderNotifiedAt: new Date() }
    });
  }
};

app.use((err, _req, res) => {
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  await prisma.$connect();
  if (config.loanSchedulerEnabled) {
    setInterval(() => {
      runLoanMaintenanceJobs().catch((err) => {
        console.error('Loan maintenance job failed', err);
      });
    }, config.loanSchedulerIntervalMs);
    runLoanMaintenanceJobs().catch((err) => {
      console.error('Initial loan maintenance job failed', err);
    });
  }
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Ariadne server listening on 0.0.0.0:${config.port}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
