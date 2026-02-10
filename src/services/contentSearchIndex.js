import localforage from "localforage";
import ePub from "epubjs";

const contentSearchStore = localforage.createInstance({
  name: "SmartReaderLib",
  storeName: "contentSearch"
});

const CONTENT_INDEX_VERSION = 1;
const MANIFEST_KEY = "__manifest__";
const BOOK_KEY_PREFIX = "book:";

const compactWhitespace = (value) => (value || "").toString().replace(/\s+/g, " ").trim();
const normalizeText = (value) => compactWhitespace(value).toLowerCase();
const normalizeHref = (href = "") => href.split("#")[0];

const flattenToc = (items, acc = []) => {
  if (!Array.isArray(items)) return acc;
  items.forEach((item) => {
    if (!item) return;
    const href = typeof item.href === "string" ? item.href : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (href && label) {
      acc.push({ href: normalizeHref(href), label });
    }
    if (Array.isArray(item.subitems) && item.subitems.length) {
      flattenToc(item.subitems, acc);
    }
  });
  return acc;
};

const getBookStoreKey = (bookId) => `${BOOK_KEY_PREFIX}${bookId}`;

const resolveChapterLabel = (sectionHref, tocEntries) => {
  const normalizedSectionHref = normalizeHref(sectionHref || "");
  if (!normalizedSectionHref) return "";
  const match = tocEntries.find((entry) => {
    const tocHref = normalizeHref(entry.href || "");
    if (!tocHref) return false;
    return normalizedSectionHref.includes(tocHref) || tocHref.includes(normalizedSectionHref);
  });
  return match?.label || "";
};

const getRawSectionText = (section) => {
  const documentFromSection = section?.document || section?.contents?.document || null;
  const rawText = documentFromSection?.body?.textContent || "";
  return compactWhitespace(rawText);
};

export const getBookContentIndexSignature = (book) => {
  const data = book?.data;
  const size = Number(data?.size) || 0;
  const lastModified = Number(data?.lastModified) || 0;
  const fileName = typeof data?.name === "string" ? data.name : "";
  return `${book?.id || ""}:${size}:${lastModified}:${fileName}`;
};

export const loadContentSearchManifest = async () => {
  const manifest = await contentSearchStore.getItem(MANIFEST_KEY);
  if (
    !manifest ||
    manifest.version !== CONTENT_INDEX_VERSION ||
    !manifest.books ||
    typeof manifest.books !== "object"
  ) {
    return {
      version: CONTENT_INDEX_VERSION,
      books: {}
    };
  }
  return manifest;
};

export const getContentSearchIndexRecord = async (bookId) => {
  if (!bookId) return null;
  const record = await contentSearchStore.getItem(getBookStoreKey(bookId));
  if (!record || record.version !== CONTENT_INDEX_VERSION) return null;
  return record;
};

const buildBookContentIndexRecord = async (book) => {
  if (!book?.data || !book?.id) return null;
  const epub = ePub(book.data);
  try {
    await epub.ready;
    const navigation = epub?.loaded?.navigation ? await epub.loaded.navigation : null;
    const tocEntries = flattenToc(navigation?.toc || []);
    const spineItems = Array.isArray(epub?.spine?.spineItems) ? epub.spine.spineItems : [];
    const sections = [];

    for (let index = 0; index < spineItems.length; index += 1) {
      const section = spineItems[index];
      if (!section || section.linear === "no" || section.linear === false) continue;
      try {
        await section.load(epub.load.bind(epub));
        const rawText = getRawSectionText(section);
        if (!rawText) continue;
        sections.push({
          id: section.idref || section.href || `section-${index}`,
          href: normalizeHref(section.href || ""),
          chapterLabel: resolveChapterLabel(section.href || "", tocEntries),
          preview: rawText.slice(0, 420),
          text: normalizeText(rawText)
        });
      } finally {
        section.unload();
      }
    }

    return {
      version: CONTENT_INDEX_VERSION,
      bookId: book.id,
      signature: getBookContentIndexSignature(book),
      builtAt: new Date().toISOString(),
      sections
    };
  } finally {
    try {
      epub.destroy();
    } catch (err) {
      console.error(err);
    }
  }
};

export const ensureContentSearchIndexes = async (books = [], options = {}) => {
  const isCancelled = typeof options.isCancelled === "function" ? options.isCancelled : () => false;
  const onBookIndexed =
    typeof options.onBookIndexed === "function" ? options.onBookIndexed : () => {};

  const activeBooks = Array.isArray(books)
    ? books.filter((book) => book && !book.isDeleted && book.data && typeof book.id === "string")
    : [];
  const activeIds = new Set(activeBooks.map((book) => book.id));

  const manifest = await loadContentSearchManifest();
  const nextBooks = { ...(manifest.books || {}) };
  let manifestChanged = false;

  const staleIds = Object.keys(nextBooks).filter((bookId) => !activeIds.has(bookId));
  for (const staleId of staleIds) {
    if (isCancelled()) break;
    delete nextBooks[staleId];
    manifestChanged = true;
    await contentSearchStore.removeItem(getBookStoreKey(staleId));
  }

  for (const book of activeBooks) {
    if (isCancelled()) break;
    const signature = getBookContentIndexSignature(book);
    const existingEntry = nextBooks[book.id];
    if (
      existingEntry &&
      existingEntry.version === CONTENT_INDEX_VERSION &&
      existingEntry.signature === signature
    ) {
      continue;
    }

    try {
      const record = await buildBookContentIndexRecord(book);
      if (!record || isCancelled()) break;
      await contentSearchStore.setItem(getBookStoreKey(book.id), record);
      const manifestEntry = {
        version: CONTENT_INDEX_VERSION,
        signature,
        sectionCount: Array.isArray(record.sections) ? record.sections.length : 0,
        updatedAt: record.builtAt
      };
      nextBooks[book.id] = manifestEntry;
      manifestChanged = true;
      onBookIndexed(book.id, manifestEntry);
    } catch (err) {
      console.error("Content index build failed", err);
    }
  }

  if (manifestChanged && !isCancelled()) {
    await contentSearchStore.setItem(MANIFEST_KEY, {
      version: CONTENT_INDEX_VERSION,
      updatedAt: new Date().toISOString(),
      books: nextBooks
    });
  }

  return {
    version: CONTENT_INDEX_VERSION,
    books: nextBooks
  };
};

