import localforage from 'localforage';
import ePub from 'epubjs';

const bookStore = localforage.createInstance({ name: "SmartReaderLib" });

const toBase64 = (url) => fetch(url)
  .then(response => response.blob())
  .then(blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }));

export const addBook = async (file) => {
  const id = Date.now().toString();
  const book = ePub(file);
  const metadata = await book.loaded.metadata;
  const rawCoverUrl = await book.coverUrl();
  
  let finalCover = null;
  if (rawCoverUrl) {
    try {
      finalCover = await toBase64(rawCoverUrl);
    } catch (err) {
      console.error("Cover conversion failed", err);
    }
  }

  const newBook = {
    id,
    title: metadata.title || file.name.replace('.epub', ''),
    author: metadata.creator || "Unknown Author",
    publisher: metadata.publisher || "Unknown Publisher",
    pubDate: metadata.pubdate || "",
    cover: finalCover,
    data: file,
    progress: 0,
    highlights: [],
    bookmarks: [],
    isFavorite: false,
    readingTime: 0,
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
  await bookStore.iterate((value) => { books.push(value); });
  return books.sort((a, b) => {
    if (a.isFavorite === b.isFavorite) {
      return new Date(b.addedAt) - new Date(a.addedAt);
    }
    return a.isFavorite ? -1 : 1;
  });
};

export const getBook = async (id) => await bookStore.getItem(id);

export const updateBookProgress = async (id, location, percentage) => {
  const book = await bookStore.getItem(id);
  if (book) {
    book.lastLocation = location;
    book.progress = Math.min(Math.max(Math.floor(percentage * 100), 0), 100); 
    book.lastRead = new Date().toISOString();
    await bookStore.setItem(id, book);
  }
};

export const updateReadingStats = async (id, secondsToAdd) => {
  const book = await bookStore.getItem(id);
  if (book) {
    book.readingTime = (book.readingTime || 0) + secondsToAdd;
    book.lastRead = new Date().toISOString();
    await bookStore.setItem(id, book);
    return book;
  }
};

// NEW: Save a chapter summary and update the global story summary
export const saveChapterSummary = async (bookId, chapterHref, chapterSummary, newGlobalSummary) => {
  const book = await bookStore.getItem(bookId);
  if (book) {
    if (!book.chapterSummaries) book.chapterSummaries = [];
    
    // Check if we already have a summary for this chapter to avoid duplicates
    const index = book.chapterSummaries.findIndex(s => s.chapterHref === chapterHref);
    if (index > -1) {
      book.chapterSummaries[index].summary = chapterSummary;
    } else {
      book.chapterSummaries.push({ chapterHref, summary: chapterSummary });
    }

    book.globalSummary = newGlobalSummary;
    await bookStore.setItem(bookId, book);
    return book;
  }
};

export const savePageSummary = async (bookId, pageKey, pageSummary, newGlobalSummary) => {
  const book = await bookStore.getItem(bookId);
  if (book) {
    if (!book.pageSummaries) book.pageSummaries = [];

    const index = book.pageSummaries.findIndex(s => s.pageKey === pageKey);
    if (index > -1) {
      book.pageSummaries[index].summary = pageSummary;
    } else {
      book.pageSummaries.push({ pageKey, summary: pageSummary });
    }

    book.globalSummary = newGlobalSummary;
    await bookStore.setItem(bookId, book);
    return book;
  }
};

export const deleteBook = async (id) => {
  await bookStore.removeItem(id);
};

export const toggleFavorite = async (id) => {
  const book = await bookStore.getItem(id);
  if (book) {
    book.isFavorite = !book.isFavorite;
    await bookStore.setItem(id, book);
    return book;
  }
};

export const saveHighlight = async (bookId, highlight) => {
  const book = await bookStore.getItem(bookId);
  if (book) {
    if (!book.highlights) book.highlights = [];
    book.highlights.push(highlight);
    await bookStore.setItem(bookId, book);
    return book.highlights;
  }
  return [];
};

export const deleteHighlight = async (bookId, cfiRange) => {
  const book = await bookStore.getItem(bookId);
  if (book) {
    book.highlights = book.highlights.filter(h => h.cfiRange !== cfiRange);
    await bookStore.setItem(bookId, book);
    return book.highlights;
  }
  return [];
};

export const saveBookmark = async (bookId, bookmark) => {
  const book = await bookStore.getItem(bookId);
  if (book) {
    if (!book.bookmarks) book.bookmarks = [];
    const exists = book.bookmarks.some((b) => b.cfi === bookmark.cfi);
    if (!exists) {
      book.bookmarks.push(bookmark);
      await bookStore.setItem(bookId, book);
    }
    return book.bookmarks;
  }
  return [];
};

export const deleteBookmark = async (bookId, cfi) => {
  const book = await bookStore.getItem(bookId);
  if (book) {
    book.bookmarks = (book.bookmarks || []).filter(b => b.cfi !== cfi);
    await bookStore.setItem(bookId, book);
    return book.bookmarks;
  }
  return [];
};
