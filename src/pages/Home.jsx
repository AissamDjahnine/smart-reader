import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addBook, getAllBooks, deleteBook, toggleFavorite, markBookStarted, backfillBookMetadata, moveBookToTrash, restoreBookFromTrash, purgeExpiredTrashBooks } from '../services/db'; 
import { Plus, Book as BookIcon, User, Calendar, Trash2, Clock, Search, Heart, Filter, ArrowUpDown, LayoutGrid, List, Flame, RotateCcw, ArrowLeft } from 'lucide-react';

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

export default function Home() {
  const navigate = useNavigate();
  const [books, setBooks] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  
  // Search, filter & sort states
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [sortBy, setSortBy] = useState("last-read-desc");
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === "undefined") return "grid";
    return window.localStorage.getItem("library-view-mode") === "list" ? "list" : "grid";
  });

  useEffect(() => { loadLibrary(); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("library-view-mode", viewMode);
  }, [viewMode]);

  const loadLibrary = async () => {
    await purgeExpiredTrashBooks(TRASH_RETENTION_DAYS);
    const storedBooks = await getAllBooks();
    setBooks(storedBooks);

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

  const buildReaderPath = (id, panel = '') => {
    const params = new URLSearchParams({ id });
    if (panel) params.set('panel', panel);
    return `/read?${params.toString()}`;
  };

  const handleQuickOpen = (e, id, panel = '') => {
    e.preventDefault();
    e.stopPropagation();
    handleOpenBook(id);
    navigate(buildReaderPath(id, panel));
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

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file && file.type === "application/epub+zip") {
      setIsUploading(true);
      await addBook(file);
      await loadLibrary();
      setIsUploading(false);
    }
  };

  const filterOptions = [
    { value: "all", label: "All books" },
    { value: "favorites", label: "Favorites" },
    { value: "in-progress", label: "In progress" },
    { value: "finished", label: "Finished" },
    { value: "has-highlights", label: "Has highlights" },
    { value: "has-notes", label: "Has notes" },
    { value: "trash", label: "Trash" }
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

  const getReadingStreak = (libraryBooks) => {
    const dayKeys = new Set(
      libraryBooks
        .filter((book) => {
          if (book.isDeleted) return false;
          const progress = normalizeNumber(book.progress);
          return startedBookIds.has(book.id) || Boolean(book.hasStarted) || Boolean(book.lastLocation) || progress > 0 || normalizeNumber(book.readingTime) > 0;
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
  const isTrashView = activeFilter === "trash";

  const sortedBooks = [...books]
    .filter((book) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = !query
        || normalizeString(book.title).includes(query)
        || normalizeString(book.author).includes(query);

      const highlightCount = Array.isArray(book.highlights) ? book.highlights.length : 0;
      const noteCount = Array.isArray(book.highlights)
        ? book.highlights.filter((h) => (h?.note || "").trim()).length
        : 0;
      const progress = normalizeNumber(book.progress);
      const inTrash = Boolean(book.isDeleted);

      const matchesFilter =
        activeFilter === "trash" ? inTrash
        : inTrash ? false
        : activeFilter === "all" ? true
        : activeFilter === "favorites" ? !!book.isFavorite
        : activeFilter === "in-progress" ? progress > 0 && progress < 100
        : activeFilter === "finished" ? progress >= 100
        : activeFilter === "has-highlights" ? highlightCount > 0
        : activeFilter === "has-notes" ? noteCount > 0
        : true;

      return matchesSearch && matchesFilter;
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

  const continueReadingBooks = [...books]
    .filter((book) => {
      if (book.isDeleted) return false;
      const progress = normalizeNumber(book.progress);
      const hasStarted = startedBookIds.has(book.id) || Boolean(book.hasStarted) || Boolean(book.lastLocation) || progress > 0 || normalizeNumber(book.readingTime) > 0;
      return hasStarted && progress < 100;
    })
    .sort((left, right) => normalizeTime(right.lastRead) - normalizeTime(left.lastRead))
    .slice(0, 8);

  const showContinueReading = activeFilter === "all" && !searchQuery.trim() && continueReadingBooks.length > 0;
  const { streakCount, readToday } = getReadingStreak(books);

  const formatTime = (totalSeconds) => {
    if (!totalSeconds || totalSeconds < 60) return "Just started";
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
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

  const getFilterLabel = () => {
    if (activeFilter === "trash") return "Trash";
    return filterOptions.find((f) => f.value === activeFilter)?.label || "All books";
  };

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
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="trash-toggle-button"
              onClick={() => setActiveFilter((current) => (current === "trash" ? "all" : "trash"))}
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
                onClick={() => setActiveFilter("in-progress")}
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
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px_280px_120px] gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input 
              type="text"
              placeholder="Search by title or author..."
              data-testid="library-search"
              className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select
              data-testid="library-filter"
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm text-sm font-semibold text-gray-700"
            >
              {filterOptions.map((option) => (
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
              className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm text-sm font-semibold text-gray-700"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div
            className="flex items-center bg-white p-1 border border-gray-200 rounded-2xl shadow-sm"
            data-testid="library-view-toggle"
          >
            <button
              type="button"
              data-testid="library-view-grid"
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
              className={`flex-1 py-2 rounded-xl transition-colors flex items-center justify-center ${
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
              className={`flex-1 py-2 rounded-xl transition-colors flex items-center justify-center ${
                viewMode === "list" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>
        <div className="mb-8 text-xs text-gray-500 flex items-center gap-2">
          <span className="font-semibold text-gray-600">Active:</span>
          <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200">
            {getFilterLabel()}
          </span>
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
              onClick={() => setActiveFilter("all")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              <ArrowLeft size={14} />
              <span>Back to Library</span>
            </button>
          </div>
        )}

        {sortedBooks.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-gray-200 rounded-3xl p-20 text-center shadow-sm">
            <BookIcon size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 text-lg">
              {isTrashView ? "Trash is empty." : "No books found matching your criteria."}
            </p>
            {(searchQuery || activeFilter !== "all") && (
              <button 
                onClick={() => { setSearchQuery(""); setActiveFilter("all"); }}
                className="mt-4 text-blue-600 font-bold hover:underline"
              >
                Clear all filters
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

                    <div className="flex items-center gap-2 text-blue-500 text-xs mt-2 font-semibold">
                      <Clock size={12} />
                      <span>{formatTime(book.readingTime)}</span>
                    </div>
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

                      <div className="mt-2 text-xs text-blue-500 font-semibold flex items-center gap-2">
                        <Clock size={12} />
                        <span>{formatTime(book.readingTime)}</span>
                      </div>
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
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
