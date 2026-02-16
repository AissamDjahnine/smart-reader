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

export const updateMe = async ({ displayName }) => {
  const { data } = await client.patch('/users/me', { displayName });
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
  const { data } = await client.patch(`/highlights/${highlightId}`, payload);
  return data.highlights || [];
};

export const deleteHighlightById = async (highlightId) => {
  const { data } = await client.delete(`/highlights/${highlightId}`);
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

export const getFileUrl = (bookId) => {
  const token = getToken();
  if (!API_BASE_URL || !token) return '';
  return `${API_BASE_URL}/books/${bookId}/file?token=${encodeURIComponent(token)}`;
};

export { client as collabClient };
