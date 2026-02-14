const DUPLICATE_TITLE_SUFFIX_REGEX = /\s*\(duplicate\s+\d+\)\s*$/i;

export const normalizeDuplicateValue = (value) => (value || "").toString().trim().toLowerCase();

export const stripDuplicateTitleSuffix = (title) =>
  (title || "").toString().replace(DUPLICATE_TITLE_SUFFIX_REGEX, "").trim();

export const isDuplicateTitleBook = (book) =>
  DUPLICATE_TITLE_SUFFIX_REGEX.test((book?.title || "").toString());

export const getDuplicateKey = (title, author) =>
  `${normalizeDuplicateValue(title)}::${normalizeDuplicateValue(author)}`;

export const buildDuplicateIndex = (sourceBooks = []) => {
  const byKey = new Map();
  const titleSet = new Set();
  sourceBooks.forEach((book) => {
    if (!book || book.isDeleted) return;
    const key = getDuplicateKey(book.title, book.author);
    const existing = byKey.get(key) || [];
    byKey.set(key, [...existing, book]);
    titleSet.add(normalizeDuplicateValue(book.title));
  });
  return { byKey, titleSet };
};

export const findDuplicateBooks = (title, author, sourceBooks = [], duplicateIndex = null) => {
  if (duplicateIndex) {
    return duplicateIndex.byKey.get(getDuplicateKey(title, author)) || [];
  }
  const key = getDuplicateKey(title, author);
  return sourceBooks.filter((book) => !book.isDeleted && getDuplicateKey(book.title, book.author) === key);
};

export const buildDuplicateTitle = (baseTitle, sourceBooks = [], duplicateIndex = null) => {
  const existingTitles = duplicateIndex
    ? duplicateIndex.titleSet
    : new Set(
      sourceBooks
        .filter((book) => !book.isDeleted)
        .map((book) => normalizeDuplicateValue(book.title))
    );
  let idx = 1;
  let candidate = `${baseTitle} (Duplicate ${idx})`;
  while (existingTitles.has(normalizeDuplicateValue(candidate))) {
    idx += 1;
    candidate = `${baseTitle} (Duplicate ${idx})`;
  }
  return candidate;
};
