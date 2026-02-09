import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { jsPDF } from "jspdf";
import {
  addBook,
  readEpubMetadata,
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
  Heart,
  Tag,
  Flame,
  RotateCcw,
  FileText,
  Moon,
  Sun,
  Languages,
  FolderClosed,
  Info,
  X,
  Search,
  ArrowUpDown,
  LayoutGrid,
  List,
} from 'lucide-react';
import LibraryAccountSection from './library/LibraryAccountSection';
import { LibraryWorkspaceSidebar, LibraryWorkspaceMobileNav } from './library/LibraryWorkspaceNav';
import LibraryNotesCenterPanel from './library/LibraryNotesCenterPanel';
import LibraryHighlightsCenterPanel from './library/LibraryHighlightsCenterPanel';
import LibraryCollectionsBoard from './library/LibraryCollectionsBoard';
import LibraryGlobalSearchPanel from './library/LibraryGlobalSearchPanel';
import LibraryToolbarSection from './library/LibraryToolbarSection';

const STARTED_BOOK_IDS_KEY = 'library-started-book-ids';
const TRASH_RETENTION_DAYS = 30;
const LIBRARY_THEME_KEY = 'library-theme';
const LIBRARY_LANGUAGE_KEY = 'library-language';
const ACCOUNT_PROFILE_KEY = 'library-account-profile';
const ACCOUNT_DEFAULT_EMAIL = 'dreamerissame@gmail.com';
const LANGUAGE_DISPLAY_NAMES =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

const readStoredAccountProfile = () => {
  if (typeof window === "undefined") {
    return {
      firstName: "",
      email: ACCOUNT_DEFAULT_EMAIL,
      preferredLanguage: "en",
      emailNotifications: "yes"
    };
  }
  try {
    const raw = window.localStorage.getItem(ACCOUNT_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const fallbackLanguage = window.localStorage.getItem(LIBRARY_LANGUAGE_KEY) || "en";
    return {
      firstName: typeof parsed?.firstName === "string" ? parsed.firstName : "",
      email: typeof parsed?.email === "string" && parsed.email.trim() ? parsed.email.trim() : ACCOUNT_DEFAULT_EMAIL,
      preferredLanguage:
        typeof parsed?.preferredLanguage === "string" && parsed.preferredLanguage.trim()
          ? parsed.preferredLanguage
          : fallbackLanguage,
      emailNotifications: parsed?.emailNotifications === "no" ? "no" : "yes"
    };
  } catch (err) {
    console.error(err);
    return {
      firstName: "",
      email: ACCOUNT_DEFAULT_EMAIL,
      preferredLanguage: "en",
      emailNotifications: "yes"
    };
  }
};

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
const EXCLUDED_METADATA_KEYS = new Set(["modified", "identifier"]);
const PRIORITIZED_METADATA_KEYS = ["title", "creator", "author", "language"];

const decodeHtmlEntities = (value) => {
  if (typeof value !== "string") return value;
  if (typeof document === "undefined") return value;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
};

const sanitizeMetadataText = (value) => {
  if (typeof value !== "string") return value;
  let normalized = value;
  normalized = normalized.replace(/<\s*\/\s*/g, "</");
  normalized = normalized.replace(/<\s*br\s*\/?\s*>/gi, " ");
  normalized = normalized.replace(/<\s*\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, " ");
  normalized = normalized.replace(/<[^>]*>/g, " ");
  normalized = decodeHtmlEntities(normalized);
  normalized = normalized.replace(/\u00a0/g, " ");
  return compactWhitespace(normalized);
};

const getMetadataSortRank = (key) => {
  const normalized = String(key || "").trim().toLowerCase();
  const index = PRIORITIZED_METADATA_KEYS.indexOf(normalized);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const sortMetadataKeys = (a, b) => {
  const rankA = getMetadataSortRank(a);
  const rankB = getMetadataSortRank(b);
  if (rankA !== rankB) return rankA - rankB;
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
};

const safeStringify = (value) => {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch (err) {
    console.error(err);
    return "[unsupported value]";
  }
};

const formatMetadataValue = (rawValue, key = "") => {
  const normalizedKey = String(key || "").trim().toLowerCase();
  if (EXCLUDED_METADATA_KEYS.has(normalizedKey)) return "";

  if (rawValue == null) return "";

  const formatLanguageMetadata = (input) => {
    if (input == null) return "";
    if (Array.isArray(input)) {
      return input
        .map((item) => formatLanguageMetadata(item))
        .filter(Boolean)
        .join(", ");
    }
    if (typeof input !== "string") return "";
    const parts = input
      .split(/[,;|]/)
      .map((part) => compactWhitespace(part))
      .filter(Boolean);
    if (!parts.length) return "";
    const mapped = parts.map((part) => formatLanguageLabel(part) || part);
    return compactWhitespace(mapped.join(", "));
  };

  if (normalizedKey === "language") {
    return formatLanguageMetadata(rawValue);
  }

  if (Array.isArray(rawValue)) {
    const joined = rawValue
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "string") return sanitizeMetadataText(item);
        if (typeof item === "number" || typeof item === "boolean") return String(item);
        return safeStringify(item);
      })
      .filter(Boolean)
      .join(", ");
    return compactWhitespace(joined);
  }
  if (typeof rawValue === "string") return sanitizeMetadataText(rawValue);
  if (typeof rawValue === "number" || typeof rawValue === "boolean") return String(rawValue);
  if (typeof rawValue === "object") return compactWhitespace(safeStringify(rawValue));
  return compactWhitespace(String(rawValue));
};

const toSafeFilename = (value, fallback = "book") => {
  const normalized = compactWhitespace(value || "");
  if (!normalized) return fallback;
  return normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120) || fallback;
};

const triggerBlobDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};

const getBookAnnotationStats = (book) => {
  const highlights = Array.isArray(book?.highlights) ? book.highlights : [];
  const highlightsCount = highlights.filter((item) => compactWhitespace(item?.text)).length;
  const notesCount = highlights.filter((item) => compactWhitespace(item?.note)).length;
  return {
    highlightsCount,
    notesCount,
    hasAny: highlightsCount > 0 || notesCount > 0
  };
};

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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState("idle");
  const [showUploadSuccess, setShowUploadSuccess] = useState(false);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState("Book loaded and added");
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0);
  const [uploadBatchCompleted, setUploadBatchCompleted] = useState(0);
  const [uploadBatchCurrentIndex, setUploadBatchCurrentIndex] = useState(0);
  const [uploadBatchCurrentName, setUploadBatchCurrentName] = useState("");
  const [recentlyAddedBookId, setRecentlyAddedBookId] = useState("");
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);
  
  // Search, filter & sort states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [librarySection, setLibrarySection] = useState("library");
  const [trashSortBy, setTrashSortBy] = useState("deleted-desc");
  const [selectedTrashBookIds, setSelectedTrashBookIds] = useState([]);
  const [flagFilters, setFlagFilters] = useState([]);
  const [sortBy, setSortBy] = useState("last-read-desc");
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "grid";
    return window.localStorage.getItem("library-view-mode") === "list" ? "list" : "grid";
  });
  const [libraryTheme, setLibraryTheme] = useState(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem(LIBRARY_THEME_KEY) === "dark" ? "dark" : "light";
  });
  const [libraryLanguage, setLibraryLanguage] = useState(() => {
    if (typeof window === "undefined") return "en";
    return window.localStorage.getItem(LIBRARY_LANGUAGE_KEY) || "en";
  });
  const [accountProfile, setAccountProfile] = useState(() => readStoredAccountProfile());
  const [accountSaveMessage, setAccountSaveMessage] = useState("");
  const [isNotesCenterOpen, setIsNotesCenterOpen] = useState(false);
  const [isHighlightsCenterOpen, setIsHighlightsCenterOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState("");
  const [noteEditorValue, setNoteEditorValue] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [collections, setCollections] = useState([]);
  const [collectionNameDraft, setCollectionNameDraft] = useState("");
  const [collectionColorDraft, setCollectionColorDraft] = useState(COLLECTION_COLOR_OPTIONS[0]);
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [editingCollectionName, setEditingCollectionName] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [collectionPickerBookId, setCollectionPickerBookId] = useState("");
  const [infoPopover, setInfoPopover] = useState(null);
  const [showCreateCollectionForm, setShowCreateCollectionForm] = useState(false);
  const [contentSearchMatches, setContentSearchMatches] = useState({});
  const [isContentSearching, setIsContentSearching] = useState(false);
  const contentSearchTokenRef = useRef(0);
  const uploadTimerRef = useRef(null);
  const uploadSuccessTimerRef = useRef(null);
  const recentHighlightTimerRef = useRef(null);
  const infoPopoverCloseTimerRef = useRef(null);
  const infoPopoverRef = useRef(null);
  const duplicateDecisionResolverRef = useRef(null);

  const openInfoPopover = (book, rect, pinned = false) => {
    if (!book || !rect) return;
    if (infoPopoverCloseTimerRef.current) {
      clearTimeout(infoPopoverCloseTimerRef.current);
      infoPopoverCloseTimerRef.current = null;
    }
    const safeRect = {
      left: Number.isFinite(rect.left) ? rect.left : 0,
      right: Number.isFinite(rect.right) ? rect.right : 0,
      top: Number.isFinite(rect.top) ? rect.top : 0,
      bottom: Number.isFinite(rect.bottom) ? rect.bottom : 0,
      width: Number.isFinite(rect.width) ? rect.width : 0,
      height: Number.isFinite(rect.height) ? rect.height : 0
    };
    setInfoPopover({ book, rect: safeRect, pinned });
  };

  const scheduleInfoPopoverClose = () => {
    if (infoPopover?.pinned) return;
    if (infoPopoverCloseTimerRef.current) clearTimeout(infoPopoverCloseTimerRef.current);
    infoPopoverCloseTimerRef.current = setTimeout(() => {
      setInfoPopover(null);
    }, 140);
  };

  const cancelInfoPopoverClose = () => {
    if (infoPopoverCloseTimerRef.current) {
      clearTimeout(infoPopoverCloseTimerRef.current);
      infoPopoverCloseTimerRef.current = null;
    }
  };

  useEffect(() => { loadLibrary(); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("library-view-mode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_THEME_KEY, libraryTheme);
  }, [libraryTheme]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_LANGUAGE_KEY, libraryLanguage);
  }, [libraryLanguage]);

  useEffect(() => {
    if (!infoPopover) return;
    const handleMouseDown = (event) => {
      if (!infoPopoverRef.current) return;
      if (infoPopoverRef.current.contains(event.target)) return;
      setInfoPopover(null);
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [infoPopover]);

  useEffect(() => {
    return () => {
      if (duplicateDecisionResolverRef.current) {
        duplicateDecisionResolverRef.current("ignore");
        duplicateDecisionResolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    const shouldSearchContent = query.length >= 2 && librarySection === "library";

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
  }, [books, searchQuery, librarySection]);

  useEffect(() => {
    if (librarySection !== "trash") return;
    if (!flagFilters.length) return;
    setFlagFilters([]);
  }, [librarySection, flagFilters]);

  useEffect(() => {
    if (librarySection !== "trash") return;
    if (!isNotesCenterOpen && !isHighlightsCenterOpen) return;
    setIsNotesCenterOpen(false);
    setIsHighlightsCenterOpen(false);
    setEditingNoteId("");
    setNoteEditorValue("");
  }, [librarySection, isNotesCenterOpen, isHighlightsCenterOpen]);

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

  useEffect(() => {
    const trashedIds = new Set(books.filter((book) => Boolean(book.isDeleted)).map((book) => book.id));
    setSelectedTrashBookIds((current) => current.filter((id) => trashedIds.has(id)));
  }, [books]);

  useEffect(() => {
    return () => {
      if (uploadTimerRef.current) {
        clearInterval(uploadTimerRef.current);
      }
      if (uploadSuccessTimerRef.current) {
        clearTimeout(uploadSuccessTimerRef.current);
      }
      if (recentHighlightTimerRef.current) {
        clearTimeout(recentHighlightTimerRef.current);
      }
    };
  }, []);

  const startUploadProgress = () => {
    if (uploadTimerRef.current) {
      clearInterval(uploadTimerRef.current);
    }
    setUploadProgress(8);
    setUploadStage("reading");
    uploadTimerRef.current = setInterval(() => {
      setUploadProgress((current) => {
        const next = Math.min(current + Math.floor(Math.random() * 8 + 4), 92);
        return next;
      });
    }, 320);
  };

  const stopUploadProgress = () => {
    if (uploadTimerRef.current) {
      clearInterval(uploadTimerRef.current);
      uploadTimerRef.current = null;
    }
  };

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
    const targetBook = books.find((book) => book.id === id);
    if (!targetBook) return;
    const { hasAny } = getBookAnnotationStats(targetBook);
    const confirmMessage = hasAny
      ? "Delete this book forever? This cannot be undone."
      : "Delete this book forever? This cannot be undone. (No highlights nor notes are available with this book.)";
    if (!window.confirm(confirmMessage)) return;
    if (hasAny) {
      const shouldBackup = window.confirm("Download backup first? (PDF + JSON with highlights and notes)");
      if (shouldBackup) {
        await exportTrashBackups([targetBook]);
      }
    }
    await deleteBook(id);
    await loadLibrary();
  };

  const buildBookBackupPayload = (book) => {
    const highlights = Array.isArray(book?.highlights) ? book.highlights : [];
    const highlightedEntries = highlights
      .filter((item) => compactWhitespace(item?.text))
      .map((item, index) => ({
        index: index + 1,
        text: compactWhitespace(item?.text),
        note: compactWhitespace(item?.note || ""),
        color: item?.color || "",
        cfiRange: item?.cfiRange || "",
        chapterLabel: item?.chapterLabel || ""
      }));
    return {
      exportedAt: new Date().toISOString(),
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        language: book.language || "",
        deletedAt: book.deletedAt || "",
        estimatedPages: book.estimatedPages || null
      },
      highlights: highlightedEntries,
      notes: highlightedEntries.filter((item) => item.note)
    };
  };

  const buildBookBackupPdfBlob = (book, payload) => {
    const doc = new jsPDF({
      orientation: "p",
      unit: "pt",
      format: "a4"
    });
    const margin = 40;
    const lineHeight = 16;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const ensureSpace = (height = lineHeight) => {
      if (y + height <= pageHeight - margin) return;
      doc.addPage();
      y = margin;
    };

    const writeLine = (text, options = {}) => {
      const size = options.size || 11;
      const style = options.style || "normal";
      const color = options.color || [17, 24, 39];
      const before = options.before || 0;
      const after = options.after || 6;
      if (before) y += before;
      doc.setFont("helvetica", style);
      doc.setFontSize(size);
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(String(text || ""), contentWidth);
      lines.forEach((line) => {
        ensureSpace(lineHeight);
        doc.text(line, margin, y);
        y += lineHeight;
      });
      y += after;
    };

    writeLine(book.title || "Untitled", { size: 18, style: "bold", after: 2 });
    writeLine(book.author || "Unknown Author", { size: 12, color: [75, 85, 99], after: 10 });
    writeLine(`Deleted: ${book.deletedAt ? new Date(book.deletedAt).toLocaleString() : "Unknown"}`, { size: 10, color: [100, 116, 139], after: 12 });

    if (!payload.highlights.length) {
      writeLine("No highlights found.", { size: 11, color: [100, 116, 139] });
    } else {
      payload.highlights.forEach((entry) => {
        writeLine(`Highlight ${entry.index}`, { size: 11, style: "bold", color: [30, 64, 175], after: 2 });
        writeLine(entry.text, { size: 11, color: [31, 41, 55], after: 2 });
        if (entry.note) {
          writeLine(`Note: ${entry.note}`, { size: 10, style: "italic", color: [75, 85, 99], after: 2 });
        }
        if (entry.chapterLabel) {
          writeLine(`Chapter: ${entry.chapterLabel}`, { size: 9, color: [107, 114, 128], after: 4 });
        }
        y += 8;
      });
    }

    return doc.output("blob");
  };

  const exportTrashBackups = async (targetBooks) => {
    const validBooks = (targetBooks || []).filter(Boolean);
    if (!validBooks.length) return;

    if (validBooks.length === 1) {
      const book = validBooks[0];
      const payload = buildBookBackupPayload(book);
      const pdfBlob = buildBookBackupPdfBlob(book, payload);
      const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const baseName = toSafeFilename(`${book.title || "book"}-${book.author || "author"}`);
      triggerBlobDownload(pdfBlob, `${baseName}-highlights-notes.pdf`);
      triggerBlobDownload(jsonBlob, `${baseName}-highlights-notes.json`);
      return;
    }

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    validBooks.forEach((book, index) => {
      const payload = buildBookBackupPayload(book);
      const folderName = toSafeFilename(`${index + 1}-${book.title || "book"}`);
      const folder = zip.folder(folderName);
      if (!folder) return;
      const pdfBlob = buildBookBackupPdfBlob(book, payload);
      folder.file("highlights-notes.pdf", pdfBlob);
      folder.file("highlights-notes.json", JSON.stringify(payload, null, 2));
    });
    const zipBlob = await zip.generateAsync({ type: "blob" });
    triggerBlobDownload(zipBlob, `trash-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  };

  const handleToggleTrashSelection = (id) => {
    setSelectedTrashBookIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  };

  const handleToggleSelectAllTrash = () => {
    setSelectedTrashBookIds((current) => {
      const nextIds = Array.from(new Set(sortedTrashBooks.map((book) => book.id)));
      if (!nextIds.length) return [];
      const allSelected = nextIds.every((id) => current.includes(id));
      return allSelected ? [] : nextIds;
    });
  };

  const handleRestoreSelectedTrash = async () => {
    if (!selectedTrashBookIds.length) return;
    await Promise.all(selectedTrashBookIds.map((id) => restoreBookFromTrash(id)));
    setSelectedTrashBookIds([]);
    await loadLibrary();
  };

  const handleDeleteSelectedTrash = async () => {
    if (!selectedTrashBookIds.length) return;
    const selectedBooks = trashedBooks.filter((book) => selectedTrashBookIds.includes(book.id));
    const hasAnyAnnotations = selectedBooks.some((book) => getBookAnnotationStats(book).hasAny);
    const confirmMessage = hasAnyAnnotations
      ? "Delete selected books forever? This cannot be undone."
      : "Delete selected books forever? This cannot be undone. (No highlights nor notes are available with selected books.)";
    if (!window.confirm(confirmMessage)) return;
    if (hasAnyAnnotations) {
      const shouldBackup = window.confirm("Download backup first? (ZIP with PDF + JSON per book)");
      if (shouldBackup) {
        await exportTrashBackups(selectedBooks);
      }
    }
    await Promise.all(selectedTrashBookIds.map((id) => deleteBook(id)));
    setSelectedTrashBookIds([]);
    await loadLibrary();
  };

  const handleRestoreAllTrash = async () => {
    if (!trashedBooks.length) return;
    await Promise.all(trashedBooks.map((book) => restoreBookFromTrash(book.id)));
    setSelectedTrashBookIds([]);
    await loadLibrary();
  };

  const handleDeleteAllTrash = async () => {
    if (!trashedBooks.length) return;
    const hasAnyAnnotations = trashedBooks.some((book) => getBookAnnotationStats(book).hasAny);
    const confirmMessage = hasAnyAnnotations
      ? "Delete all books from Trash forever? This cannot be undone."
      : "Delete all books from Trash forever? This cannot be undone. (No highlights nor notes are available with books in trash.)";
    if (!window.confirm(confirmMessage)) return;
    if (hasAnyAnnotations) {
      const shouldBackup = window.confirm("Download backup first? (ZIP with PDF + JSON per book)");
      if (shouldBackup) {
        await exportTrashBackups(trashedBooks);
      }
    }
    await Promise.all(trashedBooks.map((book) => deleteBook(book.id)));
    setSelectedTrashBookIds([]);
    await loadLibrary();
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

  const toggleBookCollectionMembership = async (bookId, collectionId) => {
    try {
      await toggleBookCollection(bookId, collectionId);
      await loadLibrary();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleBookCollection = async (e, bookId, collectionId) => {
    e.preventDefault();
    e.stopPropagation();
    await toggleBookCollectionMembership(bookId, collectionId);
  };

  const consumeCardActionEvent = (e) => {
    if (!e) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleCreateCollection = async () => {
    setCollectionError("");
    try {
      await createCollection(collectionNameDraft, collectionColorDraft);
      setCollectionNameDraft("");
      setCollectionColorDraft(COLLECTION_COLOR_OPTIONS[0]);
      setShowCreateCollectionForm(false);
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
    setIsNotesCenterOpen((current) => {
      const next = !current;
      if (next) {
        setLibrarySection("notes");
        setIsHighlightsCenterOpen(false);
      } else if (librarySection === "notes") {
        setLibrarySection("library");
      }
      return next;
    });
    setEditingNoteId("");
    setNoteEditorValue("");
  };

  const handleToggleHighlightsCenter = () => {
    setIsHighlightsCenterOpen((current) => {
      const next = !current;
      if (next) {
        setLibrarySection("highlights");
        setIsNotesCenterOpen(false);
      } else if (librarySection === "highlights") {
        setLibrarySection("library");
      }
      return next;
    });
  };

  const handleSidebarSectionSelect = (section) => {
    setLibrarySection(section);
    if (section === "library") {
      setIsNotesCenterOpen(false);
      setIsHighlightsCenterOpen(false);
      setSelectedTrashBookIds([]);
      return;
    }
    if (section === "trash") {
      setIsNotesCenterOpen(false);
      setIsHighlightsCenterOpen(false);
      setCollectionFilter("all");
      setStatusFilter("all");
      setCollectionPickerBookId("");
      setSelectedTrashBookIds([]);
      return;
    }
    if (section === "collections") {
      setCollectionError("");
      setIsNotesCenterOpen(false);
      setIsHighlightsCenterOpen(false);
      setStatusFilter("all");
      setSelectedTrashBookIds([]);
      return;
    }
    if (section === "notes") {
      setIsNotesCenterOpen(true);
      setIsHighlightsCenterOpen(false);
      setSelectedTrashBookIds([]);
      return;
    }
    if (section === "highlights") {
      setIsHighlightsCenterOpen(true);
      setIsNotesCenterOpen(false);
      setSelectedTrashBookIds([]);
      return;
    }
    if (section === "account") {
      setStatusFilter("all");
      setCollectionFilter("all");
      setSelectedTrashBookIds([]);
    }
    setIsNotesCenterOpen(false);
    setIsHighlightsCenterOpen(false);
  };

  const handleAccountFieldChange = (field, value) => {
    setAccountSaveMessage("");
    setAccountProfile((current) => ({ ...current, [field]: value }));
  };

  const handleSaveAccountProfile = () => {
    const nextProfile = {
      firstName: (accountProfile.firstName || "").trim(),
      email: (accountProfile.email || ACCOUNT_DEFAULT_EMAIL).trim() || ACCOUNT_DEFAULT_EMAIL,
      preferredLanguage: accountProfile.preferredLanguage || "en",
      emailNotifications: accountProfile.emailNotifications === "no" ? "no" : "yes"
    };

    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACCOUNT_PROFILE_KEY, JSON.stringify(nextProfile));
    }
    setAccountProfile(nextProfile);
    setLibraryLanguage(nextProfile.preferredLanguage);
    setAccountSaveMessage("Changes saved.");
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

  const handleOpenHighlightInReader = (entry) => {
    if (!entry?.bookId) return;
    handleOpenBook(entry.bookId);
    navigate(buildReaderPath(entry.bookId, "highlights", { cfi: entry.cfiRange || "" }));
  };

  const normalizeDuplicateValue = (value) => (value || "").toString().trim().toLowerCase();

  const findDuplicateBooks = (title, author, sourceBooks = books) => {
    const normTitle = normalizeDuplicateValue(title);
    const normAuthor = normalizeDuplicateValue(author);
    return sourceBooks.filter((book) => {
      if (book.isDeleted) return false;
      return normalizeDuplicateValue(book.title) === normTitle && normalizeDuplicateValue(book.author) === normAuthor;
    });
  };

  const buildDuplicateTitle = (baseTitle, sourceBooks = books) => {
    const existingTitles = new Set(
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

  const completeAddBook = async (file, preparedMetadata, options = {}) => {
    const newBook = await addBook(file, {
      preparedMetadata,
      titleOverride: options.titleOverride
    });
    await loadLibrary();
    setUploadProgress(100);
    if (newBook?.id) {
      setRecentlyAddedBookId(newBook.id);
      if (recentHighlightTimerRef.current) {
        clearTimeout(recentHighlightTimerRef.current);
      }
      recentHighlightTimerRef.current = setTimeout(() => {
        setRecentlyAddedBookId("");
      }, 10000);
    }
    return newBook;
  };

  const requestDuplicateDecision = (payload) => {
    return new Promise((resolve) => {
      duplicateDecisionResolverRef.current = resolve;
      setDuplicatePrompt(payload);
    });
  };

  const resolveDuplicateDecision = (decision) => {
    const resolver = duplicateDecisionResolverRef.current;
    duplicateDecisionResolverRef.current = null;
    setDuplicatePrompt(null);
    if (resolver) resolver(decision);
  };

  const isEpubFile = (file) => {
    if (!file) return false;
    if (file.type === "application/epub+zip") return true;
    return /\.epub$/i.test(file.name || "");
  };

  const handleFileUpload = async (event) => {
    const input = event.target;
    const files = Array.from(input.files || []).filter(isEpubFile);
    if (!files.length) {
      input.value = "";
      return;
    }

    try {
      setIsUploading(true);
      setShowUploadSuccess(false);
      setUploadStage("reading");
      setUploadBatchTotal(files.length);
      setUploadBatchCompleted(0);
      setUploadBatchCurrentIndex(0);
      setUploadBatchCurrentName("");
      setUploadProgress(0);

      let addedCount = 0;
      let knownBooks = await getAllBooks();
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadBatchCurrentIndex(index + 1);
        setUploadBatchCurrentName(file.name || `Book ${index + 1}`);
        startUploadProgress();

        try {
          const prepared = await readEpubMetadata(file);
          const title = prepared?.metadata?.title || file.name.replace(/\.epub$/i, "");
          const author = prepared?.metadata?.creator || "Unknown Author";
          const duplicates = findDuplicateBooks(title, author, knownBooks);

          if (duplicates.length === 0) {
            await completeAddBook(file, prepared);
            addedCount += 1;
            knownBooks = await getAllBooks();
            continue;
          }

          stopUploadProgress();
          setUploadProgress(100);
          const decision = await requestDuplicateDecision({
            file,
            preparedMetadata: prepared,
            title,
            author,
            duplicates
          });

          if (decision === "ignore") {
            continue;
          }

          if (decision === "replace") {
            await Promise.all(duplicates.map((book) => deleteBook(book.id)));
            await completeAddBook(file, prepared);
            addedCount += 1;
            knownBooks = await getAllBooks();
            continue;
          }

          if (decision === "keep-both") {
            const duplicateTitle = buildDuplicateTitle(title, knownBooks);
            await completeAddBook(file, prepared, { titleOverride: duplicateTitle });
            addedCount += 1;
            knownBooks = await getAllBooks();
          }
        } catch (err) {
          console.error(err);
        } finally {
          stopUploadProgress();
          setUploadProgress(100);
          setUploadBatchCompleted(index + 1);
        }
      }

      setUploadStage("idle");
      setUploadProgress(0);
      setUploadBatchCurrentName("");
      setUploadBatchCurrentIndex(0);
      setUploadBatchTotal(0);
      setUploadBatchCompleted(0);

      if (addedCount > 0) {
        setUploadSuccessMessage(
          addedCount === 1 ? "Book loaded and added" : `${addedCount} books loaded and added`
        );
        setShowUploadSuccess(true);
        if (uploadSuccessTimerRef.current) {
          clearTimeout(uploadSuccessTimerRef.current);
        }
        uploadSuccessTimerRef.current = setTimeout(() => {
          setShowUploadSuccess(false);
        }, 2800);
      }
    } finally {
      setIsUploading(false);
      input.value = "";
    }
  };

  const statusFilterOptions = [
    { value: "all", label: "All books" },
    { value: "to-read", label: "To read" },
    { value: "in-progress", label: "In progress" },
    { value: "finished", label: "Finished" }
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
  const trashSortOptions = [
    { value: "deleted-desc", label: "Last deleted (newest)" },
    { value: "deleted-asc", label: "Last deleted (oldest)" },
    { value: "title-asc", label: "Title (A-Z)" },
    { value: "title-desc", label: "Title (Z-A)" },
    { value: "author-asc", label: "Author (A-Z)" },
    { value: "author-desc", label: "Author (Z-A)" },
    { value: "added-desc", label: "Added date (newest)" },
    { value: "added-asc", label: "Added date (oldest)" }
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

  const bookMatchesTrashSearch = (book, query) => {
    if (!query) return true;
    const normalizedQuery = normalizeString(query.trim());
    if (!normalizedQuery) return true;

    const searchableFields = [
      book.title,
      book.author,
      formatLanguageLabel(book.language),
      formatGenreLabel(book.genre)
    ];

    return searchableFields.some((field) => normalizeString(field).includes(normalizedQuery));
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
  const trashedBooks = books.filter((book) => Boolean(book.isDeleted));
  const trashedBooksCount = books.length - activeBooks.length;
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
  const highlightsCenterEntries = activeBooks
    .flatMap((book) => {
      const highlights = Array.isArray(book.highlights) ? book.highlights : [];
      return highlights
        .filter((highlight) => typeof highlight?.text === "string" && highlight.text.trim())
        .map((highlight, index) => ({
          id: `${book.id}::${highlight.cfiRange || `highlight-${index}`}`,
          bookId: book.id,
          cfiRange: highlight.cfiRange || "",
          bookTitle: book.title,
          bookAuthor: book.author,
          text: compactWhitespace(highlight.text || ""),
          note: compactWhitespace(highlight.note || ""),
          color: highlight.color || "#fcd34d",
          lastRead: book.lastRead
        }));
    })
    .sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead));
  const highlightsCenterFilteredEntries = highlightsCenterEntries.filter((entry) => {
    const query = normalizeString(searchQuery.trim());
    if (!query) return true;
    return (
      normalizeString(entry.bookTitle).includes(query) ||
      normalizeString(entry.bookAuthor).includes(query) ||
      normalizeString(entry.text).includes(query) ||
      normalizeString(entry.note).includes(query)
    );
  });
  const activeBooksById = new Map(activeBooks.map((book) => [book.id, book]));
  const buildCenterPairs = (entries, prefix) => {
    const pairs = [];
    const pairMap = new Map();

    entries.forEach((entry) => {
      if (!entry?.bookId) return;
      const book = activeBooksById.get(entry.bookId);
      if (!book) return;

      let pair = pairMap.get(entry.bookId);
      if (!pair) {
        pair = {
          bookId: entry.bookId,
          title: entry.bookTitle || book.title,
          entries: [],
          cardItem: {
            id: `${prefix}-${entry.bookId}`,
            bookId: entry.bookId,
            book,
            cfi: entry.cfiRange || "",
            query: "",
            openSearch: false
          }
        };
        pairMap.set(entry.bookId, pair);
        pairs.push(pair);
      }

      pair.entries.push(entry);
      if (!pair.cardItem.cfi && entry.cfiRange) {
        pair.cardItem.cfi = entry.cfiRange;
      }
    });

    return pairs;
  };
  const notesCenterPairs = buildCenterPairs(notesCenterFilteredEntries, "notes-book");
  const highlightsCenterPairs = buildCenterPairs(highlightsCenterFilteredEntries, "highlights-book");

  const sortedBooks = [...activeBooks]
    .filter((book) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = !query || bookMatchesLibrarySearch(book, query);

      const highlightCount = Array.isArray(book.highlights) ? book.highlights.length : 0;
      const noteCount = Array.isArray(book.highlights)
        ? book.highlights.filter((h) => (h?.note || "").trim()).length
        : 0;
      const progress = normalizeNumber(book.progress);

      const matchesStatus =
        statusFilter === "all" ? true
        : statusFilter === "to-read" ? isBookToRead(book)
        : statusFilter === "in-progress" ? progress > 0 && progress < 100
        : statusFilter === "finished" ? progress >= 100
        : true;

      const matchesFlags = flagFilters.every((flag) => {
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

  const sortedTrashBooks = [...trashedBooks]
    .filter((book) => bookMatchesTrashSearch(book, searchQuery))
    .sort((left, right) => {
      if (trashSortBy === "deleted-desc") return normalizeTime(right.deletedAt) - normalizeTime(left.deletedAt);
      if (trashSortBy === "deleted-asc") return normalizeTime(left.deletedAt) - normalizeTime(right.deletedAt);
      if (trashSortBy === "title-desc") return normalizeString(right.title).localeCompare(normalizeString(left.title));
      if (trashSortBy === "author-asc") return normalizeString(left.author).localeCompare(normalizeString(right.author));
      if (trashSortBy === "author-desc") return normalizeString(right.author).localeCompare(normalizeString(left.author));
      if (trashSortBy === "added-desc") return normalizeTime(right.addedAt) - normalizeTime(left.addedAt);
      if (trashSortBy === "added-asc") return normalizeTime(left.addedAt) - normalizeTime(right.addedAt);
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
    librarySection === "library" &&
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
    const metaItems = [];

    if (language) {
      metaItems.push({
        key: "language",
        testId: "book-meta-language",
        icon: Languages,
        label: language
      });
    }
    if (estimatedPages) {
      metaItems.push({
        key: "pages",
        testId: "book-meta-pages",
        icon: FileText,
        label: `${estimatedPages} pages`
      });
    }
    if (!metaItems.length && !genre) return null;

    return (
      <div className="mt-2">
        {metaItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
            {metaItems.map((item) => {
              const Icon = item.icon;
              return (
                <span
                  key={`${book.id}-${item.key}`}
                  data-testid={item.testId}
                  className="inline-flex items-center gap-1.5"
                >
                  <Icon size={13} className="text-gray-400" />
                  <span>{item.label}</span>
                </span>
              );
            })}
          </div>
        )}
        {genre && (
          <div className={metaItems.length ? "mt-2" : ""}>
            <span
              data-testid="book-meta-genre"
              className="inline-flex items-center rounded-full border border-pink-500 bg-pink-50 px-3 py-0.5 text-xs font-semibold tracking-wide text-pink-600"
            >
              {genre}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderGlobalSearchBookCard = (item, options = {}) => {
    const book = item.book;
    if (!book) return null;
    const { coverHeightClass = CONTENT_PANEL_HEIGHT_CLASS } = options;
    const query = typeof item.query === "string" ? item.query : "";
    const openSearch = item.openSearch ?? Boolean(query);
    return (
      <Link
        to={buildReaderPath(book.id, "", {
          cfi: item.cfi || "",
          query,
          openSearch
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
  const canShowResetFilters = hasActiveLibraryFilters;
  const isDarkLibraryTheme = libraryTheme === "dark";
  const isAccountSection = librarySection === "account";
  const isCollectionsPage = librarySection === "collections";
  const isTrashSection = librarySection === "trash";
  const shouldShowLibraryHomeContent = librarySection === "library";
  const shouldShowContinueReading = showContinueReading && librarySection === "library";
  const visibleTrashIds = Array.from(new Set(sortedTrashBooks.map((book) => book.id)));
  const trashSelectedCount = selectedTrashBookIds.length;
  const allVisibleTrashSelected =
    visibleTrashIds.length > 0 &&
    visibleTrashIds.every((id) => selectedTrashBookIds.includes(id));

  return (
    <div className={`min-h-screen p-6 md:p-12 font-sans ${isDarkLibraryTheme ? "bg-slate-950 text-slate-100" : "bg-gray-50 text-gray-900"}`}>
      <div className="mx-auto max-w-[1480px] md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
        <LibraryWorkspaceSidebar
          librarySection={librarySection}
          isDarkLibraryTheme={isDarkLibraryTheme}
          notesCount={notesCenterEntries.length}
          highlightsCount={highlightsCenterEntries.length}
          trashCount={trashedBooksCount}
          onSelectSection={handleSidebarSectionSelect}
        />

        <div className="w-full min-w-0">
        <LibraryWorkspaceMobileNav
          librarySection={librarySection}
          onSelectSection={handleSidebarSectionSelect}
        />
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
          <div>
            {isAccountSection ? (
              <>
                <h1 className={`text-4xl font-extrabold tracking-tight ${isDarkLibraryTheme ? "text-slate-100" : "text-gray-900"}`}>
                  Account
                </h1>
                <p className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                  Manage your profile details and account preferences.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
                  {isCollectionsPage ? "My Collections" : isTrashSection ? "Trash" : "My Library"}
                </h1>
                <p className="text-gray-500 mt-1">
                  {isCollectionsPage
                    ? `${collections.length} collection${collections.length === 1 ? "" : "s"}`
                    : isTrashSection
                    ? `Showing ${sortedTrashBooks.length} of ${trashedBooksCount} deleted books`
                    : sortedBooks.length === activeBooks.length
                    ? `You have ${activeBooks.length} books`
                    : `Showing ${sortedBooks.length} of ${activeBooks.length} books`}
                  {!isTrashSection && !isCollectionsPage && trashedBooksCount > 0 ? ` · ${trashedBooksCount} in trash` : ""}
                </p>
                {!isCollectionsPage && !isTrashSection && (
                  <>
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
                  </>
                )}
              </>
            )}
          </div>

          {!isAccountSection && (
          <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:justify-end">
            <button
              type="button"
              data-testid="library-theme-toggle"
              onClick={() => setLibraryTheme((current) => (current === "dark" ? "light" : "dark"))}
              className={`inline-flex h-12 min-w-[122px] items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${
                isDarkLibraryTheme
                  ? "border-slate-500 bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
              }`}
              title={isDarkLibraryTheme ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={isDarkLibraryTheme ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDarkLibraryTheme ? <Sun size={16} /> : <Moon size={16} />}
              <span>{isDarkLibraryTheme ? "Light mode" : "Dark mode"}</span>
            </button>

            <button
              type="button"
              data-testid="trash-toggle-button"
              onClick={() => {
                const nextSection = isTrashSection ? "library" : "trash";
                setLibrarySection(nextSection);
                setCollectionFilter("all");
                setStatusFilter("all");
                setSelectedTrashBookIds([]);
              }}
              className={`relative p-3 rounded-full border shadow-sm transition-all ${
                isTrashSection
                  ? "bg-amber-500 text-white border-amber-500"
                  : "bg-white text-gray-600 border-gray-200 hover:text-amber-600 hover:border-amber-300"
              }`}
              title={isTrashSection ? "Back to library" : "Open Trash"}
              aria-label={isTrashSection ? "Back to library" : "Open Trash"}
            >
              <Trash2 size={20} />
              {trashedBooksCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {trashedBooksCount}
                </span>
              )}
            </button>

          </div>
          )}
        </header>

        {isAccountSection && (
          <LibraryAccountSection
            isDarkLibraryTheme={isDarkLibraryTheme}
            accountProfile={accountProfile}
            accountSaveMessage={accountSaveMessage}
            onFieldChange={handleAccountFieldChange}
            onSave={handleSaveAccountProfile}
          />
        )}

        {!isAccountSection && (
        <>
        {shouldShowContinueReading && (
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

        {shouldShowLibraryHomeContent && (
          <LibraryToolbarSection
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusFilterOptions={statusFilterOptions}
            sortBy={sortBy}
            onSortChange={setSortBy}
            sortOptions={sortOptions}
            getFilterLabel={getFilterLabel}
            getCollectionFilterLabel={getCollectionFilterLabel}
            flagFilters={flagFilters}
            flagFilterOptions={flagFilterOptions}
            onToggleFlagFilter={toggleFlagFilter}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            canShowResetFilters={canShowResetFilters}
            onResetFilters={resetLibraryFilters}
          />
        )}
        {isTrashSection && (
          <>
            <div
              data-testid="trash-retention-note"
              className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"
            >
              Books in Trash are permanently deleted after {TRASH_RETENTION_DAYS} days.
            </div>

            <div
              data-testid="trash-toolbar"
              className="sticky top-3 z-20 mb-3 rounded-2xl bg-gray-50/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80"
            >
              <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_320px_auto]">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    placeholder="Search deleted books..."
                    data-testid="trash-search"
                    className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="relative">
                  <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <select
                    data-testid="trash-sort"
                    value={trashSortBy}
                    onChange={(e) => setTrashSortBy(e.target.value)}
                    className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
                  >
                    {trashSortOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  className="flex h-[52px] w-[108px] items-center rounded-2xl border border-gray-200 bg-white p-1 shadow-sm"
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
              </div>
            </div>

            <div data-testid="trash-bulk-actions" className="mb-6 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="trash-select-all"
                onClick={handleToggleSelectAllTrash}
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
              >
                {allVisibleTrashSelected ? "Unselect all" : "Select all"}
              </button>
              <span className="text-xs font-semibold text-gray-500">
                {trashSelectedCount} selected
              </span>
              <button
                type="button"
                data-testid="trash-restore-selected"
                onClick={handleRestoreSelectedTrash}
                disabled={!trashSelectedCount}
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 enabled:hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Restore selected
              </button>
              <button
                type="button"
                data-testid="trash-delete-selected"
                onClick={handleDeleteSelectedTrash}
                disabled={!trashSelectedCount}
                className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 enabled:hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete selected
              </button>
              <button
                type="button"
                data-testid="trash-restore-all"
                onClick={handleRestoreAllTrash}
                disabled={!trashedBooks.length}
                className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 enabled:hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Restore all
              </button>
              <button
                type="button"
                data-testid="trash-delete-all"
                onClick={handleDeleteAllTrash}
                disabled={!trashedBooks.length}
                className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 enabled:hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete all
              </button>
            </div>
          </>
        )}
        {isNotesCenterOpen && !isTrashSection && (
          <LibraryNotesCenterPanel
            notesCenterFilteredEntries={notesCenterFilteredEntries}
            notesCenterPairs={notesCenterPairs}
            searchQuery={searchQuery}
            contentPanelHeightClass={CONTENT_PANEL_HEIGHT_CLASS}
            contentScrollHeightClass={CONTENT_SCROLL_HEIGHT_CLASS}
            renderBookCard={renderGlobalSearchBookCard}
            editingNoteId={editingNoteId}
            noteEditorValue={noteEditorValue}
            isSavingNote={isSavingNote}
            onClose={handleToggleNotesCenter}
            onOpenReader={handleOpenNoteInReader}
            onStartEdit={handleStartNoteEdit}
            onNoteEditorChange={setNoteEditorValue}
            onSaveNote={handleSaveNoteFromCenter}
            onCancelEdit={handleCancelNoteEdit}
          />
        )}

        {isHighlightsCenterOpen && !isTrashSection && (
          <LibraryHighlightsCenterPanel
            highlightsCenterFilteredEntries={highlightsCenterFilteredEntries}
            highlightsCenterPairs={highlightsCenterPairs}
            searchQuery={searchQuery}
            contentPanelHeightClass={CONTENT_PANEL_HEIGHT_CLASS}
            contentScrollHeightClass={CONTENT_SCROLL_HEIGHT_CLASS}
            renderBookCard={renderGlobalSearchBookCard}
            onClose={handleToggleHighlightsCenter}
            onOpenReader={handleOpenHighlightInReader}
          />
        )}
        {isCollectionsPage && !isTrashSection && (
          <LibraryCollectionsBoard
            collections={collections}
            books={books}
            collectionError={collectionError}
            showCreateCollectionForm={showCreateCollectionForm}
            collectionNameDraft={collectionNameDraft}
            collectionColorDraft={collectionColorDraft}
            collectionColorOptions={COLLECTION_COLOR_OPTIONS}
            editingCollectionId={editingCollectionId}
            editingCollectionName={editingCollectionName}
            onToggleCreateForm={() => {
              setCollectionError("");
              setShowCreateCollectionForm((current) => !current);
              cancelCollectionRename();
            }}
            onCollectionNameChange={setCollectionNameDraft}
            onCollectionColorChange={setCollectionColorDraft}
            onCreateCollection={handleCreateCollection}
            onCollectionRenameStart={startCollectionRename}
            onCollectionRenameInputChange={setEditingCollectionName}
            onCollectionRenameSave={handleSaveCollectionRename}
            onCollectionRenameCancel={cancelCollectionRename}
            onCollectionDelete={handleDeleteCollection}
            onOpenBook={handleOpenBook}
            onRemoveFromCollection={toggleBookCollectionMembership}
            buildReaderPath={buildReaderPath}
          />
        )}
        {shouldShowLibraryHomeContent && globalSearchQuery && (
          <LibraryGlobalSearchPanel
            showGlobalSearchSplitColumns={showGlobalSearchSplitColumns}
            globalSearchTotal={globalSearchTotal}
            isContentSearching={isContentSearching}
            globalMatchedBookPairs={globalMatchedBookPairs}
            globalOtherGroups={globalOtherGroups}
            globalMatchedBooks={globalMatchedBooks}
            contentPanelHeightClass={CONTENT_PANEL_HEIGHT_CLASS}
            contentScrollHeightClass={CONTENT_SCROLL_HEIGHT_CLASS}
            onOpenResult={handleGlobalResultOpen}
            renderGlobalSearchBookCard={renderGlobalSearchBookCard}
          />
        )}
        {(shouldShowLibraryHomeContent || isTrashSection) && (!showGlobalSearchBooksColumn || isTrashSection) && ((isTrashSection ? sortedTrashBooks.length : sortedBooks.length) === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl p-20 text-center shadow-sm">
            <BookIcon size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-lg">
              {isTrashSection ? "Trash is empty." : "No books found matching your criteria."}
            </p>
            {!isTrashSection && canShowResetFilters && (
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
            {(isTrashSection ? sortedTrashBooks : sortedBooks).map((book) => {
              const inTrash = Boolean(book.isDeleted);
              const isRecent = book.id === recentlyAddedBookId;
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
                  className={`group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 flex flex-col relative ${
                    isRecent ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white shadow-[0_0_0_3px_rgba(251,191,36,0.2)]" : ""
                  }`}
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
                          <button
                            type="button"
                            data-testid="book-info"
                            onMouseDown={consumeCardActionEvent}
                            onPointerDown={consumeCardActionEvent}
                            onClick={(e) => {
                              consumeCardActionEvent(e);
                              const rect = e.currentTarget.getBoundingClientRect();
                              if (infoPopover?.book?.id === book.id && infoPopover?.pinned) {
                                setInfoPopover(null);
                                return;
                              }
                              openInfoPopover(book, rect, true);
                            }}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              openInfoPopover(book, rect, false);
                            }}
                            onMouseLeave={() => {
                              scheduleInfoPopoverClose();
                            }}
                            className="p-2 bg-white text-gray-400 hover:text-blue-600 rounded-xl shadow-md transition-transform active:scale-95"
                            title="Book info"
                          >
                            <Info size={16} />
                          </button>
                        </>
                      )}
                    </div>
                    {inTrash && (
                      <label
                        data-testid={`trash-book-select-${book.id}`}
                        className="absolute left-3 top-3 z-10 inline-flex items-center rounded-lg bg-white/95 px-2 py-1 text-[11px] font-semibold text-gray-700 shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <input
                          type="checkbox"
                          data-testid={`trash-book-select-input-${book.id}`}
                          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                          checked={selectedTrashBookIds.includes(book.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onChange={() => handleToggleTrashSelection(book.id)}
                        />
                      </label>
                    )}
                    
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
                              setLibrarySection("collections");
                              setCollectionPickerBookId("");
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

                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4 animate-in fade-in duration-500" data-testid="library-books-list">
            {(isTrashSection ? sortedTrashBooks : sortedBooks).map((book) => {
              const inTrash = Boolean(book.isDeleted);
              const isRecent = book.id === recentlyAddedBookId;
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
                  className={`group bg-white rounded-2xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden border border-gray-100 flex ${
                    isRecent ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white shadow-[0_0_0_3px_rgba(251,191,36,0.2)]" : ""
                  }`}
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
                      {inTrash && (
                        <label
                          data-testid={`trash-book-select-${book.id}`}
                          className="inline-flex items-center justify-end gap-2 rounded-lg px-2 py-1 text-xs font-semibold text-gray-600"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            data-testid={`trash-book-select-input-${book.id}`}
                            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                            checked={selectedTrashBookIds.includes(book.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            onChange={() => handleToggleTrashSelection(book.id)}
                          />
                        </label>
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
                            <button
                              type="button"
                              data-testid="book-info"
                              onMouseDown={consumeCardActionEvent}
                              onPointerDown={consumeCardActionEvent}
                              onClick={(e) => {
                                consumeCardActionEvent(e);
                                const rect = e.currentTarget.getBoundingClientRect();
                                if (infoPopover?.book?.id === book.id && infoPopover?.pinned) {
                                  setInfoPopover(null);
                                  return;
                                }
                                openInfoPopover(book, rect, true);
                              }}
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                openInfoPopover(book, rect, false);
                              }}
                              onMouseLeave={() => {
                                scheduleInfoPopoverClose();
                              }}
                              className="p-2 bg-white border border-gray-200 text-gray-400 hover:text-blue-600 rounded-xl shadow-sm transition-transform active:scale-95"
                              title="Book info"
                            >
                              <Info size={16} />
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
                                setLibrarySection("collections");
                                setCollectionPickerBookId("");
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
        {!isTrashSection && (
          <label
            data-testid="library-add-book-fab"
            className={`fixed bottom-6 right-6 z-50 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-blue-600 text-white shadow-xl transition-all hover:scale-105 hover:bg-blue-700 focus-within:ring-4 focus-within:ring-blue-200 ${
              isUploading ? 'opacity-60 pointer-events-none' : ''
            }`}
            title={isUploading ? 'Adding book...' : 'Add Book'}
            aria-label={isUploading ? 'Adding book...' : 'Add Book'}
          >
            <Plus size={28} />
            <input type="file" accept=".epub" multiple className="hidden" onChange={handleFileUpload} />
          </label>
        )}
        {uploadStage === "reading" && (
          <div
            data-testid="upload-progress-modal"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          >
            <div
              className={`w-[360px] rounded-3xl border p-5 shadow-2xl ${
                isDarkLibraryTheme ? "border-slate-700 bg-slate-900 text-slate-100" : "border-gray-200 bg-white text-gray-900"
              }`}
            >
              <div className="text-sm font-bold">Adding books...</div>
              <p
                data-testid="upload-progress-overall-label"
                className={`mt-1 text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-gray-600"}`}
              >
                Overall: {Math.max(uploadBatchCurrentIndex, uploadBatchCompleted, 1)}/{Math.max(uploadBatchTotal, 1)}
              </p>
              <div className="mt-2 h-2 rounded-full bg-gray-200/70 overflow-hidden">
                <div
                  data-testid="upload-progress-overall-bar"
                  className="h-full bg-blue-600 transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        ((uploadBatchCompleted + uploadProgress / 100) / Math.max(uploadBatchTotal, 1)) * 100
                      )
                    )}%`
                  }}
                />
              </div>

              <p
                data-testid="upload-progress-current-label"
                className={`mt-3 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}
              >
                Current file: {uploadBatchCurrentName || "Preparing..."}
              </p>
              <div className="mt-2 h-2 rounded-full bg-gray-200/70 overflow-hidden">
                <div
                  data-testid="upload-progress-current-bar"
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className={`mt-2 text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-gray-600"}`}>
                {uploadProgress}% for current file
              </div>
            </div>
          </div>
        )}
        {showUploadSuccess && (
          <div className="fixed bottom-24 right-6 z-50">
            <div
              data-testid="upload-success-toast"
              className="rounded-full border border-amber-300 px-4 py-2 text-xs font-semibold text-amber-700 bg-amber-50/40 backdrop-blur-sm shadow-sm"
            >
              {uploadSuccessMessage}
            </div>
          </div>
        )}
        {duplicatePrompt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => resolveDuplicateDecision("ignore")}
            />
            <div className="relative w-full max-w-lg rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl">
              <h3 className="text-lg font-bold text-gray-900">Duplicate book detected</h3>
              <p className="mt-1 text-sm text-gray-500">
                We found a book with the same title and author.
              </p>
              <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                {duplicatePrompt.duplicates.map((book) => (
                  <div key={`dup-${book.id}`} className="text-sm font-semibold text-gray-800">
                    {book.title} · <span className="text-gray-500">{book.author}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                Replace will remove all highlights, notes, and bookmarks for the existing copy.
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  data-testid="duplicate-ignore"
                  onClick={() => resolveDuplicateDecision("ignore")}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:border-gray-300"
                >
                  Ignore
                </button>
                <button
                  type="button"
                  data-testid="duplicate-replace"
                  onClick={() => resolveDuplicateDecision("replace")}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
                >
                  Replace
                </button>
                <button
                  type="button"
                  data-testid="duplicate-keep-both"
                  onClick={() => resolveDuplicateDecision("keep-both")}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Keep Both
                </button>
              </div>
            </div>
          </div>
        )}
        {infoPopover && (() => {
          const { book, rect } = infoPopover;
          if (!book || !rect) return null;
          const metadata = (book.epubMetadata && typeof book.epubMetadata === "object") ? book.epubMetadata : {};
          const sortedKeys = Object.keys(metadata).sort(sortMetadataKeys);
          const metadataEntries = sortedKeys
            .map((key) => ({
              key,
              value: formatMetadataValue(metadata[key], key)
            }))
            .filter((item) => item.value);
          const popoverLayout = (() => {
            const width = 320;
            if (typeof window === "undefined") {
              return { left: 0, top: 0, width, maxHeight: 420 };
            }
            const maxHeight = Math.min(420, window.innerHeight - 24);
            let left = Math.min(rect.left, window.innerWidth - width - 16);
            left = Math.max(16, left);
            let top = rect.bottom + 10;
            if (top + maxHeight > window.innerHeight - 16) {
              top = Math.max(16, rect.top - maxHeight - 10);
            }
            return { left, top, width, maxHeight };
          })();
          return (
            <div
              ref={infoPopoverRef}
              data-testid="book-info-popover"
              className="fixed z-[70] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
              style={{
                left: popoverLayout.left,
                top: popoverLayout.top,
                width: popoverLayout.width,
                maxHeight: popoverLayout.maxHeight
              }}
              onMouseEnter={() => cancelInfoPopoverClose()}
              onMouseLeave={() => scheduleInfoPopoverClose()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Book info</div>
                  <div className="text-[11px] text-gray-500">EPUB metadata</div>
                </div>
                <button
                  type="button"
                  onClick={() => setInfoPopover(null)}
                  className="p-1.5 rounded-full text-gray-500 hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                <div className="flex gap-3">
                  <div className="w-16 h-24 rounded-lg overflow-hidden border border-gray-100 bg-gray-100 flex-shrink-0">
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <BookIcon size={18} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{book.title}</div>
                    <div className="text-xs text-gray-500 truncate">{book.author}</div>
                    <div className="mt-2 text-[11px] text-gray-600">
                      {book.language ? `Language: ${formatLanguageLabel(book.language)}` : "Language: n/a"}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      {book.estimatedPages ? `${book.estimatedPages} pages` : "Pages: n/a"}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {metadataEntries.length === 0 ? (
                    <div className="text-xs text-gray-500">No extra metadata found.</div>
                  ) : (
                    metadataEntries.map((item) => (
                      <div
                        key={item.key}
                        data-testid="book-info-metadata-item"
                        className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                      >
                        <div data-testid="book-info-metadata-key" className="text-[10px] uppercase tracking-widest text-gray-400">
                          {item.key}
                        </div>
                        <div data-testid="book-info-metadata-value" className="text-xs text-gray-800 break-words">
                          {item.value || "—"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="border-t border-gray-100 px-4 py-2">
                <button
                  type="button"
                  onClick={() => {
                    handleOpenBook(book.id);
                    navigate(buildReaderPath(book.id));
                    setInfoPopover(null);
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                  Open in Reader
                </button>
              </div>
            </div>
          );
        })()}
        </>
        )}
      </div>
    </div>
    </div>
  );
}
