import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getBook, updateBookProgress, saveHighlight, deleteHighlight, updateReadingStats, saveChapterSummary, savePageSummary, saveBookmark, deleteBookmark, updateHighlightNote, updateBookReaderSettings, markBookStarted } from '../services/db';
import BookView from '../components/BookView';
import { summarizeChapter } from '../services/ai'; 
import FeedbackToast from '../components/FeedbackToast';

import { 
  Moon, Sun, BookOpen, Scroll, Type, 
  ChevronLeft, Menu, X,
  Search as SearchIcon, Sparkles, Wand2, User,
  BookOpenText, Highlighter, Languages, Bookmark, BookText
} from 'lucide-react';

const DEFAULT_TRANSLATE_PROVIDER = 'mymemory';
const TRANSLATE_PROVIDER = (import.meta.env.VITE_TRANSLATE_PROVIDER || DEFAULT_TRANSLATE_PROVIDER).toLowerCase();
const SUPPORTS_AUTO_DETECT = TRANSLATE_PROVIDER.includes('libre');
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';
const LIBRE_ENDPOINT = import.meta.env.VITE_TRANSLATE_ENDPOINT || 'https://libretranslate.com/translate';
const TRANSLATE_API_KEY = import.meta.env.VITE_TRANSLATE_API_KEY || '';
const TRANSLATE_EMAIL = import.meta.env.VITE_TRANSLATE_EMAIL || '';
const DEFAULT_READER_SETTINGS = {
  fontSize: 100,
  theme: 'light',
  flow: 'paginated',
  fontFamily: 'publisher'
};
const READER_SEARCH_HISTORY_KEY = 'reader-search-history-v1';
const READER_ANNOTATION_HISTORY_KEY = 'reader-annotation-search-history-v1';
const MAX_RECENT_QUERIES = 8;

const parseStoredQueryHistory = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    const cleaned = [];
    parsed.forEach((value) => {
      if (typeof value !== 'string') return;
      const term = value.trim();
      if (!term) return;
      const normalized = term.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      cleaned.push(term);
    });
    return cleaned.slice(0, MAX_RECENT_QUERIES);
  } catch (err) {
    console.error(err);
    return [];
  }
};

const appendRecentQuery = (history, query) => {
  const term = (query || '').trim();
  if (!term) return history;
  const normalized = term.toLowerCase();
  const next = [
    term,
    ...history.filter((item) => item.toLowerCase() !== normalized)
  ];
  return next.slice(0, MAX_RECENT_QUERIES);
};

function OwlIcon({ size = 18, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M4 18v-7a8 8 0 0 1 16 0v7" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <path d="m11 15 1 1 1-1" />
      <path d="m7 6-2 2" />
      <path d="m17 6 2 2" />
      <path d="M4 18h16" />
    </svg>
  );
}

export default function Reader() {
  const [searchParams] = useSearchParams();
  const bookId = searchParams.get('id');
  const panelParam = searchParams.get('panel');
  const cfiParam = searchParams.get('cfi');
  const searchTermParam = searchParams.get('q');
  const flashParam = searchParams.get('flash');
  const [book, setBook] = useState(null);
  const bookRef = useRef(null);
  
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showAnnotationSearchMenu, setShowAnnotationSearchMenu] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(false);
  const [showBookmarksPanel, setShowBookmarksPanel] = useState(false);
  const [isExportingHighlights, setIsExportingHighlights] = useState(false);
  const [isPageSummarizing, setIsPageSummarizing] = useState(false);
  const [isChapterSummarizing, setIsChapterSummarizing] = useState(false);
  const [isStoryRecapping, setIsStoryRecapping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isDefining, setIsDefining] = useState(false);
  const [toc, setToc] = useState([]);
  const [jumpTarget, setJumpTarget] = useState(null);
  const [rendition, setRendition] = useState(null);
  const [modalContext, setModalContext] = useState(null);

  // Track the last CFI that was summarised to avoid redundant API calls.
  const lastSummaryCfiRef = useRef(null);
  // Flag to indicate a background summary is in progress.  Prevents overlapping requests.
  const isBackgroundSummarizingRef = useRef(false);
  // Determines which type of analysis is being displayed in the AI modal ("page" or "story").
  const [modalMode, setModalMode] = useState(null);
  // Holds the contextual page explanation returned from the AI.
  const [pageSummary, setPageSummary] = useState("");
  // Holds the story-so-far recap returned from the AI.
  const [storyRecap, setStoryRecap] = useState("");
  const [pageError, setPageError] = useState("");
  const [storyError, setStoryError] = useState("");
  const [isRebuildingMemory, setIsRebuildingMemory] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState({ current: 0, total: 0 });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [recentSearchQueries, setRecentSearchQueries] = useState(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredQueryHistory(window.localStorage.getItem(READER_SEARCH_HISTORY_KEY));
  });
  const [annotationSearchQuery, setAnnotationSearchQuery] = useState('');
  const [annotationSearchResults, setAnnotationSearchResults] = useState([]);
  const [activeAnnotationSearchIndex, setActiveAnnotationSearchIndex] = useState(-1);
  const [recentAnnotationSearchQueries, setRecentAnnotationSearchQueries] = useState(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredQueryHistory(window.localStorage.getItem(READER_ANNOTATION_HISTORY_KEY));
  });
  const [focusedSearchCfi, setFocusedSearchCfi] = useState(null);
  const [searchHighlightCount, setSearchHighlightCount] = useState(0);
  const activeSearchCfi = activeSearchIndex >= 0 ? (searchResults[activeSearchIndex]?.cfi || null) : null;
  const searchInputRef = useRef(null);
  const searchResultsListRef = useRef(null);
  const annotationSearchInputRef = useRef(null);
  const annotationSearchResultsListRef = useRef(null);
  const searchTokenRef = useRef(0);
  const [showDictionary, setShowDictionary] = useState(false);
  const [dictionaryAnchor, setDictionaryAnchor] = useState(null);
  const [dictionaryQuery, setDictionaryQuery] = useState("");
  const [dictionaryEntry, setDictionaryEntry] = useState(null);
  const [dictionaryError, setDictionaryError] = useState("");
  const dictionaryTokenRef = useRef(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translationAnchor, setTranslationAnchor] = useState(null);
  const [translationQuery, setTranslationQuery] = useState("");
  const [translationResult, setTranslationResult] = useState("");
  const [translationError, setTranslationError] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState(SUPPORTS_AUTO_DETECT ? 'auto' : 'en');
  const [targetLanguage, setTargetLanguage] = useState('fr');
  const translationTokenRef = useRef(0);
  const lastActiveRef = useRef(Date.now());
  const isUpdatingStatsRef = useRef(false);
  const [highlights, setHighlights] = useState([]);
  const [selectedHighlights, setSelectedHighlights] = useState([]);
  const [editingHighlight, setEditingHighlight] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [pendingHighlightDelete, setPendingHighlightDelete] = useState(null);
  const [readerToast, setReaderToast] = useState(null);
  const pendingHighlightDeleteRef = useRef(null);
  const pendingHighlightDeleteTimerRef = useRef(null);
  const readerToastTimerRef = useRef(null);
  const [flashingHighlightCfi, setFlashingHighlightCfi] = useState(null);
  const [flashingHighlightPulse, setFlashingHighlightPulse] = useState(0);
  const highlightFlashTimersRef = useRef([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [selection, setSelection] = useState(null);
  const selectionRef = useRef(null);
  const [selectionMode, setSelectionMode] = useState('actions');
  const [returnSpot, setReturnSpot] = useState(null);
  const returnSpotTimerRef = useRef(null);
  const currentLocationCfiRef = useRef('');
  const [currentLocationCfi, setCurrentLocationCfi] = useState('');
  const [lastArrowScrollStep, setLastArrowScrollStep] = useState(0);
  const arrowScrollStateRef = useRef({ key: '', streak: 0, lastAt: 0 });
  const [footnotePreview, setFootnotePreview] = useState(null);
  const footnotePreviewPanelRef = useRef(null);
  const [postHighlightPrompt, setPostHighlightPrompt] = useState(null);
  const postHighlightPromptStateRef = useRef(null);
  const [postHighlightNoteDraft, setPostHighlightNoteDraft] = useState('');
  const [postHighlightNoteError, setPostHighlightNoteError] = useState('');
  const [isSavingPostHighlightNote, setIsSavingPostHighlightNote] = useState(false);
  const postHighlightPromptRef = useRef(null);
  const [progressPct, setProgressPct] = useState(0);
  const [currentHref, setCurrentHref] = useState('');
  const [legacyReaderSettings] = useState(() => {
    const saved = localStorage.getItem('reader-settings');
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.error(err);
      return null;
    }
  });
  const settingsHydratedRef = useRef(false);
  const [settings, setSettings] = useState(DEFAULT_READER_SETTINGS);
  const initialPanelAppliedRef = useRef(false);
  const initialJumpAppliedRef = useRef(false);
  const initialSearchAppliedRef = useRef(false);
  const initialFlashAppliedRef = useRef(false);
  const progressPersistRef = useRef({
    timer: null,
    lastWriteTs: 0,
    lastCfi: '',
    lastPct: -1,
    pending: null
  });

  const aiUnavailableMessage = "AI features are not available now.";

  const clearReturnSpotTimer = useCallback(() => {
    if (returnSpotTimerRef.current) {
      clearTimeout(returnSpotTimerRef.current);
      returnSpotTimerRef.current = null;
    }
  }, []);

  const closeReturnSpot = useCallback(() => {
    clearReturnSpotTimer();
    setReturnSpot(null);
  }, [clearReturnSpotTimer]);

  const queueReturnSpot = useCallback((cfi, source = 'jump') => {
    const normalized = (cfi || '').toString().replace(/\s+/g, '').trim();
    if (!normalized) return;
    clearReturnSpotTimer();
    setReturnSpot((prev) => (
      prev || {
        cfi: normalized,
        source
      }
    ));
    returnSpotTimerRef.current = setTimeout(() => {
      setReturnSpot(null);
      returnSpotTimerRef.current = null;
    }, 12000);
  }, [clearReturnSpotTimer]);

  const closeFootnotePreview = useCallback(() => {
    setFootnotePreview(null);
  }, []);

  const closePostHighlightPrompt = useCallback(() => {
    setPostHighlightPrompt(null);
    setPostHighlightNoteDraft('');
    setPostHighlightNoteError('');
    setIsSavingPostHighlightNote(false);
  }, []);

  const clearHighlightFlashTimers = useCallback(() => {
    highlightFlashTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    highlightFlashTimersRef.current = [];
  }, []);

  const triggerHighlightFlash = useCallback((cfiRange) => {
    if (!cfiRange) return;
    clearHighlightFlashTimers();
    // Single flash cycle: one emphasis pulse, then restore.
    setFlashingHighlightCfi(cfiRange);
    setFlashingHighlightPulse(1);

    const settleId = setTimeout(() => {
      setFlashingHighlightPulse(0);
    }, 160);
    highlightFlashTimersRef.current.push(settleId);

    const clearId = setTimeout(() => {
      setFlashingHighlightCfi(null);
    }, 220);
    highlightFlashTimersRef.current.push(clearId);
  }, [clearHighlightFlashTimers]);

  useEffect(() => () => {
    clearHighlightFlashTimers();
  }, [clearHighlightFlashTimers]);

  useEffect(() => () => {
    clearReturnSpotTimer();
  }, [clearReturnSpotTimer]);

  useEffect(() => () => {
    if (pendingHighlightDeleteTimerRef.current) {
      clearTimeout(pendingHighlightDeleteTimerRef.current);
      pendingHighlightDeleteTimerRef.current = null;
    }
    if (readerToastTimerRef.current) {
      clearTimeout(readerToastTimerRef.current);
      readerToastTimerRef.current = null;
    }
  }, []);

  const dismissReaderToast = useCallback(() => {
    if (readerToastTimerRef.current) {
      clearTimeout(readerToastTimerRef.current);
      readerToastTimerRef.current = null;
    }
    setReaderToast(null);
  }, []);

  const showReaderToast = useCallback((payload, options = {}) => {
    const { duration = 2800 } = options;
    if (!payload) return;
    if (readerToastTimerRef.current) {
      clearTimeout(readerToastTimerRef.current);
      readerToastTimerRef.current = null;
    }
    const nextToast = { id: `${Date.now()}-${Math.random()}`, ...payload };
    setReaderToast(nextToast);
    if (duration > 0) {
      readerToastTimerRef.current = setTimeout(() => {
        setReaderToast((current) => (current?.id === nextToast.id ? null : current));
        readerToastTimerRef.current = null;
      }, duration);
    }
  }, []);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    pendingHighlightDeleteRef.current = pendingHighlightDelete;
  }, [pendingHighlightDelete]);

  useEffect(() => {
    postHighlightPromptStateRef.current = postHighlightPrompt;
  }, [postHighlightPrompt]);

  const resolveAnchorFromRange = useCallback((range, fallbackDocument = null) => {
    if (!range) return null;
    const rects = range.getClientRects?.() || [];
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect?.();
    if (!rect) return null;
    let left = rect.left;
    let right = rect.right;
    let top = rect.top;
    let bottom = rect.bottom;
    let x = rect.right;
    let y = rect.bottom;
    const ownerDocument = fallbackDocument || range?.startContainer?.ownerDocument || null;
    const frameElement = ownerDocument?.defaultView?.frameElement || null;
    if (frameElement) {
      const frameRect = frameElement.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      left += frameRect.left;
      right += frameRect.left;
      top += frameRect.top;
      bottom += frameRect.top;
    }
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const isVisible = right >= 0 && left <= viewportWidth && bottom >= 0 && top <= viewportHeight;
    if (!isVisible) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }, []);

  const resolveAnchorFromCfi = useCallback((cfiRange) => {
    if (!rendition || !cfiRange) return null;

    const renderedContents = rendition.getContents?.() || [];
    for (const content of renderedContents) {
      try {
        const range = content?.range ? content.range(cfiRange) : null;
        const anchor = resolveAnchorFromRange(range, content?.document || null);
        if (anchor) return anchor;
      } catch (err) {
        // CFI can legitimately belong to another rendered section.
      }
    }

    try {
      const rangeCandidate = rendition.book?.getRange?.(cfiRange);
      if (rangeCandidate && typeof rangeCandidate.then !== 'function') {
        const anchor = resolveAnchorFromRange(rangeCandidate);
        if (anchor) return anchor;
      }
    } catch (err) {
      // Ignore fallback failures; caller can keep previous anchor.
    }
    return null;
  }, [rendition, resolveAnchorFromRange]);

  useEffect(() => {
    if (!rendition) return;
    let rafId = null;

    const syncAnchors = () => {
      rafId = null;
      const currentSelection = selectionRef.current;
      if (currentSelection?.cfiRange) {
        const nextAnchor = resolveAnchorFromCfi(currentSelection.cfiRange);
        if (nextAnchor) {
          setSelection((prev) => {
            if (!prev || prev.cfiRange !== currentSelection.cfiRange) return prev;
            const prevX = Number(prev?.pos?.x) || 0;
            const prevY = Number(prev?.pos?.y) || 0;
            const deltaX = Math.abs(prevX - nextAnchor.x);
            const deltaY = Math.abs(prevY - nextAnchor.y);
            if (deltaX <= 1 && deltaY <= 1) return prev;
            return { ...prev, pos: nextAnchor };
          });
        } else {
          setSelection((prev) => {
            if (!prev || prev.cfiRange !== currentSelection.cfiRange) return prev;
            return null;
          });
          setSelectionMode('actions');
        }
      }

      const currentPrompt = postHighlightPromptStateRef.current;
      const promptCfi = currentPrompt?.highlight?.cfiRange;
      if (promptCfi) {
        const nextAnchor = resolveAnchorFromCfi(promptCfi);
        if (nextAnchor) {
          setPostHighlightPrompt((prev) => {
            if (!prev || prev?.highlight?.cfiRange !== promptCfi) return prev;
            const prevX = Number(prev?.x) || 0;
            const prevY = Number(prev?.y) || 0;
            const deltaX = Math.abs(prevX - nextAnchor.x);
            const deltaY = Math.abs(prevY - nextAnchor.y);
            if (deltaX <= 1 && deltaY <= 1) return prev;
            return { ...prev, x: nextAnchor.x, y: nextAnchor.y };
          });
        } else {
          closePostHighlightPrompt();
        }
      }
    };

    const scheduleSync = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(syncAnchors);
    };

    const onViewportChange = () => {
      scheduleSync();
    };

    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    const contentListeners = (rendition.getContents?.() || [])
      .map((content) => {
        const contentWindow = content?.window;
        if (!contentWindow) return null;
        contentWindow.addEventListener('scroll', onViewportChange);
        contentWindow.addEventListener('resize', onViewportChange);
        return () => {
          contentWindow.removeEventListener('scroll', onViewportChange);
          contentWindow.removeEventListener('resize', onViewportChange);
        };
      })
      .filter(Boolean);

    scheduleSync();

    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      contentListeners.forEach((dispose) => dispose());
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [rendition, currentHref, resolveAnchorFromCfi, closePostHighlightPrompt]);

  useEffect(() => {
    if (!postHighlightPrompt) return;

    const onPointerDown = (event) => {
      if (!postHighlightPromptRef.current) return;
      if (postHighlightPromptRef.current.contains(event.target)) return;
      closePostHighlightPrompt();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePostHighlightPrompt();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [postHighlightPrompt, closePostHighlightPrompt]);

  useEffect(() => {
    if (!footnotePreview) return;

    const onPointerDown = (event) => {
      const node = footnotePreviewPanelRef.current;
      if (!node) return;
      if (node.contains(event.target)) return;
      closeFootnotePreview();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeFootnotePreview();
    };

    const onViewportChange = () => {
      closeFootnotePreview();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [footnotePreview, closeFootnotePreview]);

  useEffect(() => {
    if (showAIModal && rendition) {
      try {
        const loc = rendition.currentLocation();
        if (loc && loc.start) {
          const currentIndex = loc.start.index;
          // Extract chapter label from TOC
          const chapterLabel = toc.find(t => t.href.includes(loc.start.href))?.label || `Section ${currentIndex + 1}`;
          const prevSpineItem = currentIndex > 0 ? rendition.book.spine.get(currentIndex - 1) : null;
          
          setModalContext({
            chapterLabel,
            index: currentIndex,
            total: rendition.book.spine.length,
            prevHref: prevSpineItem ? prevSpineItem.href : null
          });
        }
      } catch (err) { console.error(err); }
    }
  }, [showAIModal, rendition, toc]);

  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  const mergeBookUpdate = useCallback((nextBook) => {
    if (!nextBook) return;
    setBook((prev) => {
      if (!prev) return nextBook;
      if (prev.id !== nextBook.id) return nextBook;
      if (prev.data && prev.data !== nextBook.data) {
        return { ...nextBook, data: prev.data };
      }
      return nextBook;
    });
  }, []);

  const flushPersistedProgress = useCallback(() => {
    const state = progressPersistRef.current;
    if (!bookId || !state.pending) return;

    const { cfi, percentage } = state.pending;
    state.pending = null;
    if (!cfi) return;

    const normalized = Math.min(Math.max(Number(percentage) || 0, 0), 1);
    if (state.lastCfi === cfi && state.lastPct === normalized) return;

    state.lastCfi = cfi;
    state.lastPct = normalized;
    state.lastWriteTs = Date.now();

    updateBookProgress(bookId, cfi, normalized).catch((err) => {
      console.error(err);
    });
  }, [bookId]);

  const queueProgressPersist = useCallback((cfi, percentage) => {
    if (!bookId || !cfi) return;

    const state = progressPersistRef.current;
    state.pending = { cfi, percentage };

    const throttleMs = 1200;
    const elapsed = Date.now() - state.lastWriteTs;

    if (elapsed >= throttleMs && !state.timer) {
      flushPersistedProgress();
      return;
    }

    if (!state.timer) {
      const waitMs = Math.max(120, throttleMs - elapsed);
      state.timer = setTimeout(() => {
        state.timer = null;
        flushPersistedProgress();
      }, waitMs);
    }
  }, [bookId, flushPersistedProgress]);

  useEffect(() => {
    const markActive = () => {
      lastActiveRef.current = Date.now();
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActive));
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPersistedProgress();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      const state = progressPersistRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      flushPersistedProgress();
    };
  }, [flushPersistedProgress]);

  const getStoryMemory = (currentBook) => {
    if (!currentBook) return '';
    if (typeof currentBook.globalSummary === 'string' && currentBook.globalSummary.trim()) {
      return currentBook.globalSummary;
    }
    if (Array.isArray(currentBook.chapterSummaries) && currentBook.chapterSummaries.length) {
      return currentBook.chapterSummaries.map(s => s.summary).filter(Boolean).join("\n\n");
    }
    if (Array.isArray(currentBook.aiSummaries) && currentBook.aiSummaries.length) {
      return currentBook.aiSummaries.map(s => s.summary).filter(Boolean).join("\n\n");
    }
    return '';
  };

  const highlightColors = [
    { name: 'Amber', value: '#fcd34d' },
    { name: 'Rose', value: '#f9a8d4' },
    { name: 'Sky', value: '#7dd3fc' },
    { name: 'Lime', value: '#bef264' },
    { name: 'Violet', value: '#c4b5fd' },
    { name: 'Teal', value: '#5eead4' },
    { name: 'Orange', value: '#fdba74' }
  ];

  const languageOptions = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'French' },
    { code: 'es', label: 'Spanish' },
    { code: 'ar', label: 'Arabic' },
    { code: 'de', label: 'German' },
    { code: 'it', label: 'Italian' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ja', label: 'Japanese' }
  ];

  const sourceLanguageOptions = SUPPORTS_AUTO_DETECT
    ? [{ code: 'auto', label: 'Auto detect' }, ...languageOptions]
    : languageOptions;

  const translateProviderLabel = TRANSLATE_PROVIDER.includes('libre')
    ? 'LibreTranslate'
    : 'MyMemory (free)';

  const fontOptions = [
    { value: 'publisher', label: 'Publisher default' },
    { value: "'Merriweather', Georgia, serif", label: 'Merriweather' },
    { value: "'Lora', Georgia, serif", label: 'Lora' },
    { value: "'Playfair Display', Georgia, serif", label: 'Playfair Display' },
    { value: "'Source Serif 4', Georgia, serif", label: 'Source Serif 4' },
    { value: "'Source Sans 3', Helvetica, Arial, sans-serif", label: 'Source Sans 3' },
    { value: "'Nunito', Arial, sans-serif", label: 'Nunito' },
    { value: "'Raleway', Arial, sans-serif", label: 'Raleway' },
    { value: "'Montserrat', Arial, sans-serif", label: 'Montserrat' },
    { value: "'Poppins', Arial, sans-serif", label: 'Poppins' },
    { value: "'Fira Sans', Arial, sans-serif", label: 'Fira Sans' }
  ];

  const sameHighlights = (a = [], b = []) => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const left = a[i] || {};
      const right = b[i] || {};
      if (
        left.cfiRange !== right.cfiRange ||
        left.color !== right.color ||
        left.note !== right.note ||
        left.text !== right.text
      ) {
        return false;
      }
    }
    return true;
  };

  const sameBookmarks = (a = [], b = []) => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const left = a[i] || {};
      const right = b[i] || {};
      if (
        left.cfi !== right.cfi ||
        left.label !== right.label ||
        left.text !== right.text ||
        left.href !== right.href
      ) {
        return false;
      }
    }
    return true;
  };

  const sentenceSplit = (text) => {
    if (!text) return [];
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];
    const matches = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
    return matches ? matches.map((s) => s.trim()).filter(Boolean) : [cleaned];
  };

  const clampText = (text, max = 320) => {
    if (!text) return '';
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1).trim()}…`;
  };

  const normalizeForMatch = (text) => {
    if (!text) return { normalized: '', map: [] };
    const map = [];
    let normalized = '';
    let lastWasSpace = false;

    for (let i = 0; i < text.length; i += 1) {
      let ch = text[i];
      if (ch === '’' || ch === '‘') ch = "'";
      if (ch === '“' || ch === '”') ch = '"';
      if (ch === '…') ch = '.';

      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          normalized += ' ';
          map.push(i);
          lastWasSpace = true;
        }
        continue;
      }

      lastWasSpace = false;
      normalized += ch.toLowerCase();
      map.push(i);
    }

    return { normalized, map };
  };

  const findSentenceBounds = (text, startIndex, endIndex) => {
    const isBoundary = (idx) => {
      const ch = text[idx];
      return ch === '.' || ch === '!' || ch === '?';
    };

    let prev = -1;
    for (let i = startIndex - 1; i >= 0; i -= 1) {
      if (isBoundary(i)) { prev = i; break; }
    }

    let next = text.length;
    for (let i = endIndex; i < text.length; i += 1) {
      if (isBoundary(i)) { next = i + 1; break; }
    }

    return { prev, next };
  };

  const segmentSentences = (text) => {
    if (!text) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        const segments = [];
        for (const segment of segmenter.segment(text)) {
          const trimmed = segment.segment.trim();
          if (!trimmed) continue;
          segments.push({
            text: trimmed,
            start: segment.index,
            end: segment.index + segment.segment.length
          });
        }
        return segments;
      } catch (err) {
        console.error(err);
      }
    }
    return [];
  };

  const extractSentenceContext = (raw, highlightText) => {
    const target = (highlightText || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { before: '', current: target, after: '' };

    const rawClean = raw.replace(/\s+/g, ' ').trim();
    if (!target) return { before: '', current: clampText(rawClean), after: '' };

    const { normalized: rawNorm, map } = normalizeForMatch(rawClean);
    const { normalized: targetNorm } = normalizeForMatch(target);
    let matchIndex = rawNorm.indexOf(targetNorm);

    if (matchIndex < 0 && targetNorm.length) {
      const words = targetNorm.split(' ').filter(Boolean);
      if (words.length >= 3) {
        const probe = words.slice(0, 4).join(' ');
        matchIndex = rawNorm.indexOf(probe);
      }
    }

    if (matchIndex < 0) {
      return { before: '', current: clampText(rawClean), after: '' };
    }

    const startOriginal = map[matchIndex] ?? 0;
    const endOriginal = map[Math.min(matchIndex + targetNorm.length - 1, map.length - 1)] ?? startOriginal;

    const segments = segmentSentences(rawClean);
    if (segments.length) {
      const idx = segments.findIndex((seg) => seg.start <= startOriginal && seg.end >= endOriginal);
      const currentSeg = segments[idx >= 0 ? idx : 0];
      const beforeSeg = idx > 0 ? segments[idx - 1] : null;
      const afterSeg = idx >= 0 && idx + 1 < segments.length ? segments[idx + 1] : null;
      return {
        before: clampText(beforeSeg?.text || ''),
        current: clampText(currentSeg?.text || target),
        after: clampText(afterSeg?.text || '')
      };
    }

    const { prev, next } = findSentenceBounds(rawClean, startOriginal, endOriginal);
    const current = rawClean.slice(prev + 1, next).trim();

    const { prev: prevPrev } = findSentenceBounds(rawClean, Math.max(prev, 0), Math.max(prev, 0));
    const before = prev >= 0 ? rawClean.slice(prevPrev + 1, prev + 1).trim() : '';

    const { next: nextNext } = findSentenceBounds(rawClean, next + 1, next + 1);
    const after = next < rawClean.length ? rawClean.slice(next, nextNext).trim() : '';

    return {
      before: clampText(before),
      current: clampText(current || target),
      after: clampText(after)
    };
  };

  const hexToRgba = (hex, alpha = 0.35) => {
    if (!hex) return `rgba(250, 204, 21, ${alpha})`;
    const clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16);
      const g = parseInt(clean[1] + clean[1], 16);
      const b = parseInt(clean[2] + clean[2], 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (clean.length === 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return `rgba(250, 204, 21, ${alpha})`;
  };

  const buildHighlightContext = async (cfiRange, highlightText) => {
    try {
      if (!rendition?.book) return { before: '', current: highlightText, after: '' };
      if (rendition.book?.ready) await rendition.book.ready;
      const range = await rendition.book.getRange(cfiRange);
      if (!range) return { before: '', current: highlightText, after: '' };
      const node = range.commonAncestorContainer?.nodeType === 3
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;
      const block = node?.closest?.('p, li, blockquote') || node?.closest?.('div') || node;
      const raw = block?.textContent || '';
      return extractSentenceContext(raw, highlightText);
    } catch (err) {
      console.error(err);
      return { before: '', current: highlightText, after: '' };
    }
  };

  const exportHighlightsPdf = async () => {
    const targets = selectedHighlights.length
      ? highlights.filter((h) => selectedHighlights.includes(h.cfiRange))
      : highlights;
    if (!targets.length || isExportingHighlights) return;
    setIsExportingHighlights(true);
    try {
      const [{ default: html2canvasLib }, jsPdfModule] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const JsPdfCtor = jsPdfModule.jsPDF || jsPdfModule.default;

      const exportRoot = document.createElement('div');
      exportRoot.style.position = 'fixed';
      exportRoot.style.left = '-10000px';
      exportRoot.style.top = '0';
      exportRoot.style.width = '720px';
      exportRoot.style.padding = '24px';
      document.body.appendChild(exportRoot);

      const pdf = new JsPdfCtor({ unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 36;
      const gap = 18;
      const availableWidth = pageWidth - margin * 2;
      let cursorY = margin;

      for (let i = 0; i < targets.length; i += 1) {
        const h = targets[i];
        exportRoot.innerHTML = '';

        const card = document.createElement('div');
        card.style.background = '#0f172a';
        card.style.border = '1px solid #1e293b';
        card.style.borderRadius = '16px';
        card.style.padding = '24px';
        card.style.color = '#e2e8f0';
        card.style.fontFamily = "'Source Serif 4', Georgia, serif";
        card.style.boxShadow = '0 16px 40px rgba(15, 23, 42, 0.4)';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.marginBottom = '16px';
        header.style.fontFamily = "'Fira Sans', Arial, sans-serif";
        header.style.textTransform = 'uppercase';
        header.style.letterSpacing = '0.12em';
        header.style.fontSize = '10px';
        header.style.color = '#94a3b8';
        header.textContent = `${book?.title || 'Highlights'} · Highlight ${i + 1} of ${targets.length}`;

        let chapterLabel = '';
        let locationLabel = '';
        try {
          if (rendition?.book?.spine?.get) {
            const spineItem = rendition.book.spine.get(h.cfiRange);
            const href = spineItem?.href || '';
            const match = toc.find(t => t.href && href && href.includes(t.href));
            if (match?.label) chapterLabel = match.label;
          }
          const locations = rendition?.book?.locations;
          if (locations?.locationFromCfi) {
            const loc = locations.locationFromCfi(h.cfiRange);
            if (Number.isFinite(loc)) {
              const total = typeof locations.total === 'number'
                ? locations.total
                : (typeof locations.length === 'function' ? locations.length() : null);
              locationLabel = total ? `Page ${loc + 1} / ${total}` : `Page ${loc + 1}`;
            }
          }
        } catch (err) {
          console.error(err);
        }

        const meta = document.createElement('div');
        meta.style.marginTop = '6px';
        meta.style.fontFamily = "'Fira Sans', Arial, sans-serif";
        meta.style.fontSize = '11px';
        meta.style.color = '#94a3b8';
        meta.textContent = [chapterLabel, locationLabel].filter(Boolean).join(' · ');

        const main = document.createElement('div');
        main.style.margin = '14px 0';
        main.style.fontSize = '16px';
        main.style.lineHeight = '1.7';
        main.style.fontWeight = '600';
        main.style.whiteSpace = 'normal';
        main.style.wordBreak = 'break-word';
        main.style.overflowWrap = 'anywhere';

        const target = (h.text || '').replace(/\s+/g, ' ').trim();
        if (target) {
          const spanMatch = document.createElement('span');
          spanMatch.textContent = target;
          spanMatch.style.background = hexToRgba(h.color, 0.55);
          spanMatch.style.color = '#0b1220';
          spanMatch.style.padding = '2px 6px 5px';
          spanMatch.style.borderRadius = '6px';
          spanMatch.style.lineHeight = '1.8';
          spanMatch.style.boxDecorationBreak = 'clone';
          spanMatch.style.webkitBoxDecorationBreak = 'clone';
          spanMatch.style.backgroundClip = 'padding-box';
          main.append(spanMatch);
        } else {
          main.textContent = '';
        }

        if (h.note) {
          const note = document.createElement('div');
          note.style.marginTop = '16px';
          note.style.paddingTop = '12px';
          note.style.borderTop = '1px solid rgba(148, 163, 184, 0.35)';
          note.style.fontFamily = "'Fira Sans', Arial, sans-serif";
          note.style.fontSize = '13px';
          note.style.color = '#cbd5f5';
          note.style.fontStyle = 'italic';
          note.textContent = h.note;
          card.append(header, meta, main, note);
        } else {
          card.append(header, meta, main);
        }
        exportRoot.appendChild(card);

        await new Promise((resolve) => requestAnimationFrame(resolve));
        const canvas = await html2canvasLib(card, { scale: 2, backgroundColor: null });
        const imgData = canvas.toDataURL('image/png');

        const ratio = canvas.height / canvas.width;
        let imgWidth = availableWidth;
        let imgHeight = imgWidth * ratio;
        if (imgHeight > pageHeight - margin * 2) {
          imgHeight = pageHeight - margin * 2;
          imgWidth = imgHeight / ratio;
        }
        if (cursorY + imgHeight > pageHeight - margin) {
          pdf.addPage();
          cursorY = margin;
        }
        const x = (pageWidth - imgWidth) / 2;
        pdf.addImage(imgData, 'PNG', x, cursorY, imgWidth, imgHeight);
        cursorY += imgHeight + gap;
      }

      const suffix = selectedHighlights.length ? 'selected' : 'highlights';
      pdf.save(`${book?.title || 'highlights'}-${suffix}.pdf`);
      document.body.removeChild(exportRoot);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExportingHighlights(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const minutes = Math.max(1, Math.round(seconds / 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours <= 0) return `${minutes}m`;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes}m`;
  };

  const estimateTimeLeft = () => {
    const readingTime = book?.readingTime || 0;
    if (!readingTime || progressPct <= 0 || progressPct >= 100) return null;
    const avgPerPercent = readingTime / progressPct;
    if (!Number.isFinite(avgPerPercent) || avgPerPercent <= 0) return null;
    const remaining = Math.max(0, (100 - progressPct) * avgPerPercent);
    return remaining || null;
  };

  const timeLeftSeconds = estimateTimeLeft();
  const timeLeftLabel = progressPct >= 100
    ? 'Done'
    : timeLeftSeconds
      ? `${formatDuration(timeLeftSeconds)} left`
      : 'Estimating...';

  const cancelSearch = () => {
    searchTokenRef.current += 1;
    setIsSearching(false);
  };

  const clearSearch = () => {
    cancelSearch();
    setSearchQuery("");
    setSearchResults([]);
    setActiveSearchIndex(-1);
    setFocusedSearchCfi(null);
  };

  const closeSearchMenu = (options = {}) => {
    const { preserveFocusedSearch = false } = options;
    cancelSearch();
    if (!preserveFocusedSearch) {
      setFocusedSearchCfi(null);
    }
    setShowSearchMenu(false);
  };

  const clearAnnotationSearch = () => {
    setAnnotationSearchQuery('');
    setAnnotationSearchResults([]);
    setActiveAnnotationSearchIndex(-1);
  };

  const closeAnnotationSearchMenu = () => {
    setShowAnnotationSearchMenu(false);
  };

  const rememberSearchQuery = useCallback((query) => {
    const term = (query || '').trim();
    if (!term) return;
    setRecentSearchQueries((prev) => appendRecentQuery(prev, term));
  }, []);

  const rememberAnnotationSearchQuery = useCallback((query) => {
    const term = (query || '').trim();
    if (!term) return;
    setRecentAnnotationSearchQueries((prev) => appendRecentQuery(prev, term));
  }, []);

  const clearRecentSearchQueries = useCallback(() => {
    setRecentSearchQueries([]);
  }, []);

  const clearRecentAnnotationSearchQueries = useCallback(() => {
    setRecentAnnotationSearchQueries([]);
  }, []);

  const buildAnnotationExcerpt = (value) => {
    const text = (value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= 180) return text;
    return `${text.slice(0, 179).trim()}…`;
  };

  const goToAnnotationSearchIndex = (index, overrideResults = null) => {
    const sourceResults = Array.isArray(overrideResults) ? overrideResults : annotationSearchResults;
    if (!sourceResults.length) return;
    const clamped = Math.max(0, Math.min(index, sourceResults.length - 1));
    setActiveAnnotationSearchIndex(clamped);
    const target = sourceResults[clamped];
    if (!target?.cfi) return;
    jumpToCfi(target.cfi, { rememberReturnSpot: true, source: 'annotation' });
    if (target.kind === 'highlight' || target.kind === 'note') {
      triggerHighlightFlash(target.cfi);
    }
  };

  const goToNextAnnotationResult = () => {
    if (!annotationSearchResults.length) return;
    const next = activeAnnotationSearchIndex + 1 >= annotationSearchResults.length ? 0 : activeAnnotationSearchIndex + 1;
    goToAnnotationSearchIndex(next);
  };

  const goToPrevAnnotationResult = () => {
    if (!annotationSearchResults.length) return;
    const prev = activeAnnotationSearchIndex - 1 < 0 ? annotationSearchResults.length - 1 : activeAnnotationSearchIndex - 1;
    goToAnnotationSearchIndex(prev);
  };

  const runAnnotationSearch = (query) => {
    const term = (query || '').trim().toLowerCase();
    if (!term) {
      clearAnnotationSearch();
      return;
    }

    rememberAnnotationSearchQuery(query);

    const results = [];
    highlights.forEach((item, idx) => {
      const highlightText = (item?.text || '').toLowerCase();
      const noteText = (item?.note || '').toLowerCase();
      if (highlightText.includes(term)) {
        results.push({
          id: `h-${item.cfiRange}-${idx}`,
          cfi: item.cfiRange,
          kind: 'highlight',
          label: 'Highlight',
          excerpt: buildAnnotationExcerpt(item.text)
        });
      }
      if (noteText.includes(term)) {
        results.push({
          id: `n-${item.cfiRange}-${idx}`,
          cfi: item.cfiRange,
          kind: 'note',
          label: 'Note',
          excerpt: buildAnnotationExcerpt(item.note)
        });
      }
    });

    bookmarks.forEach((item, idx) => {
      const labelText = (item?.label || '').toLowerCase();
      const snippetText = (item?.text || '').toLowerCase();
      if (labelText.includes(term) || snippetText.includes(term)) {
        results.push({
          id: `b-${item.cfi}-${idx}`,
          cfi: item.cfi,
          kind: 'bookmark',
          label: 'Bookmark',
          excerpt: buildAnnotationExcerpt(item.text || item.label || 'Saved bookmark')
        });
      }
    });

    setAnnotationSearchQuery(query);
    setAnnotationSearchResults(results);
    if (results.length) {
      goToAnnotationSearchIndex(0, results);
    } else {
      setActiveAnnotationSearchIndex(-1);
    }
  };

  const handleAnnotationSearchResultClick = (idx) => {
    goToAnnotationSearchIndex(idx);
    closeAnnotationSearchMenu();
  };

  const handleRecentAnnotationSearchClick = (query) => {
    setAnnotationSearchQuery(query);
    runAnnotationSearch(query);
  };

  const goToSearchIndex = (index, overrideResults = null, options = {}) => {
    const { focus = false, rememberReturnSpot = true } = options;
    const sourceResults = Array.isArray(overrideResults) ? overrideResults : searchResults;
    if (!sourceResults.length) return;
    const clamped = Math.max(0, Math.min(index, sourceResults.length - 1));
    setActiveSearchIndex(clamped);
    const target = sourceResults[clamped];
    if (target?.cfi) {
      jumpToCfi(target.cfi, { rememberReturnSpot, source: 'search' });
      if (focus) {
        setFocusedSearchCfi(target.cfi);
      } else {
        setFocusedSearchCfi(null);
      }
    } else {
      setFocusedSearchCfi(null);
    }
  };

  const handleSearchResultActivate = useCallback((cfi) => {
    if (!cfi || !searchResults.length) return;
    const index = searchResults.findIndex((result) => {
      const matchCfi = result?.cfi || "";
      return matchCfi === cfi || matchCfi.includes(cfi) || cfi.includes(matchCfi);
    });
    if (index >= 0) {
      setActiveSearchIndex(index);
    }
  }, [searchResults]);

  const dismissFocusedSearch = useCallback(() => {
    setFocusedSearchCfi(null);
  }, []);

  const handleSearchResultClick = (idx) => {
    goToSearchIndex(idx, null, { focus: true, rememberReturnSpot: true });
    closeSearchMenu({ preserveFocusedSearch: true });
  };

  const handleRecentSearchClick = (query) => {
    setSearchQuery(query);
    runSearch(query);
  };

  const goToNextResult = () => {
    if (!searchResults.length) return;
    const next = activeSearchIndex + 1 >= searchResults.length ? 0 : activeSearchIndex + 1;
    goToSearchIndex(next);
  };

  const goToPrevResult = () => {
    if (!searchResults.length) return;
    const prev = activeSearchIndex - 1 < 0 ? searchResults.length - 1 : activeSearchIndex - 1;
    goToSearchIndex(prev);
  };

  const runSearch = async (query, targetCfi = '') => {
    const term = query.trim();
    if (!rendition || !term) {
      clearSearch();
      return;
    }

    rememberSearchQuery(term);

    const token = searchTokenRef.current + 1;
    searchTokenRef.current = token;
    setIsSearching(true);
    setSearchResults([]);
    setActiveSearchIndex(-1);

    try {
      const book = rendition.book;
      if (book?.ready) await book.ready;

      const results = [];
      const spineItems = book?.spine?.spineItems || [];
      for (const section of spineItems) {
        if (searchTokenRef.current !== token) return;
        if (!section) continue;
        if (section.linear === "no" || section.linear === false) continue;
        try {
          await section.load(book.load.bind(book));
          let matches = [];
          if (typeof section.find === 'function') {
            matches = section.find(term) || [];
          } else if (typeof section.search === 'function') {
            matches = section.search(term) || [];
          }
          matches.forEach((match) => {
            results.push({
              ...match,
              href: section.href,
              spineIndex: section.index
            });
          });
        } finally {
          section.unload();
        }
      }

      if (searchTokenRef.current !== token) return;
      setSearchResults(results);
      if (results.length) {
        const targetIndex = targetCfi
          ? results.findIndex((result) => {
              const matchCfi = result?.cfi || '';
              return matchCfi === targetCfi || matchCfi.includes(targetCfi) || targetCfi.includes(matchCfi);
            })
          : -1;
        const initialIndex = targetIndex >= 0 ? targetIndex : 0;
        goToSearchIndex(initialIndex, results);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (searchTokenRef.current === token) setIsSearching(false);
    }
  };

  const sanitizeDictionaryTerm = (text) => {
    if (!text) return '';
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';
    const firstToken = trimmed.split(' ')[0];
    return firstToken.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  };

  const cancelDictionaryLookup = () => {
    dictionaryTokenRef.current += 1;
    setIsDefining(false);
  };

  const clearDictionary = () => {
    cancelDictionaryLookup();
    setDictionaryQuery("");
    setDictionaryEntry(null);
    setDictionaryError("");
  };

  const closeDictionary = () => {
    cancelDictionaryLookup();
    setShowDictionary(false);
    setDictionaryAnchor(null);
  };

  const cancelTranslation = () => {
    translationTokenRef.current += 1;
    setIsTranslating(false);
  };

  const clearTranslation = () => {
    cancelTranslation();
    setTranslationQuery("");
    setTranslationResult("");
    setTranslationError("");
  };

  const closeTranslation = () => {
    cancelTranslation();
    setShowTranslation(false);
    setTranslationAnchor(null);
  };

  const handleSearchInputKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (searchResults.length > 0) {
      goToNextResult();
    } else {
      runSearch(searchQuery);
    }
  };

  const handleAnnotationSearchInputKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (annotationSearchResults.length > 0) {
      goToNextAnnotationResult();
    } else {
      runAnnotationSearch(annotationSearchQuery);
    }
  };

  const lookupDictionary = async (term) => {
    const clean = sanitizeDictionaryTerm(term);
    if (!clean) {
      clearDictionary();
      return;
    }
    const token = dictionaryTokenRef.current + 1;
    dictionaryTokenRef.current = token;
    setDictionaryQuery(clean);
    setDictionaryError("");
    setDictionaryEntry(null);
    setIsDefining(true);

    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`);
      if (!response.ok) {
        throw new Error('No definition found');
      }
      const data = await response.json();
      if (dictionaryTokenRef.current !== token) return;
      const first = Array.isArray(data) ? data[0] : null;
      setDictionaryEntry(first);
    } catch (err) {
      if (dictionaryTokenRef.current !== token) return;
      console.error(err);
      setDictionaryError('No definition found for that word.');
    } finally {
      if (dictionaryTokenRef.current === token) setIsDefining(false);
    }
  };

  const translateText = async (text, target = targetLanguage, source = sourceLanguage) => {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      clearTranslation();
      return;
    }

    const token = translationTokenRef.current + 1;
    translationTokenRef.current = token;
    setTranslationError("");
    setTranslationResult("");
    setIsTranslating(true);

    try {
      const provider = TRANSLATE_PROVIDER.includes('libre') ? 'libre' : 'mymemory';
      let translated = '';

      if (provider === 'mymemory') {
        if ((source || 'auto') === 'auto') {
          throw new Error('Pick a source language for MyMemory.');
        }
        const langpair = `${source || 'en'}|${target}`;
        const params = new URLSearchParams({ q: trimmed, langpair });
        if (TRANSLATE_EMAIL) params.set('de', TRANSLATE_EMAIL);
        const response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`);
        const data = await response.json();
        if (data?.responseStatus !== 200) {
          const details = data?.responseDetails || 'Translation failed.';
          if ((source || 'auto') === 'auto') {
            throw new Error(`Auto-detect failed. Pick a source language. ${details}`);
          }
          throw new Error(details);
        }
        translated = data?.responseData?.translatedText || '';
      } else {
        const payload = {
          q: trimmed,
          source: source || 'auto',
          target,
          format: 'text'
        };

        if (TRANSLATE_API_KEY) {
          payload.api_key = TRANSLATE_API_KEY;
        }

        const response = await fetch(LIBRE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        let data = {};
        try {
          data = await response.json();
        } catch (err) {
          data = {};
        }

        if (!response.ok) {
          const message = data?.error || data?.message || `Translation failed (${response.status})`;
          throw new Error(message);
        }

        translated = data?.translatedText || data?.translation || data?.text || '';
      }

      if (!translated) {
        throw new Error('Translation returned no text.');
      }

      if (translationTokenRef.current !== token) return;
      setTranslationResult(translated);
    } catch (err) {
      if (translationTokenRef.current !== token) return;
      console.error(err);
      setTranslationError(err?.message || 'Translation failed.');
    } finally {
      if (translationTokenRef.current === token) setIsTranslating(false);
    }
  };

  const openDictionaryForText = (text) => {
    closeFootnotePreview();
    closePostHighlightPrompt();
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const wordCount = trimmed.split(/\s+/).length;
    const clean = sanitizeDictionaryTerm(trimmed);
    if (!clean) return;
    if (selection?.pos) {
      setDictionaryAnchor({ ...selection.pos });
    }
    setShowTranslation(false);
    setTranslationAnchor(null);
    setShowDictionary(true);
    setDictionaryQuery(clean);
    if (wordCount === 1) {
      lookupDictionary(clean);
    } else {
      setDictionaryEntry(null);
      setDictionaryError('Select a single word to look it up.');
    }
  };

  const openTranslationForText = (text) => {
    closeFootnotePreview();
    closePostHighlightPrompt();
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    if (selection?.pos) {
      setTranslationAnchor({ ...selection.pos });
    }
    setShowDictionary(false);
    setDictionaryAnchor(null);
    setShowTranslation(true);
    setTranslationQuery(trimmed);
    setTranslationResult("");
    setTranslationError("");
    translateText(trimmed, targetLanguage, sourceLanguage);
  };

  const getContextPanelStyle = (anchor) => {
    const padding = 12;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const width = Math.min(420, Math.max(280, viewportWidth - padding * 2));
    const maxHeight = Math.min(520, Math.max(260, Math.floor(viewportHeight * 0.72)));

    const safeAnchorX = anchor?.x ?? viewportWidth / 2;
    const safeAnchorY = anchor?.y ?? viewportHeight / 2;

    let left = safeAnchorX + 8;
    let top = safeAnchorY + 8;

    if (left + width > viewportWidth - padding) {
      left = viewportWidth - width - padding;
    }
    if (left < padding) left = padding;

    if (top + maxHeight > viewportHeight - padding) {
      top = Math.max(padding, safeAnchorY - maxHeight - 8);
    }
    if (top < padding) top = padding;

    return { left, top, width, maxHeight };
  };

  const getFootnotePanelStyle = (anchor) => {
    const padding = 12;
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800;
    const width = Math.min(360, Math.max(260, viewportWidth - padding * 2));
    const maxHeight = Math.min(280, Math.max(180, Math.floor(viewportHeight * 0.5)));

    const safeAnchorX = anchor?.x ?? viewportWidth / 2;
    const safeAnchorY = anchor?.y ?? viewportHeight / 2;

    let left = safeAnchorX + 8;
    let top = safeAnchorY + 8;

    if (left + width > viewportWidth - padding) {
      left = viewportWidth - width - padding;
    }
    if (left < padding) left = padding;

    if (top + maxHeight > viewportHeight - padding) {
      top = Math.max(padding, safeAnchorY - maxHeight - 8);
    }
    if (top < padding) top = padding;

    return { left, top, width, maxHeight };
  };

  const handleFootnotePreview = useCallback((payload) => {
    if (!payload) {
      closeFootnotePreview();
      return;
    }
    setShowDictionary(false);
    setDictionaryAnchor(null);
    setShowTranslation(false);
    setTranslationAnchor(null);
    closePostHighlightPrompt();
    setSelection(null);
    setSelectionMode('actions');
    setFootnotePreview(payload);
  }, [closeFootnotePreview, closePostHighlightPrompt]);

  const getChapterLabel = (loc) => {
    if (!loc?.start) return 'Bookmark';
    const match = toc.find(t => t.href && loc.start.href && t.href.includes(loc.start.href));
    if (match?.label) return match.label;
    if (typeof loc.start.index === 'number') return `Section ${loc.start.index + 1}`;
    return 'Bookmark';
  };

  const addBookmarkAtLocation = async () => {
    const currentBook = bookRef.current;
    if (!currentBook || !rendition) return;
    try {
      const liveLocation = rendition.currentLocation?.() || rendition.location || null;
      const liveStart = liveLocation?.start || {};
      const fallbackCfi = typeof currentBook.lastLocation === 'string' ? currentBook.lastLocation : '';
      const cfi = liveStart.cfi || fallbackCfi;
      if (!cfi) return;

      const viewer = rendition.getContents()[0];
      const pageText = viewer?.document?.body?.innerText || '';
      const snippet = pageText.trim().slice(0, 140);
      const label = liveLocation?.start ? getChapterLabel(liveLocation) : 'Bookmark';

      const newBookmark = {
        cfi,
        href: liveStart.href || '',
        label,
        text: snippet,
        createdAt: new Date().toISOString()
      };

      const updated = await saveBookmark(currentBook.id, newBookmark);
      if (updated) {
        setBookmarks(updated);
        setBook({ ...currentBook, bookmarks: updated });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const removeBookmark = async (cfi) => {
    const currentBook = bookRef.current;
    if (!currentBook || !cfi) return;
    try {
      const updated = await deleteBookmark(currentBook.id, cfi);
      if (updated) {
        setBookmarks(updated);
        setBook({ ...currentBook, bookmarks: updated });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const findHighlightByCfi = useCallback((cfiRange) => {
    if (!cfiRange) return null;
    const normalizeCfi = (value) => (value || '').toString().replace(/\s+/g, '');
    const target = normalizeCfi(cfiRange);
    if (!target) return null;
    return highlights.find((item) => {
      const source = normalizeCfi(item?.cfiRange);
      if (!source) return false;
      return source === target || source.includes(target) || target.includes(source);
    }) || null;
  }, [highlights]);

  const handleSelection = useCallback((text, cfiRange, pos, isExisting = false) => {
    closeFootnotePreview();
    closePostHighlightPrompt();
    const trimmed = (text || '').trim();
    if (!trimmed) {
      setSelection(null);
      setSelectionMode('actions');
      return;
    }
    setSelection({
      text: trimmed,
      cfiRange,
      pos,
      isExisting
    });
    setSelectionMode('actions');
  }, [closeFootnotePreview, closePostHighlightPrompt]);

  const jumpToCfi = useCallback((cfi, options = {}) => {
    const { rememberReturnSpot = false, source = 'jump' } = options;
    if (!cfi) return;
    if (rememberReturnSpot) {
      const runtimeCfi = rendition?.currentLocation?.()?.start?.cfi || '';
      const fromCfi = (currentLocationCfiRef.current || runtimeCfi || bookRef.current?.lastLocation || '').toString().trim();
      const normalizedFrom = fromCfi.replace(/\s+/g, '');
      const normalizedTo = cfi.toString().replace(/\s+/g, '');
      if (normalizedFrom && normalizedFrom !== normalizedTo) {
        queueReturnSpot(normalizedFrom, source);
      }
    }
    if (rendition) {
      try {
        rendition.display(cfi);
      } catch (err) {
        console.error(err);
        setJumpTarget(cfi);
      }
    } else {
      setJumpTarget(cfi);
    }
    setTimeout(() => setJumpTarget(null), 0);
  }, [queueReturnSpot, rendition]);

  const clearSelection = () => {
    setSelection(null);
    setSelectionMode('actions');
    closeFootnotePreview();
    if (rendition) {
      try {
        const contentsList = rendition.getContents?.() || [];
        contentsList.forEach((content) => {
          content?.window?.getSelection?.()?.removeAllRanges?.();
        });
      } catch (err) {
        console.error(err);
      }
    }
  };

  const addHighlight = async (color) => {
    const currentBook = bookRef.current;
    if (!currentBook || !selection?.cfiRange) return;
    const selectionSnapshot = selection ? { ...selection } : null;
    const newHighlight = {
      cfiRange: selection.cfiRange,
      text: selection.text,
      color,
      createdAt: new Date().toISOString()
    };

    try {
      const updated = await saveHighlight(currentBook.id, newHighlight);
      if (updated) {
        setHighlights(updated);
        setBook({ ...currentBook, highlights: updated });
        showReaderToast({
          tone: 'success',
          title: 'Highlight saved',
          message: 'Highlight added to this page.'
        });
        if (selectionSnapshot?.pos) {
          const savedHighlight = updated.find((item) => item?.cfiRange === newHighlight.cfiRange) || newHighlight;
          setPostHighlightPrompt({
            x: selectionSnapshot.pos.x,
            y: selectionSnapshot.pos.y,
            highlight: savedHighlight
          });
          setPostHighlightNoteDraft(savedHighlight?.note || '');
          setPostHighlightNoteError('');
        }
      }
    } catch (err) {
      console.error(err);
      showReaderToast({
        tone: 'warning',
        title: 'Could not save highlight',
        message: 'Try again in a moment.'
      });
    } finally {
      clearSelection();
    }
  };

  const recolorExistingHighlight = async (color) => {
    const currentBook = bookRef.current;
    if (!currentBook || !selection?.cfiRange) return;
    const existing = findHighlightByCfi(selection.cfiRange);
    if (!existing?.cfiRange) return;

    const nextHighlight = {
      ...existing,
      color
    };

    try {
      const updated = await saveHighlight(currentBook.id, nextHighlight);
      if (updated) {
        setHighlights(updated);
        setBook({ ...currentBook, highlights: updated });
        triggerHighlightFlash(nextHighlight.cfiRange);
        showReaderToast({
          tone: 'success',
          title: 'Highlight updated',
          message: 'Highlight color changed.'
        });
      }
    } catch (err) {
      console.error(err);
      showReaderToast({
        tone: 'warning',
        title: 'Could not update highlight',
        message: 'Try again in a moment.'
      });
    } finally {
      clearSelection();
    }
  };

  const removeHighlight = async (cfiRange) => {
    const normalizeCfi = (value) => (value || '').toString().replace(/\s+/g, '');
    const clearPendingTimer = () => {
      if (pendingHighlightDeleteTimerRef.current) {
        clearTimeout(pendingHighlightDeleteTimerRef.current);
        pendingHighlightDeleteTimerRef.current = null;
      }
    };

    const clearPendingState = (payload = null) => {
      clearPendingTimer();
      if (!payload || pendingHighlightDeleteRef.current === payload) {
        pendingHighlightDeleteRef.current = null;
        setPendingHighlightDelete(null);
      }
    };

    const finalizePendingDelete = async (payload = pendingHighlightDeleteRef.current) => {
      if (!payload?.bookId || !payload?.highlight?.cfiRange) return;
      clearPendingState(payload);
      try {
        const updated = await deleteHighlight(payload.bookId, payload.highlight.cfiRange);
        if (updated) {
          setHighlights(updated);
          setBook((prev) => {
            if (!prev || prev.id !== payload.bookId) return prev;
            return { ...prev, highlights: updated };
          });
        }
      } catch (err) {
        console.error(err);
        if (Array.isArray(payload.previousHighlights)) {
          setHighlights(payload.previousHighlights);
          setBook((prev) => {
            if (!prev || prev.id !== payload.bookId) return prev;
            return { ...prev, highlights: payload.previousHighlights };
          });
        }
      }
    };

    const currentBook = bookRef.current;
    if (!currentBook || !cfiRange) return;

    if (pendingHighlightDeleteRef.current) {
      await finalizePendingDelete();
    }

    const target = findHighlightByCfi(cfiRange);
    if (!target?.cfiRange) {
      clearSelection();
      return;
    }

    const targetKey = normalizeCfi(target.cfiRange);
    const previousHighlights = Array.isArray(highlights) ? highlights : [];
    const nextHighlights = previousHighlights.filter((item) => normalizeCfi(item?.cfiRange) !== targetKey);
    const payload = {
      bookId: currentBook.id,
      highlight: target,
      previousHighlights
    };

    setHighlights(nextHighlights);
    setBook((prev) => {
      if (!prev || prev.id !== currentBook.id) return prev;
      return { ...prev, highlights: nextHighlights };
    });

    pendingHighlightDeleteRef.current = payload;
    setPendingHighlightDelete(payload);
    clearPendingTimer();
    pendingHighlightDeleteTimerRef.current = setTimeout(() => {
      finalizePendingDelete(payload);
    }, 5000);

    clearSelection();
  };

  const undoPendingHighlightDelete = useCallback(() => {
    const pending = pendingHighlightDeleteRef.current;
    if (!pending?.highlight?.cfiRange || !Array.isArray(pending.previousHighlights)) return;
    if (pendingHighlightDeleteTimerRef.current) {
      clearTimeout(pendingHighlightDeleteTimerRef.current);
      pendingHighlightDeleteTimerRef.current = null;
    }
    pendingHighlightDeleteRef.current = null;
    setPendingHighlightDelete(null);
    setHighlights(pending.previousHighlights);
    setBook((prev) => {
      if (!prev || prev.id !== pending.bookId) return prev;
      return { ...prev, highlights: pending.previousHighlights };
    });
  }, []);

  const openNoteEditor = (highlight) => {
    closePostHighlightPrompt();
    setEditingHighlight(highlight);
    setNoteDraft(highlight?.note || '');
  };

  const applyHighlightNoteLocally = useCallback((cfiRange, note) => {
    const normalizeCfi = (value) => (value || '').toString().replace(/\s+/g, '');
    const target = normalizeCfi(cfiRange);
    if (!target) return false;

    let didUpdate = false;
    setHighlights((prev) => prev.map((item) => {
      const source = normalizeCfi(item?.cfiRange);
      if (!source) return item;
      const matches = source === target || source.includes(target) || target.includes(source);
      if (!matches) return item;
      didUpdate = true;
      return { ...item, note };
    }));

    setBook((prev) => {
      if (!prev) return prev;
      const nextHighlights = Array.isArray(prev.highlights)
        ? prev.highlights.map((item) => {
          const source = normalizeCfi(item?.cfiRange);
          if (!source) return item;
          const matches = source === target || source.includes(target) || target.includes(source);
          return matches ? { ...item, note } : item;
        })
        : prev.highlights;
      return { ...prev, highlights: nextHighlights };
    });

    return didUpdate;
  }, []);

  const handleInlineNoteMarkerActivate = useCallback((payload) => {
    const target = payload?.highlight;
    if (!target?.cfiRange) return;
    closePostHighlightPrompt();
    setShowDictionary(false);
    setDictionaryAnchor(null);
    setShowTranslation(false);
    setTranslationAnchor(null);
    setSelection(null);
    setSelectionMode('actions');
    setEditingHighlight(target);
    setNoteDraft(target?.note || '');
  }, [closePostHighlightPrompt]);

  const closeNoteEditor = () => {
    setEditingHighlight(null);
    setNoteDraft('');
  };

  const saveHighlightNote = async () => {
    const currentBook = bookRef.current;
    if (!currentBook || !editingHighlight?.cfiRange) return;
    const nextNote = noteDraft.trim();
    applyHighlightNoteLocally(editingHighlight.cfiRange, nextNote);
    try {
      const updated = await updateHighlightNote(currentBook.id, editingHighlight.cfiRange, nextNote);
      if (updated) {
        setHighlights(updated);
        setBook({ ...currentBook, highlights: updated });
      }
      showReaderToast({
        tone: 'success',
        title: 'Note saved',
        message: nextNote ? 'Highlight note updated.' : 'Highlight note removed.'
      });
    } catch (err) {
      console.error(err);
      showReaderToast({
        tone: 'warning',
        title: 'Could not save note',
        message: 'Try again in a moment.'
      });
    } finally {
      closeNoteEditor();
    }
  };

  const savePostHighlightPromptNote = async () => {
    const currentBook = bookRef.current;
    const target = postHighlightPrompt?.highlight;
    if (!currentBook || !target?.cfiRange) return;
    const nextNote = postHighlightNoteDraft.trim();
    if (!nextNote) {
      setPostHighlightNoteError('Write a note first.');
      return;
    }
    applyHighlightNoteLocally(target.cfiRange, nextNote);
    setIsSavingPostHighlightNote(true);
    setPostHighlightNoteError('');
    try {
      const updated = await updateHighlightNote(currentBook.id, target.cfiRange, nextNote);
      if (updated) {
        setHighlights(updated);
        setBook({ ...currentBook, highlights: updated });
      }
      closePostHighlightPrompt();
      showReaderToast({
        tone: 'success',
        title: 'Note saved',
        message: 'Note added to highlight.'
      });
    } catch (err) {
      console.error(err);
      setPostHighlightNoteError('Could not save note. Try again.');
      showReaderToast({
        tone: 'warning',
        title: 'Could not save note',
        message: 'Try again in a moment.'
      });
    } finally {
      setIsSavingPostHighlightNote(false);
    }
  };

  const handleLocationChange = (loc) => {
    if (!loc?.start || !bookId) return;
    lastActiveRef.current = Date.now();
    currentLocationCfiRef.current = loc.start.cfi || '';
    setCurrentLocationCfi(currentLocationCfiRef.current);
    const nextProgress = Math.min(Math.max(Math.floor((loc.percentage || 0) * 100), 0), 100);
    queueProgressPersist(loc.start.cfi, loc.percentage || 0);
    setProgressPct(nextProgress);
    setCurrentHref(loc.start.href || '');

    // Automatically summarise each new "screen" in the background.  If the
    // current CFI differs from the last summarised one and no background
    // summarisation is underway, trigger a new summary.  This builds up the
    // cumulative story memory without interrupting the reader.
    const currentCfi = loc.start.cfi;
    if (currentCfi && lastSummaryCfiRef.current !== currentCfi && !isBackgroundSummarizingRef.current) {
      lastSummaryCfiRef.current = currentCfi;
      summariseBackground(currentCfi);
    }
  };

  const flattenTocItems = (items, depth = 0, acc = []) => {
    if (!Array.isArray(items)) return acc;
    items.forEach((item) => {
      if (!item) return;
      const href = typeof item.href === 'string' ? item.href : '';
      const labelBase = typeof item.label === 'string' ? item.label : '';
      const label = labelBase.trim() || `Section ${acc.length + 1}`;
      if (href) {
        acc.push({ href, label, depth });
      }
      if (Array.isArray(item.subitems) && item.subitems.length) {
        flattenTocItems(item.subitems, depth + 1, acc);
      }
    });
    return acc;
  };

  const tocItems = flattenTocItems(toc);

  const normalizeHref = (href = '') => href.split('#')[0];
  const isTocItemActive = (href) => {
    const active = normalizeHref(currentHref);
    const target = normalizeHref(href);
    if (!active || !target) return false;
    return active.includes(target) || target.includes(active);
  };

  const handleTocSelect = (href) => {
    if (!href) return;
    setShowSidebar(false);
    jumpToCfi(href, { rememberReturnSpot: true, source: 'toc' });
  };

  // NOTE: Intermediate summaries were previously generated after a fixed number
  // of page turns.  The new continuous chronicler renders this obsolete, so
  // the triggerIntermediateSummary function has been removed.

  const handleChapterEnd = async (chapterHref, rawText) => {
    // Generate a final summary when the reader reaches the end of a chapter.
    // The summary is appended to the global story memory.  Unlike the old
    // implementation we do not incorporate intermediate summaries, as the
    // chronicler updates the global summary on every screen change.
    const currentBook = bookRef.current;
    if (!currentBook || isChapterSummarizing) return;
    const alreadySummarized =
      currentBook.chapterSummaries?.some((s) => s.chapterHref === chapterHref) ||
      currentBook.aiSummaries?.some((s) => s.chapterHref === chapterHref);
    if (alreadySummarized) return;

    setIsChapterSummarizing(true);
    try {
      const memory = currentBook.globalSummary || '';
      const result = await summarizeChapter(rawText, memory, 'cumulative');
      if (result.text) {
        const updatedGlobal = memory ? `${memory}\n\n${result.text}` : result.text;
        const updatedBook = await saveChapterSummary(currentBook.id, chapterHref, result.text, updatedGlobal);
        if (updatedBook) {
          mergeBookUpdate(updatedBook);
        }
      } else if (result.error) {
        console.error('Chapter summary failed:', result.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsChapterSummarizing(false);
    }
  };

  // Explain the currently visible page in context.  This function
  // is invoked when the user clicks the "Explain Page" button.  It explains
  // the current page in the context of the story so far without updating memory.
  const handleManualPageSummary = async () => {
    const currentBook = bookRef.current;
    if (!rendition || !currentBook) return;
    setModalMode('page');
    setShowAIModal(true);
    setIsPageSummarizing(true);
    setPageSummary("");
    setPageError("");

    try {
      const viewer = rendition.getContents()[0];
      const pageText = viewer?.document?.body?.innerText || "";
      if (!pageText) {
        setPageError('Unable to read the current page.');
        return;
      }
      const memory = getStoryMemory(currentBook);
      const result = await summarizeChapter(pageText, memory, "contextual");
      if (result.text) {
        setPageSummary(result.text);
      } else if (result.error) {
        setPageError(aiUnavailableMessage);
      } else {
        setPageSummary("");
      }
    } catch (err) { console.error(err); } finally {
      setIsPageSummarizing(false);
    }
  };

  // Provide a story-so-far recap using the accumulated story memory.
  const handleStoryRecap = async () => {
    const currentBook = bookRef.current;
    if (!currentBook) return;
    setModalMode('story');
    setShowAIModal(true);
    setStoryRecap("");
    setStoryError("");

    const memory = getStoryMemory(currentBook);

    setIsStoryRecapping(true);
    try {
      let pageText = "";
      if (rendition) {
        try {
          const viewer = rendition.getContents()[0];
          pageText = viewer?.document?.body?.innerText || "";
        } catch (err) {
          console.error(err);
        }
      }
      if (!memory && !pageText) {
        setStoryError('Unable to read the current page.');
        return;
      }
      let effectiveMemory = memory;
      if (!effectiveMemory && pageText) {
        const seed = await summarizeChapter(pageText, "", "cumulative");
        if (seed.text) {
          effectiveMemory = seed.text;
          const updatedBook = await savePageSummary(currentBook.id, `seed-${Date.now()}`, seed.text, seed.text);
          if (updatedBook) mergeBookUpdate(updatedBook);
        } else if (seed.error) {
          setStoryError(aiUnavailableMessage);
        }
      }

      if (!effectiveMemory) {
        setStoryError((prev) => prev || 'No story memory yet. Read a bit more, then try again.');
        return;
      }

      const recapResult = await summarizeChapter(pageText, effectiveMemory, "recap");
      if (recapResult.text) {
        setStoryRecap(recapResult.text);
      } else if (recapResult.error) {
        setStoryError(aiUnavailableMessage);
        setStoryRecap(effectiveMemory);
      } else {
        setStoryRecap(effectiveMemory);
      }
    } catch (err) {
      console.error(err);
      if (memory) setStoryRecap(memory);
      setStoryError(aiUnavailableMessage);
    } finally {
      setIsStoryRecapping(false);
    }
  };

  // Summarise the current "screen" in the background using the cumulative
  // chronicler mode.  This builds up the running story memory without
  // interrupting the reader.  The updated summary is persisted via
  // savePageSummary.  Each call uses a unique key based on the CFI.
  const summariseBackground = async (cfi) => {
    const currentBook = bookRef.current;
    if (!rendition || !currentBook) return;
    if (isRebuildingMemory) return;
    try {
      isBackgroundSummarizingRef.current = true;
      const viewer = rendition.getContents()[0];
      const pageText = viewer?.document?.body?.innerText || "";
      if (!pageText) return;
      const memory = currentBook.globalSummary || "";
      const result = await summarizeChapter(pageText, memory, 'cumulative');
      if (result.text) {
        const updatedGlobal = memory ? `${memory}\n\n${result.text}` : result.text;
        const updatedBook = await savePageSummary(currentBook.id, cfi, result.text, updatedGlobal);
        if (updatedBook) {
          mergeBookUpdate(updatedBook);
        }
      } else if (result.error) {
        console.error('Background summary failed:', result.error);
      }
    } catch (err) {
      console.error(err);
    } finally {
      isBackgroundSummarizingRef.current = false;
    }
  };

  const rebuildStoryMemory = async () => {
    const currentBook = bookRef.current;
    if (!currentBook || !rendition) return;

    setIsRebuildingMemory(true);
    setRebuildProgress({ current: 0, total: 0 });
    setStoryError("");

    try {
      const epubBook = rendition.book;
      if (epubBook?.ready) await epubBook.ready;
      const spineItems = epubBook?.spine?.spineItems || [];
      const chapters = spineItems.filter(
        (section) => section && section.linear !== "no" && section.linear !== false
      );

      if (!chapters.length) {
        setStoryError('No readable chapters found.');
        return;
      }

      let memory = "";
      let updatedBook = null;
      setRebuildProgress({ current: 0, total: chapters.length });

      for (let i = 0; i < chapters.length; i += 1) {
        const section = chapters[i];
        await section.load(epubBook.load.bind(epubBook));
        const rawText = section?.document?.body?.innerText || "";
        section.unload();

        if (!rawText.trim()) {
          setRebuildProgress({ current: i + 1, total: chapters.length });
          continue;
        }

        const result = await summarizeChapter(rawText, memory, 'cumulative');
        if (!result.text && result.error) {
          setStoryError(result.error);
          break;
        }
        if (result.text) {
          memory = memory ? `${memory}\n\n${result.text}` : result.text;
          updatedBook = await saveChapterSummary(currentBook.id, section.href, result.text, memory);
        }
        setRebuildProgress({ current: i + 1, total: chapters.length });
      }

      if (updatedBook) {
        mergeBookUpdate(updatedBook);
        setStoryRecap(memory);
      }
    } catch (err) {
      console.error(err);
      setStoryError('Failed to rebuild memory. Please try again.');
    } finally {
      setIsRebuildingMemory(false);
    }
  };

  useEffect(() => {
    const loadBook = async () => {
      if (!bookId) return;
      const loaded = await getBook(bookId);
      mergeBookUpdate(loaded);
    };
    loadBook();
  }, [bookId, mergeBookUpdate]);

  useEffect(() => {
    if (!bookId) return;
    markBookStarted(bookId).catch((err) => {
      console.error(err);
    });
  }, [bookId]);

  useEffect(() => {
    initialPanelAppliedRef.current = false;
    initialJumpAppliedRef.current = false;
    initialSearchAppliedRef.current = false;
    initialFlashAppliedRef.current = false;
    pendingHighlightDeleteRef.current = null;
    setPendingHighlightDelete(null);
    if (pendingHighlightDeleteTimerRef.current) {
      clearTimeout(pendingHighlightDeleteTimerRef.current);
      pendingHighlightDeleteTimerRef.current = null;
    }
    if (readerToastTimerRef.current) {
      clearTimeout(readerToastTimerRef.current);
      readerToastTimerRef.current = null;
    }
    setReaderToast(null);
  }, [bookId, panelParam, cfiParam, searchTermParam, flashParam]);

  useEffect(() => {
    if (!book?.id || initialPanelAppliedRef.current) return;
    if (panelParam === 'highlights') {
      setShowHighlightsPanel(true);
      setShowBookmarksPanel(false);
    } else if (panelParam === 'bookmarks') {
      setShowBookmarksPanel(true);
      setShowHighlightsPanel(false);
    }
    initialPanelAppliedRef.current = true;
  }, [book?.id, panelParam]);

  useEffect(() => {
    if (!book?.id || !cfiParam || initialJumpAppliedRef.current) return;
    jumpToCfi(cfiParam);
    initialJumpAppliedRef.current = true;
  }, [book?.id, cfiParam]);

  useEffect(() => {
    if (!book?.id || !cfiParam || initialFlashAppliedRef.current) return;
    if (flashParam !== '1') return;
    if (!Array.isArray(highlights) || highlights.length === 0) return;

    const matched = highlights.find((item) => {
      const target = (item?.cfiRange || '').trim();
      if (!target) return false;
      return target === cfiParam || target.includes(cfiParam) || cfiParam.includes(target);
    });
    if (!matched?.cfiRange) return;

    triggerHighlightFlash(matched.cfiRange);
    initialFlashAppliedRef.current = true;
  }, [book?.id, cfiParam, panelParam, flashParam, highlights, triggerHighlightFlash]);

  useEffect(() => {
    if (!book?.id || !rendition || initialSearchAppliedRef.current) return;
    if (!searchTermParam) return;

    const normalized = searchTermParam.trim();
    if (!normalized) return;

    setShowSearchMenu(true);
    setSearchQuery(normalized);
    runSearch(normalized, cfiParam || '');
    initialSearchAppliedRef.current = true;
  }, [book?.id, rendition, searchTermParam, cfiParam]);

  useEffect(() => {
    if (!book?.id) return;
    const hasBookSettings = !!(book.readerSettings && Object.keys(book.readerSettings).length);
    const merged = hasBookSettings
      ? { ...DEFAULT_READER_SETTINGS, ...book.readerSettings }
      : { ...DEFAULT_READER_SETTINGS, ...(legacyReaderSettings || {}) };

    setSettings((prev) => {
      const prevJson = JSON.stringify(prev);
      const nextJson = JSON.stringify(merged);
      return prevJson === nextJson ? prev : merged;
    });
    settingsHydratedRef.current = true;
  }, [book?.id, legacyReaderSettings]);

  useEffect(() => {
    const incoming = Array.isArray(book?.highlights) ? book.highlights : [];
    setHighlights((prev) => (sameHighlights(prev, incoming) ? prev : incoming));
  }, [book?.highlights]);

  useEffect(() => {
    if (!highlights.length) {
      setSelectedHighlights([]);
      setFlashingHighlightCfi(null);
      setFlashingHighlightPulse(0);
      return;
    }
    if (flashingHighlightCfi && !highlights.some((h) => h.cfiRange === flashingHighlightCfi)) {
      setFlashingHighlightCfi(null);
      setFlashingHighlightPulse(0);
    }
    setSelectedHighlights((prev) => prev.filter((cfi) => highlights.some((h) => h.cfiRange === cfi)));
  }, [highlights, flashingHighlightCfi]);

  useEffect(() => {
    const incoming = Array.isArray(book?.bookmarks) ? book.bookmarks : [];
    setBookmarks((prev) => (sameBookmarks(prev, incoming) ? prev : incoming));
  }, [book?.bookmarks]);

  useEffect(() => {
    if (typeof book?.progress === 'number') {
      setProgressPct(book.progress);
    }
  }, [book?.progress]);

  useEffect(() => {
    if (typeof book?.lastLocation === 'string' && book.lastLocation.trim()) {
      currentLocationCfiRef.current = book.lastLocation.trim();
      setCurrentLocationCfi(currentLocationCfiRef.current);
    }
  }, [book?.id, book?.lastLocation]);

  useEffect(() => {
    if (!bookId) return;
    const intervalMs = 15000;
    const activeWindowMs = 60000;

    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActiveRef.current > activeWindowMs) return;
      if (isUpdatingStatsRef.current) return;

      try {
        isUpdatingStatsRef.current = true;
        const updated = await updateReadingStats(bookId, Math.floor(intervalMs / 1000));
        if (updated) mergeBookUpdate(updated);
      } catch (err) {
        console.error(err);
      } finally {
        isUpdatingStatsRef.current = false;
      }
    };

    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [bookId, mergeBookUpdate]);

  useEffect(() => {
    if (!bookId || !settingsHydratedRef.current) return;
    const timeoutId = setTimeout(() => {
      updateBookReaderSettings(bookId, settings).catch((err) => {
        console.error(err);
      });
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [bookId, settings]);

  useEffect(() => {
    if (!searchResults.length) return;
    if (activeSearchIndex >= 0 && activeSearchIndex < searchResults.length) return;
    setActiveSearchIndex(0);
  }, [searchResults, activeSearchIndex]);

  useEffect(() => {
    if (!searchResults.length || !activeSearchCfi) return;
    const indexFromCfi = searchResults.findIndex((result) => {
      const cfi = result?.cfi || "";
      return cfi === activeSearchCfi || cfi.includes(activeSearchCfi) || activeSearchCfi.includes(cfi);
    });
    if (indexFromCfi >= 0 && indexFromCfi !== activeSearchIndex) {
      setActiveSearchIndex(indexFromCfi);
    }
  }, [searchResults, activeSearchCfi, activeSearchIndex]);

  useEffect(() => {
    if (!showSearchMenu) return;
    const list = searchResultsListRef.current;
    if (!list) return;
    if (!searchResults.length) return;

    let targetIndex = -1;
    if (activeSearchCfi) {
      targetIndex = searchResults.findIndex((result) => {
        const cfi = result?.cfi || "";
        return cfi === activeSearchCfi || cfi.includes(activeSearchCfi) || activeSearchCfi.includes(cfi);
      });
    }
    if (targetIndex < 0 && activeSearchIndex >= 0 && activeSearchIndex < searchResults.length) {
      targetIndex = activeSearchIndex;
    }
    if (targetIndex < 0) {
      targetIndex = 0;
    }

    // Wait for the active row class/ref assignment to complete before scrolling.
    const id = window.requestAnimationFrame(() => {
      const activeRow = list.querySelector(
        `[data-search-result-index="${targetIndex}"]`
      );
      if (!activeRow) return;
      activeRow.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    });

    return () => window.cancelAnimationFrame(id);
  }, [showSearchMenu, searchResults, activeSearchIndex, activeSearchCfi]);

  useEffect(() => {
    if (!showAnnotationSearchMenu) return;
    const list = annotationSearchResultsListRef.current;
    if (!list) return;
    if (!annotationSearchResults.length || activeAnnotationSearchIndex < 0) return;

    const id = window.requestAnimationFrame(() => {
      const activeRow = list.querySelector(
        `[data-annotation-result-index="${activeAnnotationSearchIndex}"]`
      );
      if (!activeRow) return;
      activeRow.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    });

    return () => window.cancelAnimationFrame(id);
  }, [showAnnotationSearchMenu, annotationSearchResults, activeAnnotationSearchIndex]);

  useEffect(() => {
    if (!focusedSearchCfi) return;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setFocusedSearchCfi(null);
        return;
      }
      // Allow clicking a result row to move focus to another match without clearing first.
      if (target.closest('[data-search-result-index]')) return;
      setFocusedSearchCfi(null);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [focusedSearchCfi]);

  useEffect(() => {
    if (!showSearchMenu) return;
    const id = window.requestAnimationFrame(() => {
      const input = searchInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value?.length || 0;
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(end, end);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [showSearchMenu]);

  useEffect(() => {
    if (!showAnnotationSearchMenu) return;
    const id = window.requestAnimationFrame(() => {
      const input = annotationSearchInputRef.current;
      if (!input) return;
      input.focus();
      const end = input.value?.length || 0;
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(end, end);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [showAnnotationSearchMenu]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(READER_SEARCH_HISTORY_KEY, JSON.stringify(recentSearchQueries));
  }, [recentSearchQueries]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(READER_ANNOTATION_HISTORY_KEY, JSON.stringify(recentAnnotationSearchQueries));
  }, [recentAnnotationSearchQueries]);

  useEffect(() => {
    const resetArrowScrollState = () => {
      arrowScrollStateRef.current = { key: '', streak: 0, lastAt: 0 };
    };

    const computeArrowScrollDelta = (event, containerHeight) => {
      const now = Date.now();
      const prev = arrowScrollStateRef.current;
      const sameDirection = prev.key === event.key;
      const continuing = sameDirection && (event.repeat || now - prev.lastAt < 180);
      const streak = continuing ? prev.streak + 1 : 1;
      arrowScrollStateRef.current = { key: event.key, streak, lastAt: now };

      const stepRatio = Math.min(0.16 + (streak - 1) * 0.06, 0.55);
      return Math.max(36, Math.round(containerHeight * stepRatio));
    };

    const handleKey = (event) => {
      const isFindShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f';
      if (isFindShortcut) {
        event.preventDefault();
        setShowSearchMenu(true);
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          const end = input.value?.length || 0;
          if (typeof input.setSelectionRange === 'function') {
            input.setSelectionRange(end, end);
          }
        }
        return;
      }

      if (event.key === 'Escape' && showSearchMenu) {
        event.preventDefault();
        closeSearchMenu();
        return;
      }
      if (event.key === 'Escape' && showAnnotationSearchMenu) {
        event.preventDefault();
        closeAnnotationSearchMenu();
        return;
      }
      if (event.key === 'Escape' && focusedSearchCfi) {
        event.preventDefault();
        setFocusedSearchCfi(null);
        return;
      }

      if (!rendition) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }

      if (settings.flow === 'paginated') {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          rendition.next();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          rendition.prev();
        }
      } else {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          const scrollContainer = rendition?.manager?.container;
          if (scrollContainer && typeof scrollContainer.scrollBy === 'function') {
            const delta = computeArrowScrollDelta(event, scrollContainer.clientHeight || window.innerHeight || 720);
            setLastArrowScrollStep(delta);
            scrollContainer.scrollBy({ top: direction * delta, left: 0, behavior: 'smooth' });
            return;
          }

          const sourceWindow = event.view && typeof event.view.scrollBy === 'function'
            ? event.view
            : null;
          if (sourceWindow) {
            const delta = computeArrowScrollDelta(event, sourceWindow.innerHeight || window.innerHeight || 720);
            setLastArrowScrollStep(delta);
            sourceWindow.scrollBy({ top: direction * delta, left: 0, behavior: 'smooth' });
            return;
          }

          const content = rendition.getContents()[0];
          const win = content?.window;
          if (!win) return;
          const delta = computeArrowScrollDelta(event, win.innerHeight || window.innerHeight || 720);
          setLastArrowScrollStep(delta);
          win.scrollBy({ top: direction * delta, left: 0, behavior: 'smooth' });
        }
      }
    };

    const handleKeyUp = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        resetArrowScrollState();
      }
    };

    const keydownOptions = { passive: false };
    const attachedContentWindows = new Set();

    const attachContentWindowListeners = () => {
      const contents = rendition?.getContents?.() || [];
      contents.forEach((content) => {
        const win = content?.window;
        if (!win || attachedContentWindows.has(win)) return;
        win.addEventListener('keydown', handleKey, keydownOptions);
        win.addEventListener('keyup', handleKeyUp);
        attachedContentWindows.add(win);
      });
    };

    window.addEventListener('keydown', handleKey, keydownOptions);
    window.addEventListener('keyup', handleKeyUp);
    attachContentWindowListeners();

    const onRendered = () => attachContentWindowListeners();
    const onRelocated = () => attachContentWindowListeners();
    rendition?.on?.('rendered', onRendered);
    rendition?.on?.('relocated', onRelocated);

    return () => {
      window.removeEventListener('keydown', handleKey, keydownOptions);
      window.removeEventListener('keyup', handleKeyUp);
      attachedContentWindows.forEach((win) => {
        win.removeEventListener('keydown', handleKey, keydownOptions);
        win.removeEventListener('keyup', handleKeyUp);
      });
      rendition?.off?.('rendered', onRendered);
      rendition?.off?.('relocated', onRelocated);
    };
  }, [rendition, settings.flow, showSearchMenu, showAnnotationSearchMenu, focusedSearchCfi]);

  const phoneticText =
    dictionaryEntry?.phonetic ||
    dictionaryEntry?.phonetics?.find((p) => p.text)?.text ||
    "";
  const isReaderDark = settings.theme === 'dark';
  const isReaderSepia = settings.theme === 'sepia';
  const returnSpotSourceLabel = useMemo(() => {
    if (!returnSpot?.source) return 'jump';
    const labels = {
      search: 'search',
      annotation: 'annotation search',
      highlight: 'highlight',
      bookmark: 'bookmark',
      footnote: 'note',
      toc: 'contents'
    };
    return labels[returnSpot.source] || 'jump';
  }, [returnSpot?.source]);
  const displayActiveSearchIndex = useMemo(() => {
    if (!searchResults.length) return -1;
    if (activeSearchCfi) {
      const idx = searchResults.findIndex((result) => {
        const cfi = result?.cfi || "";
        return cfi === activeSearchCfi || cfi.includes(activeSearchCfi) || activeSearchCfi.includes(cfi);
      });
      if (idx >= 0) return idx;
    }
    if (activeSearchIndex >= 0 && activeSearchIndex < searchResults.length) return activeSearchIndex;
    return 0;
  }, [searchResults, activeSearchIndex, activeSearchCfi]);
  const toolbarIconButtonBaseClass = 'p-2 rounded-full transition hover:bg-gray-100 dark:hover:bg-gray-700';
  const toolbarUtilityInactiveClass = `${toolbarIconButtonBaseClass} text-inherit`;
  const toolbarUtilityActiveClass = `${toolbarIconButtonBaseClass} text-blue-600 bg-blue-50 dark:bg-blue-900/30`;
  const toggleDarkTheme = () => {
    setSettings((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }));
  };
  const toggleSepiaTheme = () => {
    setSettings((s) => ({ ...s, theme: s.theme === 'sepia' ? 'light' : 'sepia' }));
  };
  const readerThemeClass = isReaderDark
    ? 'bg-gray-900 text-white'
    : isReaderSepia
      ? 'bg-amber-50 text-amber-950'
      : 'bg-gray-100 text-gray-800';
  const searchHighlightMode = showSearchMenu
    ? 'all-search'
    : focusedSearchCfi
      ? 'focus-only'
      : 'none';

  if (!book) return <div className="p-10 text-center dark:bg-gray-900 dark:text-gray-400">Loading...</div>;

  return (
    <div className={`h-screen flex flex-col overflow-hidden transition-colors duration-200 ${readerThemeClass}`}>
      <span className="sr-only" data-testid="search-focus-state">
        {focusedSearchCfi ? 'focused' : 'none'}
      </span>
      <span className="sr-only" data-testid="search-highlight-mode">
        {searchHighlightMode}
      </span>
      <span className="sr-only" data-testid="search-highlight-count">
        {String(searchHighlightCount)}
      </span>
      <span className="sr-only" data-testid="highlight-flash-cfi">
        {flashingHighlightCfi || ''}
      </span>
      <span className="sr-only" data-testid="selection-cfi">
        {selection?.cfiRange || ''}
      </span>
      <span className="sr-only" data-testid="reader-current-cfi">
        {currentLocationCfi || ''}
      </span>
      <span className="sr-only" data-testid="reader-last-arrow-scroll-step">
        {String(lastArrowScrollStep)}
      </span>
      
      <style>{`
        @keyframes orbit {
          from { transform: rotate(0deg) translateX(70px) rotate(0deg); }
          to { transform: rotate(360deg) translateX(70px) rotate(-360deg); }
        }
        .char-icon { position: absolute; animation: orbit 5s linear infinite; }
      `}</style>

      {showAIModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md"
            onClick={() => setShowAIModal(false)}
          />
          <div
            className={`relative w-full max-w-lg p-8 rounded-3xl shadow-2xl animate-in zoom-in duration-200 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            {/* Loading states for AI analysis */}
            {modalMode === 'page' && isPageSummarizing ? (
              <div className="flex flex-col items-center justify-center py-10 min-h-[300px] relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="char-icon" style={{ animationDelay: `-${i * 1}s` }}>
                      <User className="text-blue-400/50" size={20} />
                    </div>
                  ))}
                </div>
                <Sparkles className="text-blue-500 animate-spin mb-6" size={40} />
                <p className="text-sm font-bold tracking-widest uppercase animate-pulse">Consulting the Muses...</p>
              </div>
            ) : modalMode === 'story' && isStoryRecapping ? (
              <div className="flex flex-col items-center justify-center py-10 min-h-[300px]">
                <Sparkles className="text-blue-500 animate-spin mb-6" size={40} />
                <p className="text-sm font-bold tracking-widest uppercase animate-pulse">Weaving the Story So Far...</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b pb-4 dark:border-gray-700">
                  <h3 className="text-lg font-black text-blue-500 uppercase tracking-tighter">
                    {/* Dynamic heading based on the modal mode */}
                    {modalMode === 'page'
                      ? 'Page Explained'
                      : 'Story So Far'}
                  </h3>
                  <button
                    onClick={() => setShowAIModal(false)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    <X size={20} />
                  </button>
                </div>
                {modalContext?.chapterLabel && (
                  <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400">
                    {modalContext.chapterLabel}
                  </div>
                )}

                {modalMode === 'page' && !isPageSummarizing && !getStoryMemory(book) && (
                  <div className="text-xs text-yellow-500">
                    No story memory yet. This explanation may lack context.
                  </div>
                )}
                {modalMode === 'story' && !isStoryRecapping && !getStoryMemory(book) && (
                  <div className="flex items-center justify-between gap-3 text-xs text-yellow-500">
                    <span>No story memory yet. Rebuild it to get a full recap.</span>
                    <button
                      onClick={rebuildStoryMemory}
                      disabled={isRebuildingMemory}
                      className="px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold disabled:opacity-60"
                    >
                      {isRebuildingMemory ? 'Rebuilding…' : 'Rebuild Memory'}
                    </button>
                  </div>
                )}
                {modalMode === 'story' && isRebuildingMemory && (
                  <div className="text-[10px] text-gray-400">
                    Rebuilding {rebuildProgress.current}/{rebuildProgress.total}
                  </div>
                )}

                {modalMode === 'page' && pageError && (
                  <div className="text-xs text-yellow-500">
                    {pageError}
                  </div>
                )}
                {modalMode === 'story' && storyError && (
                  <div className="text-xs text-yellow-500">
                    {storyError}
                  </div>
                )}

                <div className="max-h-[55vh] overflow-y-auto pr-2 custom-scrollbar space-y-6">
                  {(() => {
                    const storyMemory = getStoryMemory(book);
                    // Choose the appropriate content based on the mode: the contextual page
                    // explanation or the story-so-far recap.
                    const content =
                      modalMode === 'page'
                        ? pageError
                          ? `Summary:\n${pageError}`
                          : pageSummary ||
                            'Summary:\nYour story is unfolding. Read more to see the analysis.'
                        : storyError
                          ? `Summary:\n${storyError}`
                          : storyRecap || storyMemory ||
                            'Summary:\nYour story is unfolding. Read more to build the recap.';

                    // Separate the summary and character sections based on the label.
                    const [summaryPart, charPart] = content.split(/Characters so far:/i);

                    return (
                      <>
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <h4 className="text-xs font-black text-gray-400 uppercase mb-2">Summary :</h4>
                          <div className="italic leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {summaryPart.replace(/Summary:/i, '').trim()}
                          </div>
                        </div>

                        {charPart && (
                          <div className="pt-4 border-t dark:border-gray-700">
                            <h4 className="text-xs font-black text-gray-400 uppercase mb-2">Characters so far :</h4>
                            <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-medium">
                              {charPart.trim()}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <button
                  onClick={() => setShowAIModal(false)}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl shadow-xl shadow-blue-500/20 active:scale-95 transition-all"
                >
                  CONTINUE READING
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showFontMenu && (
        <div className="fixed inset-0 z-[55]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowFontMenu(false)}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-sm rounded-3xl shadow-2xl p-5 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Type size={18} className="text-gray-400" />
                <div className="text-sm font-bold">Text Settings</div>
              </div>
              <button
                onClick={() => setShowFontMenu(false)}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">
                  Text size
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSettings(s => ({ ...s, fontSize: Math.max(80, s.fontSize - 5) }))}
                    className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 text-sm font-bold"
                  >
                    -
                  </button>
                  <input
                    type="range"
                    min="80"
                    max="160"
                    step="5"
                    value={settings.fontSize}
                    onChange={(e) => setSettings(s => ({ ...s, fontSize: Number(e.target.value) }))}
                    className="flex-1"
                  />
                  <button
                    onClick={() => setSettings(s => ({ ...s, fontSize: Math.min(160, s.fontSize + 5) }))}
                    className="w-8 h-8 rounded-full border border-gray-200 dark:border-gray-700 text-sm font-bold"
                  >
                    +
                  </button>
                  <div className="text-xs font-bold w-12 text-right">{settings.fontSize}%</div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">
                  Font
                </div>
                <select
                  value={settings.fontFamily}
                  onChange={(e) => setSettings(s => ({ ...s, fontFamily: e.target.value }))}
                  className="w-full py-2 px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold bg-transparent"
                >
                  {fontOptions.map((font) => (
                    <option key={font.label} value={font.value}>
                      {font.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSearchMenu && (
        <div className="fixed inset-0 z-[55]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeSearchMenu}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              isReaderDark ? 'bg-gray-800 border border-gray-700 text-gray-100' : 'bg-white border border-gray-200 text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <SearchIcon size={18} className={isReaderDark ? 'text-gray-400' : 'text-gray-600'} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search inside this book..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchInputKeyDown}
                className={`flex-1 bg-transparent outline-none text-sm font-semibold ${
                  isReaderDark ? 'text-gray-100 placeholder:text-gray-400' : 'text-black placeholder:text-gray-500'
                }`}
              />
              <button
                onClick={closeSearchMenu}
                className={`p-1 hover:text-red-500 ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className={`mt-3 flex items-center justify-between text-[11px] font-semibold ${isReaderDark ? 'text-gray-300' : 'text-gray-800'}`}>
              <span>
                {isSearching
                  ? 'Searching...'
                  : searchResults.length
                    ? `${displayActiveSearchIndex + 1 > 0 ? displayActiveSearchIndex + 1 : 1}/${searchResults.length}`
                    : '0 results'}
              </span>
              <span className="sr-only" data-testid="search-progress">
                {searchResults.length
                  ? `${displayActiveSearchIndex + 1 > 0 ? displayActiveSearchIndex + 1 : 1}/${searchResults.length}`
                  : '0/0'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrevResult}
                  disabled={!searchResults.length}
                  className={`px-2 py-1 rounded-full border disabled:opacity-40 ${
                    isReaderDark
                      ? 'border-gray-700 hover:bg-gray-700'
                      : 'border-gray-300 hover:bg-gray-100'
                  }`}
                  title="Previous result"
                >
                  <span className="text-xs font-bold">&lt;</span>
                </button>
                <button
                  onClick={goToNextResult}
                  disabled={!searchResults.length}
                  className={`px-2 py-1 rounded-full border disabled:opacity-40 ${
                    isReaderDark
                      ? 'border-gray-700 hover:bg-gray-700'
                      : 'border-gray-300 hover:bg-gray-100'
                  }`}
                  title="Next result"
                >
                  <span className="text-xs font-bold">&gt;</span>
                </button>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => runSearch(searchQuery)}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
              >
                Search
              </button>
              <button
                onClick={clearSearch}
                className={`flex-1 py-2 rounded-xl text-xs font-bold ${
                  isReaderDark
                    ? 'border border-gray-700 text-gray-100'
                    : 'border border-gray-300 text-gray-900'
                }`}
              >
                Clear
              </button>
            </div>

            {recentSearchQueries.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-widest font-bold ${
                      isReaderDark ? 'text-gray-400' : 'text-gray-600'
                    }`}
                  >
                    Recent queries
                  </span>
                  <button
                    type="button"
                    data-testid="search-history-clear"
                    onClick={clearRecentSearchQueries}
                    className={`text-[11px] font-semibold ${
                      isReaderDark ? 'text-gray-300 hover:text-red-400' : 'text-gray-700 hover:text-red-600'
                    }`}
                  >
                    Reset history
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recentSearchQueries.map((term, idx) => (
                    <button
                      key={`${term}-${idx}`}
                      type="button"
                      data-testid={`search-history-item-${idx}`}
                      onClick={() => handleRecentSearchClick(term)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold border transition ${
                        isReaderDark
                          ? 'border-gray-600 text-gray-200 hover:border-blue-400 hover:text-blue-200'
                          : 'border-gray-300 text-gray-800 hover:border-blue-400 hover:text-blue-700'
                      }`}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={searchResultsListRef} data-testid="search-results-list" className="mt-4 max-h-[45vh] overflow-y-auto pr-1 space-y-2">
              {!isSearching && searchQuery && searchResults.length === 0 && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>No matches found.</div>
              )}
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.cfi}-${idx}`}
                  onClick={() => handleSearchResultClick(idx)}
                  data-testid={`search-result-item-${idx}`}
                  data-search-result-index={idx}
                  className={`w-full text-left p-3 rounded-2xl border transition ${
                    displayActiveSearchIndex === idx
                      ? isReaderDark
                        ? 'border-yellow-400 bg-yellow-900/30'
                        : 'border-yellow-500 bg-yellow-50'
                      : isReaderDark
                        ? 'border-transparent hover:border-gray-700'
                        : 'border-transparent hover:border-gray-200'
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-widest mb-1 font-bold ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    Result {idx + 1}
                  </div>
                  <div className={`text-sm font-medium ${isReaderDark ? 'text-gray-100' : 'text-black'}`}>
                    {result.excerpt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showAnnotationSearchMenu && (
        <div className="fixed inset-0 z-[55]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeAnnotationSearchMenu}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              isReaderDark ? 'bg-gray-800 border border-gray-700 text-gray-100' : 'bg-white border border-gray-200 text-gray-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <BookText size={18} className={isReaderDark ? 'text-gray-400' : 'text-gray-600'} />
              <input
                ref={annotationSearchInputRef}
                type="text"
                placeholder="Search highlights, notes, bookmarks..."
                value={annotationSearchQuery}
                onChange={(e) => setAnnotationSearchQuery(e.target.value)}
                onKeyDown={handleAnnotationSearchInputKeyDown}
                className={`flex-1 bg-transparent outline-none text-sm font-semibold ${
                  isReaderDark ? 'text-gray-100 placeholder:text-gray-400' : 'text-black placeholder:text-gray-500'
                }`}
              />
              <button
                onClick={closeAnnotationSearchMenu}
                className={`p-1 hover:text-red-500 ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className={`mt-3 flex items-center justify-between text-[11px] font-semibold ${isReaderDark ? 'text-gray-300' : 'text-gray-800'}`}>
              <span>
                {annotationSearchResults.length
                  ? `${activeAnnotationSearchIndex + 1 > 0 ? activeAnnotationSearchIndex + 1 : 1}/${annotationSearchResults.length}`
                  : '0 results'}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrevAnnotationResult}
                  disabled={!annotationSearchResults.length}
                  className={`px-2 py-1 rounded-full border disabled:opacity-40 ${
                    isReaderDark
                      ? 'border-gray-700 hover:bg-gray-700'
                      : 'border-gray-300 hover:bg-gray-100'
                  }`}
                  title="Previous result"
                >
                  <span className="text-xs font-bold">&lt;</span>
                </button>
                <button
                  onClick={goToNextAnnotationResult}
                  disabled={!annotationSearchResults.length}
                  className={`px-2 py-1 rounded-full border disabled:opacity-40 ${
                    isReaderDark
                      ? 'border-gray-700 hover:bg-gray-700'
                      : 'border-gray-300 hover:bg-gray-100'
                  }`}
                  title="Next result"
                >
                  <span className="text-xs font-bold">&gt;</span>
                </button>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => runAnnotationSearch(annotationSearchQuery)}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
              >
                Search
              </button>
              <button
                onClick={clearAnnotationSearch}
                className={`flex-1 py-2 rounded-xl text-xs font-bold ${
                  isReaderDark
                    ? 'border border-gray-700 text-gray-100'
                    : 'border border-gray-300 text-gray-900'
                }`}
              >
                Clear
              </button>
            </div>

            {recentAnnotationSearchQueries.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[10px] uppercase tracking-widest font-bold ${
                      isReaderDark ? 'text-gray-400' : 'text-gray-600'
                    }`}
                  >
                    Recent queries
                  </span>
                  <button
                    type="button"
                    data-testid="annotation-search-history-clear"
                    onClick={clearRecentAnnotationSearchQueries}
                    className={`text-[11px] font-semibold ${
                      isReaderDark ? 'text-gray-300 hover:text-red-400' : 'text-gray-700 hover:text-red-600'
                    }`}
                  >
                    Reset history
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {recentAnnotationSearchQueries.map((term, idx) => (
                    <button
                      key={`${term}-${idx}`}
                      type="button"
                      data-testid={`annotation-search-history-item-${idx}`}
                      onClick={() => handleRecentAnnotationSearchClick(term)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold border transition ${
                        isReaderDark
                          ? 'border-gray-600 text-gray-200 hover:border-blue-400 hover:text-blue-200'
                          : 'border-gray-300 text-gray-800 hover:border-blue-400 hover:text-blue-700'
                      }`}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div
              ref={annotationSearchResultsListRef}
              data-testid="annotation-search-results-list"
              className="mt-4 max-h-[45vh] overflow-y-auto pr-1 space-y-2"
            >
              {annotationSearchQuery && annotationSearchResults.length === 0 && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>No annotation matches found.</div>
              )}
              {annotationSearchResults.map((result, idx) => (
                <button
                  key={result.id}
                  onClick={() => handleAnnotationSearchResultClick(idx)}
                  data-testid={`annotation-search-result-item-${idx}`}
                  data-annotation-result-index={idx}
                  className={`w-full text-left p-3 rounded-2xl border transition ${
                    activeAnnotationSearchIndex === idx
                      ? isReaderDark
                        ? 'border-yellow-400 bg-yellow-900/30'
                        : 'border-yellow-500 bg-yellow-50'
                      : isReaderDark
                        ? 'border-transparent hover:border-gray-700'
                        : 'border-transparent hover:border-gray-200'
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-widest mb-1 font-bold ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}>
                    {result.label} {idx + 1}
                  </div>
                  <div className={`text-sm font-medium ${isReaderDark ? 'text-gray-100' : 'text-black'}`}>
                    {result.excerpt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showDictionary && (() => {
        const panelStyle = getContextPanelStyle(dictionaryAnchor || selection?.pos);
        return (
        <div className="fixed inset-0 z-[75]" onClick={closeDictionary}>
          <div
            className={`absolute rounded-3xl shadow-2xl p-5 flex flex-col ${
              isReaderDark
                ? 'bg-gray-800 border border-gray-700 text-gray-100'
                : 'bg-white border border-gray-200 text-gray-900'
            }`}
            style={panelStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <BookOpenText size={18} className={isReaderDark ? 'text-gray-400' : 'text-gray-600'} />
              <input
                type="text"
                placeholder="Look up a word..."
                value={dictionaryQuery}
                onChange={(e) => setDictionaryQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') lookupDictionary(dictionaryQuery);
                }}
                className={`flex-1 bg-transparent outline-none text-sm ${
                  isReaderDark ? 'text-gray-100 placeholder:text-gray-400' : 'text-gray-900 placeholder:text-gray-500'
                }`}
              />
              <button
                onClick={closeDictionary}
                className={`p-1 hover:text-red-500 ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => lookupDictionary(dictionaryQuery)}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
              >
                Define
              </button>
              <button
                onClick={clearDictionary}
                className={`flex-1 py-2 rounded-xl text-xs font-bold ${
                  isReaderDark ? 'border border-gray-700' : 'border border-gray-300 text-gray-900'
                }`}
              >
                Clear
              </button>
            </div>

            <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
              {isDefining && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}>Looking up definition...</div>
              )}
              {!isDefining && dictionaryError && (
                <div className="text-xs text-red-500">{dictionaryError}</div>
              )}
              {!isDefining && dictionaryEntry && (
                <div className="space-y-3">
                  <div>
                    <div className={`text-lg font-bold ${isReaderDark ? 'text-gray-100' : 'text-gray-900'}`}>
                      {dictionaryEntry.word}
                    </div>
                    {phoneticText && (
                      <div className={`text-xs ${isReaderDark ? 'text-gray-300' : 'text-gray-700'}`}>{phoneticText}</div>
                    )}
                  </div>

                  {(dictionaryEntry.meanings || []).slice(0, 3).map((meaning, idx) => (
                    <div key={`${meaning.partOfSpeech}-${idx}`} className="space-y-2">
                      <div className={`text-xs uppercase tracking-widest ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {meaning.partOfSpeech}
                      </div>
                      {(meaning.definitions || []).slice(0, 2).map((def, dIdx) => (
                        <div key={`${idx}-${dIdx}`} className={`text-sm ${isReaderDark ? 'text-gray-200' : 'text-gray-800'}`}>
                          - {def.definition}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {showTranslation && (() => {
        const panelStyle = getContextPanelStyle(translationAnchor || selection?.pos);
        return (
        <div className="fixed inset-0 z-[75]" data-testid="translation-panel" onClick={closeTranslation}>
          <div
            className={`absolute rounded-3xl shadow-2xl p-5 flex flex-col ${
              isReaderDark
                ? 'bg-gray-800 border border-gray-700 text-gray-100'
                : 'bg-white border border-gray-200 text-gray-900'
            }`}
            style={panelStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <Languages size={18} className={isReaderDark ? 'text-gray-400' : 'text-gray-600'} />
              <textarea
                rows={2}
                placeholder="Translate this text..."
                value={translationQuery}
                onChange={(e) => setTranslationQuery(e.target.value)}
                className={`flex-1 bg-transparent outline-none text-sm resize-none ${
                  isReaderDark ? 'text-gray-100 placeholder:text-gray-400' : 'text-gray-900 placeholder:text-gray-500'
                }`}
              />
              <button
                onClick={closeTranslation}
                className={`p-1 hover:text-red-500 ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={sourceLanguage}
                onChange={(e) => {
                  const next = e.target.value;
                  setSourceLanguage(next);
                  if (translationQuery.trim()) translateText(translationQuery, targetLanguage, next);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold ${
                  isReaderDark
                    ? 'border border-gray-700 bg-gray-800 text-gray-100'
                    : 'border border-gray-300 bg-white text-gray-900'
                }`}
              >
                {sourceLanguageOptions.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
              <select
                value={targetLanguage}
                onChange={(e) => {
                  const next = e.target.value;
                  setTargetLanguage(next);
                  if (translationQuery.trim()) translateText(translationQuery, next, sourceLanguage);
                }}
                className={`py-2 px-3 rounded-xl text-xs font-bold ${
                  isReaderDark
                    ? 'border border-gray-700 bg-gray-800 text-gray-100'
                    : 'border border-gray-300 bg-white text-gray-900'
                }`}
              >
                {languageOptions.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => translateText(translationQuery, targetLanguage, sourceLanguage)}
                className="py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
              >
                Translate
              </button>
              <button
                onClick={clearTranslation}
                className={`py-2 rounded-xl text-xs font-bold ${
                  isReaderDark ? 'border border-gray-700' : 'border border-gray-300 text-gray-900'
                }`}
              >
                Clear
              </button>
            </div>

            <div className={`mt-2 text-[10px] uppercase tracking-widest ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}>
              Provider: {translateProviderLabel}{SUPPORTS_AUTO_DETECT ? '' : ' · select source language'}
            </div>

            <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
              {isTranslating && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}>Translating...</div>
              )}
              {!isTranslating && translationError && (
                <div className="text-xs text-red-500">{translationError}</div>
              )}
              {!isTranslating && translationResult && (
                <div className={`p-3 rounded-2xl text-sm whitespace-pre-wrap ${
                  isReaderDark ? 'bg-gray-900/40 text-gray-200' : 'bg-gray-100 text-gray-900'
                }`}>
                  {translationResult}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {footnotePreview && (() => {
        const panelStyle = getFootnotePanelStyle(footnotePreview);
        return (
          <div className="fixed inset-0 z-[74] pointer-events-none" data-testid="footnote-preview-overlay">
            <div
              ref={footnotePreviewPanelRef}
              data-testid="footnote-preview-panel"
              className={`absolute rounded-2xl shadow-2xl border p-3 pointer-events-auto ${
                isReaderDark
                  ? 'bg-gray-800 border-gray-700 text-gray-100'
                  : 'bg-white border-gray-200 text-gray-900'
              }`}
              style={panelStyle}
            >
              <div className="flex items-center justify-between gap-2">
                <div className={`text-[10px] uppercase tracking-widest font-bold ${isReaderDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  Note preview {footnotePreview?.label ? `· ${footnotePreview.label}` : ''}
                </div>
                <button
                  onClick={closeFootnotePreview}
                  className={`p-1 ${isReaderDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-500'}`}
                  aria-label="Close note preview"
                >
                  <X size={14} />
                </button>
              </div>
              <div className={`mt-2 max-h-40 overflow-y-auto pr-1 text-sm leading-relaxed ${isReaderDark ? 'text-gray-200' : 'text-gray-800'}`}>
                {footnotePreview.text}
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeFootnotePreview}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    isReaderDark
                      ? 'border border-gray-600 text-gray-200 hover:bg-gray-700'
                      : 'border border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!footnotePreview?.targetHref) return;
                    jumpToCfi(footnotePreview.targetHref, { rememberReturnSpot: true, source: 'footnote' });
                    closeFootnotePreview();
                  }}
                  disabled={!footnotePreview?.targetHref}
                  className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Open full note
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showHighlightsPanel && (
        <div className="fixed inset-0 z-[55]" data-testid="highlights-panel">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowHighlightsPanel(false)}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Highlighter size={18} className={isReaderDark ? 'text-gray-400' : 'text-gray-600'} />
                <div className={`text-sm font-bold ${isReaderDark ? 'text-gray-100' : 'text-gray-900'}`}>Highlights</div>
              </div>
              <button
                onClick={() => setShowHighlightsPanel(false)}
                className={`p-1 ${isReaderDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-500'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className={`mt-3 text-[11px] ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>
              {highlights.length} highlight{highlights.length === 1 ? '' : 's'}
              <button
                onClick={exportHighlightsPdf}
                disabled={!selectedHighlights.length || isExportingHighlights}
                className="ml-3 px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold disabled:opacity-50"
              >
                {isExportingHighlights ? 'Exporting...' : 'Export Selected'}
              </button>
            </div>

            <div className={`mt-2 flex items-center justify-between text-[11px] ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>
              <span>
                {selectedHighlights.length} selected
              </span>
              <div className="flex items-center gap-2">
                {highlights.length > 0 && (
                  <button
                    onClick={() => {
                      const allSelected = selectedHighlights.length === highlights.length;
                      setSelectedHighlights(allSelected ? [] : highlights.map((h) => h.cfiRange));
                    }}
                    className="text-[10px] font-bold text-blue-500"
                  >
                    {selectedHighlights.length === highlights.length ? 'Unselect all' : 'Select all'}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 max-h-[55vh] overflow-y-auto pr-1 space-y-3">
              {highlights.length === 0 && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>No highlights yet.</div>
              )}
              {highlights.map((h, idx) => (
                <div
                  key={`${h.cfiRange}-${idx}`}
                  className={`p-3 rounded-2xl border border-transparent transition ${
                    isReaderDark ? 'hover:border-gray-700' : 'hover:border-gray-200'
                  }`}
                  data-testid="highlight-item"
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => {
                        setSelectedHighlights((prev) => prev.includes(h.cfiRange)
                          ? prev.filter((cfi) => cfi !== h.cfiRange)
                          : [...prev, h.cfiRange]
                        );
                      }}
                      className={`mt-1 w-4 h-4 rounded border flex items-center justify-center ${
                        selectedHighlights.includes(h.cfiRange)
                          ? 'bg-blue-600 border-blue-600'
                          : (isReaderDark ? 'border-gray-600' : 'border-gray-300')
                      }`}
                      title="Select highlight"
                    >
                      {selectedHighlights.includes(h.cfiRange) && (
                        <span className="w-2 h-2 bg-white rounded-sm" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        jumpToCfi(h.cfiRange, { rememberReturnSpot: true, source: 'highlight' });
                        triggerHighlightFlash(h.cfiRange);
                        setShowHighlightsPanel(false);
                      }}
                      data-testid="highlight-item-jump"
                      className="text-left flex-1"
                    >
                      <div
                        data-testid="highlight-item-label"
                        className={`mb-1 text-[10px] uppercase tracking-widest ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
                      >
                        Highlight {idx + 1}
                      </div>
                      <div
                        data-testid="highlight-item-text"
                        className={`text-sm line-clamp-3 ${isReaderDark ? 'text-gray-200' : 'text-gray-800'}`}
                      >
                        {h.text}
                      </div>
                      {h.note && (
                        <div
                          data-testid="highlight-item-note"
                          className={`mt-2 text-xs italic line-clamp-2 ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
                        >
                          {h.note}
                        </div>
                      )}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="h-1.5 rounded-full flex-1" style={{ background: h.color }} />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openNoteEditor(h)}
                        className="text-xs text-blue-500 hover:text-blue-600"
                      >
                        {h.note ? 'Edit note' : 'Add note'}
                      </button>
                      <button
                        onClick={() => removeHighlight(h.cfiRange)}
                        className="text-xs text-red-500 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingHighlight && (
        <div className="fixed inset-0 z-[70]">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeNoteEditor}
          />
          <div
            data-testid="highlight-note-editor"
            className={`absolute left-1/2 top-24 -translate-x-1/2 w-[92vw] max-w-lg rounded-3xl shadow-2xl p-6 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold">Highlight note</div>
              <button
                onClick={closeNoteEditor}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 text-xs text-gray-500 line-clamp-3">
              {editingHighlight.text}
            </div>
            <textarea
              data-testid="highlight-note-editor-input"
              rows={4}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Write your note..."
              className="mt-4 w-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-transparent p-3 text-sm"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={closeNoteEditor}
                className="px-4 py-2 rounded-full text-xs font-bold border border-gray-200 dark:border-gray-700"
              >
                Cancel
              </button>
              <button
                data-testid="highlight-note-editor-save"
                onClick={saveHighlightNote}
                className="px-4 py-2 rounded-full text-xs font-bold bg-blue-600 text-white"
              >
                Save note
              </button>
            </div>
          </div>
        </div>
      )}

      {showBookmarksPanel && (
        <div className="fixed inset-0 z-[55]" data-testid="bookmarks-panel">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowBookmarksPanel(false)}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bookmark size={18} className={isReaderDark ? 'text-gray-400' : 'text-gray-600'} />
                <div className={`text-sm font-bold ${isReaderDark ? 'text-gray-100' : 'text-gray-900'}`}>Bookmarks</div>
              </div>
              <button
                onClick={() => setShowBookmarksPanel(false)}
                className={`p-1 ${isReaderDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-500'}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className={`mt-3 flex items-center justify-between text-[11px] ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>
              <span>
                {bookmarks.length} bookmark{bookmarks.length === 1 ? '' : 's'}
              </span>
              <button
                onClick={addBookmarkAtLocation}
                className="px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold"
              >
                Add Bookmark
              </button>
            </div>

            <div className="mt-4 max-h-[55vh] overflow-y-auto pr-1 space-y-3">
              {bookmarks.length === 0 && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>No bookmarks yet.</div>
              )}
              {bookmarks.map((b, idx) => (
                <div
                  key={`${b.cfi}-${idx}`}
                  className={`p-3 rounded-2xl border border-transparent transition ${
                    isReaderDark ? 'hover:border-gray-700' : 'hover:border-gray-200'
                  }`}
                  data-testid="bookmark-item"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => {
                        jumpToCfi(b.cfi, { rememberReturnSpot: true, source: 'bookmark' });
                        setShowBookmarksPanel(false);
                      }}
                      className="text-left flex-1"
                    >
                      <div
                        data-testid="bookmark-item-label"
                        className={`mb-1 text-[10px] uppercase tracking-widest ${isReaderDark ? 'text-gray-400' : 'text-gray-600'}`}
                      >
                        {b.label || `Bookmark ${idx + 1}`}
                      </div>
                      {b.text && (
                        <div
                          data-testid="bookmark-item-text"
                          className={`text-sm line-clamp-2 ${isReaderDark ? 'text-gray-200' : 'text-gray-800'}`}
                        >
                          {b.text}
                        </div>
                      )}
                    </button>
                    <button
                      onClick={() => removeBookmark(b.cfi)}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selection && selection.pos && !showDictionary && !showTranslation && (() => {
        const padding = 12;
        const rawX = selection.pos.x;
        const rawY = selection.pos.y;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : rawX;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : rawY;
        const panelWidth = 320;
        const panelHeight = 48;
        const clampedX = Math.min(Math.max(rawX, padding), Math.max(padding, viewportWidth - panelWidth - padding));
        const clampedY = Math.min(Math.max(rawY, padding), Math.max(padding, viewportHeight - panelHeight - padding));
        const transform = 'translate(8px, 8px)';

        return (
        <div
          className="fixed z-[70] pointer-events-auto"
          style={{
            left: clampedX,
            top: clampedY,
            transform,
            transition: 'left 140ms ease-out, top 140ms ease-out'
          }}
          data-testid="selection-toolbar"
        >
          <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl shadow-xl border ${
            settings.theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-800'
          }`}>
            {selectionMode === 'colors' ? (
              <>
                {highlightColors.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => {
                      if (selection.isExisting) {
                        recolorExistingHighlight(c.value);
                        return;
                      }
                      addHighlight(c.value);
                    }}
                    className="w-5 h-5 rounded-full border border-white/40 shadow"
                    title={`${selection.isExisting ? 'Recolor' : 'Highlight'} ${c.name}`}
                    style={{ background: c.value }}
                  />
                ))}
                <button
                  onClick={() => setSelectionMode('actions')}
                  className="ml-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Back
                </button>
              </>
            ) : selection.isExisting ? (
              <>
                <button
                  onClick={() => removeHighlight(selection.cfiRange)}
                  className="text-xs font-bold text-red-500 hover:text-red-600"
                >
                  Delete highlight
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
                <button
                  onClick={() => setSelectionMode('colors')}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                >
                  <Highlighter size={12} />
                  Color
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
                <button
                  onClick={() => openDictionaryForText(selection.text)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                >
                  <BookText size={12} />
                  Dictionary
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
                <button
                  onClick={() => openTranslationForText(selection.text)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                >
                  <Languages size={12} />
                  Translate
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => openDictionaryForText(selection.text)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                >
                  <BookText size={12} />
                  Dictionary
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
                <button
                  onClick={() => setSelectionMode('colors')}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                >
                  <Highlighter size={12} />
                  Highlight
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
                <button
                  onClick={() => openTranslationForText(selection.text)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                >
                  <Languages size={12} />
                  Translate
                </button>
              </>
            )}
            <button
              onClick={clearSelection}
              className="text-xs text-gray-400 hover:text-red-500"
            >
              <X size={12} />
            </button>
          </div>
        </div>
        );
      })()}

      {postHighlightPrompt && (() => {
        const padding = 12;
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : postHighlightPrompt.x;
        const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : postHighlightPrompt.y;
        const promptWidth = 332;
        const promptHeight = 132;
        let left = (postHighlightPrompt.x || 0) + 8;
        let top = (postHighlightPrompt.y || 0) + 28;

        if (left + promptWidth > viewportWidth - padding) {
          left = viewportWidth - promptWidth - padding;
        }
        if (left < padding) left = padding;

        if (top + promptHeight > viewportHeight - padding) {
          top = Math.max(padding, (postHighlightPrompt.y || 0) - promptHeight - 8);
        }
        if (top < padding) top = padding;

        return (
          <div
            ref={postHighlightPromptRef}
            data-testid="post-highlight-note-prompt"
            className={`fixed z-[72] rounded-lg border p-3 shadow-lg ${
              isReaderDark
                ? 'bg-gray-800 border-gray-700 text-gray-100'
                : 'bg-white border-gray-200 text-gray-800'
            }`}
            style={{
              left,
              top,
              width: promptWidth,
              transition: 'left 140ms ease-out, top 140ms ease-out'
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">
                Highlight saved
              </div>
              <button
                type="button"
                aria-label="Close note prompt"
                onClick={closePostHighlightPrompt}
                className="text-gray-400 hover:text-red-500"
              >
                <X size={12} />
              </button>
            </div>

            <textarea
              data-testid="post-highlight-note-input"
              value={postHighlightNoteDraft}
              onChange={(event) => {
                setPostHighlightNoteDraft(event.target.value);
                if (postHighlightNoteError) setPostHighlightNoteError('');
              }}
              placeholder="Type your note..."
              rows={2}
              autoFocus
              className={`mt-2 w-full resize-none rounded-lg border px-2 py-1.5 text-xs outline-none ${
                isReaderDark
                  ? 'border-gray-600 bg-gray-900/50 text-gray-100 placeholder:text-gray-400'
                  : 'border-gray-300 bg-gray-50 text-gray-900 placeholder:text-gray-500'
              }`}
            />

            {postHighlightNoteError && (
              <div className="mt-1 text-[11px] text-red-500">{postHighlightNoteError}</div>
            )}

            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closePostHighlightPrompt}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  isReaderDark
                    ? 'border border-gray-600 text-gray-200 hover:bg-gray-700'
                    : 'border border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
              >
                Later
              </button>
              <button
                type="button"
                data-testid="post-highlight-note-save"
                onClick={savePostHighlightPromptNote}
                disabled={isSavingPostHighlightNote || !postHighlightNoteDraft.trim()}
                className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSavingPostHighlightNote ? 'Saving...' : 'Save note'}
              </button>
            </div>
          </div>
        );
      })()}

      {returnSpot && (
        <div
          data-testid="return-to-spot-chip"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[68]"
        >
          <div className={`flex items-center gap-2 rounded-full border px-3 py-2 shadow-xl backdrop-blur ${
            isReaderDark
              ? 'bg-gray-800/95 border-gray-700 text-gray-100'
              : 'bg-white/95 border-gray-200 text-gray-800'
          }`}>
            <span className={`text-[11px] ${isReaderDark ? 'text-gray-300' : 'text-gray-600'}`}>
              From {returnSpotSourceLabel}
            </span>
            <button
              type="button"
              data-testid="return-to-spot-action"
              onClick={() => {
                const targetCfi = returnSpot?.cfi;
                closeReturnSpot();
                if (targetCfi) jumpToCfi(targetCfi);
              }}
              className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
            >
              Back to previous spot
            </button>
            <button
              type="button"
              data-testid="return-to-spot-close"
              onClick={closeReturnSpot}
              className={`rounded-full p-1 ${isReaderDark ? 'text-gray-400 hover:text-red-400' : 'text-gray-500 hover:text-red-500'}`}
              aria-label="Dismiss return spot"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      <FeedbackToast
        toast={
          pendingHighlightDelete
            ? {
              tone: 'destructive',
              title: 'Highlight deleted',
              message: 'You can undo this action.',
              actionLabel: 'Undo',
              onAction: undoPendingHighlightDelete
            }
            : readerToast
        }
        isDark={isReaderDark}
        onDismiss={() => {
          if (pendingHighlightDelete) {
            setPendingHighlightDelete(null);
            return;
          }
          dismissReaderToast();
        }}
        testId={pendingHighlightDelete ? 'highlight-undo-toast' : 'reader-feedback-toast'}
        actionTestId={pendingHighlightDelete ? 'highlight-undo-action' : 'reader-feedback-action'}
        className="fixed bottom-20 left-1/2 z-[69] -translate-x-1/2"
      />

      {showSidebar && (
        <div className="fixed inset-0 z-[65]" data-testid="chapters-panel">
          <button
            onClick={() => setShowSidebar(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close chapters"
          />
          <aside
            className={`absolute left-0 top-0 h-full w-[88vw] max-w-sm shadow-2xl border-r ${
              settings.theme === 'dark'
                ? 'bg-gray-900 border-gray-700 text-gray-100'
                : 'bg-white border-gray-200 text-gray-900'
            }`}
          >
            <div className="h-full flex flex-col">
              <div className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${settings.theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="flex items-center gap-2">
                  <BookOpenText size={18} className="text-blue-500" />
                  <h3 className="text-sm font-bold">Contents</h3>
                </div>
                <button
                  onClick={() => setShowSidebar(false)}
                  className={`p-1 rounded-full ${settings.theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                  aria-label="Close contents"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="px-2 py-2 overflow-y-auto flex-1 space-y-1">
                {tocItems.length === 0 ? (
                  <div className={`px-3 py-2 text-xs ${settings.theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Chapters are still loading...
                  </div>
                ) : (
                  tocItems.map((item, idx) => (
                    <button
                      key={`${item.href}-${idx}`}
                      onClick={() => handleTocSelect(item.href)}
                      data-testid="toc-item"
                      className={`w-full text-left rounded-xl py-2 pr-2 text-sm transition ${
                        isTocItemActive(item.href)
                          ? 'bg-blue-600 text-white'
                          : settings.theme === 'dark'
                            ? 'text-gray-200 hover:bg-gray-800'
                            : 'text-gray-700 hover:bg-gray-100'
                      }`}
                      style={{ paddingLeft: `${12 + item.depth * 14}px` }}
                    >
                      {item.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* TOP BAR */}
      <div className={`flex items-center justify-between p-3 border-b shadow-sm z-20 ${settings.theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-800'}`}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSidebar(true)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition"
            aria-label="Open chapters"
          >
            <Menu size={20} />
          </button>
          <Link to="/" className="hover:opacity-70 p-1"><ChevronLeft size={24} /></Link>
          <div className="flex flex-col">
            <h2 className="font-bold truncate text-sm max-w-[120px]">{book.title}</h2>
            <div className="hidden sm:block text-[10px] uppercase tracking-widest text-gray-400">
              {progressPct}% · {timeLeftLabel}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            disabled
            data-testid="ai-explain-disabled"
            title="AI feature not available yet"
            className="flex cursor-not-allowed items-center gap-2 rounded-full border border-orange-200 bg-orange-50 p-2 px-3 text-orange-700 opacity-90 dark:border-orange-800/40 dark:bg-orange-900/20 dark:text-orange-300"
          >
            <Wand2 size={18} />
            <span className="text-[10px] font-black uppercase hidden lg:inline">Explain Page</span>
          </button>
          <button
            type="button"
            disabled
            data-testid="ai-story-disabled"
            title="AI feature not available yet"
            className="flex cursor-not-allowed items-center gap-2 rounded-full border border-orange-200 bg-orange-50 p-2 px-3 text-orange-700 opacity-90 dark:border-orange-800/40 dark:bg-orange-900/20 dark:text-orange-300"
          >
            <Sparkles size={20} />
            <span className="hidden md:inline text-xs font-black uppercase">Story</span>
          </button>
          <button
            onClick={() => {
              if (showSearchMenu) {
                closeSearchMenu();
              } else {
                closeAnnotationSearchMenu();
                setShowSearchMenu(true);
              }
            }}
            className={showSearchMenu ? toolbarUtilityActiveClass : toolbarUtilityInactiveClass}
            title="Search"
            data-testid="reader-search-toggle"
          >
            <SearchIcon size={18} />
          </button>
          <button
            onClick={() => {
              if (showAnnotationSearchMenu) {
                closeAnnotationSearchMenu();
              } else {
                closeSearchMenu();
                setShowAnnotationSearchMenu(true);
              }
            }}
            className={showAnnotationSearchMenu ? toolbarUtilityActiveClass : toolbarUtilityInactiveClass}
            title="Annotations"
            data-testid="reader-annotation-search-toggle"
          >
            <BookText size={18} />
          </button>
          <button
            onClick={() => setShowHighlightsPanel((s) => !s)}
            className={showHighlightsPanel ? toolbarUtilityActiveClass : toolbarUtilityInactiveClass}
            title="Highlights"
            data-testid="reader-highlights-toggle"
          >
            <Highlighter size={18} />
          </button>
          <button
            onClick={() => setShowBookmarksPanel((s) => !s)}
            className={showBookmarksPanel ? toolbarUtilityActiveClass : toolbarUtilityInactiveClass}
            title="Bookmarks"
            data-testid="reader-bookmarks-toggle"
          >
            <Bookmark size={18} />
          </button>
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button onClick={toggleDarkTheme} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700" data-testid="theme-toggle">
            {isReaderDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button
            onClick={toggleSepiaTheme}
            className={`p-2 rounded-full transition hover:bg-gray-100 dark:hover:bg-gray-700 ${isReaderSepia ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/30' : ''}`}
            data-testid="sepia-toggle"
            title={isReaderSepia ? 'Disable night reading mode' : 'Enable night reading mode'}
          >
            <OwlIcon size={20} />
          </button>
          <button onClick={() => setSettings(s => ({...s, flow: s.flow === 'paginated' ? 'scrolled' : 'paginated'}))} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">{settings.flow === 'paginated' ? <Scroll size={20} /> : <BookOpen size={20} />}</button>
          <button onClick={() => setShowFontMenu(!showFontMenu)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700"><Type size={20} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <BookView 
          bookData={book.data} settings={settings} initialLocation={book.lastLocation}
          onLocationChange={handleLocationChange} 
          onTocLoaded={setToc} tocJump={jumpTarget}
          onRenditionReady={setRendition}
          onChapterEnd={handleChapterEnd}
          searchResults={searchResults}
          activeSearchCfi={activeSearchCfi}
          focusedSearchCfi={focusedSearchCfi}
          showSearchHighlights={showSearchMenu || Boolean(focusedSearchCfi)}
          onSearchHighlightCountChange={setSearchHighlightCount}
          flashingHighlightCfi={flashingHighlightCfi}
          flashingHighlightPulse={flashingHighlightPulse}
          onSearchResultActivate={handleSearchResultActivate}
          onSearchFocusDismiss={dismissFocusedSearch}
          highlights={highlights}
          onSelection={handleSelection}
          onInlineNoteMarkerActivate={handleInlineNoteMarkerActivate}
          onFootnotePreview={handleFootnotePreview}
        />
      </div>
    </div>
  );
}
