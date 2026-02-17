import axios from 'axios';
import { getToken, setCurrentUser, setSession } from './session';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
export const isCollabMode = Boolean(API_BASE_URL);

const client = axios.create({
  baseURL: API_BASE_URL || undefined,
  timeout: 20000
});

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authLogin = async ({ email, password }) => {
  const { data } = await client.post('/auth/login', { email, password });
  setSession(data);
  return data;
};

export const authRegister = async ({ email, password, displayName }) => {
  const { data } = await client.post('/auth/register', { email, password, displayName });
  setSession(data);
  return data;
};

export const authMe = async () => {
  const { data } = await client.get('/auth/me');
  return data.user;
};

export const updateMe = async ({ displayName, loanReminderDays }) => {
  const payload = { displayName };
  if (loanReminderDays !== undefined) payload.loanReminderDays = loanReminderDays;
  const { data } = await client.patch('/users/me', payload);
  if (data?.user) setCurrentUser(data.user);
  return data.user;
};

export const uploadMyAvatar = async (file) => {
  const payload = new FormData();
  payload.append('avatar', file);
  const { data } = await client.post('/users/me/avatar', payload, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  if (data?.user) setCurrentUser(data.user);
  return data.user;
};

export const fetchBooks = async () => {
  const { data } = await client.get('/books');
  return data.books || [];
};

export const createOrAttachBook = async ({ file, epubHash, title, author, language, cover, bookId }) => {
  const payload = new FormData();
  if (file) payload.append('file', file);
  if (epubHash) payload.append('epubHash', epubHash);
  if (title) payload.append('title', title);
  if (author) payload.append('author', author);
  if (language) payload.append('language', language);
  if (cover) payload.append('cover', cover);
  if (bookId) payload.append('bookId', bookId);

  const { data } = await client.post('/books', payload, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data.book;
};

export const fetchBook = async (bookId) => {
  const { data } = await client.get(`/books/${bookId}`);
  return data.book;
};

export const removeBookFromLibrary = async (bookId) => {
  const { data } = await client.delete(`/books/${bookId}`);
  return data.ok;
};

export const setBookTrashState = async (bookId, deleted) => {
  const { data } = await client.patch(`/books/${bookId}/trash`, { deleted: Boolean(deleted) });
  return data.book;
};

export const fetchBookBinary = async (bookId) => {
  const { data } = await client.get(`/books/${bookId}/file`, {
    responseType: 'arraybuffer'
  });
  return data;
};

export const saveProgress = async (bookId, progressPercent, progressCfi) => {
  const { data } = await client.patch(`/books/${bookId}/progress`, { progressPercent, progressCfi });
  return data.book;
};

export const fetchHighlights = async (bookId) => {
  const { data } = await client.get(`/books/${bookId}/highlights`);
  return data.highlights || [];
};

export const createHighlight = async (bookId, payload) => {
  const { data } = await client.post(`/books/${bookId}/highlights`, payload);
  return data.highlights || [];
};

export const updateHighlightById = async (highlightId, payload) => {
  const headers = {};
  if (Number.isInteger(payload?.expectedRevision) && payload.expectedRevision > 0) {
    headers['if-match-revision'] = String(payload.expectedRevision);
  }
  const { ...rest } = payload || {};
  const { data } = await client.patch(`/highlights/${highlightId}`, rest, {
    headers
  });
  return data.highlights || [];
};

export const deleteHighlightById = async (highlightId, { expectedRevision } = {}) => {
  const headers = {};
  if (Number.isInteger(expectedRevision) && expectedRevision > 0) {
    headers['if-match-revision'] = String(expectedRevision);
  }
  const { data } = await client.delete(`/highlights/${highlightId}`, {
    headers
  });
  return data.highlights || [];
};

export const createBookShare = async ({ bookId, epubHash, toEmail, message }) => {
  const { data } = await client.post('/shares/books', { bookId, epubHash, toEmail, message });
  return data.share;
};

export const fetchShareInbox = async () => {
  const { data } = await client.get('/shares/inbox');
  return data.shares || [];
};

export const acceptShare = async (shareId) => {
  const { data } = await client.post(`/shares/${shareId}/accept`);
  return data.share;
};

export const rejectShare = async (shareId) => {
  const { data } = await client.post(`/shares/${shareId}/reject`);
  return data.share;
};

export const borrowFromShare = async (shareId, { borrowAnyway = false } = {}) => {
  const { data } = await client.post(`/shares/${shareId}/borrow`, { borrowAnyway });
  return data;
};

export const requestBookLoan = async ({
  bookId,
  epubHash,
  toEmail,
  message,
  durationDays,
  graceDays,
  permissions
}) => {
  const { data } = await client.post('/loans/books', {
    bookId,
    epubHash,
    toEmail,
    message,
    durationDays,
    graceDays,
    permissions
  });
  return data.loan;
};

export const fetchLoanInbox = async () => {
  const { data } = await client.get('/loans/inbox');
  return data.loans || [];
};

export const fetchLoanTemplate = async () => {
  const { data } = await client.get('/loans/templates/default');
  return data.template;
};

export const updateLoanTemplate = async (payload) => {
  const { data } = await client.put('/loans/templates/default', payload);
  return data.template;
};

export const acceptLoan = async (loanId, { borrowAnyway = false } = {}) => {
  const { data } = await client.post(`/loans/${loanId}/accept`, { borrowAnyway });
  return data;
};

export const rejectLoan = async (loanId) => {
  const { data } = await client.post(`/loans/${loanId}/reject`);
  return data.loan;
};

export const fetchBorrowedLoans = async () => {
  const { data } = await client.get('/loans/borrowed');
  return data.loans || [];
};

export const fetchLentLoans = async () => {
  const { data } = await client.get('/loans/lent');
  return data.loans || [];
};

export const fetchLoanRenewals = async () => {
  const { data } = await client.get('/loans/renewals');
  return data.renewals || [];
};

export const requestLoanRenewal = async (loanId, payload) => {
  const { data } = await client.post(`/loans/${loanId}/renewals`, payload);
  return data.renewal;
};

export const approveLoanRenewal = async (renewalId, payload = {}) => {
  const { data } = await client.post(`/loans/renewals/${renewalId}/approve`, payload);
  return data.renewal;
};

export const denyLoanRenewal = async (renewalId, payload = {}) => {
  const { data } = await client.post(`/loans/renewals/${renewalId}/deny`, payload);
  return data.renewal;
};

export const cancelLoanRenewal = async (renewalId) => {
  const { data } = await client.post(`/loans/renewals/${renewalId}/cancel`);
  return data.renewal;
};

export const returnLoan = async (loanId, { exportAnnotations = false } = {}) => {
  const { data } = await client.post(`/loans/${loanId}/return`, { exportAnnotations });
  return data;
};

export const revokeLoan = async (loanId) => {
  const { data } = await client.post(`/loans/${loanId}/revoke`);
  return data.loan;
};

export const exportLoanData = async (loanId) => {
  const { data } = await client.get(`/loans/${loanId}/export`);
  return data.export;
};

export const exportRevokedLoanData = exportLoanData;

export const fetchLoanAudit = async () => {
  const { data } = await client.get('/loans/audit');
  return data.events || [];
};

export const fetchNotifications = async () => {
  const { data } = await client.get('/notifications');
  return data.notifications || [];
};

export const markAllNotificationsRead = async () => {
  const { data } = await client.post('/notifications/read-all');
  return data.ok;
};

export const patchNotification = async (notificationId, payload) => {
  const { data } = await client.patch(`/notifications/${notificationId}`, payload);
  return data.notification;
};

export const getFileUrl = (bookId) => {
  const token = getToken();
  if (!API_BASE_URL || !token) return '';
  return `${API_BASE_URL}/books/${bookId}/file?token=${encodeURIComponent(token)}`;
};

export { client as collabClient };
