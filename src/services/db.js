import localforage from 'localforage';
import ePub from 'epubjs';

const bookStore = localforage.createInstance({ name: "SmartReaderLib" });
const collectionsStore = localforage.createInstance({ name: "SmartReaderLib", storeName: "collections" });
const mutationQueues = new Map();
const BOOK_METADATA_VERSION = 2;
const TRASH_RETENTION_DAYS = 30;
const READING_SESSION_BREAK_MS = 10 * 60 * 1000;
const MAX_READING_SESSIONS = 180;
const DEFAULT_COLLECTION_COLOR = "#2563eb";
const ALLOWED_COLLECTION_COLORS = new Set([
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#0891b2",
  "#4b5563"
]);

const runBookMutation = async (id, mutator) => {
  const previous = mutationQueues.get(id) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const book = await bookStore.getItem(id);
      if (!book) return null;
      const nextBook = (await mutator(book)) || book;
      await bookStore.setItem(id, nextBook);
      return nextBook;
    });

  mutationQueues.set(
    id,
    current.finally(() => {
      if (mutationQueues.get(id) === current) mutationQueues.delete(id);
    })
  );

  return current;
};

const toBase64 = (url) => fetch(url)
  .then(response => response.blob())
  .then(blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }));

const toPositiveInteger = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.round(parsed));
};

const normalizeCollectionIds = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))];
};

const normalizeBookCollections = (book) => {
  if (!book || typeof book !== "object") return book;
  const normalizedIds = normalizeCollectionIds(book.collectionIds);
  const hasSameIds =
    Array.isArray(book.collectionIds) &&
    book.collectionIds.length === normalizedIds.length &&
    book.collectionIds.every((id, index) => id === normalizedIds[index]);

  if (hasSameIds) return book;
  return {
    ...book,
    collectionIds: normalizedIds
  };
};

const normalizeCollectionName = (value) => (value || "").toString().trim();
const normalizeCollectionColor = (value) => {
  const clean = (value || "").toString().trim().toLowerCase();
  return ALLOWED_COLLECTION_COLORS.has(clean) ? clean : DEFAULT_COLLECTION_COLOR;
};

const cleanGenreToken = (value) =>
  (value || "")
    .toString()
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeGenreLabel = (value) => {
  const clean = cleanGenreToken(value);
  if (!clean) return "";
  const lower = clean.toLowerCase();

  if (/\b(science fiction|sci[- ]?fi)\b/.test(lower)) return "Science Fiction";
  if (/\b(fantasy)\b/.test(lower)) return "Fantasy";
  if (/\b(horror)\b/.test(lower)) return "Horror";
  if (/\b(thriller|suspense)\b/.test(lower)) return "Thriller";
  if (/\b(mystery|crime|detective)\b/.test(lower)) return "Mystery";
  if (/\b(romance|love story)\b/.test(lower)) return "Romance";
  if (/\b(classic|classics)\b/.test(lower)) return "Classic";
  if (/\b(historical fiction|historical)\b/.test(lower)) return "Historical";
  if (/\b(poetry|poems)\b/.test(lower)) return "Poetry";
  if (/\b(drama|plays?)\b/.test(lower)) return "Drama";
  if (/\b(biography|memoir|autobiography)\b/.test(lower)) return "Biography";
  if (/\b(history)\b/.test(lower)) return "History";
  if (/\b(philosophy)\b/.test(lower)) return "Philosophy";
  if (/\b(non[- ]?fiction)\b/.test(lower)) return "Nonfiction";
  if (/\b(fiction)\b/.test(lower)) return "Fiction";

  return clean
    .split(" ")
    .map((word) => {
      if (!word) return word;
      const upper = word.toUpperCase();
      if (upper.length <= 3) return upper;
      return upper[0] + word.slice(1).toLowerCase();
    })
    .join(" ");
};

const pushGenreCandidate = (source, out) => {
  if (source == null) return;
  if (Array.isArray(source)) {
    source.forEach((item) => pushGenreCandidate(item, out));
    return;
  }
  if (typeof source === "object") {
    const keys = ["genre", "subject", "subjects", "type", "types", "value", "label", "name", "text"];
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        pushGenreCandidate(source[key], out);
      }
    });
    return;
  }
  if (typeof source !== "string") return;
  source
    .split(/[,;|/]/)
    .map((item) => cleanGenreToken(item))
    .filter(Boolean)
    .forEach((item) => out.push(item));
};

const extractGenre = (metadata = {}) => {
  const candidates = [];
  [
    metadata.genre,
    metadata.subject,
    metadata.subjects,
    metadata.type,
    metadata.types,
    metadata["dc:subject"],
    metadata["dc:type"],
    metadata.subjectterm,
    metadata.tags
  ].forEach((value) => pushGenreCandidate(value, candidates));

  for (const candidate of candidates) {
    const normalized = normalizeGenreLabel(candidate);
    if (normalized) return normalized;
  }
  return "";
};

const estimatePageCount = async (book) => {
  try {
    // epub.js location chunks are a practical approximation for "pages".
    await book.ready;
    await book.locations.generate(1024);
    const generatedTotal = toPositiveInteger(book.locations?.total);
    if (generatedTotal) return generatedTotal;
  } catch (err) {
    console.error("Page estimation fallback engaged", err);
  }

  const spineCount = Array.isArray(book?.packaging?.spine) ? book.packaging.spine.length : 0;
  if (spineCount > 0) {
    return toPositiveInteger(spineCount * 8);
  }

  return null;
};

export const readEpubMetadata = async (file) => {
  const book = ePub(file);
  try {
    const metadata = await book.loaded.metadata;
    const estimatedPages = await estimatePageCount(book);
    const genre = extractGenre(metadata);
    const rawCoverUrl = await book.coverUrl();

    let finalCover = null;
    if (rawCoverUrl) {
      try {
        finalCover = await toBase64(rawCoverUrl);
      } catch (err) {
        console.error("Cover conversion failed", err);
      }
    }

    return {
      metadata,
      estimatedPages,
      genre,
      cover: finalCover
    };
  } finally {
    try {
      book.destroy();
    } catch (err) {
      console.error(err);
    }
  }
};

const needsMetadataBackfill = (book) => {
  if (!book) return false;
  if (!book.data) return false;
  if ((book.metadataVersion || 0) < BOOK_METADATA_VERSION) return true;

  const missingLanguage = !String(book.language || "").trim();
  const missingPages = !toPositiveInteger(book.estimatedPages);
  const missingGenreField = typeof book.genre !== "string";
  return missingLanguage || missingPages || missingGenreField;
};

export const addBook = async (file, options = {}) => {
  const id = Date.now().toString();
  const prepared = options.preparedMetadata || (await readEpubMetadata(file));
  const metadata = prepared?.metadata || {};
  const estimatedPages = prepared?.estimatedPages || null;
  const genre = prepared?.genre || extractGenre(metadata) || "";
  const finalCover = prepared?.cover || null;
  const baseTitle = metadata.title || file.name.replace('.epub', '');
  const bookTitle = options.titleOverride || baseTitle;

  const newBook = {
    id,
    title: bookTitle,
    author: metadata.creator || "Unknown Author",
    language: metadata.language || "",
    genre: genre || "",
    estimatedPages: estimatedPages || null,
    metadataVersion: BOOK_METADATA_VERSION,
    publisher: metadata.publisher || "Unknown Publisher",
    pubDate: metadata.pubdate || "",
    epubMetadata: metadata || {},
    cover: finalCover,
    data: file,
    progress: 0,
    hasStarted: false,
    highlights: [],
    bookmarks: [],
    readerSettings: {
      fontSize: 100,
      theme: 'light',
      flow: 'paginated',
      fontFamily: 'publisher'
    },
    isFavorite: false,
    isToRead: false,
    collectionIds: [],
    isDeleted: false,
    deletedAt: null,
    readingTime: 0,
    readingSessions: [],
    lastRead: new Date().toISOString(),
    addedAt: new Date(),
    // AI Summarization Fields
    aiSummaries: [], // Legacy: mixed page/chapter summaries (kept for backward compatibility)
    pageSummaries: [], // Array of { pageKey: string, summary: string }
    chapterSummaries: [], // Array of { chapterHref: string, summary: string }
    globalSummary: "" // The running story memory for "Story so far"
  };
  
  await bookStore.setItem(id, newBook);
  return newBook;
};

export const getAllBooks = async () => {
  const books = [];
  await bookStore.iterate((value, key) => {
    const normalized = normalizeBookCollections(value);
    books.push(normalized);
  });
  return books.sort((a, b) => {
    if (a.isFavorite === b.isFavorite) {
      return new Date(b.addedAt) - new Date(a.addedAt);
    }
    return a.isFavorite ? -1 : 1;
  });
};

export const purgeExpiredTrashBooks = async (retentionDays = TRASH_RETENTION_DAYS) => {
  const cutoffMs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const idsToDelete = [];

  await bookStore.iterate((value, key) => {
    if (!value?.isDeleted) return;
    const deletedAtMs = new Date(value.deletedAt || 0).getTime();
    if (!Number.isFinite(deletedAtMs)) return;
    if (deletedAtMs <= cutoffMs) {
      idsToDelete.push(key);
    }
  });

  await Promise.all(
    idsToDelete.map(async (id) => {
      await bookStore.removeItem(id);
      mutationQueues.delete(id);
    })
  );

  return idsToDelete.length;
};

export const backfillBookMetadata = async (id) => {
  return runBookMutation(id, async (book) => {
    if (!needsMetadataBackfill(book)) {
      return book;
    }

    try {
      const epub = ePub(book.data);
      const metadata = await epub.loaded.metadata;
      const estimatedPages = await estimatePageCount(epub);
      const genre = extractGenre(metadata);

      const language = String(book.language || "").trim() || metadata.language || "";
      const nextPages = toPositiveInteger(book.estimatedPages) || estimatedPages || null;
      const nextGenre = typeof book.genre === "string" && book.genre.trim()
        ? book.genre.trim()
        : (genre || "");

      const isChanged =
        language !== (book.language || "") ||
        nextPages !== (book.estimatedPages || null) ||
        nextGenre !== (book.genre || "") ||
        (book.metadataVersion || 0) < BOOK_METADATA_VERSION;

      if (!isChanged) {
        return book;
      }

      return {
        ...book,
        language,
        estimatedPages: nextPages,
        genre: nextGenre,
        epubMetadata: metadata || book.epubMetadata || {},
        metadataVersion: BOOK_METADATA_VERSION
      };
    } catch (err) {
      console.error("Book metadata backfill failed", err);
      return book;
    }
  });
};

export const getBook = async (id) => await bookStore.getItem(id);

export const updateBookProgress = async (id, location, percentage) => {
  await runBookMutation(id, (book) => {
    book.lastLocation = location;
    book.progress = Math.min(Math.max(Math.floor(percentage * 100), 0), 100); 
    book.lastRead = new Date().toISOString();
    return book;
  });
};

export const updateBookReaderSettings = async (id, readerSettings) => {
  const updatedBook = await runBookMutation(id, (book) => {
    const current = book.readerSettings || {};
    book.readerSettings = {
      ...current,
      ...readerSettings
    };
    return book;
  });
  return updatedBook ? updatedBook.readerSettings : null;
};

export const updateReadingStats = async (id, secondsToAdd) => {
  return runBookMutation(id, (book) => {
    const safeSeconds = Math.max(0, Number(secondsToAdd) || 0);
    const now = new Date();
    const nowIso = now.toISOString();
    const nowMs = now.getTime();

    book.readingTime = (book.readingTime || 0) + safeSeconds;
    book.lastRead = nowIso;

    if (!Array.isArray(book.readingSessions)) {
      book.readingSessions = [];
    }

    if (safeSeconds > 0) {
      const sessions = [...book.readingSessions];
      const lastSession = sessions[sessions.length - 1];
      const lastEndMs = lastSession
        ? new Date(lastSession.endAt || lastSession.startAt || 0).getTime()
        : NaN;
      const shouldExtendLast =
        Number.isFinite(lastEndMs) && (nowMs - lastEndMs <= READING_SESSION_BREAK_MS);

      if (shouldExtendLast) {
        lastSession.endAt = nowIso;
        lastSession.seconds = (Number(lastSession.seconds) || 0) + safeSeconds;
      } else {
        sessions.push({
          startAt: nowIso,
          endAt: nowIso,
          seconds: safeSeconds
        });
      }

      book.readingSessions = sessions.slice(-MAX_READING_SESSIONS);
    }
    return book;
  });
};

export const markBookStarted = async (id) => {
  return runBookMutation(id, (book) => {
    if (!book.hasStarted) {
      book.hasStarted = true;
    }
    book.lastRead = new Date().toISOString();
    return book;
  });
};

// NEW: Save a chapter summary and update the global story summary
export const saveChapterSummary = async (bookId, chapterHref, chapterSummary, newGlobalSummary) => {
  return runBookMutation(bookId, (book) => {
    if (!book.chapterSummaries) book.chapterSummaries = [];
    
    // Check if we already have a summary for this chapter to avoid duplicates
    const index = book.chapterSummaries.findIndex(s => s.chapterHref === chapterHref);
    if (index > -1) {
      book.chapterSummaries[index].summary = chapterSummary;
    } else {
      book.chapterSummaries.push({ chapterHref, summary: chapterSummary });
    }

    book.globalSummary = newGlobalSummary;
    return book;
  });
};

export const savePageSummary = async (bookId, pageKey, pageSummary, newGlobalSummary) => {
  return runBookMutation(bookId, (book) => {
    if (!book.pageSummaries) book.pageSummaries = [];

    const index = book.pageSummaries.findIndex(s => s.pageKey === pageKey);
    if (index > -1) {
      book.pageSummaries[index].summary = pageSummary;
    } else {
      book.pageSummaries.push({ pageKey, summary: pageSummary });
    }

    book.globalSummary = newGlobalSummary;
    return book;
  });
};

export const deleteBook = async (id) => {
  await bookStore.removeItem(id);
  mutationQueues.delete(id);
};

export const moveBookToTrash = async (id) => {
  return runBookMutation(id, (book) => {
    book.isDeleted = true;
    book.deletedAt = new Date().toISOString();
    return book;
  });
};

export const restoreBookFromTrash = async (id) => {
  return runBookMutation(id, (book) => {
    book.isDeleted = false;
    book.deletedAt = null;
    return book;
  });
};

export const toggleFavorite = async (id) => {
  return runBookMutation(id, (book) => {
    book.isFavorite = !book.isFavorite;
    return book;
  });
};

export const toggleToRead = async (id) => {
  return runBookMutation(id, (book) => {
    book.isToRead = !Boolean(book.isToRead);
    return book;
  });
};

export const getAllCollections = async () => {
  const collections = [];
  await collectionsStore.iterate((value) => {
    if (!value || typeof value !== "object") return;
    collections.push({
      id: value.id,
      name: normalizeCollectionName(value.name),
      color: normalizeCollectionColor(value.color),
      createdAt: value.createdAt || new Date().toISOString(),
      updatedAt: value.updatedAt || value.createdAt || new Date().toISOString()
    });
  });
  return collections
    .filter((item) => item.id && item.name)
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.name.localeCompare(right.name);
    });
};

export const createCollection = async (name, color = DEFAULT_COLLECTION_COLOR) => {
  const cleanName = normalizeCollectionName(name);
  if (!cleanName) throw new Error("Collection name is required.");
  const existing = await getAllCollections();
  const exists = existing.some((item) => item.name.toLowerCase() === cleanName.toLowerCase());
  if (exists) throw new Error("A collection with that name already exists.");

  const now = new Date().toISOString();
  const id = `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const collection = {
    id,
    name: cleanName,
    color: normalizeCollectionColor(color),
    createdAt: now,
    updatedAt: now
  };
  await collectionsStore.setItem(id, collection);
  return collection;
};

export const renameCollection = async (id, name) => {
  if (!id) throw new Error("Collection id is required.");
  const cleanName = normalizeCollectionName(name);
  if (!cleanName) throw new Error("Collection name is required.");

  const existing = await getAllCollections();
  const duplicate = existing.some(
    (item) => item.id !== id && item.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (duplicate) throw new Error("A collection with that name already exists.");

  const current = await collectionsStore.getItem(id);
  if (!current) throw new Error("Collection not found.");

  const next = {
    ...current,
    name: cleanName,
    color: normalizeCollectionColor(current.color),
    updatedAt: new Date().toISOString()
  };
  await collectionsStore.setItem(id, next);
  return next;
};

export const deleteCollection = async (id) => {
  if (!id) return;
  await collectionsStore.removeItem(id);

  const pending = [];
  await bookStore.iterate((value, key) => {
    const normalizedIds = normalizeCollectionIds(value?.collectionIds);
    if (!normalizedIds.includes(id)) return;
    pending.push(
      runBookMutation(key, (book) => {
        book.collectionIds = normalizeCollectionIds(book.collectionIds).filter((item) => item !== id);
        return book;
      })
    );
  });
  if (pending.length) await Promise.all(pending);
};

export const toggleBookCollection = async (bookId, collectionId) => {
  if (!bookId || !collectionId) return [];
  const collection = await collectionsStore.getItem(collectionId);
  if (!collection) throw new Error("Collection not found.");

  const updatedBook = await runBookMutation(bookId, (book) => {
    const current = normalizeCollectionIds(book.collectionIds);
    const exists = current.includes(collectionId);
    book.collectionIds = exists
      ? current.filter((item) => item !== collectionId)
      : [...current, collectionId];
    return book;
  });
  return normalizeCollectionIds(updatedBook?.collectionIds);
};

export const saveHighlight = async (bookId, highlight) => {
  const updatedBook = await runBookMutation(bookId, (book) => {
    if (!book.highlights) book.highlights = [];
    const idx = book.highlights.findIndex((h) => h.cfiRange === highlight.cfiRange);
    if (idx > -1) {
      const previous = book.highlights[idx];
      book.highlights[idx] = {
        ...previous,
        ...highlight,
        note: previous.note || highlight.note || ''
      };
    } else {
      book.highlights.push(highlight);
    }
    return book;
  });
  return updatedBook?.highlights || [];
};

export const updateHighlightNote = async (bookId, cfiRange, note) => {
  const updatedBook = await runBookMutation(bookId, (book) => {
    if (!book.highlights) book.highlights = [];
    const normalizeCfi = (value) => (value || '').toString().replace(/\s+/g, '');
    const targetCfi = normalizeCfi(cfiRange);
    const idx = book.highlights.findIndex((h) => {
      const sourceCfi = normalizeCfi(h?.cfiRange);
      if (!sourceCfi || !targetCfi) return false;
      return (
        sourceCfi === targetCfi ||
        sourceCfi.includes(targetCfi) ||
        targetCfi.includes(sourceCfi)
      );
    });
    if (idx > -1) {
      book.highlights[idx].note = note;
    }
    return book;
  });
  return updatedBook?.highlights || [];
};

export const deleteHighlight = async (bookId, cfiRange) => {
  const updatedBook = await runBookMutation(bookId, (book) => {
    book.highlights = book.highlights.filter(h => h.cfiRange !== cfiRange);
    return book;
  });
  return updatedBook?.highlights || [];
};

export const saveBookmark = async (bookId, bookmark) => {
  const updatedBook = await runBookMutation(bookId, (book) => {
    if (!book.bookmarks) book.bookmarks = [];
    const exists = book.bookmarks.some((b) => b.cfi === bookmark.cfi);
    if (!exists) {
      book.bookmarks.push(bookmark);
    }
    return book;
  });
  return updatedBook?.bookmarks || [];
};

export const deleteBookmark = async (bookId, cfi) => {
  const updatedBook = await runBookMutation(bookId, (book) => {
    book.bookmarks = (book.bookmarks || []).filter(b => b.cfi !== cfi);
    return book;
  });
  return updatedBook?.bookmarks || [];
};
