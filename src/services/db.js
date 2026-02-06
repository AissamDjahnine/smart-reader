import localforage from 'localforage';
import ePub from 'epubjs';

const bookStore = localforage.createInstance({ name: "SmartReaderLib" });
const mutationQueues = new Map();

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
    book.readingTime = (book.readingTime || 0) + secondsToAdd;
    book.lastRead = new Date().toISOString();
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

export const toggleFavorite = async (id) => {
  return runBookMutation(id, (book) => {
    book.isFavorite = !book.isFavorite;
    return book;
  });
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
    const idx = book.highlights.findIndex(h => h.cfiRange === cfiRange);
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
