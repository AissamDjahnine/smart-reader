import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addBook,
  getAllBooks,
  deleteBook,
  toggleFavorite,
  toggleToRead,
  markBookStarted,
  backfillBookMetadata,
  moveBookToTrash,
  restoreBookFromTrash,
  purgeExpiredTrashBooks,
  updateHighlightNote,
  getAllCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  toggleBookCollection
} from '../services/db';
import ePub from 'epubjs';
import {
  Plus,
  Book as BookIcon,
  User,
  Calendar,
  Trash2,
  Clock,
  Search,
  Heart,
  Tag,
  Filter,
  ArrowUpDown,
  LayoutGrid,
  List,
  Flame,
  RotateCcw,
  ArrowLeft,
  FileText,
  FolderClosed,
  FolderPlus,
  Pencil,
  Check,
  X
} from 'lucide-react';

const STARTED_BOOK_IDS_KEY = 'library-started-book-ids';
const TRASH_RETENTION_DAYS = 30;
const LANGUAGE_DISPLAY_NAMES =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

const toPositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
};

const formatLanguageLabel = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  const normalized = value.trim().replace("_", "-");
  const primaryCode = normalized.split("-")[0].toLowerCase();
  if (LANGUAGE_DISPLAY_NAMES) {
    try {
      const displayName = LANGUAGE_DISPLAY_NAMES.of(primaryCode);
      if (displayName) return displayName;
    } catch (err) {
      console.error(err);
    }
  }
  return primaryCode.toUpperCase();
};

const formatGenreLabel = (value) => {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim();
};

const compactWhitespace = (value) => (value || "").toString().replace(/\s+/g, " ").trim();

const buildSnippet = (value, query) => {
  const source = compactWhitespace(value);
  if (!source) return "";
  const needle = compactWhitespace(query).toLowerCase();
  if (!needle) return source.slice(0, 120);

  const haystack = source.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return source.slice(0, 120);

  const radius = 56;
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + needle.length + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end)}${suffix}`;
};

const normalizeHref = (href = "") => href.split("#")[0];

const flattenToc = (items, acc = []) => {
  if (!Array.isArray(items)) return acc;
  items.forEach((item) => {
    if (!item) return;
    const href = typeof item.href === "string" ? item.href : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (href && label) {
      acc.push({ href, label });
    }
    if (Array.isArray(item.subitems) && item.subitems.length) {
      flattenToc(item.subitems, acc);
    }
  });
  return acc;
};

const searchBookContent = async (book, query, maxMatches = 30) => {
  if (!book?.data || !query) return [];
  const epub = ePub(book.data);
  const matches = [];
  let tocEntries = [];

  try {
    await epub.ready;
    if (epub?.loaded?.navigation) {
      const nav = await epub.loaded.navigation;
      tocEntries = flattenToc(nav?.toc || []);
    }

    const spineItems = epub?.spine?.spineItems || [];
    for (const section of spineItems) {
      if (!section || section.linear === "no" || section.linear === false) continue;
      try {
        await section.load(epub.load.bind(epub));
        const sectionMatches = typeof section.find === "function" ? (section.find(query) || []) : [];
        for (const match of sectionMatches) {
          matches.push({
            cfi: match?.cfi || "",
            excerpt: match?.excerpt || "",
            chapterLabel:
              tocEntries.find((entry) => {
                const sectionHref = normalizeHref(section.href || "");
                const tocHref = normalizeHref(entry.href || "");
                return sectionHref && tocHref && (sectionHref.includes(tocHref) || tocHref.includes(sectionHref));
              })?.label || ""
          });
          if (matches.length >= maxMatches) break;
        }
        if (matches.length >= maxMatches) break;
      } finally {
        section.unload();
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    epub.destroy();
  }

  return matches;
};

const CONTENT_SCROLL_HEIGHT_CLASS = "h-[42vh]";
const CONTENT_PANEL_HEIGHT_CLASS = "h-[calc(42vh+3rem)]";
const FOUND_BOOK_COVER_PADDING_CLASS = "p-4";
const COLLECTION_COLOR_OPTIONS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ea580c",
  "#16a34a",
  "#0891b2",
  "#4b5563"
];

export default function Home() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Search, filter & sort states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [flagFilters, setFlagFilters] = useState([]);
  const [sortBy, setSortBy] = useState("last-read-desc");
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "grid";
    return window.localStorage.getItem("library-view-mode") === "list" ? "list" : "grid";
  });
  const [isNotesCenterOpen, setIsNotesCenterOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [noteEditorValue, setNoteEditorValue] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [collections, setCollections] = useState([]);
  const [showCollectionsModal, setShowCollectionsModal] = useState(false);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [collectionColorDraft, setCollectionColorDraft] = useState(COLLECTION_COLOR_OPTIONS[0]);
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [collectionPickerBookId, setCollectionPickerBookId] = useState("");
  const [contentSearchMatches, setContentSearchMatches] = useState({});
  const [isContentSearching, setIsContentSearching] = useState(false);
  const contentSearchTokenRef = useRef(0);

  useEffect(() => { loadLibrary(); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("library-view-mode", viewMode);
  }, [viewMode]);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    const shouldSearchContent = query.length >= 2 && statusFilter !== "trash";

    if (!shouldSearchContent) {
      setContentSearchMatches({});
      setIsContentSearching(false);
      contentSearchTokenRef.current += 1;
      return;
    }

    const token = contentSearchTokenRef.current + 1;
    contentSearchTokenRef.current = token;
    setIsContentSearching(true);
    setContentSearchMatches({});

    const timeoutId = setTimeout(async () => {
      const targetBooks = books.filter((book) => !book.isDeleted && book?.data);
      const nextMatches = {};

      for (const book of targetBooks) {
        if (contentSearchTokenRef.current !== token) return;
        const matches = await searchBookContent(book, query, 30);
        if (contentSearchTokenRef.current !== token) return;
        if (matches.length) nextMatches[book.id] = matches;
      }

      if (contentSearchTokenRef.current === token) {
        setContentSearchMatches(nextMatches);
        setIsContentSearching(false);
      }
    }, 220);

    return () => {
      clearTimeout(timeoutId);
      if (contentSearchTokenRef.current === token) {
        setIsContentSearching(false);
      }
    };
  }, [books, searchQuery, statusFilter]);

  useEffect(() => {
    if (statusFilter !== "trash") return;
    if (!flagFilters.length) return;
    setFlagFilters([]);
  }, [statusFilter, flagFilters]);

  useEffect(() => {
    if (statusFilter !== "trash") return;
    if (!isNotesCenterOpen) return;
    setIsNotesCenterOpen(false);
    setEditingNoteId("");
    setNoteEditorValue("");
  }, [statusFilter, isNotesCenterOpen]);

  useEffect(() => {
    if (!collectionPickerBookId) return;
    const onPointerDown = (event) => {
      const target = event?.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-testid="book-collection-picker"]')) return;
      if (target.closest('[data-testid="book-collection-picker-toggle"]')) return;
      setCollectionPickerBookId("");
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [collectionPickerBookId]);

  const loadLibrary = async () => {
    await purgeExpiredTrashBooks(TRASH_RETENTION_DAYS);
    const [storedBooks, storedCollections] = await Promise.all([getAllBooks(), getAllCollections()]);
    setBooks(storedBooks);
    setCollections(storedCollections);

    const legacyBookIds = storedBooks
      .filter((book) => {
        if (!book?.data) return false;
        const missingLanguage = !String(book.language || "").trim();
        const missingPages = !toPositiveNumber(book.estimatedPages);
        const missingGenreField = typeof book.genre !== "string";
        const isLegacyVersion = (book.metadataVersion || 0) < 1;
        return missingLanguage || missingPages || missingGenreField || isLegacyVersion;
      })
      .map((book) => book.id);

    if (!legacyBookIds.length) return;

    await Promise.all(legacyBookIds.map((id) => backfillBookMetadata(id)));
    const refreshedBooks = await getAllBooks();
    setBooks(refreshedBooks);
  };

  const readStartedBookIds = () => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(STARTED_BOOK_IDS_KEY);
      const parsed = JSON.parse(raw || "[]");
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      console.error(err);
      return new Set();
    }
  };

  const persistStartedBookId = (id) => {
    if (!id || typeof window === "undefined") return;
    const next = readStartedBookIds();
    next.add(id);
    window.localStorage.setItem(STARTED_BOOK_IDS_KEY, JSON.stringify([...next]));
  };

  const handleOpenBook = (id) => {
    persistStartedBookId(id);
    markBookStarted(id).catch((err) => {
      console.error(err);
    });
  };

  const buildReaderPath = (id, panel = '', options = {}) => {
    const params = new URLSearchParams({ id });
    if (panel) params.set('panel', panel);
    if (options.cfi) params.set('cfi', options.cfi);
    if (options.query) params.set('q', options.query);
    if (options.openSearch) params.set('search', '1');
    return `/read?${params.toString()}`;
  };

  const handleQuickOpen = (e, id, panel = '') => {
    e.preventDefault();
    e.stopPropagation();
    handleOpenBook(id);
    navigate(buildReaderPath(id, panel));
  };

  const handleGlobalResultOpen = (e, result) => {
    e.preventDefault();
    e.stopPropagation();
    if (!result?.bookId) return;
    handleOpenBook(result.bookId);
    navigate(buildReaderPath(result.bookId, "", {
      cfi: result.cfi || "",
      query: result.query || "",
      openSearch: !!result.query
    }));
  };

  const handleDeleteBook = async (e, id) => {
    e.preventDefault(); 
    e.stopPropagation(); 
    if (window.confirm("Move this book to Trash?")) {
      await moveBookToTrash(id);
      loadLibrary(); 
    }
  };

  const handleRestoreBook = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    await restoreBookFromTrash(id);
    loadLibrary();
  };

  const handleDeleteBookForever = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm("Delete this book forever? This cannot be undone.")) {
      await deleteBook(id);
      loadLibrary(); 
    }
  };

  const handleToggleFavorite = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleFavorite(id);
    loadLibrary();
  };

  const handleToggleToRead = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleToRead(id);
    loadLibrary();
  };

  const handleToggleCollectionPicker = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setCollectionPickerBookId((current) => (current === id ? "" : id));
  };

  const handleToggleBookCollection = async (e, bookId, collectionId) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await toggleBookCollection(bookId, collectionId);
      await loadLibrary();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateCollection = async () => {
    setCollectionError("");
    try {
      await createCollection(collectionNameDraft, collectionColorDraft);
      setCollectionNameDraft("");
      setCollectionColorDraft(COLLECTION_COLOR_OPTIONS[0]);
      await loadLibrary();
    } catch (err) {
      setCollectionError(err?.message || "Unable to create collection.");
    }
  };

  const startCollectionRename = (collection) => {
    setCollectionError("");
    setEditingCollectionId(collection.id);
    setEditingCollectionName(collection.name);
  };

  const cancelCollectionRename = () => {
    setEditingCollectionId("");
    setEditingCollectionName("");
    setCollectionError("");
  };

  const handleSaveCollectionRename = async () => {
    if (!editingCollectionId) return;
    setCollectionError("");
    try {
      await renameCollection(editingCollectionId, editingCollectionName);
      await loadLibrary();
      cancelCollectionRename();
    } catch (err) {
      setCollectionError(err?.message || "Unable to rename collection.");
    }
  };

  const handleDeleteCollection = async (collectionId) => {
    setCollectionError("");
    await deleteCollection(collectionId);
    if (collectionFilter === collectionId) {
      setCollectionFilter("all");
    }
    await loadLibrary();
  };

  const handleToggleNotesCenter = () => {
    setIsNotesCenterOpen((current) => !current);
    setEditingNoteId("");
    setNoteEditorValue("");
  };

  const handleStartNoteEdit = (entry) => {
    setEditingNoteId(entry.id);
    setNoteEditorValue(entry.note || "");
  };

  const handleCancelNoteEdit = () => {
    setEditingNoteId("");
    setNoteEditorValue("");
  };

  const handleSaveNoteFromCenter = async (entry) => {
    if (!entry?.bookId || !entry?.cfiRange) return;
    setIsSavingNote(true);
    try {
      await updateHighlightNote(entry.bookId, entry.cfiRange, noteEditorValue.trim());
      await loadLibrary();
      setEditingNoteId("");
      setNoteEditorValue("");
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleOpenNoteInReader = (entry) => {
    if (!entry?.bookId) return;
    handleOpenBook(entry.bookId);
    navigate(buildReaderPath(entry.bookId, "highlights", { cfi: entry.cfiRange || "" }));
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file && file.type === "application/epub+zip") {
      setIsUploading(true);
      await addBook(file);
      await loadLibrary();
      setIsUploading(false);
    }
  };

  const statusFilterOptions = [
    { value: "all", label: "All books" },
    { value: "to-read", label: "To read" },
    { value: "in-progress", label: "In progress" },
    { value: "finished", label: "Finished" },
    { value: "trash", label: "Trash" }
  ];
  const collectionFilterOptions = [
    { value: "all", label: "All collections" },
    ...collections.map((collection) => ({ value: collection.id, label: collection.name }))
  ];
  const flagFilterOptions = [
    { value: "favorites", label: "Favorites" },
    { value: "has-highlights", label: "Has highlights" },
    { value: "has-notes", label: "Has notes" }
  ];

  const sortOptions = [
    { value: "last-read-desc", label: "Last read (newest)" },
    { value: "last-read-asc", label: "Last read (oldest)" },
    { value: "added-desc", label: "Added date (newest)" },
    { value: "added-asc", label: "Added date (oldest)" },
    { value: "progress-desc", label: "Progress (high to low)" },
    { value: "progress-asc", label: "Progress (low to high)" },
    { value: "title-asc", label: "Title (A-Z)" },
    { value: "title-desc", label: "Title (Z-A)" },
    { value: "author-asc", label: "Author (A-Z)" },
    { value: "author-desc", label: "Author (Z-A)" }
  ];

  const normalizeString = (value) => (value || "").toString().toLowerCase();
  const normalizeNumber = (value) => Number(value || 0);
  const normalizeTime = (value) => {
    const parsed = new Date(value || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const toLocalDateKey = (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const startedBookIds = readStartedBookIds();
  const isBookStarted = (book) => {
    const progress = normalizeNumber(book?.progress);
    return (
      startedBookIds.has(book?.id) ||
      Boolean(book?.hasStarted) ||
      Boolean(book?.lastLocation) ||
      progress > 0 ||
      normalizeNumber(book?.readingTime) > 0
    );
  };
  const isBookToRead = (book) => Boolean(book?.isToRead);
  const isFlagFilterActive = (flag) => flagFilters.includes(flag);
  const toggleFlagFilter = (flag) => {
    setFlagFilters((current) =>
      current.includes(flag) ? current.filter((item) => item !== flag) : [...current, flag]
    );
  };

  const collectionMap = new Map(collections.map((collection) => [collection.id, collection]));
  const hexToRgba = (hex, alpha = 0.16) => {
    const clean = (hex || "").replace("#", "").trim();
    if (clean.length !== 6) return `rgba(37, 99, 235, ${alpha})`;
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return `rgba(37, 99, 235, ${alpha})`;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const bookMatchesLibrarySearch = (book, query) => {
    if (!query) return true;
    const normalizedQuery = normalizeString(query.trim());
    if (!normalizedQuery) return true;

    const metadataFields = [
      book.title,
      book.author,
      formatLanguageLabel(book.language),
      formatGenreLabel(book.genre)
    ];
    if (metadataFields.some((field) => normalizeString(field).includes(normalizedQuery))) {
      return true;
    }

    const highlights = Array.isArray(book.highlights) ? book.highlights : [];
    if (highlights.some((h) => normalizeString(h?.text).includes(normalizedQuery) || normalizeString(h?.note).includes(normalizedQuery))) {
      return true;
    }

    const bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];
    if (bookmarks.some((b) => normalizeString(b?.label).includes(normalizedQuery) || normalizeString(b?.text).includes(normalizedQuery))) {
      return true;
    }

    if (Array.isArray(contentSearchMatches[book.id]) && contentSearchMatches[book.id].length > 0) {
      return true;
    }

    return false;
  };

  const getReadingStreak = (libraryBooks) => {
    const dayKeys = new Set(
      libraryBooks
        .filter((book) => {
          if (book.isDeleted) return false;
          return isBookStarted(book);
        })
        .map((book) => toLocalDateKey(book.lastRead))
        .filter(Boolean)
    );

    if (!dayKeys.size) {
      return { streakCount: 0, readToday: false };
    }

    const now = new Date();
    const todayKey = toLocalDateKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toLocalDateKey(yesterday);
    const startKey = dayKeys.has(todayKey) ? todayKey : (dayKeys.has(yesterdayKey) ? yesterdayKey : "");

    if (!startKey) {
      return { streakCount: 0, readToday: false };
    }

    let streakCount = 0;
    const cursor = new Date(startKey);
    while (dayKeys.has(toLocalDateKey(cursor))) {
      streakCount += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      streakCount,
      readToday: dayKeys.has(todayKey)
    };
  };

  const activeBooks = books.filter((book) => !book.isDeleted);
  const trashedBooksCount = books.length - activeBooks.length;
  const isTrashView = statusFilter === "trash";
  const quickFilterStats = [
    {
      key: "to-read",
      label: "To read",
      count: activeBooks.filter((book) => isBookToRead(book)).length
    },
    {
      key: "in-progress",
      label: "In progress",
      count: activeBooks.filter((book) => {
        const progress = normalizeNumber(book.progress);
        return progress > 0 && progress < 100;
      }).length
    },
    {
      key: "finished",
      label: "Finished",
      count: activeBooks.filter((book) => normalizeNumber(book.progress) >= 100).length
    },
    {
      key: "favorites",
      label: "Favorites",
      count: activeBooks.filter((book) => Boolean(book.isFavorite)).length
    }
  ];
  const notesCenterEntries = activeBooks
    .flatMap((book) => {
      const highlights = Array.isArray(book.highlights) ? book.highlights : [];
      return highlights
        .filter((highlight) => typeof highlight?.note === "string" && highlight.note.trim())
        .map((highlight, index) => ({
          id: `${book.id}::${highlight.cfiRange || `note-${index}`}`,
          bookId: book.id,
          cfiRange: highlight.cfiRange || "",
          bookTitle: book.title,
          bookAuthor: book.author,
          highlightText: compactWhitespace(highlight.text || ""),
          note: highlight.note.trim(),
          lastRead: book.lastRead
        }));
    })
    .sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead));
  const notesCenterFilteredEntries = notesCenterEntries.filter((entry) => {
    const query = normalizeString(searchQuery.trim());
    if (!query) return true;
    return (
      normalizeString(entry.bookTitle).includes(query) ||
      normalizeString(entry.bookAuthor).includes(query) ||
      normalizeString(entry.note).includes(query) ||
      normalizeString(entry.highlightText).includes(query)
    );
  });

  const sortedBooks = [...books]
    .filter((book) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = !query || bookMatchesLibrarySearch(book, query);

      const highlightCount = Array.isArray(book.highlights) ? book.highlights.length : 0;
      const noteCount = Array.isArray(book.highlights)
        ? book.highlights.filter((h) => (h?.note || "").trim()).length
        : 0;
      const progress = normalizeNumber(book.progress);
      const inTrash = Boolean(book.isDeleted);

      const matchesStatus =
        statusFilter === "trash" ? inTrash
        : inTrash ? false
        : statusFilter === "all" ? true
        : statusFilter === "to-read" ? isBookToRead(book)
        : statusFilter === "in-progress" ? progress > 0 && progress < 100
        : statusFilter === "finished" ? progress >= 100
        : true;

      const matchesFlags =
        statusFilter === "trash"
          ? true
          : flagFilters.every((flag) => {
              if (flag === "favorites") return Boolean(book.isFavorite);
              if (flag === "has-highlights") return highlightCount > 0;
              if (flag === "has-notes") return noteCount > 0;
              return true;
            });

      const matchesCollection =
        collectionFilter === "all"
          ? true
          : Array.isArray(book.collectionIds) && book.collectionIds.includes(collectionFilter);

      return matchesSearch && matchesStatus && matchesFlags && matchesCollection;
    })
    .sort((left, right) => {
      if (sortBy === "last-read-desc") return normalizeTime(right.lastRead) - normalizeTime(left.lastRead);
      if (sortBy === "last-read-asc") return normalizeTime(left.lastRead) - normalizeTime(right.lastRead);
      if (sortBy === "added-desc") return normalizeTime(right.addedAt) - normalizeTime(left.addedAt);
      if (sortBy === "added-asc") return normalizeTime(left.addedAt) - normalizeTime(right.addedAt);
      if (sortBy === "progress-desc") return normalizeNumber(right.progress) - normalizeNumber(left.progress);
      if (sortBy === "progress-asc") return normalizeNumber(left.progress) - normalizeNumber(right.progress);
      if (sortBy === "title-desc") return normalizeString(right.title).localeCompare(normalizeString(left.title));
      if (sortBy === "author-asc") return normalizeString(left.author).localeCompare(normalizeString(right.author));
      if (sortBy === "author-desc") return normalizeString(right.author).localeCompare(normalizeString(left.author));
      return normalizeString(left.title).localeCompare(normalizeString(right.title));
    });

  const globalSearchQuery = searchQuery.trim().toLowerCase();
  const globalSearchGroups = (() => {
    if (!globalSearchQuery) return [];
    const nextGroups = {
      books: [],
      highlights: [],
      notes: [],
      bookmarks: [],
      content: []
    };

    books.forEach((book) => {
      if (book.isDeleted) return;
      const existingBookResultIds = new Set();

      const metadataFields = [
        book.title,
        book.author,
        formatLanguageLabel(book.language),
        formatGenreLabel(book.genre)
      ];
      if (metadataFields.some((field) => normalizeString(field).includes(globalSearchQuery))) {
        const resultId = `${book.id}-book`;
        nextGroups.books.push({
          id: resultId,
          bookId: book.id,
          panel: "",
          cfi: "",
          query: globalSearchQuery,
          title: book.title,
          subtitle: book.author,
          snippet: `Book match: ${book.title} by ${book.author}`
        });
        existingBookResultIds.add(resultId);
      }

      const highlights = Array.isArray(book.highlights) ? book.highlights : [];
      highlights.forEach((highlight, index) => {
        const textValue = compactWhitespace(highlight?.text);
        if (normalizeString(textValue).includes(globalSearchQuery)) {
          nextGroups.highlights.push({
            id: `${book.id}-highlight-${highlight?.cfiRange || index}`,
            bookId: book.id,
            panel: "highlights",
            cfi: highlight?.cfiRange || "",
            query: globalSearchQuery,
            title: book.title,
            subtitle: book.author,
            snippet: buildSnippet(textValue, globalSearchQuery)
          });
        }

        const noteValue = compactWhitespace(highlight?.note);
        if (normalizeString(noteValue).includes(globalSearchQuery)) {
          nextGroups.notes.push({
            id: `${book.id}-note-${highlight?.cfiRange || index}`,
            bookId: book.id,
            panel: "highlights",
            cfi: highlight?.cfiRange || "",
            query: globalSearchQuery,
            title: book.title,
            subtitle: book.author,
            snippet: buildSnippet(noteValue, globalSearchQuery)
          });
        }
      });

      const bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];
      bookmarks.forEach((bookmark, index) => {
        const labelValue = compactWhitespace(bookmark?.label);
        const textValue = compactWhitespace(bookmark?.text);
        const hasMatch =
          normalizeString(labelValue).includes(globalSearchQuery) ||
          normalizeString(textValue).includes(globalSearchQuery);
        if (!hasMatch) return;

        nextGroups.bookmarks.push({
          id: `${book.id}-bookmark-${bookmark?.cfi || index}`,
          bookId: book.id,
          panel: "bookmarks",
          cfi: bookmark?.cfi || "",
          query: globalSearchQuery,
          title: book.title,
          subtitle: book.author,
          snippet: buildSnippet(textValue || labelValue, globalSearchQuery)
        });
      });

      const contentMatches = Array.isArray(contentSearchMatches[book.id]) ? contentSearchMatches[book.id] : [];
      contentMatches.forEach((match, index) => {
        nextGroups.content.push({
          id: `${book.id}-content-${match?.cfi || index}`,
          bookId: book.id,
          panel: "",
          cfi: match?.cfi || "",
          query: globalSearchQuery,
          title: book.title,
          subtitle: [book.author, match?.chapterLabel].filter(Boolean).join(" · "),
          snippet: buildSnippet(match?.excerpt || "", globalSearchQuery)
        });
      });

      if (contentMatches.length > 0) {
        const resultId = `${book.id}-book`;
        const firstContentCfi = contentMatches[0]?.cfi || "";
        if (!existingBookResultIds.has(resultId)) {
          nextGroups.books.push({
            id: resultId,
            bookId: book.id,
            panel: "",
            cfi: firstContentCfi,
            query: globalSearchQuery,
            title: book.title,
            subtitle: book.author,
            snippet: `Found ${contentMatches.length} content match${contentMatches.length === 1 ? '' : 'es'}`
          });
          existingBookResultIds.add(resultId);
        } else {
          const existingIndex = nextGroups.books.findIndex((item) => item.id === resultId);
          if (existingIndex >= 0 && !nextGroups.books[existingIndex].cfi) {
            nextGroups.books[existingIndex] = {
              ...nextGroups.books[existingIndex],
              cfi: firstContentCfi
            };
          }
        }
      }
    });

    const descriptors = [
      { key: "content", label: "Book content" },
      { key: "books", label: "Books" },
      { key: "highlights", label: "Highlights" },
      { key: "notes", label: "Notes" },
      { key: "bookmarks", label: "Bookmarks" }
    ];

    return descriptors
      .map((descriptor) => ({
        ...descriptor,
        items: nextGroups[descriptor.key]
      }))
      .filter((group) => group.items.length > 0);
  })();
  const globalSearchBookGroup = globalSearchGroups.find((group) => group.key === "books");
  const globalSearchBookItems = globalSearchBookGroup?.items || [];
  const visibleGlobalSearchGroups = globalSearchGroups.filter((group) => group.key !== "books");
  const globalContentGroup = visibleGlobalSearchGroups.find((group) => group.key === "content");
  const globalOtherGroups = visibleGlobalSearchGroups.filter((group) => group.key !== "content");
  const globalSearchTotal = visibleGlobalSearchGroups.reduce((total, group) => total + group.items.length, 0) + globalSearchBookItems.length;
  const booksById = new Map(books.filter((book) => !book.isDeleted).map((book) => [book.id, book]));
  const globalMatchedBooks = globalSearchBookItems
    .map((item) => ({
      ...item,
      book: booksById.get(item.bookId)
    }))
    .filter((item) => Boolean(item.book));
  const globalContentItemsByBook = (globalContentGroup?.items || []).reduce((acc, item) => {
    if (!item?.bookId) return acc;
    if (!acc[item.bookId]) acc[item.bookId] = [];
    acc[item.bookId].push(item);
    return acc;
  }, {});
  const globalMatchedBookPairs = globalMatchedBooks
    .map((item) => ({
      ...item,
      contentItems: globalContentItemsByBook[item.bookId] || []
    }))
    .filter((item) => item.contentItems.length > 0);
  const showGlobalSearchBooksColumn = Boolean(
    globalSearchQuery &&
    !isTrashView &&
    (globalMatchedBookPairs.length || globalMatchedBooks.length)
  );
  const showGlobalSearchSplitColumns = showGlobalSearchBooksColumn && globalMatchedBookPairs.length === 0;

  const continueReadingBooks = [...books]
    .filter((book) => {
      if (book.isDeleted) return false;
      const progress = normalizeNumber(book.progress);
      const hasStarted = isBookStarted(book);
      return hasStarted && progress < 100;
    })
    .sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead))
    .slice(0, 8);

  const showContinueReading =
    statusFilter === "all" &&
    collectionFilter === "all" &&
    !searchQuery.trim() &&
    continueReadingBooks.length > 0;
  const { streakCount, readToday } = getReadingStreak(books);

  const formatTime = (totalSeconds) => {
    if (!totalSeconds || totalSeconds < 60) return "Just started";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const renderReadingStateBadge = (book, extraClasses = "") => (
    <div className={`flex items-center gap-2 text-blue-500 text-xs font-semibold ${extraClasses}`}>
      <Clock size={12} />
      <span>{formatTime(book.readingTime)}</span>
    </div>
  );

  const renderToReadTag = (book, extraClasses = "") => {
    if (!isBookToRead(book)) return null;
    return (
      <span
        data-testid="book-to-read-tag"
        className={`inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold tracking-wide text-amber-700 ${extraClasses}`}
      >
        TO READ
      </span>
    );
  };

  const renderCollectionChips = (book, extraClasses = "") => {
    const ids = Array.isArray(book?.collectionIds) ? book.collectionIds : [];
    if (!ids.length) return null;
    const resolved = ids
      .map((id) => collectionMap.get(id))
      .filter(Boolean);
    if (!resolved.length) return null;

    const visible = resolved.slice(0, 2);
    const remaining = resolved.length - visible.length;
    return (
      <div className={`mt-2 flex flex-wrap items-center gap-1.5 ${extraClasses}`}>
        {visible.map((collection) => (
          <span
            key={`${book.id}-${collection.id}`}
            data-testid="book-collection-chip"
            className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide"
            style={{
              borderColor: collection.color,
              backgroundColor: hexToRgba(collection.color, 0.16),
              color: collection.color
            }}
          >
            {collection.name}
          </span>
        ))}
        {remaining > 0 && (
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-600">
            +{remaining}
          </span>
        )}
      </div>
    );
  };

  const formatLastRead = (dateString) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffInDays === 0) return "Read today";
    if (diffInDays === 1) return "Read yesterday";
    if (diffInDays < 7) return `Read ${diffInDays} days ago`;
    return `Read ${date.toLocaleDateString()}`;
  };

  const formatDeletedAt = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return "";
    const now = new Date();
    const diffInDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffInDays === 0) return "Deleted today";
    if (diffInDays === 1) return "Deleted yesterday";
    if (diffInDays < 7) return `Deleted ${diffInDays} days ago`;
    return `Deleted ${date.toLocaleDateString()}`;
  };

  const formatSessionDuration = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const minutes = Math.max(1, Math.round(safeSeconds / 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours <= 0) return `${minutes} min`;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes} min`;
  };

  const getCalendarDayDiff = (dateString) => {
    const date = new Date(dateString || 0);
    if (!Number.isFinite(date.getTime())) return 0;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffMs = todayStart.getTime() - dateStart.getTime();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const getSessionStats = (book) => {
    const sessions = Array.isArray(book?.readingSessions) ? book.readingSessions : [];
    if (!sessions.length) {
      return { lastSessionSeconds: 0, lastSessionDaysAgo: 0 };
    }

    const latestSession = sessions[sessions.length - 1];
    const lastSessionSeconds = Math.max(0, Number(latestSession?.seconds) || 0);
    const lastSessionDate = latestSession?.endAt || latestSession?.startAt || "";
    const lastSessionDaysAgo = getCalendarDayDiff(lastSessionDate);
    return { lastSessionSeconds, lastSessionDaysAgo };
  };

  const renderSessionTimeline = (book, options = {}) => {
    const { compact = false } = options;
    const { lastSessionSeconds, lastSessionDaysAgo } = getSessionStats(book);
    if (!lastSessionSeconds) return null;
    const daysSuffix = lastSessionDaysAgo > 0
      ? ` (${lastSessionDaysAgo} day${lastSessionDaysAgo === 1 ? "" : "s"} ago)`
      : "";
    const label = `Last session: ${formatSessionDuration(lastSessionSeconds)}${daysSuffix}`;

    if (compact) {
      return (
        <div className="mt-1 text-[10px] font-semibold text-gray-500">
          {label}
        </div>
      );
    }

    return (
      <div
        data-testid="book-session-summary"
        className="mt-2 text-[10px] font-semibold text-gray-500"
      >
        <span data-testid="book-last-session">{label}</span>
      </div>
    );
  };

  const renderMetadataBadges = (book) => {
    const language = formatLanguageLabel(book.language);
    const estimatedPages = toPositiveNumber(book.estimatedPages);
    const genre = formatGenreLabel(book.genre);
    const badges = [];

    if (language) {
      badges.push({
        key: "language",
        testId: "book-meta-language",
        label: `Language: ${language}`
      });
    }
    if (estimatedPages) {
      badges.push({
        key: "pages",
        testId: "book-meta-pages",
        label: `Pages: ${estimatedPages}`
      });
    }
    if (genre) {
      badges.push({
        key: "genre",
        testId: "book-meta-genre",
        label: `Genre: ${genre}`
      });
    }

    if (!badges.length) return null;

    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span
            key={`${book.id}-${badge.key}`}
            data-testid={badge.testId}
            className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600"
          >
            {badge.label}
          </span>
        ))}
      </div>
    );
  };

  const renderGlobalSearchBookCard = (item, options = {}) => {
    const book = item.book;
    if (!book) return null;
    const { coverHeightClass = CONTENT_PANEL_HEIGHT_CLASS } = options;
    return (
      <Link
        to={buildReaderPath(book.id, "", {
          cfi: item.cfi || "",
          query: globalSearchQuery,
          openSearch: true
        })}
        key={`global-card-${book.id}`}
        data-testid="global-search-found-book-card"
        onClick={() => handleOpenBook(book.id)}
        className={`group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 block relative ${coverHeightClass}`}
      >
        <div data-testid="global-search-found-book-cover" className={`h-full bg-gray-100 ${FOUND_BOOK_COVER_PADDING_CLASS}`}>
          <div className="relative h-full w-full rounded-xl overflow-hidden bg-white border border-gray-100">
            {book.cover ? (
              <img src={book.cover} alt={book.title} className="w-full h-full object-contain group-hover:scale-[1.01] transition-transform duration-500" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                <BookIcon size={40} className="mb-2 opacity-20" />
                <span className="text-xs font-medium uppercase tracking-widest">{book.title}</span>
              </div>
            )}

            <div className="absolute inset-x-0 bottom-0 border-t border-gray-200 bg-white/95 backdrop-blur-sm px-3 py-2">
              <h3 data-testid="global-search-found-book-title" className="font-bold text-gray-900 text-xl leading-tight line-clamp-1 group-hover:text-blue-600 transition-colors">
                {book.title}
              </h3>
              <div data-testid="global-search-found-book-author" className="mt-1 flex items-center gap-2 text-gray-600 text-sm">
                <User size={14} />
                <span className="truncate">{book.author}</span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  };

  const getFilterLabel = () => {
    if (statusFilter === "trash") return "Trash";
    return statusFilterOptions.find((f) => f.value === statusFilter)?.label || "All books";
  };

  const getCollectionFilterLabel = () => {
    if (collectionFilter === "all") return "All collections";
    return collections.find((item) => item.id === collectionFilter)?.name || "All collections";
  };

  const resetLibraryFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setCollectionFilter("all");
    setFlagFilters([]);
    setSortBy("last-read-desc");
  };

  const hasActiveLibraryFilters =
    Boolean(searchQuery.trim()) ||
    statusFilter !== "all" ||
    collectionFilter !== "all" ||
    flagFilters.length > 0 ||
    sortBy !== "last-read-desc";

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-12 text-gray-900 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
          <div>
            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">My Library</h1>
            <p className="text-gray-500 mt-1">
              {isTrashView
                ? `Trash has ${sortedBooks.length} books`
                : sortedBooks.length === activeBooks.length
                ? `You have ${activeBooks.length} books`
                : `Showing ${sortedBooks.length} of ${activeBooks.length} books`}
              {!isTrashView && trashedBooksCount > 0 ? ` · ${trashedBooksCount} in trash` : ""}
            </p>
            <div
              data-testid="library-streak-badge"
              className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                streakCount > 0
                  ? 'border-orange-200 bg-orange-50 text-orange-700'
                  : 'border-gray-200 bg-white text-gray-500'
              }`}
              title={streakCount > 0 && !readToday ? 'Read today to keep your streak alive.' : 'Daily reading streak'}
            >
              <Flame size={14} className={streakCount > 0 ? 'text-orange-500' : 'text-gray-400'} />
              <span>{streakCount > 0 ? `${streakCount}-day streak` : 'No streak yet'}</span>
            </div>

            <div data-testid="library-quick-filters" className="mt-3 flex flex-wrap gap-2">
              {quickFilterStats.map((stat) => {
                const isQuickActive =
                  stat.key === "favorites"
                    ? isFlagFilterActive("favorites")
                    : statusFilter === stat.key;
                return (
                <button
                  key={stat.key}
                  type="button"
                  data-testid={`library-quick-filter-${stat.key}`}
                  aria-pressed={isQuickActive}
                  onClick={() => {
                    if (stat.key === "favorites") {
                      if (statusFilter === "trash") setStatusFilter("all");
                      toggleFlagFilter("favorites");
                      return;
                    }
                    setStatusFilter(stat.key);
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    isQuickActive
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
                  }`}
                  title={`Show ${stat.label.toLowerCase()} books`}
                >
                  <span>{stat.label}</span>
                  <span
                    data-testid={`library-quick-filter-${stat.key}-count`}
                    className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                      isQuickActive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {stat.count}
                  </span>
                </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="trash-toggle-button"
              onClick={() => setStatusFilter((current) => (current === "trash" ? "all" : "trash"))}
              className={`relative p-3 rounded-full border shadow-sm transition-all ${
                isTrashView
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-white text-gray-600 border-gray-200 hover:text-amber-600 hover:border-amber-300"
              }`}
              title={isTrashView ? "Back to library" : "Open Trash"}
              aria-label={isTrashView ? "Back to library" : "Open Trash"}
            >
              <Trash2 size={20} />
              {trashedBooksCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {trashedBooksCount}
                </span>
              )}
            </button>

            <label className={`cursor-pointer flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-all transform hover:scale-105 ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Plus size={20} />
              <span>{isUploading ? 'Adding...' : 'Add Book'}</span>
              <input type="file" accept=".epub" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </header>

        {showContinueReading && (
          <section className="mb-8" data-testid="continue-reading-rail">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Continue Reading</h2>
                <p className="text-xs text-gray-500">Quick resume for books you already started.</p>
              </div>
              <button
                type="button"
                onClick={() => setStatusFilter("in-progress")}
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                View in-progress
              </button>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-2">
              {continueReadingBooks.map((book) => (
                <Link
                  to={buildReaderPath(book.id)}
                  key={`continue-${book.id}`}
                  data-testid="continue-reading-card"
                  onClick={() => handleOpenBook(book.id)}
                  className="min-w-[240px] max-w-[240px] rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all"
                >
                  <div className="p-3 flex gap-3">
                    <div className="w-14 h-20 bg-gray-200 rounded-lg overflow-hidden shrink-0">
                      {book.cover ? (
                        <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <BookIcon size={16} />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 line-clamp-2">{book.title}</div>
                      <div className="mt-1 text-xs text-gray-500 truncate">{book.author}</div>
                      <div className="mt-2 text-[11px] text-blue-600 font-semibold">
                        {normalizeNumber(book.progress)}% · {formatTime(book.readingTime)}
                      </div>
                      {renderSessionTimeline(book, { compact: true })}
                      <div className="mt-1 text-[10px] text-gray-400">{formatLastRead(book.lastRead)}</div>
                      <div className="mt-2 w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-blue-600 h-full transition-all duration-700"
                          style={{ width: `${normalizeNumber(book.progress)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Search, Filter and Sort Bar */}
        <div
          data-testid="library-toolbar-sticky"
          className="sticky top-3 z-20 mb-3 rounded-2xl bg-gray-50/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80"
        >
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px_280px_auto]">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input 
                type="text"
                placeholder="Search books, highlights, notes, bookmarks..."
                data-testid="library-search"
                className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="relative">
              <FolderClosed className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                data-testid="library-collection-filter"
                value={collectionFilter}
                onChange={(e) => setCollectionFilter(e.target.value)}
                className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
              >
                {collectionFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                data-testid="library-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
              >
                {statusFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <select
                data-testid="library-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-stretch justify-end gap-2">
              {!isTrashView && (
                <button
                  type="button"
                  data-testid="library-manage-collections-button"
                  onClick={() => {
                    setShowCollectionsModal(true);
                    setCollectionError("");
                  }}
                  className="inline-flex h-[52px] items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                  title="Manage shelves"
                >
                  <FolderPlus size={16} />
                  <span>Shelves</span>
                </button>
              )}

              <div
                className="flex h-[52px] w-[120px] items-center rounded-2xl border border-gray-200 bg-white p-1 shadow-sm"
                data-testid="library-view-toggle"
              >
                <button
                  type="button"
                  data-testid="library-view-grid"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={`flex h-full flex-1 items-center justify-center rounded-xl transition-colors ${
                    viewMode === "grid" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}
                  title="Grid view"
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  data-testid="library-view-list"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={`flex h-full flex-1 items-center justify-center rounded-xl transition-colors ${
                    viewMode === "list" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
                  }`}
                  title="List view"
                >
                  <List size={16} />
                </button>
              </div>

              {!isTrashView && (
                <button
                  type="button"
                  data-testid="library-notes-center-toggle"
                  onClick={handleToggleNotesCenter}
                  className={`inline-flex h-[52px] items-center gap-2 rounded-2xl border px-3 text-sm font-semibold transition ${
                    isNotesCenterOpen
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
                  }`}
                >
                  <FileText size={15} />
                  <span>Notes Center</span>
                  <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                    isNotesCenterOpen ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                  }`}>
                    {notesCenterEntries.length}
                  </span>
                </button>
              )}

              {hasActiveLibraryFilters && (
                <button
                  type="button"
                  data-testid="library-reset-filters-button"
                  onClick={resetLibraryFilters}
                  className="inline-flex h-[52px] items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                  title="Reset filters"
                  aria-label="Reset filters"
                >
                  <RotateCcw size={16} />
                  <span>Reset filters</span>
                </button>
              )}
            </div>
          </div>
        </div>
        {isNotesCenterOpen && !isTrashView && (
          <section data-testid="notes-center-panel" className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-blue-900">Notes Center</h2>
                <p
                  data-testid="notes-center-count"
                  className="mt-1 text-xs text-blue-700/90"
                >
                  {notesCenterFilteredEntries.length} note{notesCenterFilteredEntries.length === 1 ? "" : "s"} shown
                  {searchQuery.trim() ? ` for "${searchQuery.trim()}"` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleNotesCenter}
                className="text-xs font-semibold text-blue-700 hover:text-blue-900"
              >
                Close
              </button>
            </div>

            {notesCenterFilteredEntries.length === 0 ? (
              <div data-testid="notes-center-empty" className="mt-3 rounded-xl border border-blue-100 bg-white p-3 text-xs text-gray-600">
                No notes found yet. Add notes on highlights in the Reader, then manage them here.
              </div>
            ) : (
              <div className="mt-3 max-h-[56vh] space-y-3 overflow-y-auto pr-1">
                {notesCenterFilteredEntries.map((entry) => (
                  <article
                    key={entry.id}
                    data-testid="notes-center-item"
                    className="rounded-xl border border-blue-100 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-gray-900">{entry.bookTitle}</div>
                        <div className="text-xs text-gray-500">{entry.bookAuthor}</div>
                      </div>
                      <button
                        type="button"
                        data-testid="notes-center-open-reader"
                        onClick={() => handleOpenNoteInReader(entry)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                      >
                        Open in Reader
                      </button>
                    </div>

                    {entry.highlightText && (
                      <p className="mt-2 text-[11px] italic text-gray-500 line-clamp-2">
                        "{entry.highlightText}"
                      </p>
                    )}

                    {editingNoteId === entry.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea
                          data-testid="notes-center-textarea"
                          className="w-full min-h-[88px] rounded-xl border border-gray-200 bg-white p-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                          value={noteEditorValue}
                          onChange={(event) => setNoteEditorValue(event.target.value)}
                          placeholder="Write your note..."
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid="notes-center-save"
                            onClick={() => handleSaveNoteFromCenter(entry)}
                            disabled={isSavingNote}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isSavingNote ? "Saving..." : "Save note"}
                          </button>
                          <button
                            type="button"
                            data-testid="notes-center-cancel"
                            onClick={handleCancelNoteEdit}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <p
                          data-testid="notes-center-note-text"
                          className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2 text-sm text-gray-800"
                        >
                          {entry.note}
                        </p>
                        <button
                          type="button"
                          data-testid="notes-center-edit"
                          onClick={() => handleStartNoteEdit(entry)}
                          className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                        >
                          Edit note
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {showCollectionsModal && !isTrashView && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/35"
              onClick={() => {
                setShowCollectionsModal(false);
                cancelCollectionRename();
              }}
            />
            <section
              data-testid="collections-modal"
              className="relative w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-gray-900">Manage Shelves</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    Group books into custom collections.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="collections-modal-close"
                  onClick={() => {
                    setShowCollectionsModal(false);
                    cancelCollectionRename();
                  }}
                  className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs font-semibold text-gray-700">Create shelf</div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    data-testid="collection-create-input"
                    value={collectionNameDraft}
                    onChange={(e) => setCollectionNameDraft(e.target.value)}
                    placeholder="Shelf name (e.g. Classics)"
                    className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex items-center gap-2">
                    {COLLECTION_COLOR_OPTIONS.map((color) => (
                      <button
                        key={`draft-${color}`}
                        type="button"
                        data-testid="collection-color-option"
                        onClick={() => setCollectionColorDraft(color)}
                        className={`h-6 w-6 rounded-full border-2 ${collectionColorDraft === color ? "border-gray-900" : "border-white"}`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    data-testid="collection-create-button"
                    onClick={handleCreateCollection}
                    className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
                  >
                    Create
                  </button>
                </div>
                {collectionError && (
                  <div className="mt-2 text-xs font-semibold text-red-600">{collectionError}</div>
                )}
              </div>

              <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {collections.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
                    No shelves yet. Create your first one above.
                  </div>
                )}
                {collections.map((collection) => {
                  const linkedCount = books.filter((book) => Array.isArray(book.collectionIds) && book.collectionIds.includes(collection.id)).length;
                  const isEditing = editingCollectionId === collection.id;
                  return (
                    <div
                      key={collection.id}
                      data-testid="collection-item"
                      className="rounded-2xl border border-gray-200 bg-white p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: collection.color }}
                            />
                            {isEditing ? (
                              <input
                                data-testid="collection-rename-input"
                                value={editingCollectionName}
                                onChange={(e) => setEditingCollectionName(e.target.value)}
                                className="h-8 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            ) : (
                              <div data-testid="collection-item-name" className="truncate text-sm font-bold text-gray-900">
                                {collection.name}
                              </div>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {linkedCount} book{linkedCount === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                data-testid="collection-rename-save"
                                onClick={handleSaveCollectionRename}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"
                              >
                                <Check size={12} />
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelCollectionRename}
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-600"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                data-testid="collection-rename-button"
                                onClick={() => startCollectionRename(collection)}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                              >
                                <Pencil size={12} />
                                Rename
                              </button>
                              <button
                                type="button"
                                data-testid="collection-delete-button"
                                onClick={() => handleDeleteCollection(collection.id)}
                                className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
        {globalSearchQuery && !isTrashView && (
          <div className={`mb-4 ${showGlobalSearchSplitColumns ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)] gap-4 items-start" : ""}`}>
          <section
            data-testid="global-search-panel"
            className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-blue-900">Global Search Results</h2>
              <span className="text-xs font-semibold text-blue-700">
                {globalSearchTotal} match{globalSearchTotal === 1 ? "" : "es"}
              </span>
            </div>
            {isContentSearching && (
              <p data-testid="global-search-scanning" className="mt-2 text-[11px] font-semibold text-blue-800/80">
                Scanning book text...
              </p>
            )}

            {globalSearchTotal === 0 ? (
              <p data-testid="global-search-empty" className="mt-2 text-xs text-blue-800/80">
                No matches found in books, highlights, notes, or bookmarks.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {globalMatchedBookPairs.length > 0 && (
                  <div data-testid="global-search-found-books" className="space-y-3">
                    {globalMatchedBookPairs.map((pair) => (
                      <div
                        key={`content-pair-${pair.bookId}`}
                        data-testid="global-search-content-book-row"
                        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.95fr)] gap-3 items-start"
                      >
                        <div
                          data-testid="global-search-group-content"
                          className={`rounded-xl border border-blue-100 bg-white p-3 ${CONTENT_PANEL_HEIGHT_CLASS}`}
                        >
                          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-blue-700">
                            Book content · {pair.title}
                          </div>
                          <div
                            data-testid="global-search-group-content-scroll"
                            className={`space-y-2 ${CONTENT_SCROLL_HEIGHT_CLASS} overflow-y-auto pr-1 pb-2`}
                          >
                            {pair.contentItems.map((item) => (
                              <button
                                key={item.id}
                                data-testid="global-search-result-content"
                                onClick={(e) => handleGlobalResultOpen(e, item)}
                                className="w-full text-left rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50 px-2 py-2 transition"
                              >
                                <div className="text-xs font-bold text-gray-900 line-clamp-1">{item.title}</div>
                                <div className="text-[11px] text-gray-500 line-clamp-1">{item.subtitle}</div>
                                {item.snippet && (
                                  <div className="mt-1 text-[11px] leading-[1.45] text-gray-700 line-clamp-2">{item.snippet}</div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>{renderGlobalSearchBookCard(pair)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {globalOtherGroups.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {globalOtherGroups.map((group) => (
                      <div
                        key={group.key}
                        data-testid={`global-search-group-${group.key}`}
                        className="rounded-xl border border-blue-100 bg-white p-3"
                      >
                        <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-blue-700">
                          {group.label}
                        </div>
                        <div className="space-y-2">
                          {group.items.map((item) => (
                            <button
                              key={item.id}
                              data-testid={`global-search-result-${group.key}`}
                              onClick={(e) => handleGlobalResultOpen(e, item)}
                              className="w-full text-left rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50 px-2 py-2 transition"
                            >
                              <div className="text-xs font-bold text-gray-900 line-clamp-1">{item.title}</div>
                              <div className="text-[11px] text-gray-500 line-clamp-1">{item.subtitle}</div>
                              {item.snippet && (
                                <div className="mt-1 text-[11px] text-gray-700 line-clamp-2">{item.snippet}</div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {globalMatchedBookPairs.length === 0 && globalOtherGroups.length === 0 && (
                  <p className="text-xs text-blue-800/80">
                    Book matches are shown on the right.
                  </p>
                )}
              </div>
            )}
          </section>
          {showGlobalSearchSplitColumns && (
            <aside
              data-testid="global-search-found-books"
              className="rounded-2xl border border-blue-100 bg-white p-4"
            >
              <div className="text-sm font-bold text-gray-900">Found books</div>
              <p className="mt-1 text-xs text-gray-500">
                {globalMatchedBooks.length} book{globalMatchedBooks.length === 1 ? "" : "s"} found
              </p>
              <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1 space-y-4">
                {globalMatchedBooks.map((item) => renderGlobalSearchBookCard(item))}
              </div>
            </aside>
          )}
          </div>
        )}
        <div className="mb-8 text-xs text-gray-500 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-600">Active:</span>
          <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">
            {getFilterLabel()}
          </span>
          <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">
            {getCollectionFilterLabel()}
          </span>
          {flagFilters.map((flag) => {
            const label = flagFilterOptions.find((item) => item.value === flag)?.label || flag;
            return (
              <button
                key={`active-flag-${flag}`}
                type="button"
                data-testid={`active-flag-chip-${flag}`}
                onClick={() => toggleFlagFilter(flag)}
                className="px-2 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                title={`Remove ${label.toLowerCase()} filter`}
              >
                {label} x
              </button>
            );
          })}
          <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">
            {sortOptions.find((s) => s.value === sortBy)?.label || "Last read (newest)"}
          </span>
        </div>
        {isTrashView && (
          <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div
              data-testid="trash-retention-note"
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
            >
              Books in Trash are permanently deleted after {TRASH_RETENTION_DAYS} days.
            </div>
            <button
              type="button"
              data-testid="trash-back-button"
              onClick={() => setStatusFilter("all")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={14} />
              <span>Back to Library</span>
            </button>
          </div>
        )}

        {!showGlobalSearchBooksColumn && (sortedBooks.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl p-20 text-center shadow-sm">
            <BookIcon size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-lg">
              {isTrashView ? "Trash is empty." : "No books found matching your criteria."}
            </p>
            {hasActiveLibraryFilters && (
              <button 
                data-testid="library-empty-reset-filters-button"
                onClick={resetLibraryFilters}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100"
                title="Reset filters"
                aria-label="Reset filters"
              >
                <RotateCcw size={16} />
                <span>Reset filters</span>
              </button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8 animate-in fade-in duration-500" data-testid="library-books-grid">
            {sortedBooks.map((book) => {
              const inTrash = Boolean(book.isDeleted);
              return (
                <Link 
                  to={inTrash ? "#" : buildReaderPath(book.id)} 
                  key={book.id}
                  onClick={(e) => {
                    if (inTrash) {
                      e.preventDefault();
                      return;
                    }
                    handleOpenBook(book.id);
                  }}
                  className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 flex flex-col relative"
                >
                  <div className="aspect-[3/4] bg-gray-200 overflow-hidden relative">
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                        <BookIcon size={40} className="mb-2 opacity-20" />
                        <span className="text-xs font-medium uppercase tracking-widest">{book.title}</span>
                      </div>
                    )}

                    <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      {inTrash ? (
                        <>
                          <button
                            data-testid="book-restore"
                            onClick={(e) => handleRestoreBook(e, book.id)}
                            className="p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-md transition-transform active:scale-95"
                            title="Restore Book"
                          >
                            <RotateCcw size={16} />
                          </button>
                          <button
                            data-testid="book-delete-forever"
                            onClick={(e) => handleDeleteBookForever(e, book.id)}
                            className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl shadow-md transition-transform active:scale-95"
                            title="Delete Forever"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button 
                            data-testid="book-move-trash"
                            onClick={(e) => handleDeleteBook(e, book.id)}
                            className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl shadow-md transition-transform active:scale-95"
                            title="Move to Trash"
                          >
                            <Trash2 size={16} />
                          </button>
                          <button
                            type="button"
                            data-testid="book-collection-picker-toggle"
                            onClick={(e) => handleToggleCollectionPicker(e, book.id)}
                            className={`p-2 rounded-xl shadow-md transition-all active:scale-95 ${
                              Array.isArray(book.collectionIds) && book.collectionIds.length
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white text-gray-400 hover:text-indigo-600'
                            }`}
                            title="Shelves"
                          >
                            <FolderClosed size={16} />
                          </button>
                          <button
                            data-testid="book-toggle-to-read"
                            onClick={(e) => handleToggleToRead(e, book.id)}
                            className={`p-2 rounded-xl shadow-md transition-all active:scale-95 ${
                              book.isToRead ? 'bg-amber-500 text-white' : 'bg-white text-gray-400 hover:text-amber-600'
                            }`}
                            title={book.isToRead ? "Remove To Read tag" : "Add To Read tag"}
                          >
                            <Tag size={16} />
                          </button>
                          <button 
                            onClick={(e) => handleToggleFavorite(e, book.id)}
                            className={`p-2 rounded-xl shadow-md transition-all active:scale-95 ${
                              book.isFavorite ? 'bg-pink-500 text-white' : 'bg-white text-gray-400 hover:text-pink-500'
                            }`}
                            title="Favorite"
                          >
                            <Heart size={16} fill={book.isFavorite ? "currentColor" : "none"} />
                          </button>
                        </>
                      )}
                    </div>
                    
                    <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md text-white text-xs font-bold px-2 py-1 rounded-lg">
                      {book.progress}%
                    </div>

                    {collectionPickerBookId === book.id && !inTrash && (
                      <div
                        data-testid="book-collection-picker"
                        className="absolute left-3 top-3 z-20 w-[230px] rounded-xl border border-gray-200 bg-white p-3 shadow-xl"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Shelves</div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setShowCollectionsModal(true);
                              setCollectionError("");
                            }}
                            className="text-[10px] font-bold text-blue-600 hover:text-blue-700"
                          >
                            Manage
                          </button>
                        </div>
                        {collections.length === 0 ? (
                          <p className="mt-2 text-[11px] text-gray-500">Create a shelf first.</p>
                        ) : (
                          <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                            {collections.map((collection) => {
                              const isChecked = Array.isArray(book.collectionIds) && book.collectionIds.includes(collection.id);
                              return (
                                <label
                                  key={`${book.id}-${collection.id}`}
                                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                                >
                                  <input
                                    type="checkbox"
                                    data-testid="book-collection-toggle"
                                    checked={isChecked}
                                    onChange={(e) => handleToggleBookCollection(e, book.id, collection.id)}
                                  />
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: collection.color }}
                                  />
                                  <span className="truncate">{collection.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col">
                    <h3 className="font-bold text-gray-900 text-lg leading-tight mb-2 line-clamp-2 group-hover:text-blue-600 transition-colors">
                      {book.title}
                    </h3>
                    
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                      <User size={14} />
                      <span className="truncate">{book.author}</span>
                    </div>

                    {renderMetadataBadges(book)}
                    {renderCollectionChips(book)}

                    {renderReadingStateBadge(book, "mt-2")}
                    {renderToReadTag(book, "mt-2")}
                    {renderSessionTimeline(book)}

                    <div className="mt-auto pt-4 flex justify-between items-center text-[10px] text-gray-400 font-medium">
                      {book.pubDate ? (
                        <div className="flex items-center gap-1">
                          <Calendar size={10} />
                          <span>{new Date(book.pubDate).getFullYear() || book.pubDate}</span>
                        </div>
                      ) : <span></span>}
                      
                      <span>{inTrash ? formatDeletedAt(book.deletedAt) : formatLastRead(book.lastRead)}</span>
                    </div>

                    <div className="w-full bg-gray-100 h-1.5 rounded-full mt-2 overflow-hidden">
                      <div 
                        className="bg-blue-600 h-full transition-all duration-1000" 
                        style={{ width: `${book.progress}%` }}
                      />
                    </div>

                    {!inTrash && (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button
                          data-testid="quick-action-resume"
                          onClick={(e) => handleQuickOpen(e, book.id)}
                          className="text-[10px] font-bold py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                          title="Resume"
                        >
                          Resume
                        </button>
                        <button
                          data-testid="quick-action-highlights"
                          onClick={(e) => handleQuickOpen(e, book.id, 'highlights')}
                          className="text-[10px] font-bold py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                          title="Open highlights"
                        >
                          Highlights
                        </button>
                        <button
                          data-testid="quick-action-bookmarks"
                          onClick={(e) => handleQuickOpen(e, book.id, 'bookmarks')}
                          className="text-[10px] font-bold py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                          title="Open bookmarks"
                        >
                          Bookmarks
                        </button>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4 animate-in fade-in duration-500" data-testid="library-books-list">
            {sortedBooks.map((book) => {
              const inTrash = Boolean(book.isDeleted);
              return (
                <Link
                  to={inTrash ? "#" : buildReaderPath(book.id)}
                  key={book.id}
                  onClick={(e) => {
                    if (inTrash) {
                      e.preventDefault();
                      return;
                    }
                    handleOpenBook(book.id);
                  }}
                  className="group bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden border border-gray-100 flex"
                >
                  <div className="w-24 sm:w-28 md:w-32 bg-gray-200 overflow-hidden relative shrink-0">
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-3 text-center">
                        <BookIcon size={24} className="mb-1 opacity-20" />
                        <span className="text-[10px] font-medium uppercase tracking-widest line-clamp-2">{book.title}</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg">
                      {book.progress}%
                    </div>
                  </div>

                  <div className="flex-1 p-4 flex flex-col md:flex-row md:items-center gap-4 min-w-0">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-gray-900 text-base leading-tight line-clamp-1 group-hover:text-blue-600 transition-colors">
                        {book.title}
                      </h3>

                      <div className="mt-1 flex items-center gap-2 text-gray-500 text-sm">
                        <User size={14} />
                        <span className="truncate">{book.author}</span>
                      </div>

                      {renderMetadataBadges(book)}
                      {renderCollectionChips(book)}

                      {renderReadingStateBadge(book, "mt-2")}
                      {renderToReadTag(book, "mt-2")}
                      {renderSessionTimeline(book)}

                      <div className="mt-2 text-[11px] text-gray-400 flex items-center justify-between gap-3">
                        <span>{inTrash ? formatDeletedAt(book.deletedAt) : formatLastRead(book.lastRead)}</span>
                        {book.pubDate ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={10} />
                            <span>{new Date(book.pubDate).getFullYear() || book.pubDate}</span>
                          </span>
                        ) : <span />}
                      </div>

                      <div className="w-full bg-gray-100 h-1.5 rounded-full mt-3 overflow-hidden">
                        <div
                          className="bg-blue-600 h-full transition-all duration-700"
                          style={{ width: `${book.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 md:w-44">
                      {!inTrash && (
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            data-testid="quick-action-resume"
                            onClick={(e) => handleQuickOpen(e, book.id)}
                            className="text-[10px] font-bold py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                            title="Resume"
                          >
                            Resume
                          </button>
                          <button
                            data-testid="quick-action-highlights"
                            onClick={(e) => handleQuickOpen(e, book.id, 'highlights')}
                            className="text-[10px] font-bold py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                            title="Open highlights"
                          >
                            Highlights
                          </button>
                          <button
                            data-testid="quick-action-bookmarks"
                            onClick={(e) => handleQuickOpen(e, book.id, 'bookmarks')}
                            className="text-[10px] font-bold py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                            title="Open bookmarks"
                          >
                            Bookmarks
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-2 justify-end">
                        {inTrash ? (
                          <>
                            <button
                              data-testid="book-restore"
                              onClick={(e) => handleRestoreBook(e, book.id)}
                              className="p-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl shadow-sm transition-transform active:scale-95"
                              title="Restore Book"
                            >
                              <RotateCcw size={16} />
                            </button>
                            <button
                              data-testid="book-delete-forever"
                              onClick={(e) => handleDeleteBookForever(e, book.id)}
                              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl shadow-sm transition-transform active:scale-95"
                              title="Delete Forever"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              data-testid="book-collection-picker-toggle"
                              onClick={(e) => handleToggleCollectionPicker(e, book.id)}
                              className={`p-2 rounded-xl shadow-sm transition-all active:scale-95 ${
                                Array.isArray(book.collectionIds) && book.collectionIds.length
                                  ? 'bg-indigo-500 text-white'
                                  : 'bg-white border border-gray-200 text-gray-400 hover:text-indigo-600'
                              }`}
                              title="Shelves"
                            >
                              <FolderClosed size={16} />
                            </button>
                            <button
                              data-testid="book-toggle-to-read"
                              onClick={(e) => handleToggleToRead(e, book.id)}
                              className={`p-2 rounded-xl shadow-sm transition-all active:scale-95 ${
                                book.isToRead ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-400 hover:text-amber-600'
                              }`}
                              title={book.isToRead ? "Remove To Read tag" : "Add To Read tag"}
                            >
                              <Tag size={16} />
                            </button>
                            <button
                              onClick={(e) => handleToggleFavorite(e, book.id)}
                              className={`p-2 rounded-xl shadow-sm transition-all active:scale-95 ${
                                book.isFavorite ? 'bg-pink-500 text-white' : 'bg-white border border-gray-200 text-gray-400 hover:text-pink-500'
                              }`}
                              title="Favorite"
                            >
                              <Heart size={16} fill={book.isFavorite ? "currentColor" : "none"} />
                            </button>
                            <button
                              data-testid="book-move-trash"
                              onClick={(e) => handleDeleteBook(e, book.id)}
                              className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-xl shadow-sm transition-transform active:scale-95"
                              title="Move to Trash"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>

                      {collectionPickerBookId === book.id && !inTrash && (
                        <div
                          data-testid="book-collection-picker"
                          className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">Shelves</div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShowCollectionsModal(true);
                                setCollectionError("");
                              }}
                              className="text-[10px] font-bold text-blue-600 hover:text-blue-700"
                            >
                              Manage
                            </button>
                          </div>
                          {collections.length === 0 ? (
                            <p className="mt-2 text-[11px] text-gray-500">Create a shelf first.</p>
                          ) : (
                            <div className="mt-2 max-h-36 overflow-y-auto space-y-1">
                              {collections.map((collection) => {
                                const isChecked = Array.isArray(book.collectionIds) && book.collectionIds.includes(collection.id);
                                return (
                                  <label
                                    key={`${book.id}-list-${collection.id}`}
                                    className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                                  >
                                    <input
                                      type="checkbox"
                                      data-testid="book-collection-toggle"
                                      checked={isChecked}
                                      onChange={(e) => handleToggleBookCollection(e, book.id, collection.id)}
                                    />
                                    <span
                                      className="inline-block w-2.5 h-2.5 rounded-full"
                                      style={{ backgroundColor: collection.color }}
                                    />
                                    <span className="truncate">{collection.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
