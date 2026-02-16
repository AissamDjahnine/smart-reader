import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { readEpubMetadataFast } from '../services/epubMetadataWorkerClient';
import { buildBookSearchRecord, syncSearchIndexFromBooks } from "../services/searchIndex";
import {
  ensureContentSearchIndexes,
  getBookContentIndexSignature,
  getContentSearchIndexRecord,
  loadContentSearchManifest
} from "../services/contentSearchIndex";
import { findContentIndexCandidates } from "../services/contentSearchWorkerClient";
import ePub from 'epubjs';
import {
  Plus,
  Book as BookIcon,
  User,
  Calendar,
  Trash2,
  Clock,
  Bell,
  History,
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
  CircleHelp,
  LogOut,
  BarChart3,
  Settings2,
  Target,
  Trophy,
  MoreHorizontal,
  Archive,
  Check,
  Mail,
  Send,
} from 'lucide-react';
import { createBookShare, fetchShareInbox, isCollabMode, updateMe, uploadMyAvatar } from '../services/collabApi';
import { clearSession, getCurrentUser, setCurrentUser } from '../services/session';
import LibraryAccountSection from './library/LibraryAccountSection';
import { LibraryWorkspaceSidebar, LibraryWorkspaceMobileNav } from './library/LibraryWorkspaceNav';
import LibraryNotesCenterPanel from './library/LibraryNotesCenterPanel';
import LibraryHighlightsCenterPanel from './library/LibraryHighlightsCenterPanel';
import LibraryCollectionsBoard from './library/LibraryCollectionsBoard';
import LibraryShareInboxPanel from './library/LibraryShareInboxPanel';
import LibraryGlobalSearchPanel from './library/LibraryGlobalSearchPanel';
import LibraryToolbarSection from './library/LibraryToolbarSection';
import LibraryReadingStatisticsSection from './library/LibraryReadingStatisticsSection';
import {
  buildDuplicateIndex,
  buildDuplicateTitle,
  findDuplicateBooks,
  isDuplicateTitleBook,
  stripDuplicateTitleSuffix
} from './library/duplicateBooks';
import { buildLibraryNotifications } from './library/libraryNotifications';
import { buildContinueReadingBooks } from './library/continueReading';
import { areAllVisibleIdsSelected, pruneSelectionByAllowedIds } from './library/selectionState';
import FeedbackToast from '../components/FeedbackToast';

const STARTED_BOOK_IDS_KEY = 'library-started-book-ids';
const TRASH_RETENTION_DAYS = 30;
const LIBRARY_THEME_KEY = 'library-theme';
const LIBRARY_LANGUAGE_KEY = 'library-language';
const ACCOUNT_PROFILE_KEY = 'library-account-profile';
const LIBRARY_NOTIFICATION_STATE_KEY = 'library-notification-state';
const ACCOUNT_DEFAULT_EMAIL = '';
const LIBRARY_PERF_DEBUG_KEY = "library-perf-debug";
const LIBRARY_PERF_HISTORY_KEY = "__smartReaderPerfHistory";
const LANGUAGE_DISPLAY_NAMES =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "language" })
    : null;

const getPerfNow = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

const isPerfLoggingEnabled = () => {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LIBRARY_PERF_DEBUG_KEY) === "1";
};

const recordPerfMetric = (label, startAt, details = {}) => {
  const durationMs = Number((getPerfNow() - startAt).toFixed(1));
  if (!isPerfLoggingEnabled() || typeof window === "undefined") return durationMs;

  const entry = {
    label,
    durationMs,
    details,
    at: new Date().toISOString()
  };
  const history = Array.isArray(window[LIBRARY_PERF_HISTORY_KEY]) ? window[LIBRARY_PERF_HISTORY_KEY] : [];
  history.push(entry);
  if (history.length > 200) history.shift();
  window[LIBRARY_PERF_HISTORY_KEY] = history;
  console.info(`[perf] ${label} ${durationMs}ms`, details);
  return durationMs;
};

const readStoredAccountProfile = () => {
  const sessionEmail = (() => {
    try {
      return (getCurrentUser()?.email || "").trim();
    } catch {
      return "";
    }
  })();
  const sessionDisplayName = (() => {
    try {
      return (getCurrentUser()?.displayName || "").trim();
    } catch {
      return "";
    }
  })();
  const sessionAvatarUrl = (() => {
    try {
      return (getCurrentUser()?.avatarUrl || "").trim();
    } catch {
      return "";
    }
  })();
  const sessionFirstName = sessionDisplayName ? sessionDisplayName.split(/\s+/).filter(Boolean)[0] || "" : "";

  if (typeof window === "undefined") {
    return {
      firstName: sessionFirstName,
      email: sessionEmail || ACCOUNT_DEFAULT_EMAIL,
      avatarUrl: sessionAvatarUrl,
      preferredLanguage: "en",
      emailNotifications: "yes"
    };
  }
  try {
    const raw = window.localStorage.getItem(ACCOUNT_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const fallbackLanguage = window.localStorage.getItem(LIBRARY_LANGUAGE_KEY) || "en";
    const storedEmail = typeof parsed?.email === "string" && parsed.email.trim() ? parsed.email.trim() : "";
    const resolvedEmail = isCollabMode
      ? (sessionEmail || storedEmail || ACCOUNT_DEFAULT_EMAIL)
      : (storedEmail || sessionEmail || ACCOUNT_DEFAULT_EMAIL);
    const storedFirstName = typeof parsed?.firstName === "string" ? parsed.firstName : "";
    const storedAvatar = typeof parsed?.avatarUrl === "string" ? parsed.avatarUrl.trim() : "";
    return {
      firstName: isCollabMode ? (sessionFirstName || storedFirstName) : storedFirstName,
      email: resolvedEmail,
      avatarUrl: isCollabMode ? (sessionAvatarUrl || storedAvatar) : storedAvatar,
      preferredLanguage:
        typeof parsed?.preferredLanguage === "string" && parsed.preferredLanguage.trim()
          ? parsed.preferredLanguage
          : fallbackLanguage,
      emailNotifications: parsed?.emailNotifications === "no" ? "no" : "yes"
    };
  } catch (err) {
    console.error(err);
    return {
      firstName: sessionFirstName,
      email: sessionEmail || ACCOUNT_DEFAULT_EMAIL,
      avatarUrl: sessionAvatarUrl,
      preferredLanguage: "en",
      emailNotifications: "yes"
    };
  }
};

const readStoredNotificationState = () => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LIBRARY_NOTIFICATION_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
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

let homeJsPdfCtorPromise = null;
const loadHomeJsPdfCtor = async () => {
  if (!homeJsPdfCtorPromise) {
    homeJsPdfCtorPromise = import("jspdf")
      .then((module) => module.jsPDF || module.default)
      .catch((err) => {
        homeJsPdfCtorPromise = null;
        throw err;
      });
  }
  return homeJsPdfCtorPromise;
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
  const unsafeChars = new Set(["<", ">", ":", "\"", "/", "\\", "|", "?", "*"]);
  const safe = Array.from(normalized)
    .map((char) => (unsafeChars.has(char) || char.charCodeAt(0) < 32 ? "_" : char))
    .join("");
  return safe.slice(0, 120) || fallback;
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

const searchBookContentLegacy = async (book, query, maxMatches = 30) => {
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

const searchBookContentFromIndex = async (book, query, manifestEntry, maxMatches = 30) => {
  if (!book?.id || !book?.data || !query || !manifestEntry) return null;
  const expectedSignature = getBookContentIndexSignature(book);
  if (manifestEntry.signature !== expectedSignature) return null;

  const indexRecord = await getContentSearchIndexRecord(book.id);
  if (!indexRecord || indexRecord.signature !== expectedSignature) return null;
  if (!Array.isArray(indexRecord.sections) || !indexRecord.sections.length) return [];

  const candidates = await findContentIndexCandidates(indexRecord.sections, query, Math.max(maxMatches, 12));
  if (!candidates.length) return [];

  const epub = ePub(book.data);
  const matches = [];

  try {
    await epub.ready;
    const spineItems = Array.isArray(epub?.spine?.spineItems) ? epub.spine.spineItems : [];
    const sectionByHref = new Map();

    spineItems.forEach((section) => {
      if (!section) return;
      const href = normalizeHref(section.href || "");
      if (!href || sectionByHref.has(href)) return;
      sectionByHref.set(href, section);
    });

    for (const candidate of candidates) {
      const section = sectionByHref.get(normalizeHref(candidate?.href || ""));
      if (!section) continue;

      try {
        await section.load(epub.load.bind(epub));
        const sectionMatches = typeof section.find === "function" ? section.find(query) || [] : [];
        for (const match of sectionMatches) {
          matches.push({
            cfi: match?.cfi || "",
            excerpt: match?.excerpt || candidate?.preview || "",
            chapterLabel: candidate?.chapterLabel || ""
          });
          if (matches.length >= maxMatches) break;
        }
      } finally {
        section.unload();
      }

      if (matches.length >= maxMatches) break;
    }
  } catch (err) {
    console.error(err);
    return null;
  } finally {
    epub.destroy();
  }

  return matches;
};

const CONTENT_SCROLL_HEIGHT_CLASS = "h-[42vh]";
const CONTENT_PANEL_HEIGHT_CLASS = "h-[calc(42vh+3rem)]";
const FOUND_BOOK_COVER_PADDING_CLASS = "p-4";
const LIBRARY_DENSITY_MODE_KEY = "library-density-mode";
const LIBRARY_RENDER_BATCH_SIZE = 48;
const VIRTUAL_GRID_CARD_STYLE = { contentVisibility: "auto", containIntrinsicSize: "620px" };
const VIRTUAL_LIST_CARD_STYLE = { contentVisibility: "auto", containIntrinsicSize: "220px" };
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
  const [feedbackToast, setFeedbackToast] = useState(null);
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0);
  const [uploadBatchCompleted, setUploadBatchCompleted] = useState(0);
  const [uploadBatchCurrentIndex, setUploadBatchCurrentIndex] = useState(0);
  const [uploadBatchCurrentName, setUploadBatchCurrentName] = useState("");
  const [recentlyAddedBookId, setRecentlyAddedBookId] = useState("");
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);
  
  // Search, filter & sort states
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [notesSearchQuery, setNotesSearchQuery] = useState("");
  const [debouncedNotesSearchQuery, setDebouncedNotesSearchQuery] = useState("");
  const [highlightsSearchQuery, setHighlightsSearchQuery] = useState("");
  const [debouncedHighlightsSearchQuery, setDebouncedHighlightsSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [librarySection, setLibrarySection] = useState("library");
  const [trashSortBy, setTrashSortBy] = useState("deleted-desc");
  const [selectedTrashBookIds, setSelectedTrashBookIds] = useState([]);
  const [selectedLibraryBookIds, setSelectedLibraryBookIds] = useState([]);
  const [isLibrarySelectionMode, setIsLibrarySelectionMode] = useState(false);
  const [libraryRenderLimit, setLibraryRenderLimit] = useState(LIBRARY_RENDER_BATCH_SIZE);
  const [trashRenderLimit, setTrashRenderLimit] = useState(LIBRARY_RENDER_BATCH_SIZE);
  const [flagFilters, setFlagFilters] = useState([]);
  const [sortBy, setSortBy] = useState("last-read-desc");
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "grid";
    return window.localStorage.getItem("library-view-mode") === "list" ? "list" : "grid";
  });
  const [densityMode, setDensityMode] = useState(() => {
    if (typeof window === "undefined") return "comfortable";
    return window.localStorage.getItem(LIBRARY_DENSITY_MODE_KEY) === "compact" ? "compact" : "comfortable";
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
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isNotesCenterOpen, setIsNotesCenterOpen] = useState(false);
  const [isHighlightsCenterOpen, setIsHighlightsCenterOpen] = useState(false);
  const [notesCenterSortBy, setNotesCenterSortBy] = useState("recent");
  const [highlightsCenterSortBy, setHighlightsCenterSortBy] = useState("recent");
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
  const [contentIndexManifest, setContentIndexManifest] = useState({});
  const [searchIndexByBook, setSearchIndexByBook] = useState({});
  const [isContentSearching, setIsContentSearching] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [activeNotificationMenuId, setActiveNotificationMenuId] = useState("");
  const [notificationView, setNotificationView] = useState("all");
  const [notificationStateById, setNotificationStateById] = useState(() => readStoredNotificationState());
  const [notificationFocusedBookId, setNotificationFocusedBookId] = useState("");
  const [shareInboxCount, setShareInboxCount] = useState(0);
  const [shareDialogBook, setShareDialogBook] = useState(null);
  const [shareRecipientEmail, setShareRecipientEmail] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [shareError, setShareError] = useState("");
  const [isSharingBook, setIsSharingBook] = useState(false);
  const contentSearchTokenRef = useRef(0);
  const uploadTimerRef = useRef(null);
  const feedbackToastTimerRef = useRef(null);
  const pendingTrashUndoTimerRef = useRef(null);
  const pendingTrashUndoRef = useRef(null);
  const recentHighlightTimerRef = useRef(null);
  const loadMoreBooksRef = useRef(null);
  const infoPopoverCloseTimerRef = useRef(null);
  const infoPopoverRef = useRef(null);
  const duplicateDecisionResolverRef = useRef(null);
  const notificationsMenuRef = useRef(null);
  const notificationFocusTimerRef = useRef(null);

  useEffect(() => {
    if (!isCollabMode) return;
    const sessionUser = getCurrentUser() || {};
    const sessionEmail = (sessionUser.email || "").trim();
    const sessionDisplayName = (sessionUser.displayName || "").trim();
    const sessionAvatarUrl = (sessionUser.avatarUrl || "").trim();
    const sessionFirstName = sessionDisplayName ? sessionDisplayName.split(/\s+/).filter(Boolean)[0] || "" : "";
    if (!sessionEmail && !sessionFirstName && !sessionAvatarUrl) return;
    setAccountProfile((current) => {
      const next = {
        ...current,
        email: sessionEmail || current?.email || "",
        firstName: sessionFirstName || current?.firstName || "",
        avatarUrl: sessionAvatarUrl || current?.avatarUrl || ""
      };
      if (
        (next.email || "") === (current?.email || "") &&
        (next.firstName || "") === (current?.firstName || "") &&
        (next.avatarUrl || "") === (current?.avatarUrl || "")
      ) {
        return current;
      }
      return next;
    });
  }, []);

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

  useEffect(() => {
    loadLibrary();
    refreshShareInboxCount();
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("library-view-mode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_DENSITY_MODE_KEY, densityMode);
  }, [densityMode]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_THEME_KEY, libraryTheme);
  }, [libraryTheme]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_LANGUAGE_KEY, libraryLanguage);
  }, [libraryLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LIBRARY_NOTIFICATION_STATE_KEY, JSON.stringify(notificationStateById));
  }, [notificationStateById]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 180);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedNotesSearchQuery(notesSearchQuery);
    }, 180);
    return () => clearTimeout(timeoutId);
  }, [notesSearchQuery]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedHighlightsSearchQuery(highlightsSearchQuery);
    }, 180);
    return () => clearTimeout(timeoutId);
  }, [highlightsSearchQuery]);

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
    if (!isNotificationsOpen && !isProfileMenuOpen) return;

    const handleMouseDown = (event) => {
      if (!notificationsMenuRef.current) return;
      if (notificationsMenuRef.current.contains(event.target)) return;
      setIsNotificationsOpen(false);
      setIsProfileMenuOpen(false);
      setActiveNotificationMenuId("");
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsNotificationsOpen(false);
        setIsProfileMenuOpen(false);
        setActiveNotificationMenuId("");
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isNotificationsOpen, isProfileMenuOpen]);

  useEffect(() => {
    setIsNotificationsOpen(false);
    setIsProfileMenuOpen(false);
    setActiveNotificationMenuId("");
    setNotificationView("all");
  }, [librarySection]);

  useEffect(() => {
    return () => {
      if (duplicateDecisionResolverRef.current) {
        duplicateDecisionResolverRef.current("ignore");
        duplicateDecisionResolverRef.current = null;
      }
      if (notificationFocusTimerRef.current) {
        clearTimeout(notificationFocusTimerRef.current);
        notificationFocusTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
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
        const indexedMatches = await searchBookContentFromIndex(
          book,
          query,
          contentIndexManifest[book.id],
          30
        );
        const matches =
          indexedMatches == null
            ? await searchBookContentLegacy(book, query, 30)
            : indexedMatches;
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
  }, [books, contentIndexManifest, debouncedSearchQuery, librarySection]);

  useEffect(() => {
    let isCancelled = false;

    const syncContentSearchIndex = async () => {
      const activeBooks = books.filter((book) => !book?.isDeleted && book?.data);
      if (!activeBooks.length) {
        if (!isCancelled) setContentIndexManifest({});
        return;
      }

      try {
        const cachedManifest = await loadContentSearchManifest();
        if (isCancelled) return;
        setContentIndexManifest(cachedManifest.books || {});
      } catch (err) {
        console.error("Failed to load content search manifest", err);
      }

      const indexStartAt = getPerfNow();
      try {
        const result = await ensureContentSearchIndexes(activeBooks, {
          isCancelled: () => isCancelled,
          onBookIndexed: (bookId, manifestEntry) => {
            if (isCancelled || !bookId || !manifestEntry) return;
            setContentIndexManifest((current) => ({
              ...current,
              [bookId]: manifestEntry
            }));
          }
        });
        if (isCancelled) return;
        setContentIndexManifest(result.books || {});
        recordPerfMetric("content-index.sync", indexStartAt, {
          indexedBooks: Object.keys(result.books || {}).length
        });
      } catch (err) {
        console.error("Failed to sync content search indexes", err);
      }
    };

    syncContentSearchIndex();

    return () => {
      isCancelled = true;
    };
  }, [books]);

  useEffect(() => {
    let isCancelled = false;
    const syncSearchIndex = async () => {
      if (!books.length) {
        if (!isCancelled) setSearchIndexByBook({});
        return;
      }

      const syncStartAt = getPerfNow();
      try {
        const indexedBooks = await syncSearchIndexFromBooks(books);
        if (isCancelled) return;
        setSearchIndexByBook(indexedBooks || {});
        recordPerfMetric("search-index.sync", syncStartAt, {
          indexedBooks: Object.keys(indexedBooks || {}).length
        });
      } catch (err) {
        console.error("Search index sync failed", err);
        if (isCancelled) return;
        const fallback = {};
        books
          .filter((book) => !book?.isDeleted)
          .forEach((book) => {
            fallback[book.id] = buildBookSearchRecord(book);
          });
        setSearchIndexByBook(fallback);
      }
    };

    syncSearchIndex();
    return () => {
      isCancelled = true;
    };
  }, [books]);

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
      if (feedbackToastTimerRef.current) {
        clearTimeout(feedbackToastTimerRef.current);
      }
      if (pendingTrashUndoTimerRef.current) {
        clearTimeout(pendingTrashUndoTimerRef.current);
      }
      if (recentHighlightTimerRef.current) {
        clearTimeout(recentHighlightTimerRef.current);
      }
    };
  }, []);

  const dismissFeedbackToast = () => {
    if (feedbackToastTimerRef.current) {
      clearTimeout(feedbackToastTimerRef.current);
      feedbackToastTimerRef.current = null;
    }
    setFeedbackToast(null);
  };

  const showFeedbackToast = (payload, options = {}) => {
    const { duration = 3200 } = options;
    if (!payload) return;
    if (feedbackToastTimerRef.current) {
      clearTimeout(feedbackToastTimerRef.current);
      feedbackToastTimerRef.current = null;
    }
    const nextToast = { id: `${Date.now()}-${Math.random()}`, ...payload };
    setFeedbackToast(nextToast);
    if (duration > 0) {
      feedbackToastTimerRef.current = setTimeout(() => {
        setFeedbackToast((current) => (current?.id === nextToast.id ? null : current));
        feedbackToastTimerRef.current = null;
      }, duration);
    }
  };

  const clearPendingTrashUndo = () => {
    if (pendingTrashUndoTimerRef.current) {
      clearTimeout(pendingTrashUndoTimerRef.current);
      pendingTrashUndoTimerRef.current = null;
    }
    pendingTrashUndoRef.current = null;
  };

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
    const loadStartAt = getPerfNow();
    if (!isCollabMode) {
      await purgeExpiredTrashBooks(TRASH_RETENTION_DAYS);
    }
    const [storedBooks, storedCollections] = await Promise.all([getAllBooks(), getAllCollections()]);
    setBooks(storedBooks);
    setCollections(storedCollections);

    if (isCollabMode) {
      return;
    }

    const legacyBookIds = storedBooks
      .filter((book) => {
        if (!book?.data) return false;
        const missingLanguage = !String(book.language || "").trim();
        const missingPages = !toPositiveNumber(book.estimatedPages);
        const missingGenreField = typeof book.genre !== "string";
        const isLegacyVersion = (book.metadataVersion || 0) < 2;
        return missingLanguage || missingPages || missingGenreField || isLegacyVersion;
      })
      .map((book) => book.id);

    if (!legacyBookIds.length) {
      recordPerfMetric("library.load", loadStartAt, {
        books: storedBooks.length,
        collections: storedCollections.length,
        legacyBackfills: 0
      });
      return;
    }

    const backfillStartAt = getPerfNow();
    await Promise.all(legacyBookIds.map((id) => backfillBookMetadata(id)));
    const refreshedBooks = await getAllBooks();
    setBooks(refreshedBooks);
    recordPerfMetric("library.backfill", backfillStartAt, {
      legacyBackfills: legacyBookIds.length
    });
    recordPerfMetric("library.load", loadStartAt, {
      books: refreshedBooks.length,
      collections: storedCollections.length,
      legacyBackfills: legacyBookIds.length
    });
  };

  const refreshShareInboxCount = async () => {
    if (!isCollabMode) {
      setShareInboxCount(0);
      return;
    }
    try {
      const shares = await fetchShareInbox();
      setShareInboxCount(Array.isArray(shares) ? shares.length : 0);
    } catch {
      setShareInboxCount(0);
    }
  };

  const openShareDialog = (event, book) => {
    event.preventDefault();
    event.stopPropagation();
    setShareDialogBook(book);
    setShareRecipientEmail("");
    setShareMessage("");
    setShareError("");
  };

  const closeShareDialog = () => {
    setShareDialogBook(null);
    setShareRecipientEmail("");
    setShareMessage("");
    setShareError("");
    setIsSharingBook(false);
  };

  const handleShareBook = async () => {
    if (!shareDialogBook?.id || !shareRecipientEmail.trim() || isSharingBook) return;
    setIsSharingBook(true);
    setShareError("");
    try {
      await createBookShare({
        bookId: shareDialogBook.id,
        toEmail: shareRecipientEmail.trim(),
        message: shareMessage.trim() || undefined
      });
      showFeedbackToast({
        title: "Share sent",
        message: `Invitation sent to ${shareRecipientEmail.trim()}.`
      });
      closeShareDialog();
      refreshShareInboxCount();
    } catch (err) {
      setShareError(err?.response?.data?.error || "Could not share this book");
      setIsSharingBook(false);
    }
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
    if (options.flash) params.set('flash', '1');
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
    const targetBook = books.find((book) => book.id === id);
    if (!targetBook) return;

    await moveBookToTrash(id);
    await loadLibrary();

    clearPendingTrashUndo();
    pendingTrashUndoRef.current = {
      bookId: id,
      title: targetBook.title || "Book"
    };
    pendingTrashUndoTimerRef.current = setTimeout(() => {
      clearPendingTrashUndo();
    }, 6000);

    showFeedbackToast({
      tone: "destructive",
      title: "Moved to Trash",
      message: `${targetBook.title || "Book"} moved to Trash.`,
      actionLabel: "Undo",
      onAction: async () => {
        const pending = pendingTrashUndoRef.current;
        if (!pending?.bookId) return;
        await restoreBookFromTrash(pending.bookId);
        await loadLibrary();
        clearPendingTrashUndo();
        showFeedbackToast({
          tone: "success",
          title: "Restored",
          message: `${pending.title} restored from Trash.`
        });
      }
    }, { duration: 6200 });
  };

  const handleRestoreBook = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const targetBook = books.find((book) => book.id === id);
    await restoreBookFromTrash(id);
    await loadLibrary();
    showFeedbackToast({
      tone: "success",
      title: "Restored",
      message: `${targetBook?.title || "Book"} restored from Trash.`
    });
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
    showFeedbackToast({
      tone: "destructive",
      title: "Deleted permanently",
      message: `${targetBook.title || "Book"} was deleted forever.`
    }, { duration: 3600 });
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

  const buildBookBackupPdfBlob = async (book, payload) => {
    const JsPdfCtor = await loadHomeJsPdfCtor();
    const doc = new JsPdfCtor({
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
      const pdfBlob = await buildBookBackupPdfBlob(book, payload);
      const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const baseName = toSafeFilename(`${book.title || "book"}-${book.author || "author"}`);
      triggerBlobDownload(pdfBlob, `${baseName}-highlights-notes.pdf`);
      triggerBlobDownload(jsonBlob, `${baseName}-highlights-notes.json`);
      return;
    }

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (let index = 0; index < validBooks.length; index += 1) {
      const book = validBooks[index];
      const payload = buildBookBackupPayload(book);
      const folderName = toSafeFilename(`${index + 1}-${book.title || "book"}`);
      const folder = zip.folder(folderName);
      if (!folder) continue;
      const pdfBlob = await buildBookBackupPdfBlob(book, payload);
      folder.file("highlights-notes.pdf", pdfBlob);
      folder.file("highlights-notes.json", JSON.stringify(payload, null, 2));
    }
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

  const handleToggleLibrarySelection = (id) => {
    setSelectedLibraryBookIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return Array.from(next);
    });
  };

  const handleToggleSelectAllLibrary = () => {
    setSelectedLibraryBookIds((current) => {
      const nextIds = Array.from(new Set(sortedBooks.map((book) => book.id)));
      if (!nextIds.length) return [];
      const allSelected = nextIds.every((id) => current.includes(id));
      return allSelected ? [] : nextIds;
    });
  };

  const handleClearLibrarySelection = () => {
    setSelectedLibraryBookIds([]);
  };

  const handleEnterLibrarySelectionMode = () => {
    setIsLibrarySelectionMode(true);
  };

  const handleExitLibrarySelectionMode = () => {
    setSelectedLibraryBookIds([]);
    setIsLibrarySelectionMode(false);
  };

  const handleBulkMarkToRead = async () => {
    if (!selectedLibraryBookIds.length) return;
    const selectedBooks = activeBooks.filter((book) => selectedLibraryBookIds.includes(book.id));
    const toUpdate = selectedBooks.filter((book) => !isBookToRead(book));
    if (!toUpdate.length) {
      showFeedbackToast({
        tone: "info",
        title: "Already tagged",
        message: "Selected books are already in To Read."
      });
      return;
    }
    await Promise.all(toUpdate.map((book) => toggleToRead(book.id)));
    await loadLibrary();
    showFeedbackToast({
      tone: "success",
      title: "To Read updated",
      message: `${toUpdate.length} book${toUpdate.length === 1 ? "" : "s"} added to To Read.`
    });
  };

  const handleBulkFavorite = async () => {
    if (!selectedLibraryBookIds.length) return;
    const selectedBooks = activeBooks.filter((book) => selectedLibraryBookIds.includes(book.id));
    const toUpdate = selectedBooks.filter((book) => !book.isFavorite);
    if (!toUpdate.length) {
      showFeedbackToast({
        tone: "info",
        title: "Already favorites",
        message: "Selected books are already marked as favorites."
      });
      return;
    }
    await Promise.all(toUpdate.map((book) => toggleFavorite(book.id)));
    await loadLibrary();
    showFeedbackToast({
      tone: "success",
      title: "Favorites updated",
      message: `${toUpdate.length} book${toUpdate.length === 1 ? "" : "s"} marked as favorites.`
    });
  };

  const handleBulkMoveToTrash = async () => {
    if (!selectedLibraryBookIds.length) return;
    const selectedBooks = activeBooks.filter((book) => selectedLibraryBookIds.includes(book.id));
    if (!selectedBooks.length) return;
    await Promise.all(selectedBooks.map((book) => moveBookToTrash(book.id)));
    setSelectedLibraryBookIds([]);
    await loadLibrary();
    showFeedbackToast({
      tone: "warning",
      title: "Moved to Trash",
      message: `${selectedBooks.length} book${selectedBooks.length === 1 ? "" : "s"} moved to Trash.`
    });
  };

  const handleRestoreSelectedTrash = async () => {
    if (!selectedTrashBookIds.length) return;
    const selectedBooks = trashedBooks.filter((book) => selectedTrashBookIds.includes(book.id));
    await Promise.all(selectedTrashBookIds.map((id) => restoreBookFromTrash(id)));
    setSelectedTrashBookIds([]);
    await loadLibrary();
    showFeedbackToast({
      tone: "success",
      title: "Books restored",
      message: `${selectedBooks.length} book${selectedBooks.length === 1 ? "" : "s"} restored from Trash.`
    });
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
    showFeedbackToast({
      tone: "destructive",
      title: "Deleted permanently",
      message: `${selectedBooks.length} book${selectedBooks.length === 1 ? "" : "s"} deleted forever.`
    }, { duration: 3600 });
  };

  const handleRestoreAllTrash = async () => {
    if (!trashedBooks.length) return;
    const total = trashedBooks.length;
    await Promise.all(trashedBooks.map((book) => restoreBookFromTrash(book.id)));
    setSelectedTrashBookIds([]);
    await loadLibrary();
    showFeedbackToast({
      tone: "success",
      title: "Trash restored",
      message: `${total} book${total === 1 ? "" : "s"} restored.`
    });
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
    showFeedbackToast({
      tone: "destructive",
      title: "Trash deleted permanently",
      message: "All books in Trash were deleted forever."
    }, { duration: 3600 });
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
    if (section === "inbox") {
      setStatusFilter("all");
      setCollectionFilter("all");
      setSelectedTrashBookIds([]);
      refreshShareInboxCount();
    }
    if (section === "account" || section === "statistics") {
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
    const sessionEmail = (getCurrentUser()?.email || "").trim();
    const fallbackEmail = sessionEmail || ACCOUNT_DEFAULT_EMAIL;
    const nextProfile = {
      firstName: (accountProfile.firstName || "").trim(),
      email: (accountProfile.email || fallbackEmail).trim() || fallbackEmail,
      avatarUrl: (accountProfile.avatarUrl || "").trim(),
      preferredLanguage: accountProfile.preferredLanguage || "en",
      emailNotifications: accountProfile.emailNotifications === "no" ? "no" : "yes"
    };

    if (isCollabMode) {
      const name = nextProfile.firstName || "Reader";
      updateMe({ displayName: name })
        .then((user) => {
          if (user) setCurrentUser(user);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(ACCOUNT_PROFILE_KEY, JSON.stringify({
              ...nextProfile,
              firstName: user?.displayName ? user.displayName.split(/\s+/).filter(Boolean)[0] || nextProfile.firstName : nextProfile.firstName,
              email: user?.email || nextProfile.email,
              avatarUrl: user?.avatarUrl || nextProfile.avatarUrl
            }));
          }
          setAccountProfile((current) => ({
            ...current,
            firstName: user?.displayName ? user.displayName.split(/\s+/).filter(Boolean)[0] || nextProfile.firstName : nextProfile.firstName,
            email: user?.email || nextProfile.email,
            avatarUrl: user?.avatarUrl || nextProfile.avatarUrl
          }));
          setAccountSaveMessage("Changes saved.");
        })
        .catch((err) => {
          console.error(err);
          setAccountSaveMessage("Could not save profile.");
        });
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACCOUNT_PROFILE_KEY, JSON.stringify(nextProfile));
    }
    setAccountProfile(nextProfile);
    setLibraryLanguage(nextProfile.preferredLanguage);
    setAccountSaveMessage("Changes saved.");
  };

  const handleAccountAvatarUpload = async (file) => {
    if (!file || !isCollabMode || isUploadingAvatar) return;
    setIsUploadingAvatar(true);
    setAccountSaveMessage("");
    try {
      const user = await uploadMyAvatar(file);
      const firstName = user?.displayName ? user.displayName.split(/\s+/).filter(Boolean)[0] || accountProfile.firstName : accountProfile.firstName;
      setAccountProfile((current) => ({
        ...current,
        firstName,
        email: user?.email || current.email,
        avatarUrl: user?.avatarUrl || current.avatarUrl
      }));
      if (typeof window !== "undefined") {
        const next = {
          ...accountProfile,
          firstName,
          email: user?.email || accountProfile.email,
          avatarUrl: user?.avatarUrl || accountProfile.avatarUrl
        };
        window.localStorage.setItem(ACCOUNT_PROFILE_KEY, JSON.stringify(next));
      }
      setAccountSaveMessage("Profile picture updated.");
    } catch (err) {
      console.error(err);
      setAccountSaveMessage("Could not upload profile picture.");
    } finally {
      setIsUploadingAvatar(false);
    }
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
    const noteValue = noteEditorValue.trim();
    setIsSavingNote(true);
    try {
      await updateHighlightNote(entry.bookId, entry.cfiRange, noteValue);
      await loadLibrary();
      setEditingNoteId("");
      setNoteEditorValue("");
      showFeedbackToast({
        tone: "success",
        title: "Note saved",
        message: noteValue ? "Your note has been updated." : "Note removed from highlight."
      });
    } catch (err) {
      console.error(err);
      showFeedbackToast({
        tone: "warning",
        title: "Could not save note",
        message: "Try again in a moment."
      });
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
    navigate(buildReaderPath(entry.bookId, "", {
      cfi: entry.cfiRange || "",
      flash: true
    }));
  };

  const completeAddBook = async (file, preparedMetadata, options = {}) => {
    const newBook = await addBook(file, {
      preparedMetadata,
      titleOverride: options.titleOverride
    });
    if (!options.skipReload) {
      await loadLibrary();
    }
    setUploadProgress(100);
    if (newBook?.id && !options.skipRecentHighlight) {
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
      const batchStartAt = getPerfNow();
      setIsUploading(true);
      setUploadStage("reading");
      setUploadBatchTotal(files.length);
      setUploadBatchCompleted(0);
      setUploadBatchCurrentIndex(0);
      setUploadBatchCurrentName("");
      setUploadProgress(0);

      let addedCount = 0;
      let lastAddedBookId = "";
      let knownBooks = await getAllBooks();
      let duplicateIndex = buildDuplicateIndex(knownBooks);
      const syncVisibleBooks = () => {
        const sortedKnownBooks = [...knownBooks].sort((left, right) => {
          if (left.isFavorite === right.isFavorite) {
            return new Date(right.addedAt) - new Date(left.addedAt);
          }
          return left.isFavorite ? -1 : 1;
        });
        setBooks(sortedKnownBooks);
      };
      recordPerfMetric("upload.batch.prefetch", batchStartAt, {
        files: files.length,
        knownBooks: knownBooks.length
      });

      for (let index = 0; index < files.length; index += 1) {
        const fileStartAt = getPerfNow();
        const file = files[index];
        setUploadBatchCurrentIndex(index + 1);
        setUploadBatchCurrentName(file.name || `Book ${index + 1}`);
        startUploadProgress();

        try {
          const metadataStartAt = getPerfNow();
          const prepared = await readEpubMetadataFast(file);
          const metadataDuration = recordPerfMetric("upload.file.metadata", metadataStartAt, {
            fileName: file.name,
            index: index + 1,
            totalFiles: files.length
          });
          const title = prepared?.metadata?.title || file.name.replace(/\.epub$/i, "");
          const author = prepared?.metadata?.creator || "Unknown Author";
          const duplicates = findDuplicateBooks(title, author, knownBooks, duplicateIndex);

          if (duplicates.length === 0) {
            const newBook = await completeAddBook(file, prepared, { skipReload: true, skipRecentHighlight: true });
            addedCount += 1;
            lastAddedBookId = newBook?.id || lastAddedBookId;
            if (newBook) {
              knownBooks = [...knownBooks, newBook];
              duplicateIndex = buildDuplicateIndex(knownBooks);
              syncVisibleBooks();
            }
            recordPerfMetric("upload.file.total", fileStartAt, {
              fileName: file.name,
              decision: "added",
              metadataMs: metadataDuration
            });
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
            recordPerfMetric("upload.file.total", fileStartAt, {
              fileName: file.name,
              decision: "ignored",
              metadataMs: metadataDuration
            });
            continue;
          }

          if (decision === "replace") {
            await Promise.all(duplicates.map((book) => deleteBook(book.id)));
            const duplicateIds = new Set(duplicates.map((book) => book.id));
            knownBooks = knownBooks.filter((book) => !duplicateIds.has(book.id));
            const newBook = await completeAddBook(file, prepared, { skipReload: true, skipRecentHighlight: true });
            addedCount += 1;
            lastAddedBookId = newBook?.id || lastAddedBookId;
            if (newBook) knownBooks = [...knownBooks, newBook];
            duplicateIndex = buildDuplicateIndex(knownBooks);
            syncVisibleBooks();
            recordPerfMetric("upload.file.total", fileStartAt, {
              fileName: file.name,
              decision: "replaced",
              metadataMs: metadataDuration,
              replacedCount: duplicates.length
            });
            continue;
          }

          if (decision === "keep-both") {
            const duplicateTitle = buildDuplicateTitle(title, knownBooks, duplicateIndex);
            const newBook = await completeAddBook(file, prepared, {
              titleOverride: duplicateTitle,
              skipReload: true,
              skipRecentHighlight: true
            });
            addedCount += 1;
            lastAddedBookId = newBook?.id || lastAddedBookId;
            if (newBook) {
              knownBooks = [...knownBooks, newBook];
              duplicateIndex = buildDuplicateIndex(knownBooks);
              syncVisibleBooks();
            }
            recordPerfMetric("upload.file.total", fileStartAt, {
              fileName: file.name,
              decision: "keep-both",
              metadataMs: metadataDuration
            });
          }
        } catch (err) {
          console.error(err);
          recordPerfMetric("upload.file.total", fileStartAt, {
            fileName: file.name,
            decision: "error"
          });
        } finally {
          stopUploadProgress();
          setUploadProgress(100);
          setUploadBatchCompleted(index + 1);
        }
      }

      if (addedCount > 0) {
        await loadLibrary();
        if (lastAddedBookId) {
          setRecentlyAddedBookId(lastAddedBookId);
          if (recentHighlightTimerRef.current) {
            clearTimeout(recentHighlightTimerRef.current);
          }
          recentHighlightTimerRef.current = setTimeout(() => {
            setRecentlyAddedBookId("");
          }, 10000);
        }
      }

      setUploadStage("idle");
      setUploadProgress(0);
      setUploadBatchCurrentName("");
      setUploadBatchCurrentIndex(0);
      setUploadBatchTotal(0);
      setUploadBatchCompleted(0);

      if (addedCount > 0) {
        showFeedbackToast({
          tone: "success",
          title: addedCount === 1 ? "Upload complete" : "Batch upload complete",
          message: addedCount === 1 ? "Book loaded and added." : `${addedCount} books loaded and added.`
        });
      }
      recordPerfMetric("upload.batch.total", batchStartAt, {
        files: files.length,
        addedCount
      });
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

  const collectionMap = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection])),
    [collections]
  );
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

    const searchRecord = searchIndexByBook[book.id];
    if (searchRecord) {
      if (typeof searchRecord.fullText === "string" && searchRecord.fullText.includes(normalizedQuery)) {
        return true;
      }
    } else {
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

  const activeBooks = useMemo(
    () => books.filter((book) => !book.isDeleted),
    [books]
  );
  const trashedBooks = useMemo(
    () => books.filter((book) => Boolean(book.isDeleted)),
    [books]
  );
  const trashedBooksCount = useMemo(
    () => books.length - activeBooks.length,
    [books.length, activeBooks.length]
  );
  const quickFilterStats = useMemo(
    () => [
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
          return isBookStarted(book) && progress < 100;
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
    ],
    [activeBooks]
  );
  const normalizedDebouncedNotesSearchQuery = normalizeString(debouncedNotesSearchQuery.trim());
  const normalizedDebouncedHighlightsSearchQuery = normalizeString(debouncedHighlightsSearchQuery.trim());
  const notesCenterEntries = useMemo(
    () => activeBooks
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
    .sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead)),
    [activeBooks]
  );
  const notesCenterFilteredEntries = useMemo(
    () => notesCenterEntries.filter((entry) => {
      if (!normalizedDebouncedNotesSearchQuery) return true;
      return (
        normalizeString(entry.bookTitle).includes(normalizedDebouncedNotesSearchQuery) ||
        normalizeString(entry.bookAuthor).includes(normalizedDebouncedNotesSearchQuery) ||
        normalizeString(entry.note).includes(normalizedDebouncedNotesSearchQuery) ||
        normalizeString(entry.highlightText).includes(normalizedDebouncedNotesSearchQuery)
      );
    }),
    [notesCenterEntries, normalizedDebouncedNotesSearchQuery]
  );
  const notesCenterDisplayEntries = useMemo(() => {
    const entries = [...notesCenterFilteredEntries];
    if (notesCenterSortBy === "book-asc") {
      return entries.sort((left, right) => {
        const byTitle = String(left.bookTitle || "").localeCompare(String(right.bookTitle || ""), undefined, { sensitivity: "base" });
        if (byTitle !== 0) return byTitle;
        return String(left.note || "").localeCompare(String(right.note || ""), undefined, { sensitivity: "base" });
      });
    }
    return entries.sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead));
  }, [notesCenterFilteredEntries, notesCenterSortBy]);
  const highlightsCenterEntries = useMemo(
    () => activeBooks
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
    .sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead)),
    [activeBooks]
  );
  const highlightsCenterFilteredEntries = useMemo(
    () => highlightsCenterEntries.filter((entry) => {
      if (!normalizedDebouncedHighlightsSearchQuery) return true;
      return (
        normalizeString(entry.bookTitle).includes(normalizedDebouncedHighlightsSearchQuery) ||
        normalizeString(entry.bookAuthor).includes(normalizedDebouncedHighlightsSearchQuery) ||
        normalizeString(entry.text).includes(normalizedDebouncedHighlightsSearchQuery) ||
        normalizeString(entry.note).includes(normalizedDebouncedHighlightsSearchQuery)
      );
    }),
    [highlightsCenterEntries, normalizedDebouncedHighlightsSearchQuery]
  );
  const highlightsCenterDisplayEntries = useMemo(() => {
    const entries = [...highlightsCenterFilteredEntries];
    if (highlightsCenterSortBy === "book-asc") {
      return entries.sort((left, right) => {
        const byTitle = String(left.bookTitle || "").localeCompare(String(right.bookTitle || ""), undefined, { sensitivity: "base" });
        if (byTitle !== 0) return byTitle;
        return String(left.text || "").localeCompare(String(right.text || ""), undefined, { sensitivity: "base" });
      });
    }
    return entries.sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead));
  }, [highlightsCenterFilteredEntries, highlightsCenterSortBy]);
  const activeBooksById = useMemo(
    () => new Map(activeBooks.map((book) => [book.id, book])),
    [activeBooks]
  );
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
  const notesCenterPairs = useMemo(
    () => buildCenterPairs(notesCenterDisplayEntries, "notes-book"),
    [notesCenterDisplayEntries, activeBooksById]
  );
  const highlightsCenterPairs = useMemo(
    () => buildCenterPairs(highlightsCenterDisplayEntries, "highlights-book"),
    [highlightsCenterDisplayEntries, activeBooksById]
  );

  const sortedBooks = useMemo(
    () => [...activeBooks]
    .filter((book) => {
      const query = debouncedSearchQuery.trim().toLowerCase();
      const matchesSearch = !query || bookMatchesLibrarySearch(book, query);

      const highlightCount = Array.isArray(book.highlights) ? book.highlights.length : 0;
      const noteCount = Array.isArray(book.highlights)
        ? book.highlights.filter((h) => (h?.note || "").trim()).length
        : 0;
      const progress = normalizeNumber(book.progress);

      const matchesStatus =
        statusFilter === "all" ? true
        : statusFilter === "to-read" ? isBookToRead(book)
        : statusFilter === "in-progress" ? isBookStarted(book) && progress < 100
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
    }),
    [
      activeBooks,
      debouncedSearchQuery,
      statusFilter,
      flagFilters,
      collectionFilter,
      sortBy,
      isBookStarted,
      contentSearchMatches,
      searchIndexByBook
    ]
  );

  const sortedTrashBooks = useMemo(
    () => [...trashedBooks]
    .filter((book) => bookMatchesTrashSearch(book, debouncedSearchQuery))
    .sort((left, right) => {
      if (trashSortBy === "deleted-desc") return normalizeTime(right.deletedAt) - normalizeTime(left.deletedAt);
      if (trashSortBy === "deleted-asc") return normalizeTime(left.deletedAt) - normalizeTime(right.deletedAt);
      if (trashSortBy === "title-desc") return normalizeString(right.title).localeCompare(normalizeString(left.title));
      if (trashSortBy === "author-asc") return normalizeString(left.author).localeCompare(normalizeString(right.author));
      if (trashSortBy === "author-desc") return normalizeString(right.author).localeCompare(normalizeString(left.author));
      if (trashSortBy === "added-desc") return normalizeTime(right.addedAt) - normalizeTime(left.addedAt);
      if (trashSortBy === "added-asc") return normalizeTime(left.addedAt) - normalizeTime(right.addedAt);
      return normalizeString(left.title).localeCompare(normalizeString(right.title));
    }),
    [trashedBooks, debouncedSearchQuery, trashSortBy]
  );

  useEffect(() => {
    if (librarySection === "trash") {
      setTrashRenderLimit(LIBRARY_RENDER_BATCH_SIZE);
      return;
    }
    setLibraryRenderLimit(LIBRARY_RENDER_BATCH_SIZE);
  }, [
    librarySection,
    viewMode,
    debouncedSearchQuery,
    statusFilter,
    collectionFilter,
    sortBy,
    trashSortBy,
    flagFilters,
    sortedBooks.length,
    sortedTrashBooks.length
  ]);

  const hasMoreLibraryBooks = sortedBooks.length > libraryRenderLimit;
  const hasMoreTrashBooks = sortedTrashBooks.length > trashRenderLimit;
  const hasMoreBooksToRender = librarySection === "trash" ? hasMoreTrashBooks : hasMoreLibraryBooks;

  useEffect(() => {
    if (!hasMoreBooksToRender) return;
    if (typeof IntersectionObserver !== "function") return;
    const sentinel = loadMoreBooksRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (librarySection === "trash") {
          setTrashRenderLimit((current) => Math.min(current + LIBRARY_RENDER_BATCH_SIZE, sortedTrashBooks.length));
        } else {
          setLibraryRenderLimit((current) => Math.min(current + LIBRARY_RENDER_BATCH_SIZE, sortedBooks.length));
        }
      },
      {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0.01
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreBooksToRender, librarySection, sortedBooks.length, sortedTrashBooks.length, viewMode]);

  const globalSearchQuery = debouncedSearchQuery.trim().toLowerCase();
  const globalSearchGroups = useMemo(() => {
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
      const searchRecord = searchIndexByBook[book.id] || buildBookSearchRecord(book);
      const existingBookResultIds = new Set();

      if ((searchRecord?.metadataText || "").includes(globalSearchQuery)) {
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

      const highlightEntries = Array.isArray(searchRecord?.highlights) ? searchRecord.highlights : [];
      highlightEntries.forEach((entry, index) => {
        if ((entry?.normalized || "").includes(globalSearchQuery)) {
          nextGroups.highlights.push({
            id: entry?.id || `${book.id}-highlight-${entry?.cfi || index}`,
            bookId: book.id,
            panel: "highlights",
            cfi: entry?.cfi || "",
            query: globalSearchQuery,
            title: book.title,
            subtitle: book.author,
            snippet: buildSnippet(entry?.text || "", globalSearchQuery)
          });
        }
      });

      const noteEntries = Array.isArray(searchRecord?.notes) ? searchRecord.notes : [];
      noteEntries.forEach((entry, index) => {
        if ((entry?.normalized || "").includes(globalSearchQuery)) {
          nextGroups.notes.push({
            id: entry?.id || `${book.id}-note-${entry?.cfi || index}`,
            bookId: book.id,
            panel: "highlights",
            cfi: entry?.cfi || "",
            query: globalSearchQuery,
            title: book.title,
            subtitle: book.author,
            snippet: buildSnippet(entry?.text || "", globalSearchQuery)
          });
        }
      });

      const bookmarkEntries = Array.isArray(searchRecord?.bookmarks) ? searchRecord.bookmarks : [];
      bookmarkEntries.forEach((entry, index) => {
        if (!(entry?.normalized || "").includes(globalSearchQuery)) return;
        nextGroups.bookmarks.push({
          id: entry?.id || `${book.id}-bookmark-${entry?.cfi || index}`,
          bookId: book.id,
          panel: "bookmarks",
          cfi: entry?.cfi || "",
          query: globalSearchQuery,
          title: book.title,
          subtitle: book.author,
          snippet: buildSnippet(entry?.text || "", globalSearchQuery)
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
  }, [books, contentSearchMatches, globalSearchQuery, searchIndexByBook]);
  const globalSearchBookGroup = useMemo(
    () => globalSearchGroups.find((group) => group.key === "books"),
    [globalSearchGroups]
  );
  const globalSearchBookItems = globalSearchBookGroup?.items || [];
  const visibleGlobalSearchGroups = useMemo(
    () => globalSearchGroups.filter((group) => group.key !== "books"),
    [globalSearchGroups]
  );
  const globalContentGroup = useMemo(
    () => visibleGlobalSearchGroups.find((group) => group.key === "content"),
    [visibleGlobalSearchGroups]
  );
  const globalOtherGroups = useMemo(
    () => visibleGlobalSearchGroups.filter((group) => group.key !== "content"),
    [visibleGlobalSearchGroups]
  );
  const globalSearchTotal = useMemo(
    () => visibleGlobalSearchGroups.reduce((total, group) => total + group.items.length, 0) + globalSearchBookItems.length,
    [visibleGlobalSearchGroups, globalSearchBookItems.length]
  );
  const booksById = useMemo(
    () => new Map(books.filter((book) => !book.isDeleted).map((book) => [book.id, book])),
    [books]
  );
  const globalMatchedBooks = useMemo(
    () => globalSearchBookItems
      .map((item) => ({
        ...item,
        book: booksById.get(item.bookId)
      }))
      .filter((item) => Boolean(item.book)),
    [globalSearchBookItems, booksById]
  );
  const globalContentItemsByBook = useMemo(
    () => (globalContentGroup?.items || []).reduce((acc, item) => {
      if (!item?.bookId) return acc;
      if (!acc[item.bookId]) acc[item.bookId] = [];
      acc[item.bookId].push(item);
      return acc;
    }, {}),
    [globalContentGroup]
  );
  const globalMatchedBookPairs = useMemo(
    () => globalMatchedBooks
      .map((item) => ({
        ...item,
        contentItems: globalContentItemsByBook[item.bookId] || []
      }))
      .filter((item) => item.contentItems.length > 0),
    [globalMatchedBooks, globalContentItemsByBook]
  );
  const showGlobalSearchBooksColumn = Boolean(
    globalSearchQuery &&
    librarySection === "library" &&
    (globalMatchedBookPairs.length || globalMatchedBooks.length)
  );
  const showGlobalSearchSplitColumns = showGlobalSearchBooksColumn && globalMatchedBookPairs.length === 0;

  const continueReadingBooks = useMemo(
    () =>
      buildContinueReadingBooks({
        books,
        isDuplicateTitleBook,
        isBookStarted,
        normalizeNumber,
        normalizeTime
      }),
    [books]
  );

  const showContinueReading =
    statusFilter === "all" &&
    collectionFilter === "all" &&
    !debouncedSearchQuery.trim() &&
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
    <div
      data-testid="book-reading-state"
      className={`flex items-center gap-2 text-blue-500 text-xs font-semibold ${extraClasses}`}
    >
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

  const renderGenreChip = (book, extraClasses = "") => {
    const genre = formatGenreLabel(book.genre);
    if (!genre) return null;
    return (
      <span
        data-testid="book-meta-genre"
        className={`inline-flex items-center rounded-full border border-pink-500 bg-pink-50 px-3 py-0.5 text-xs font-semibold tracking-wide text-pink-600 ${extraClasses}`}
      >
        {genre}
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
      <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${extraClasses}`}>
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

const formatRoundedHours = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    if (!safeSeconds) return "0h";
    const hours = safeSeconds / 3600;
    if (hours >= 10) return `${Math.round(hours)}h`;
    return `${Math.round(hours * 10) / 10}h`;
};

const formatNotificationTimeAgo = (value) => {
  const time = value ? new Date(value) : null;
  if (!time || Number.isNaN(time.getTime())) return "Just now";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - time.getTime()) / 1000));
  if (elapsedSeconds < 60) return "Just now";
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h ago`;
  return `${Math.floor(elapsedSeconds / 86400)}d ago`;
};

  const getPublicationYearLabel = (book) => {
    if (!book?.pubDate) return "";
    const parsed = new Date(book.pubDate);
    if (Number.isFinite(parsed.getTime())) {
      return String(parsed.getFullYear());
    }
    const raw = compactWhitespace(String(book.pubDate));
    const yearMatch = raw.match(/\b(1[6-9]\d{2}|20\d{2}|21\d{2})\b/);
    return yearMatch ? yearMatch[1] : "";
  };

  const formatEstimatedTimeLeft = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    if (!safeSeconds) return "";
    const minutes = Math.max(1, Math.round(safeSeconds / 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours <= 0) return `${minutes}m left`;
    if (remainingMinutes === 0) return `${hours}h left`;
    return `${hours}h ${remainingMinutes}m left`;
  };

  const getEstimatedRemainingSeconds = (book) => {
    const progress = Math.max(0, Math.min(100, normalizeNumber(book?.progress)));
    const spentSeconds = Math.max(0, Number(book?.readingTime) || 0);
    if (progress <= 0 || progress >= 100 || spentSeconds <= 0) return 0;
    return Math.round((spentSeconds * (100 - progress)) / progress);
  };

  const getContinueReadingTimeLeftTone = (seconds) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    if (!safeSeconds) {
      return {
        tone: "neutral",
        className: isDarkLibraryTheme ? "text-slate-300" : "text-gray-600"
      };
    }
    if (safeSeconds <= 30 * 60) {
      return {
        tone: "success",
        className: isDarkLibraryTheme ? "text-emerald-300" : "text-emerald-600"
      };
    }
    if (safeSeconds <= 2 * 60 * 60) {
      return {
        tone: "info",
        className: isDarkLibraryTheme ? "text-blue-300" : "text-blue-600"
      };
    }
    if (safeSeconds <= 6 * 60 * 60) {
      return {
        tone: "warning",
        className: isDarkLibraryTheme ? "text-amber-300" : "text-amber-600"
      };
    }
    return {
      tone: "neutral",
      className: isDarkLibraryTheme ? "text-slate-300" : "text-gray-600"
    };
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
        <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-gray-500">
          <History size={11} className="text-gray-400" />
          <span>{label}</span>
        </div>
      );
    }

    return (
      <div
        data-testid="book-session-summary"
        className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500"
      >
        <History size={12} className="text-gray-400" />
        <span data-testid="book-last-session">{label}</span>
      </div>
    );
  };

  const renderMetadataBadges = (book) => {
    const language = formatLanguageLabel(book.language);
    const estimatedPages = toPositiveNumber(book.estimatedPages);
    const publicationYear = getPublicationYearLabel(book);
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
    if (publicationYear) {
      metaItems.push({
        key: "year",
        testId: "book-meta-year",
        icon: Calendar,
        label: publicationYear
      });
    }
    if (!metaItems.length) return null;

    return (
      <div className="mt-1.5">
        {metaItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-gray-500">
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
        className={`group workspace-interactive-card workspace-interactive-card-light rounded-2xl overflow-hidden block relative ${coverHeightClass}`}
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
  const activeFilterCount =
    (searchQuery.trim() ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (collectionFilter !== "all" ? 1 : 0) +
    flagFilters.length +
    (sortBy !== "last-read-desc" ? 1 : 0);
  const canShowResetFilters = hasActiveLibraryFilters;
  const isDarkLibraryTheme = libraryTheme === "dark";
  const brandLogoSrc = isDarkLibraryTheme ? "/brand/logo-dark.png" : "/brand/logo-light.png";
  const brandLogoFallbackSrc = isDarkLibraryTheme ? "/brand/logo-light.png" : "/brand/logo-dark.png";
  const isAccountSection = librarySection === "account";
  const isStatisticsSection = librarySection === "statistics";
  const isCollectionsPage = librarySection === "collections";
  const isNotesSection = librarySection === "notes";
  const isHighlightsSection = librarySection === "highlights";
  const isInboxSection = librarySection === "inbox";
  const isTrashSection = librarySection === "trash";
  const shouldShowLibraryHomeContent = librarySection === "library";
  const sectionHeader = useMemo(() => {
    if (isAccountSection) {
      return {
        title: "Settings",
        subtitle: "Manage your profile details and account preferences.",
        summary: "Profile and account options"
      };
    }
    if (isStatisticsSection) {
      return {
        title: "Reading Statistics",
        subtitle: "Track reading momentum, completion, and habits across your library.",
        summary: `${activeBooks.length} active book${activeBooks.length === 1 ? "" : "s"}`
      };
    }
    if (isNotesSection) {
      const count = notesCenterDisplayEntries.length;
      return {
        title: "Notes",
        subtitle: "Review and refine your notes across books.",
        summary: `${count} note${count === 1 ? "" : "s"} shown`
      };
    }
    if (isHighlightsSection) {
      const count = highlightsCenterDisplayEntries.length;
      return {
        title: "Highlights",
        subtitle: "Browse key passages and jump back into the text.",
        summary: `${count} highlight${count === 1 ? "" : "s"} shown`
      };
    }
    if (isInboxSection) {
      return {
        title: "Inbox",
        subtitle: "Pending book shares from other Ariadne users.",
        summary: `${shareInboxCount} pending share${shareInboxCount === 1 ? "" : "s"}`
      };
    }
    if (isCollectionsPage) {
      return {
        title: "My Collections",
        subtitle: "Organize books into custom shelves.",
        summary: `${collections.length} collection${collections.length === 1 ? "" : "s"}`
      };
    }
    if (isTrashSection) {
      return {
        title: "Trash",
        subtitle: "Recently removed books waiting for restore or permanent deletion.",
        summary: `Showing ${sortedTrashBooks.length} of ${trashedBooksCount} deleted books`
      };
    }
    const librarySummary = sortedBooks.length === activeBooks.length
      ? `You have ${activeBooks.length} books`
      : `Showing ${sortedBooks.length} of ${activeBooks.length} books`;
    return {
      title: "My Library",
      subtitle: "Read, organize, and return to your books quickly.",
      summary: trashedBooksCount > 0 ? `${librarySummary} · ${trashedBooksCount} in trash` : librarySummary
    };
  }, [
    isAccountSection,
    isStatisticsSection,
    isNotesSection,
    isHighlightsSection,
    isCollectionsPage,
    isTrashSection,
    isInboxSection,
    activeBooks.length,
    notesCenterDisplayEntries.length,
    highlightsCenterDisplayEntries.length,
    shareInboxCount,
    collections.length,
    sortedTrashBooks.length,
    trashedBooksCount,
    sortedBooks.length
  ]);
  const shouldShowContinueReading = showContinueReading && librarySection === "library";
  const renderedBooks = (isTrashSection ? sortedTrashBooks : sortedBooks).slice(
    0,
    isTrashSection ? trashRenderLimit : libraryRenderLimit
  );
  const showRenderSentinel = isTrashSection ? hasMoreTrashBooks : hasMoreLibraryBooks;
  const visibleTrashIds = Array.from(new Set(sortedTrashBooks.map((book) => book.id)));
  const visibleLibraryIds = Array.from(new Set(sortedBooks.map((book) => book.id)));
  const trashSelectedCount = selectedTrashBookIds.length;
  const librarySelectedCount = selectedLibraryBookIds.length;
  const allVisibleTrashSelected = areAllVisibleIdsSelected(visibleTrashIds, selectedTrashBookIds);
  const allVisibleLibrarySelected = areAllVisibleIdsSelected(visibleLibraryIds, selectedLibraryBookIds);
  useEffect(() => {
    if (librarySection !== "library") {
      setSelectedLibraryBookIds([]);
      setIsLibrarySelectionMode(false);
      return;
    }
    setSelectedLibraryBookIds((current) => {
      if (!current.length) return current;
      const next = pruneSelectionByAllowedIds(current, sortedBooks.map((book) => book.id));
      return next.length === current.length ? current : next;
    });
    if (!sortedBooks.length) {
      setIsLibrarySelectionMode(false);
    }
  }, [librarySection, sortedBooks]);
  const readingSnapshot = useMemo(() => {
    const liveBooks = books.filter((book) => !book?.isDeleted);
    const totalBooks = liveBooks.length;
    const completedBooks = liveBooks.filter((book) => normalizeNumber(book.progress) >= 100);
    const finishedBooks = completedBooks.length;
    const completedPages = completedBooks.reduce((sum, book) => sum + (toPositiveNumber(book?.estimatedPages) || 0), 0);
    const totalSeconds = liveBooks.reduce((sum, book) => sum + Math.max(0, Number(book?.readingTime) || 0), 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todaySeconds = liveBooks.reduce((sum, book) => {
      const sessions = Array.isArray(book?.readingSessions) ? book.readingSessions : [];
      return sum + sessions.reduce((sessionSum, session) => {
        const endAt = new Date(session?.endAt || session?.startAt || 0);
        if (!Number.isFinite(endAt.getTime()) || endAt < todayStart) return sessionSum;
        return sessionSum + Math.max(0, Number(session?.seconds) || 0);
      }, 0);
    }, 0);
    return {
      totalBooks,
      finishedBooks,
      completedPages,
      totalSeconds,
      todaySeconds
    };
  }, [books]);
  const showReadingSnapshot = shouldShowLibraryHomeContent;
  const readingSnapshotProgress = readingSnapshot.totalBooks > 0
    ? Math.max(0, Math.min(100, Math.round((readingSnapshot.finishedBooks / readingSnapshot.totalBooks) * 100)))
    : 0;
  const libraryNotifications = useMemo(() => (
    buildLibraryNotifications({
      activeBooks,
      streakCount,
      readToday,
      todayKey: toLocalDateKey(new Date()),
      nowIso: new Date().toISOString(),
      normalizeNumber,
      getEstimatedRemainingSeconds,
      formatEstimatedTimeLeft,
      getCalendarDayDiff,
      isBookToRead,
      isBookStarted,
      isDuplicateTitleBook,
      stripDuplicateTitleSuffix
    })
  ), [
    activeBooks,
    streakCount,
    readToday,
    normalizeNumber,
    getEstimatedRemainingSeconds,
    formatEstimatedTimeLeft,
    getCalendarDayDiff,
    isBookToRead,
    isBookStarted,
    isDuplicateTitleBook,
    stripDuplicateTitleSuffix
  ]);
  useEffect(() => {
    setNotificationStateById((current) => {
      const nowIso = new Date().toISOString();
      const next = {};
      libraryNotifications.forEach((item) => {
        const previous = current[item.id] || {};
        next[item.id] = {
          firstSeenAt: previous.firstSeenAt || item.createdAt || nowIso,
          readAt: previous.readAt || null,
          snoozedUntil: previous.snoozedUntil || null,
          archivedAt: previous.archivedAt || null,
          deletedAt: previous.deletedAt || null
        };
      });
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (currentKeys.length !== nextKeys.length) return next;
      for (const key of nextKeys) {
        const a = current[key];
        const b = next[key];
        if (
          !a ||
          a.firstSeenAt !== b.firstSeenAt ||
          a.readAt !== b.readAt ||
          a.snoozedUntil !== b.snoozedUntil ||
          a.archivedAt !== b.archivedAt ||
          a.deletedAt !== b.deletedAt
        ) {
          return next;
        }
      }
      return current;
    });
  }, [libraryNotifications]);

  const libraryNotificationsWithState = useMemo(() => (
    libraryNotifications.map((item) => {
      const state = notificationStateById[item.id] || {};
      const firstSeenAt = state.firstSeenAt || null;
      const readAt = state.readAt || null;
      const snoozedUntil = state.snoozedUntil || null;
      const archivedAt = state.archivedAt || null;
      const deletedAt = state.deletedAt || null;
      const snoozedActive = Boolean(snoozedUntil) && normalizeTime(snoozedUntil) > Date.now();
      return {
        ...item,
        firstSeenAt,
        readAt,
        snoozedUntil,
        archivedAt,
        deletedAt,
        isRead: Boolean(readAt),
        isSnoozed: snoozedActive,
        isArchived: Boolean(archivedAt),
        isDeleted: Boolean(deletedAt)
      };
    })
  ), [libraryNotifications, notificationStateById]);

  const visibleNotifications = useMemo(
    () => libraryNotificationsWithState.filter((item) => !item.isSnoozed && !item.isArchived && !item.isDeleted),
    [libraryNotificationsWithState]
  );
  const unreadNotifications = useMemo(
    () => visibleNotifications.filter((item) => !item.isRead),
    [visibleNotifications]
  );
  const filteredNotifications = notificationView === "unread" ? unreadNotifications : visibleNotifications;
  const notificationCount = unreadNotifications.length;
  const profileLabel = (accountProfile?.firstName || accountProfile?.email || "Reader").trim();
  const profileAvatarUrl = (accountProfile?.avatarUrl || "").trim();
  const profileInitials = (() => {
    const firstName = (accountProfile?.firstName || "").trim();
    if (firstName) {
      const parts = firstName.split(/\s+/).filter(Boolean).slice(0, 2);
      const initials = parts.map((part) => part[0]?.toUpperCase() || "").join("");
      if (initials) return initials;
    }
    const fromEmail = (accountProfile?.email || "R").trim().charAt(0).toUpperCase();
    return fromEmail || "R";
  })();
  const profileMenuItems = [
    { key: "profile", label: "Profile", icon: User },
    { key: "reading-statistics", label: "Reading Statistics", icon: BarChart3 },
    { key: "settings", label: "Settings", icon: Settings2 },
    { key: "faq", label: "FAQ", icon: CircleHelp },
    { key: "sign-out", label: "Sign out", icon: LogOut },
  ];
  const notificationKindConfig = {
    "streak-risk": { label: "Streak", Icon: Flame, tone: "amber" },
    "finish-soon": { label: "Finish soon", Icon: Clock, tone: "green" },
    "resume-abandoned": { label: "Resume", Icon: History, tone: "blue" },
    "daily-goal": { label: "Daily goal", Icon: Target, tone: "indigo" },
    milestone: { label: "Milestone", Icon: Trophy, tone: "violet" },
    "to-read-nudge": { label: "To Read", Icon: Tag, tone: "pink" },
    "duplicate-cleanup": { label: "Duplicates", Icon: Trash2, tone: "rose" }
  };
  const notificationToneClasses = {
    amber: isDarkLibraryTheme ? "bg-amber-900/30 text-amber-300" : "bg-amber-100 text-amber-700",
    green: isDarkLibraryTheme ? "bg-emerald-900/30 text-emerald-300" : "bg-emerald-100 text-emerald-700",
    blue: isDarkLibraryTheme ? "bg-blue-900/30 text-blue-300" : "bg-blue-100 text-blue-700",
    indigo: isDarkLibraryTheme ? "bg-indigo-900/30 text-indigo-300" : "bg-indigo-100 text-indigo-700",
    violet: isDarkLibraryTheme ? "bg-violet-900/30 text-violet-300" : "bg-violet-100 text-violet-700",
    pink: isDarkLibraryTheme ? "bg-pink-900/30 text-pink-300" : "bg-pink-100 text-pink-700",
    rose: isDarkLibraryTheme ? "bg-rose-900/30 text-rose-300" : "bg-rose-100 text-rose-700"
  };

  const handleNotificationReadState = (id, read) => {
    setNotificationStateById((current) => {
      const prev = current[id] || {};
      const nextReadAt = read ? (prev.readAt || new Date().toISOString()) : null;
      if (prev.readAt === nextReadAt) return current;
      return {
        ...current,
        [id]: {
          firstSeenAt: prev.firstSeenAt || new Date().toISOString(),
          readAt: nextReadAt,
          snoozedUntil: prev.snoozedUntil || null,
          archivedAt: prev.archivedAt || null,
          deletedAt: prev.deletedAt || null
        }
      };
    });
  };

  const handleNotificationArchive = (id) => {
    const archivedAt = new Date().toISOString();
    setNotificationStateById((current) => {
      const previous = current[id] || {};
      return {
        ...current,
        [id]: {
          firstSeenAt: previous.firstSeenAt || archivedAt,
          readAt: previous.readAt || archivedAt,
          snoozedUntil: previous.snoozedUntil || null,
          archivedAt,
          deletedAt: previous.deletedAt || null
        }
      };
    });
    if (activeNotificationMenuId === id) setActiveNotificationMenuId("");
  };

  const handleNotificationDelete = (id) => {
    const deletedAt = new Date().toISOString();
    setNotificationStateById((current) => {
      const previous = current[id] || {};
      return {
        ...current,
        [id]: {
          firstSeenAt: previous.firstSeenAt || deletedAt,
          readAt: previous.readAt || deletedAt,
          snoozedUntil: previous.snoozedUntil || null,
          archivedAt: previous.archivedAt || null,
          deletedAt
        }
      };
    });
    if (activeNotificationMenuId === id) setActiveNotificationMenuId("");
  };

  const handleMarkAllNotificationsRead = () => {
    const nowIso = new Date().toISOString();
    setNotificationStateById((current) => {
      let changed = false;
      const next = { ...current };
      visibleNotifications.forEach((item) => {
        const previous = next[item.id] || {};
        if (previous.readAt) return;
        next[item.id] = {
          firstSeenAt: previous.firstSeenAt || nowIso,
          readAt: nowIso,
          snoozedUntil: previous.snoozedUntil || null,
          archivedAt: previous.archivedAt || null,
          deletedAt: previous.deletedAt || null
        };
        changed = true;
      });
      return changed ? next : current;
    });
  };

  const handleOpenNotificationTarget = (item) => {
    if (!item) return;
    handleNotificationReadState(item.id, true);
    setIsNotificationsOpen(false);
    setActiveNotificationMenuId("");

    if (item.actionType === "open-reader" && item.bookId) {
      handleOpenBook(item.bookId);
      navigate(buildReaderPath(item.bookId));
      return;
    }

    if (item.actionType === "open-library-to-read") {
      handleSidebarSectionSelect("library");
      setStatusFilter("to-read");
      setCollectionFilter("all");
      setSearchQuery("");
      return;
    }

    if (item.actionType === "open-library-in-progress") {
      handleSidebarSectionSelect("library");
      setStatusFilter("in-progress");
      setCollectionFilter("all");
      setSearchQuery("");
      return;
    }

    if (item.actionType === "open-library-duplicates") {
      handleSidebarSectionSelect("library");
      setStatusFilter("all");
      setCollectionFilter("all");
      setSearchQuery("Duplicate");
      return;
    }

    handleSidebarSectionSelect("library");
  };

  const focusContinueReadingCard = (bookId) => {
    if (!bookId || typeof window === "undefined") return;
    setNotificationFocusedBookId(bookId);
    if (notificationFocusTimerRef.current) {
      clearTimeout(notificationFocusTimerRef.current);
      notificationFocusTimerRef.current = null;
    }
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`continue-reading-${bookId}`);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      }
    });
    notificationFocusTimerRef.current = setTimeout(() => {
      setNotificationFocusedBookId("");
      notificationFocusTimerRef.current = null;
    }, 2200);
  };

  const handleNotificationCardClick = (item) => {
    if (!item) return;
    handleNotificationReadState(item.id, true);
    setActiveNotificationMenuId("");
    setIsNotificationsOpen(false);

    if (item.bookId) {
      handleSidebarSectionSelect("library");
      setStatusFilter("all");
      setCollectionFilter("all");
      setSearchQuery("");
      focusContinueReadingCard(item.bookId);
      return;
    }

    handleOpenNotificationTarget(item);
  };

  const handleProfileMenuAction = (actionKey) => {
    setIsProfileMenuOpen(false);
    setIsNotificationsOpen(false);
    if (actionKey === "settings" || actionKey === "profile") {
      handleSidebarSectionSelect("account");
      return;
    }
    if (actionKey === "reading-statistics") {
      handleSidebarSectionSelect("statistics");
      return;
    }
    if (actionKey === "faq") {
      if (typeof window !== "undefined") {
        window.open("https://github.com/AissamDjahnine/smart-reader#faq", "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (actionKey === "sign-out") {
      clearSession();
      if (typeof window !== "undefined") {
        window.location.reload();
      }
      handleSidebarSectionSelect("library");
    }
  };

  return (
    <div className={`min-h-screen p-6 md:p-12 font-sans ${isDarkLibraryTheme ? "bg-slate-950 text-slate-100" : "bg-gray-50 text-gray-900"}`}>
      <div className="mx-auto max-w-[1480px] md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
        <div className="hidden md:flex md:flex-col pt-3">
          <div
            data-testid="library-logo-slot"
            className={`mb-5 mt-1 flex items-center justify-start border-b px-2 pb-4 ${
              isDarkLibraryTheme ? "border-slate-700/70" : "border-gray-200/80"
            }`}
          >
            <button
              type="button"
              data-testid="library-logo-home-link"
              onClick={() => handleSidebarSectionSelect("library")}
              className={`inline-flex items-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border border-slate-700/70 bg-slate-800/85 px-2.5 py-1.5 shadow-[0_8px_22px_rgba(2,8,23,0.45)]"
                  : ""
              }`}
              title="Go to My Library"
              aria-label="Go to My Library"
            >
              <img
                src={brandLogoSrc}
                alt="Ariadne logo"
                className="h-14 w-auto max-w-[200px] origin-left scale-110 object-contain"
                onError={(event) => {
                  const { currentTarget } = event;
                  if (currentTarget.src.includes(brandLogoFallbackSrc)) {
                    currentTarget.style.display = "none";
                    return;
                  }
                  currentTarget.src = brandLogoFallbackSrc;
                }}
              />
            </button>
          </div>
          {showReadingSnapshot && (
            <aside
              data-testid="reading-snapshot-card"
              className={`workspace-surface p-5 ${
                isDarkLibraryTheme ? "workspace-surface-dark" : "workspace-surface-light library-zone-sidebar-light"
              }`}
            >
              <div className={`text-sm font-semibold ${
                isDarkLibraryTheme ? "text-slate-200" : "text-[#1A1A2E]"
              }`}>
                Reading Snapshot
              </div>
              <div className="mt-4 flex items-center gap-4">
                <div
                  className="relative h-20 w-20 shrink-0 rounded-full"
                  style={{
                    background: `conic-gradient(${isDarkLibraryTheme ? "#60a5fa" : "#2563eb"} ${readingSnapshotProgress}%, ${isDarkLibraryTheme ? "#334155" : "#e5e7eb"} ${readingSnapshotProgress}% 100%)`
                  }}
                >
                  <div className={`absolute inset-[7px] rounded-full ${isDarkLibraryTheme ? "bg-slate-900" : "bg-white"}`} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
                    <span className={`text-[18px] font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                      {readingSnapshot.finishedBooks}
                    </span>
                    <span className={`text-[10px] font-semibold ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                      / {readingSnapshot.totalBooks || 0}
                    </span>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="inline-flex items-center gap-2">
                    <Clock size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
                    <div className="leading-tight">
                      <div className={`text-[11px] font-medium ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>Hours</div>
                      <div className={`text-lg font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                        {formatRoundedHours(readingSnapshot.totalSeconds)}
                      </div>
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <FileText size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
                    <div className="leading-tight">
                      <div className={`text-[11px] font-medium ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>Pages done</div>
                      <div className={`text-lg font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                        {readingSnapshot.completedPages}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className={`mt-4 inline-flex w-full items-center gap-2 border-t pt-3 text-[12px] ${isDarkLibraryTheme ? "border-slate-700 text-slate-400" : "border-gray-100 text-gray-600"}`}>
                <History size={14} className={isDarkLibraryTheme ? "text-slate-500" : "text-gray-400"} />
                <span className="font-medium">Today</span>
                <span className={`ml-1 font-semibold ${isDarkLibraryTheme ? "text-blue-300" : "text-blue-600"}`}>
                  {formatSessionDuration(readingSnapshot.todaySeconds)}
                </span>
              </div>
            </aside>
          )}
          <LibraryWorkspaceSidebar
            librarySection={librarySection}
            isDarkLibraryTheme={isDarkLibraryTheme}
            notesCount={notesCenterEntries.length}
            highlightsCount={highlightsCenterEntries.length}
            inboxCount={shareInboxCount}
            trashCount={trashedBooksCount}
            onSelectSection={handleSidebarSectionSelect}
            className={showReadingSnapshot ? "mt-4" : ""}
          />
        </div>

        <div className="w-full min-w-0">
        <LibraryWorkspaceMobileNav
          librarySection={librarySection}
          onSelectSection={handleSidebarSectionSelect}
        />
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
          <div>
            <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-500"}`}>
              Workspace
            </div>
            <h1 className={`mt-1 text-4xl font-extrabold tracking-tight ${isDarkLibraryTheme ? "text-slate-100" : "text-gray-900"}`}>
              {sectionHeader.title}
            </h1>
            <p className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              {sectionHeader.subtitle}
            </p>
            <p className={`mt-1 text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-600"}`}>
              {sectionHeader.summary}
            </p>

            {shouldShowLibraryHomeContent && (
              <>
                <div
                  data-testid="library-streak-badge"
                  className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
                    streakCount > 0
                      ? (isDarkLibraryTheme
                          ? "border-amber-800/70 bg-amber-900/35 text-amber-200"
                          : "border-orange-200 bg-orange-50 text-orange-700")
                      : (isDarkLibraryTheme
                          ? "border-slate-700 bg-slate-800 text-slate-400"
                          : "border-gray-200 bg-white text-gray-500")
                  }`}
                  title={streakCount > 0 && !readToday ? 'Read today to keep your streak alive.' : 'Daily reading streak'}
                >
                  <Flame
                    size={14}
                    className={
                      streakCount > 0
                        ? (isDarkLibraryTheme ? "text-amber-300" : "text-orange-500")
                        : (isDarkLibraryTheme ? "text-slate-500" : "text-gray-400")
                    }
                  />
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
                          ? (isDarkLibraryTheme
                              ? "border-blue-700 bg-blue-950/45 text-blue-200"
                              : "border-blue-200 bg-blue-50 text-blue-700")
                          : (isDarkLibraryTheme
                              ? "border-slate-700 bg-slate-800 text-slate-300 hover:border-blue-600 hover:text-blue-300"
                              : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700")
                      }`}
                      title={`Show ${stat.label.toLowerCase()} books`}
                    >
                      <span>{stat.label}</span>
                      <span
                        data-testid={`library-quick-filter-${stat.key}-count`}
                        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
                          isQuickActive
                            ? (isDarkLibraryTheme ? "bg-blue-900/70 text-blue-200" : "bg-blue-100 text-blue-700")
                            : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
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
          </div>

          {!isAccountSection && (
          <div className="relative flex w-full flex-wrap items-center gap-3 md:w-auto md:justify-end" ref={notificationsMenuRef}>
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 ${
                isDarkLibraryTheme
                  ? "border-slate-700 bg-slate-900/50 shadow-[0_10px_22px_rgba(2,8,23,0.35)]"
                  : "border-gray-200 bg-white/90"
              }`}
            >
            <button
              type="button"
              data-testid="library-notifications-toggle"
              onClick={() => {
                setActiveNotificationMenuId("");
                setIsNotificationsOpen((open) => !open);
              }}
              className={`relative inline-flex h-12 w-12 items-center justify-center rounded-full border transition ${
                isDarkLibraryTheme
                  ? "border-slate-500 bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
              }`}
              title="Notifications"
              aria-label="Open notifications"
              aria-expanded={isNotificationsOpen}
            >
              <Bell size={17} />
              {notificationCount > 0 && (
                <span
                  data-testid="library-notifications-badge"
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
                >
                  {notificationCount}
                </span>
              )}
            </button>

            <button
              type="button"
              data-testid="library-theme-toggle"
              onClick={() => setLibraryTheme((current) => (current === "dark" ? "light" : "dark"))}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full border transition ${
                isDarkLibraryTheme
                  ? "border-slate-500 bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
              }`}
              title={isDarkLibraryTheme ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={isDarkLibraryTheme ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDarkLibraryTheme ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <button
              type="button"
              data-testid="library-profile-avatar"
              onClick={() => {
                setIsNotificationsOpen(false);
                setIsProfileMenuOpen((open) => !open);
              }}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-full border text-sm font-bold transition ${
                isDarkLibraryTheme
                  ? "border-slate-500 bg-slate-800 text-slate-100 hover:bg-slate-700"
                  : "border-gray-200 bg-white text-[#1A1A2E] hover:border-blue-200 hover:text-blue-700"
              }`}
              title={profileLabel}
              aria-label="Open profile menu"
              aria-expanded={isProfileMenuOpen}
            >
              {profileAvatarUrl ? (
                <img
                  src={profileAvatarUrl}
                  alt={profileLabel}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                profileInitials
              )}
            </button>
            </div>

            {isProfileMenuOpen && (
              <div
                data-testid="library-profile-menu"
                className={`absolute right-0 top-[56px] z-30 w-[230px] max-w-[calc(100vw-2rem)] rounded-2xl border p-2 shadow-xl ${
                  isDarkLibraryTheme ? "border-slate-700 bg-slate-900 text-slate-100" : "border-gray-200 bg-white text-[#1A1A2E]"
                }`}
              >
                {profileMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-testid={`library-profile-menu-item-${item.key}`}
                      onClick={() => handleProfileMenuAction(item.key)}
                      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                        isDarkLibraryTheme
                          ? "text-slate-100 hover:bg-slate-800"
                          : "text-[#1A1A2E] hover:bg-gray-50"
                      }`}
                    >
                      <Icon size={15} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {isNotificationsOpen && (
              <div
                data-testid="library-notifications-panel"
                className={`absolute right-0 top-[56px] z-30 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl border p-3 shadow-xl ${
                  isDarkLibraryTheme ? "border-slate-700 bg-slate-900 text-slate-100" : "border-gray-200 bg-white text-gray-900"
                }`}
              >
                <div className={`flex items-center justify-between gap-3 border-b pb-2 ${
                  isDarkLibraryTheme ? "border-slate-700" : "border-gray-200"
                }`}>
                  <div>
                    <div className="text-sm font-semibold">Notifications</div>
                    <div className={`text-[11px] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                      {visibleNotifications.length} total
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                      {notificationCount} unread
                    </div>
                    {visibleNotifications.length > 0 && notificationCount > 0 && (
                      <button
                        type="button"
                        data-testid="notifications-mark-all-read"
                        onClick={handleMarkAllNotificationsRead}
                        className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                          isDarkLibraryTheme
                            ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="notification-tab-all"
                    onClick={() => setNotificationView("all")}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      notificationView === "all"
                        ? (isDarkLibraryTheme ? "bg-blue-900/50 text-blue-200" : "bg-blue-100 text-blue-700")
                        : (isDarkLibraryTheme ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    data-testid="notification-tab-unread"
                    onClick={() => setNotificationView("unread")}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      notificationView === "unread"
                        ? (isDarkLibraryTheme ? "bg-blue-900/50 text-blue-200" : "bg-blue-100 text-blue-700")
                        : (isDarkLibraryTheme ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200")
                    }`}
                  >
                    Unread
                  </button>
                </div>
                <div className="mt-2 max-h-[360px] overflow-y-auto space-y-2.5 pr-1">
                  {filteredNotifications.length === 0 ? (
                    <div className={`rounded-xl border p-3 text-sm ${isDarkLibraryTheme ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-500"}`}>
                      {notificationView === "unread" ? "No unread notifications." : "No notifications for now."}
                    </div>
                  ) : (
                    filteredNotifications.map((item) => {
                      const kindConfig = notificationKindConfig[item.kind] || {
                        label: "Notice",
                        Icon: Bell,
                        tone: "blue"
                      };
                      const KindIcon = kindConfig.Icon;
                      const toneClass = notificationToneClasses[kindConfig.tone] || notificationToneClasses.blue;
                      const itemTestId = item.kind === "finish-soon" ? "notification-item-finish-soon" : `notification-item-${item.kind}`;
                      const relatedBook = item.bookId ? booksById.get(item.bookId) : null;
                      const coverSrc = item.actorAvatar || relatedBook?.cover || "";
                      return (
                      <div
                        key={item.id}
                        data-testid={itemTestId}
                        className={`relative cursor-pointer rounded-xl border p-3 transition ${
                          item.isRead
                            ? (isDarkLibraryTheme
                                ? "border-slate-700 bg-slate-900/60 hover:border-blue-600/70"
                                : "border-gray-200 bg-gray-50/50 hover:border-blue-200")
                            : (isDarkLibraryTheme
                                ? "border-blue-700 bg-blue-950/30 hover:border-blue-500"
                                : "border-blue-200 bg-blue-50/70 hover:border-blue-300")
                        }`}
                        onClick={() => handleNotificationCardClick(item)}
                      >
                        <div className="flex items-start gap-3">
                          {coverSrc ? (
                            <span
                              data-testid="notification-book-cover-avatar"
                              className={`mt-0.5 inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-full border ${
                                isDarkLibraryTheme ? "border-slate-600" : "border-gray-200"
                              }`}
                            >
                              <img src={coverSrc} alt={item.title || "Notification"} className="h-full w-full object-cover" />
                            </span>
                          ) : (
                            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toneClass}`}>
                              <KindIcon size={14} />
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-semibold leading-tight">{item.title}</div>
                                <div className="mt-1 flex items-center gap-2">
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneClass}`}>
                                    {kindConfig.label}
                                  </span>
                                  <span className={`text-[11px] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                                    {formatNotificationTimeAgo(item.firstSeenAt)}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                data-testid="notification-menu-toggle"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setActiveNotificationMenuId((current) => (current === item.id ? "" : item.id));
                                }}
                                className={`shrink-0 rounded-full p-1.5 ${
                                  isDarkLibraryTheme
                                    ? "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                }`}
                                aria-label="Open notification actions"
                              >
                                <MoreHorizontal size={15} />
                              </button>
                            </div>
                            <div className={`mt-2 text-xs leading-relaxed ${isDarkLibraryTheme ? "text-slate-300" : "text-gray-700"}`}>
                              {item.message}
                            </div>
                          </div>
                        </div>
                        {activeNotificationMenuId === item.id && (
                          <div
                            data-testid="notification-actions-menu"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            className={`absolute right-3 top-9 z-10 w-[170px] rounded-xl border p-1.5 shadow-lg ${
                              isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"
                            }`}
                          >
                            <button
                              type="button"
                              data-testid="notification-action-open"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleOpenNotificationTarget(item);
                              }}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold ${
                                isDarkLibraryTheme ? "text-slate-200 hover:bg-slate-800" : "text-[#1A1A2E] hover:bg-gray-50"
                              }`}
                            >
                              <BookIcon size={13} />
                              <span>{item.bookId ? "Open in Reader" : "Open"}</span>
                            </button>
                            <button
                              type="button"
                              data-testid="notification-action-mark"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleNotificationReadState(item.id, !item.isRead);
                                setActiveNotificationMenuId("");
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-semibold ${
                                isDarkLibraryTheme ? "text-slate-200 hover:bg-slate-800" : "text-[#1A1A2E] hover:bg-gray-50"
                              }`}
                            >
                              <span className="inline-flex items-center gap-2">
                                <Mail size={13} />
                                {item.isRead ? "Mark as unread" : "Mark as read"}
                              </span>
                            </button>
                            <button
                              type="button"
                              data-testid="notification-action-archive"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleNotificationArchive(item.id);
                              }}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold ${
                                isDarkLibraryTheme ? "text-slate-200 hover:bg-slate-800" : "text-[#1A1A2E] hover:bg-gray-50"
                              }`}
                            >
                              <Archive size={13} />
                              <span>Archive</span>
                            </button>
                            <button
                              type="button"
                              data-testid="notification-action-delete"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleNotificationDelete(item.id);
                              }}
                              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold ${
                                isDarkLibraryTheme ? "text-rose-300 hover:bg-rose-900/20" : "text-rose-600 hover:bg-rose-50"
                              }`}
                            >
                              <Trash2 size={13} />
                              <span>Delete</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )})
                  )}
                </div>
              </div>
            )}
          </div>
          )}
        </header>

        {isAccountSection && (
          <LibraryAccountSection
            isDarkLibraryTheme={isDarkLibraryTheme}
            accountProfile={accountProfile}
            accountSaveMessage={accountSaveMessage}
            isUploadingAvatar={isUploadingAvatar}
            onFieldChange={handleAccountFieldChange}
            onAvatarUpload={handleAccountAvatarUpload}
            onSave={handleSaveAccountProfile}
          />
        )}

        {isStatisticsSection && (
          <LibraryReadingStatisticsSection
            isDarkLibraryTheme={isDarkLibraryTheme}
            books={activeBooks}
            buildReaderPath={buildReaderPath}
            onOpenBook={handleOpenBook}
          />
        )}

        {!isAccountSection && !isStatisticsSection && (
        <>
        {shouldShowContinueReading && (
          <section
            className={`mb-8 rounded-3xl border p-4 sm:p-5 ${
              isDarkLibraryTheme ? "border-slate-700 bg-transparent" : "library-zone-continue-light"
            }`}
            data-testid="continue-reading-rail"
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Continue Reading</h2>
              </div>
              <button
                type="button"
                onClick={() => setStatusFilter("in-progress")}
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                View in-progress
              </button>
            </div>

            <div className="grid [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))] gap-x-4 gap-y-10 pb-3 pr-2">
              {continueReadingBooks.map((book) => {
                const progress = Math.max(0, Math.min(100, normalizeNumber(book.progress)));
                const estimatedRemainingSeconds = Number.isFinite(book?.__estimatedRemainingSeconds)
                  ? book.__estimatedRemainingSeconds
                  : getEstimatedRemainingSeconds(book);
                const estimatedTimeLeft = formatEstimatedTimeLeft(estimatedRemainingSeconds);
                const timeLeftTone = getContinueReadingTimeLeftTone(estimatedRemainingSeconds);
                return (
                  <div key={`continue-${book.id}`} className="pl-[88px] sm:pl-[100px] py-1">
                    <Link
                      id={`continue-reading-${book.id}`}
                      to={buildReaderPath(book.id)}
                      data-testid="continue-reading-card"
                      onClick={() => handleOpenBook(book.id)}
                      className={`group workspace-interactive-card relative block w-full min-h-[190px] sm:min-h-[196px] rounded-[24px] ${
                        isDarkLibraryTheme ? "workspace-interactive-card-dark" : "workspace-interactive-card-light"
                      } ${
                        !isDarkLibraryTheme ? "shadow-[0_14px_34px_rgba(15,23,42,0.10)]" : ""
                      } ${
                        notificationFocusedBookId === book.id
                          ? (isDarkLibraryTheme
                              ? "ring-2 ring-blue-400 border-blue-400 bg-blue-950/30"
                              : "ring-2 ring-blue-300 border-blue-300 bg-blue-50/60")
                          : ""
                      }`}
                    >
                      <div
                        className={`absolute -left-[88px] sm:-left-[100px] top-1/2 h-[186px] w-[124px] sm:h-[206px] sm:w-[138px] -translate-y-1/2 overflow-hidden rounded-[16px] ${
                          isDarkLibraryTheme
                            ? "bg-slate-700 shadow-[0_14px_26px_rgba(2,8,23,0.45)]"
                            : "bg-gray-200 shadow-[0_14px_26px_rgba(15,23,42,0.18)]"
                        }`}
                      >
                        {book.cover ? (
                          <img src={book.cover} alt={book.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className={`h-full w-full flex items-center justify-center ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-300"}`}>
                            <BookIcon size={18} />
                          </div>
                        )}
                      </div>

                      <div className="ml-auto w-[75%] min-h-[178px] px-5 sm:px-6 py-5 sm:py-6 flex flex-col justify-between">
                        <div className="flex items-start justify-between gap-2">
                          <div className={`text-[14px] sm:text-[15px] font-normal leading-tight ${isDarkLibraryTheme ? "text-slate-400" : "text-[#666666]"}`}>
                            {book.author}
                          </div>
                          {book.isFavorite ? (
                            <span
                              title="Favorite"
                              aria-label="Favorite book"
                              data-testid="continue-reading-favorite-badge"
                              className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                isDarkLibraryTheme
                                  ? "border-rose-900/50 bg-rose-900/30 text-rose-300"
                                  : "border-rose-200 bg-rose-50 text-rose-500"
                              }`}
                            >
                              <Heart size={13} className="fill-current" />
                            </span>
                          ) : null}
                        </div>
                        <div className={`mt-1.5 text-[22px] sm:text-[24px] font-semibold leading-[1.12] tracking-tight line-clamp-2 ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                          {book.title}
                        </div>
                        <div className="mt-3 inline-flex items-center gap-2 text-[#4CAF50]">
                          <span className="relative inline-flex h-8 w-8 items-center justify-center" data-testid="continue-reading-ring">
                            <span
                              className="absolute inset-0 rounded-full"
                              style={{ background: `conic-gradient(#4CAF50 ${progress * 3.6}deg, rgba(148, 163, 184, 0.28) 0deg)` }}
                            />
                            <span className={`absolute inset-[2px] rounded-full ${isDarkLibraryTheme ? "bg-slate-800" : "bg-white"}`} />
                          </span>
                          <span className="text-[16px] sm:text-[17px] font-medium leading-none">Continue</span>
                        </div>
                        {estimatedTimeLeft && (
                          <div
                            data-testid="continue-reading-time-left"
                            data-tone={timeLeftTone.tone}
                            className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium ${timeLeftTone.className}`}
                          >
                            <Clock size={12} />
                            <span>{estimatedTimeLeft}</span>
                          </div>
                        )}
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {shouldShowLibraryHomeContent && (
          <LibraryToolbarSection
            isDarkLibraryTheme={isDarkLibraryTheme}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search library (title, author, notes, highlights, bookmarks)..."
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
            densityMode={densityMode}
            onDensityModeChange={setDensityMode}
            isStatusFilterActive={statusFilter !== "all"}
            isCollectionFilterActive={collectionFilter !== "all"}
            isSortActive={sortBy !== "last-read-desc"}
            activeFilterCount={activeFilterCount}
            onClearSearch={() => setSearchQuery("")}
            onClearStatusFilter={() => setStatusFilter("all")}
            onClearCollectionFilter={() => setCollectionFilter("all")}
            onClearSort={() => setSortBy("last-read-desc")}
            canShowResetFilters={canShowResetFilters}
            onResetFilters={resetLibraryFilters}
          />
        )}
        {shouldShowLibraryHomeContent && sortedBooks.length > 0 && (
          isLibrarySelectionMode ? (
            <div
              data-testid="library-bulk-actions"
              className={`mb-6 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 ${
                isDarkLibraryTheme ? "border-slate-700 bg-slate-900/40" : "library-zone-catalog-light"
              }`}
            >
              <button
                type="button"
                data-testid="library-select-all"
                onClick={handleToggleSelectAllLibrary}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isDarkLibraryTheme
                    ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-blue-500 hover:text-blue-300"
                    : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
                }`}
              >
                {allVisibleLibrarySelected ? "Unselect all" : "Select all"}
              </button>
              <span
                data-testid="library-selected-count"
                className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}
              >
                {librarySelectedCount} selected
              </span>
              <button
                type="button"
                data-testid="library-bulk-to-read"
                onClick={handleBulkMarkToRead}
                disabled={!librarySelectedCount}
                className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 enabled:hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add to To Read
              </button>
              <button
                type="button"
                data-testid="library-bulk-favorite"
                onClick={handleBulkFavorite}
                disabled={!librarySelectedCount}
                className="inline-flex items-center rounded-full border border-pink-200 bg-pink-50 px-3 py-1.5 text-xs font-semibold text-pink-700 enabled:hover:bg-pink-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Favorite selected
              </button>
              <button
                type="button"
                data-testid="library-bulk-trash"
                onClick={handleBulkMoveToTrash}
                disabled={!librarySelectedCount}
                className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 enabled:hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Move to Trash
              </button>
              <button
                type="button"
                data-testid="library-clear-selection"
                onClick={handleClearLibrarySelection}
                disabled={!librarySelectedCount}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors enabled:hover:border-blue-200 enabled:hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 ${
                  isDarkLibraryTheme
                    ? "border-slate-700 bg-slate-800 text-slate-200 enabled:hover:border-blue-500 enabled:hover:text-blue-300"
                    : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                Clear selection
              </button>
              <button
                type="button"
                data-testid="library-exit-select-mode"
                onClick={handleExitLibrarySelectionMode}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isDarkLibraryTheme
                    ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-blue-500 hover:text-blue-300"
                    : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
                }`}
              >
                Done
              </button>
            </div>
          ) : (
            <div
              data-testid="library-bulk-select-entry"
              className="mb-6 flex items-center gap-2"
            >
              <button
                type="button"
                data-testid="library-enter-select-mode"
                onClick={handleEnterLibrarySelectionMode}
                className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isDarkLibraryTheme
                    ? "border-slate-700 bg-slate-800 text-slate-200 hover:border-blue-500 hover:text-blue-300"
                    : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
                }`}
              >
                Select
              </button>
            </div>
          )
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
        {isNotesSection && !isTrashSection && (
          <LibraryNotesCenterPanel
            isDarkLibraryTheme={isDarkLibraryTheme}
            notesCenterFilteredEntries={notesCenterDisplayEntries}
            notesCenterPairs={notesCenterPairs}
            searchQuery={notesSearchQuery}
            onSearchChange={setNotesSearchQuery}
            sortBy={notesCenterSortBy}
            onSortChange={setNotesCenterSortBy}
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

        {isHighlightsSection && !isTrashSection && (
          <LibraryHighlightsCenterPanel
            isDarkLibraryTheme={isDarkLibraryTheme}
            highlightsCenterFilteredEntries={highlightsCenterDisplayEntries}
            highlightsCenterPairs={highlightsCenterPairs}
            searchQuery={highlightsSearchQuery}
            onSearchChange={setHighlightsSearchQuery}
            sortBy={highlightsCenterSortBy}
            onSortChange={setHighlightsCenterSortBy}
            contentPanelHeightClass={CONTENT_PANEL_HEIGHT_CLASS}
            contentScrollHeightClass={CONTENT_SCROLL_HEIGHT_CLASS}
            renderBookCard={renderGlobalSearchBookCard}
            onClose={handleToggleHighlightsCenter}
            onOpenReader={handleOpenHighlightInReader}
          />
        )}
        {isInboxSection && !isTrashSection && (
          <LibraryShareInboxPanel
            onAccepted={async () => {
              await loadLibrary();
              await refreshShareInboxCount();
            }}
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
          <div
            className={`grid animate-in fade-in duration-500 rounded-3xl border p-4 ${
              densityMode === "compact"
                ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4"
                : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8"
            } ${
              isDarkLibraryTheme ? "border-slate-700 bg-slate-900/25" : "library-zone-catalog-light"
            }`}
            data-testid="library-books-grid"
            data-density={densityMode}
          >
            {renderedBooks.map((book) => {
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
                  className={`group workspace-interactive-card rounded-2xl overflow-hidden flex flex-col relative ${
                    isDarkLibraryTheme ? "workspace-interactive-card-dark" : "workspace-interactive-card-light"
                  } ${
                    isRecent ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white shadow-[0_0_0_3px_rgba(251,191,36,0.2)]" : ""
                  }`}
                  style={VIRTUAL_GRID_CARD_STYLE}
                >
                  <div className={`${densityMode === "compact" ? "aspect-[5/6]" : "aspect-[3/4]"} ${isDarkLibraryTheme ? "bg-slate-800" : "bg-gray-200"} overflow-hidden relative`}>
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-4 text-center">
                        <BookIcon size={40} className="mb-2 opacity-20" />
                        <span className="text-xs font-medium uppercase tracking-widest">{book.title}</span>
                      </div>
                    )}

                    <div
                      className={`absolute top-4 right-4 z-10 flex translate-y-1 flex-col gap-2 rounded-2xl p-1 opacity-0 backdrop-blur-sm transition-all group-hover:translate-y-0 group-hover:opacity-100 ${
                        isDarkLibraryTheme ? "bg-slate-900/45" : "bg-white/70"
                      }`}
                    >
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
                          {isCollabMode && (
                            <button
                              type="button"
                              onClick={(e) => openShareDialog(e, book)}
                              className="p-2 bg-white text-gray-400 hover:text-blue-600 rounded-xl shadow-md transition-transform active:scale-95"
                              title="Share book"
                            >
                              <Send size={16} />
                            </button>
                          )}
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
                    {!inTrash && isLibrarySelectionMode && (
                      <label
                        data-testid={`library-book-select-${book.id}`}
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
                          data-testid={`library-book-select-input-${book.id}`}
                          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                          checked={selectedLibraryBookIds.includes(book.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onChange={() => handleToggleLibrarySelection(book.id)}
                        />
                      </label>
                    )}
                    
                    {densityMode !== "compact" ? (
                      <div
                        className={`absolute bottom-3 right-3 text-xs font-bold px-2 py-1 rounded-lg backdrop-blur-md ${
                          isDarkLibraryTheme
                            ? "bg-slate-900/65 text-slate-100 border border-slate-600/60"
                            : "bg-black/60 text-white"
                        }`}
                      >
                        {book.progress}%
                      </div>
                    ) : null}

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

                  <div className={`${densityMode === "compact" ? "p-3" : "p-5"} flex-1 flex flex-col`}>
                    <h3 className={`font-semibold leading-[1.12] mb-2 line-clamp-2 transition-colors ${
                      isDarkLibraryTheme ? "text-slate-100 group-hover:text-blue-300" : "text-[#1A1A2E] group-hover:text-blue-600"
                    } ${
                      densityMode === "compact" ? "text-[17px]" : "text-[22px]"
                    }`}>
                      {book.title}
                    </h3>
                    
                    <div className={`flex items-center gap-2 mb-1 ${isDarkLibraryTheme ? "text-slate-300" : "text-[#666666]"} ${densityMode === "compact" ? "text-[14px]" : "text-[15px]"}`}>
                      <User size={14} />
                      <span className="truncate">{book.author}</span>
                    </div>

                    {densityMode !== "compact" ? (
                      <>
                        {renderMetadataBadges(book)}
                        {renderCollectionChips(book)}
                        {renderReadingStateBadge(book, "mt-1.5")}
                        {renderSessionTimeline(book)}
                        <div className="mt-1.5 min-h-[26px] flex flex-wrap items-center gap-1.5">
                          {renderGenreChip(book)}
                          {renderToReadTag(book)}
                        </div>
                        <div className="mt-auto pt-4 text-[11px] text-gray-400 font-medium text-right">
                          <span>{inTrash ? formatDeletedAt(book.deletedAt) : formatLastRead(book.lastRead)}</span>
                        </div>
                      </>
                    ) : null}

                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div
            className={`space-y-4 animate-in fade-in duration-500 rounded-3xl border p-4 ${
              isDarkLibraryTheme ? "border-slate-700 bg-slate-900/25" : "library-zone-catalog-light"
            }`}
            data-testid="library-books-list"
            data-density="comfortable"
          >
            {renderedBooks.map((book) => {
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
                  className={`group workspace-interactive-card rounded-2xl overflow-hidden flex ${
                    isDarkLibraryTheme ? "workspace-interactive-card-dark" : "workspace-interactive-card-light"
                  } ${
                    isRecent ? "ring-2 ring-amber-400 ring-offset-2 ring-offset-white shadow-[0_0_0_3px_rgba(251,191,36,0.2)]" : ""
                  }`}
                  style={VIRTUAL_LIST_CARD_STYLE}
                >
                  <div className={`w-24 sm:w-28 md:w-32 ${isDarkLibraryTheme ? "bg-slate-800" : "bg-gray-200"} overflow-hidden relative shrink-0`}>
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-3 text-center">
                        <BookIcon size={24} className="mb-1 opacity-20" />
                        <span className="text-[10px] font-medium uppercase tracking-widest line-clamp-2">{book.title}</span>
                      </div>
                    )}
                    <div
                      className={`absolute bottom-2 right-2 text-[10px] font-bold px-2 py-1 rounded-lg ${
                        isDarkLibraryTheme
                          ? "bg-slate-900/65 text-slate-100 border border-slate-600/60"
                          : "bg-black/60 text-white"
                      }`}
                    >
                      {book.progress}%
                    </div>
                  </div>

                  <div className="flex-1 p-4 flex flex-col md:flex-row md:items-center gap-4 min-w-0">
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-semibold text-[22px] leading-[1.12] line-clamp-1 transition-colors ${
                        isDarkLibraryTheme ? "text-slate-100 group-hover:text-blue-300" : "text-[#1A1A2E] group-hover:text-blue-600"
                      }`}>
                        {book.title}
                      </h3>

                      <div className={`mt-1 flex items-center gap-2 text-[15px] ${isDarkLibraryTheme ? "text-slate-300" : "text-[#666666]"}`}>
                        <User size={14} />
                        <span className="truncate">{book.author}</span>
                      </div>

                      {renderMetadataBadges(book)}
                      {renderCollectionChips(book)}

                      {renderReadingStateBadge(book, "mt-1.5")}
                      {renderSessionTimeline(book)}
                      <div className="mt-1.5 min-h-[26px] flex flex-wrap items-center gap-1.5">
                        {renderGenreChip(book)}
                        {renderToReadTag(book)}
                      </div>

                      <div className="mt-2 text-[11px] text-gray-400">
                        <span>{inTrash ? formatDeletedAt(book.deletedAt) : formatLastRead(book.lastRead)}</span>
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
                    {!inTrash && isLibrarySelectionMode && (
                        <label
                          data-testid={`library-book-select-${book.id}`}
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
                            data-testid={`library-book-select-input-${book.id}`}
                            className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                            checked={selectedLibraryBookIds.includes(book.id)}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            onChange={() => handleToggleLibrarySelection(book.id)}
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
                            {isCollabMode && (
                              <button
                                type="button"
                                onClick={(e) => openShareDialog(e, book)}
                                className="p-2 bg-white border border-gray-200 text-gray-400 hover:text-blue-600 rounded-xl shadow-sm transition-transform active:scale-95"
                                title="Share book"
                              >
                                <Send size={16} />
                              </button>
                            )}
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
        {(shouldShowLibraryHomeContent || isTrashSection) &&
          (!showGlobalSearchBooksColumn || isTrashSection) &&
          (isTrashSection ? sortedTrashBooks.length : sortedBooks.length) > 0 &&
          showRenderSentinel && (
            <div
              ref={loadMoreBooksRef}
              data-testid="library-load-more-sentinel"
              className="h-8 w-full"
            />
          )}
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
        {shareDialogBook && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30" onClick={closeShareDialog} />
            <div className="relative w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
              <h3 className="text-lg font-semibold text-gray-900">Share Book</h3>
              <p className="mt-1 text-sm text-gray-600">
                Share <span className="font-semibold text-gray-900">{shareDialogBook.title}</span> with another user.
              </p>
              <div className="mt-4 space-y-3">
                <input
                  type="email"
                  value={shareRecipientEmail}
                  onChange={(e) => setShareRecipientEmail(e.target.value)}
                  placeholder="Recipient email"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <textarea
                  value={shareMessage}
                  onChange={(e) => setShareMessage(e.target.value)}
                  placeholder="Message (optional)"
                  className="min-h-[90px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {shareError && <p className="text-xs text-rose-600">{shareError}</p>}
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeShareDialog}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleShareBook}
                  disabled={!shareRecipientEmail.trim() || isSharingBook}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {isSharingBook ? "Sharing..." : "Send share"}
                </button>
              </div>
            </div>
          </div>
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
        <FeedbackToast
          toast={feedbackToast}
          isDark={isDarkLibraryTheme}
          onDismiss={dismissFeedbackToast}
          testId="library-feedback-toast"
          actionTestId="library-feedback-action"
          className="fixed bottom-6 right-6 z-50"
        />
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
