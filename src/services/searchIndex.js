import localforage from "localforage";

const searchIndexStore = localforage.createInstance({
  name: "SmartReaderLib",
  storeName: "searchIndex"
});

const SEARCH_INDEX_VERSION = 1;
const SEARCH_INDEX_KEY = "global";

const compactWhitespace = (value) => (value || "").toString().replace(/\s+/g, " ").trim();
const normalizeForSearch = (value) => compactWhitespace(value).toLowerCase();

const normalizeLanguage = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.trim().replace("_", "-");
  const primaryCode = normalized.split("-")[0].toLowerCase();
  if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
    try {
      const display = new Intl.DisplayNames(["en"], { type: "language" }).of(primaryCode);
      if (display) return display;
    } catch (err) {
      console.error(err);
    }
  }
  return primaryCode.toUpperCase();
};

const hashString = (input) => {
  let hash = 2166136261;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
};

const toSearchSignature = (book, metadataText, highlightEntries, noteEntries, bookmarkEntries) => {
  const payload = [
    book?.id || "",
    metadataText,
    ...highlightEntries.map((entry) => `${entry.cfi}::${entry.normalized}`),
    ...noteEntries.map((entry) => `${entry.cfi}::${entry.normalized}`),
    ...bookmarkEntries.map((entry) => `${entry.cfi}::${entry.normalized}`)
  ].join("|");
  return `${payload.length}:${hashString(payload)}`;
};

export const buildBookSearchRecord = (book) => {
  const metadataText = normalizeForSearch(
    [
      book?.title || "",
      book?.author || "",
      normalizeLanguage(book?.language || ""),
      book?.genre || ""
    ]
      .filter(Boolean)
      .join(" ")
  );

  const highlights = Array.isArray(book?.highlights) ? book.highlights : [];
  const bookmarks = Array.isArray(book?.bookmarks) ? book.bookmarks : [];

  const highlightEntries = highlights
    .map((highlight, index) => {
      const text = compactWhitespace(highlight?.text || "");
      if (!text) return null;
      return {
        id: `${book?.id || "book"}-highlight-${highlight?.cfiRange || index}`,
        cfi: highlight?.cfiRange || "",
        text,
        normalized: normalizeForSearch(text)
      };
    })
    .filter(Boolean);

  const noteEntries = highlights
    .map((highlight, index) => {
      const text = compactWhitespace(highlight?.note || "");
      if (!text) return null;
      return {
        id: `${book?.id || "book"}-note-${highlight?.cfiRange || index}`,
        cfi: highlight?.cfiRange || "",
        text,
        normalized: normalizeForSearch(text)
      };
    })
    .filter(Boolean);

  const bookmarkEntries = bookmarks
    .map((bookmark, index) => {
      const text = compactWhitespace([bookmark?.label || "", bookmark?.text || ""].filter(Boolean).join(" "));
      if (!text) return null;
      return {
        id: `${book?.id || "book"}-bookmark-${bookmark?.cfi || index}`,
        cfi: bookmark?.cfi || "",
        text,
        normalized: normalizeForSearch(text)
      };
    })
    .filter(Boolean);

  const fullText = normalizeForSearch(
    [metadataText]
      .concat(highlightEntries.map((entry) => entry.text))
      .concat(noteEntries.map((entry) => entry.text))
      .concat(bookmarkEntries.map((entry) => entry.text))
      .join(" ")
  );

  return {
    version: SEARCH_INDEX_VERSION,
    id: book?.id || "",
    metadataText,
    fullText,
    highlights: highlightEntries,
    notes: noteEntries,
    bookmarks: bookmarkEntries,
    signature: toSearchSignature(book, metadataText, highlightEntries, noteEntries, bookmarkEntries),
    updatedAt: new Date().toISOString()
  };
};

export const syncSearchIndexFromBooks = async (books = []) => {
  const snapshot = await searchIndexStore.getItem(SEARCH_INDEX_KEY);
  const previousBooks =
    snapshot && snapshot.version === SEARCH_INDEX_VERSION && snapshot.books && typeof snapshot.books === "object"
      ? snapshot.books
      : {};

  const activeBooks = Array.isArray(books)
    ? books.filter((book) => book && !book.isDeleted && typeof book.id === "string")
    : [];

  let changed = snapshot?.version !== SEARCH_INDEX_VERSION;
  const nextBooks = {};

  for (const book of activeBooks) {
    const nextRecord = buildBookSearchRecord(book);
    const previousRecord = previousBooks[book.id];
    if (
      previousRecord &&
      previousRecord.version === SEARCH_INDEX_VERSION &&
      previousRecord.signature === nextRecord.signature
    ) {
      nextBooks[book.id] = previousRecord;
      continue;
    }
    nextBooks[book.id] = nextRecord;
    changed = true;
  }

  if (!changed) {
    const previousIds = Object.keys(previousBooks);
    if (previousIds.length !== Object.keys(nextBooks).length) {
      changed = true;
    }
  }

  if (!changed) {
    return previousBooks;
  }

  const nextSnapshot = {
    version: SEARCH_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    books: nextBooks
  };
  await searchIndexStore.setItem(SEARCH_INDEX_KEY, nextSnapshot);
  return nextBooks;
};

export const getSearchIndexSnapshot = async () => {
  const snapshot = await searchIndexStore.getItem(SEARCH_INDEX_KEY);
  if (!snapshot || snapshot.version !== SEARCH_INDEX_VERSION || typeof snapshot.books !== "object") {
    return {};
  }
  return snapshot.books;
};

export const clearSearchIndex = async () => {
  await searchIndexStore.removeItem(SEARCH_INDEX_KEY);
};

