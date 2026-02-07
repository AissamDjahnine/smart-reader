import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getBook, updateBookProgress, saveHighlight, deleteHighlight, updateReadingStats, saveChapterSummary, savePageSummary, saveBookmark, deleteBookmark, updateHighlightNote, updateBookReaderSettings, markBookStarted } from '../services/db';
import BookView from '../components/BookView';
import { summarizeChapter } from '../services/ai'; 
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import { 
  Moon, Sun, BookOpen, Scroll, Type, 
  ChevronLeft, Menu, X,
  Search as SearchIcon, Sparkles, Wand2, User,
  BookOpenText, Highlighter, Languages, Bookmark
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
  const [book, setBook] = useState(null);
  const bookRef = useRef(null);
  
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
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
  const selectionTouchedRef = useRef(false);
  const [editingHighlight, setEditingHighlight] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [bookmarks, setBookmarks] = useState([]);
  const [selection, setSelection] = useState(null);
  const [selectionMode, setSelectionMode] = useState('actions');
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
  const progressPersistRef = useRef({
    timer: null,
    lastWriteTs: 0,
    lastCfi: '',
    lastPct: -1,
    pending: null
  });

  const aiUnavailableMessage = "AI features are not available now.";

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
      const exportRoot = document.createElement('div');
      exportRoot.style.position = 'fixed';
      exportRoot.style.left = '-10000px';
      exportRoot.style.top = '0';
      exportRoot.style.width = '720px';
      exportRoot.style.padding = '24px';
      document.body.appendChild(exportRoot);

      const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
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
        const canvas = await html2canvas(card, { scale: 2, backgroundColor: null });
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
  };

  const closeSearchMenu = () => {
    cancelSearch();
    setShowSearchMenu(false);
  };

  const goToSearchIndex = (index) => {
    if (!searchResults.length) return;
    const clamped = Math.max(0, Math.min(index, searchResults.length - 1));
    setActiveSearchIndex(clamped);
    const target = searchResults[clamped];
    if (target?.cfi) setJumpTarget(target.cfi);
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

  const runSearch = async (query) => {
    const term = query.trim();
    if (!rendition || !term) {
      clearSearch();
      return;
    }

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
        setActiveSearchIndex(0);
        if (results[0]?.cfi) setJumpTarget(results[0].cfi);
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
      const loc = rendition.currentLocation();
      if (!loc?.start?.cfi) return;

      const viewer = rendition.getContents()[0];
      const pageText = viewer?.document?.body?.innerText || '';
      const snippet = pageText.trim().slice(0, 140);
      const label = getChapterLabel(loc);

      const newBookmark = {
        cfi: loc.start.cfi,
        href: loc.start.href || '',
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

  const handleSelection = useCallback((text, cfiRange, pos, isExisting = false) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    setSelection({
      text: trimmed,
      cfiRange,
      pos,
      isExisting
    });
    setSelectionMode(isExisting ? 'delete' : 'actions');
  }, []);

  const jumpToCfi = (cfi) => {
    if (!cfi) return;
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
  };

  const clearSelection = () => {
    setSelection(null);
    setSelectionMode('actions');
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
      }
    } catch (err) {
      console.error(err);
    } finally {
      clearSelection();
    }
  };

  const removeHighlight = async (cfiRange) => {
    const currentBook = bookRef.current;
    if (!currentBook || !cfiRange) return;
    try {
      const updated = await deleteHighlight(currentBook.id, cfiRange);
      if (updated) {
        setHighlights(updated);
        setBook({ ...currentBook, highlights: updated });
      }
    } catch (err) {
      console.error(err);
    } finally {
      clearSelection();
    }
  };

  const openNoteEditor = (highlight) => {
    setEditingHighlight(highlight);
    setNoteDraft(highlight?.note || '');
  };

  const closeNoteEditor = () => {
    setEditingHighlight(null);
    setNoteDraft('');
  };

  const saveHighlightNote = async () => {
    const currentBook = bookRef.current;
    if (!currentBook || !editingHighlight?.cfiRange) return;
    try {
      const updated = await updateHighlightNote(currentBook.id, editingHighlight.cfiRange, noteDraft.trim());
      if (updated) {
        setHighlights(updated);
        setBook({ ...currentBook, highlights: updated });
      }
    } catch (err) {
      console.error(err);
    } finally {
      closeNoteEditor();
    }
  };

  const handleLocationChange = (loc) => {
    if (!loc?.start || !bookId) return;
    lastActiveRef.current = Date.now();
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
    jumpToCfi(href);
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
  }, [bookId, panelParam, cfiParam]);

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
      selectionTouchedRef.current = false;
      return;
    }

    if (!selectionTouchedRef.current) {
      setSelectedHighlights(highlights.map((h) => h.cfiRange));
      return;
    }

    setSelectedHighlights((prev) => prev.filter((cfi) => highlights.some((h) => h.cfiRange === cfi)));
  }, [highlights]);

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
    const handleKey = (event) => {
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
          const content = rendition.getContents()[0];
          const win = content?.window;
          if (!win) return;
          const delta = Math.round(win.innerHeight * 0.85);
          win.scrollBy({ top: event.key === 'ArrowDown' ? delta : -delta, left: 0, behavior: 'smooth' });
        }
      }
    };

    window.addEventListener('keydown', handleKey, { passive: false });
    return () => window.removeEventListener('keydown', handleKey);
  }, [rendition, settings.flow]);

  const phoneticText =
    dictionaryEntry?.phonetic ||
    dictionaryEntry?.phonetics?.find((p) => p.text)?.text ||
    "";
  const isReaderDark = settings.theme === 'dark';
  const isReaderSepia = settings.theme === 'sepia';
  const activeSearchCfi = activeSearchIndex >= 0 ? (searchResults[activeSearchIndex]?.cfi || null) : null;
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

  if (!book) return <div className="p-10 text-center dark:bg-gray-900 dark:text-gray-400">Loading...</div>;

  return (
    <div className={`h-screen flex flex-col overflow-hidden transition-colors duration-200 ${readerThemeClass}`}>
      
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
                    ? `${activeSearchIndex + 1 > 0 ? activeSearchIndex + 1 : 1}/${searchResults.length}`
                    : '0 results'}
              </span>
              <span className="sr-only" data-testid="search-progress">
                {searchResults.length
                  ? `${activeSearchIndex + 1 > 0 ? activeSearchIndex + 1 : 1}/${searchResults.length}`
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

            <div className="mt-4 max-h-[45vh] overflow-y-auto pr-1 space-y-2">
              {!isSearching && searchQuery && searchResults.length === 0 && (
                <div className={`text-xs ${isReaderDark ? 'text-gray-400' : 'text-gray-700'}`}>No matches found.</div>
              )}
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.cfi}-${idx}`}
                  onClick={() => goToSearchIndex(idx)}
                  className={`w-full text-left p-3 rounded-2xl border transition ${
                    activeSearchIndex === idx
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

      {showHighlightsPanel && (
        <div className="fixed inset-0 z-[55]" data-testid="highlights-panel">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowHighlightsPanel(false)}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Highlighter size={18} className="text-gray-400" />
                <div className="text-sm font-bold">Highlights</div>
              </div>
              <button
                onClick={() => setShowHighlightsPanel(false)}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 text-[11px] text-gray-500">
              {highlights.length} highlight{highlights.length === 1 ? '' : 's'}
              <button
                onClick={exportHighlightsPdf}
                disabled={!selectedHighlights.length || isExportingHighlights}
                className="ml-3 px-3 py-1 rounded-full bg-blue-600 text-white text-[10px] font-bold disabled:opacity-50"
              >
                {isExportingHighlights ? 'Exporting...' : 'Export Selected'}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
              <span>
                {selectedHighlights.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    selectionTouchedRef.current = true;
                    setSelectedHighlights(highlights.map((h) => h.cfiRange));
                  }}
                  className="text-[10px] font-bold text-blue-500"
                >
                  Select all
                </button>
                <button
                  onClick={() => {
                    selectionTouchedRef.current = true;
                    setSelectedHighlights([]);
                  }}
                  className="text-[10px] font-bold text-gray-400 hover:text-gray-600"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="mt-4 max-h-[55vh] overflow-y-auto pr-1 space-y-3">
              {highlights.length === 0 && (
                <div className="text-xs text-gray-500">No highlights yet.</div>
              )}
              {highlights.map((h, idx) => (
                <div
                  key={`${h.cfiRange}-${idx}`}
                  className="p-3 rounded-2xl border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition"
                >
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => {
                        selectionTouchedRef.current = true;
                        setSelectedHighlights((prev) => prev.includes(h.cfiRange)
                          ? prev.filter((cfi) => cfi !== h.cfiRange)
                          : [...prev, h.cfiRange]
                        );
                      }}
                      className={`mt-1 w-4 h-4 rounded border flex items-center justify-center ${
                        selectedHighlights.includes(h.cfiRange)
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                      title="Select highlight"
                    >
                      {selectedHighlights.includes(h.cfiRange) && (
                        <span className="w-2 h-2 bg-white rounded-sm" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        jumpToCfi(h.cfiRange);
                        setShowHighlightsPanel(false);
                      }}
                      className="text-left flex-1"
                    >
                      <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                        Highlight {idx + 1}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-200 line-clamp-3">
                        {h.text}
                      </div>
                      {h.note && (
                        <div className="mt-2 text-xs text-gray-500 italic line-clamp-2">
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
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Bookmark size={18} className="text-gray-400" />
                <div className="text-sm font-bold">Bookmarks</div>
              </div>
              <button
                onClick={() => setShowBookmarksPanel(false)}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
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
                <div className="text-xs text-gray-500">No bookmarks yet.</div>
              )}
              {bookmarks.map((b, idx) => (
                <div
                  key={`${b.cfi}-${idx}`}
                  className="p-3 rounded-2xl border border-transparent hover:border-gray-200 dark:hover:border-gray-700 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => {
                        jumpToCfi(b.cfi);
                        setShowBookmarksPanel(false);
                      }}
                      className="text-left flex-1"
                    >
                      <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                        {b.label || `Bookmark ${idx + 1}`}
                      </div>
                      {b.text && (
                        <div className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2">
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
          style={{ left: clampedX, top: clampedY, transform }}
          data-testid="selection-toolbar"
        >
          <div className={`flex items-center gap-2 px-3 py-2 rounded-2xl shadow-xl border ${
            settings.theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-800'
          }`}>
            {selection.isExisting ? (
              <>
                <button
                  onClick={() => removeHighlight(selection.cfiRange)}
                  className="text-xs font-bold text-red-500 hover:text-red-600"
                >
                  Delete highlight
                </button>
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700" />
                <button
                  onClick={() => openDictionaryForText(selection.text)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400"
                >
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
            ) : selectionMode === 'colors' ? (
              <>
                {highlightColors.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => addHighlight(c.value)}
                    className="w-5 h-5 rounded-full border border-white/40 shadow"
                    title={`Highlight ${c.name}`}
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
            ) : (
              <>
                <button
                  onClick={() => openDictionaryForText(selection.text)}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400"
                >
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
          <button onClick={handleManualPageSummary} className="p-2 px-3 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center gap-2 transition hover:scale-105 active:scale-95">
            <Wand2 size={18} />
            <span className="text-[10px] font-black uppercase hidden lg:inline">Explain Page</span>
          </button>
          <button
            onClick={handleStoryRecap}
            className={`p-2 rounded-full transition flex items-center gap-2 px-3 ${isStoryRecapping ? 'animate-pulse text-yellow-500' : 'text-blue-500'}`}
          >
            <Sparkles size={20} />
            <span className="hidden md:inline text-xs font-black uppercase">Story</span>
          </button>
          <button
            onClick={() => setShowSearchMenu((s) => !s)}
            className={`p-2 rounded-full transition ${showSearchMenu ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title="Search"
          >
            <SearchIcon size={18} />
          </button>
          <button
            onClick={() => setShowHighlightsPanel((s) => !s)}
            className={`p-2 rounded-full transition ${showHighlightsPanel ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title="Highlights"
          >
            <Highlighter size={18} />
          </button>
          <button
            onClick={() => setShowBookmarksPanel((s) => !s)}
            className={`p-2 rounded-full transition ${showBookmarksPanel ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title="Bookmarks"
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

      <div className={`px-4 py-2 text-[11px] tracking-wide uppercase font-bold ${settings.theme === 'dark' ? 'bg-yellow-900/30 text-yellow-300' : 'bg-yellow-50 text-yellow-700'}`}>
        AI FEATURES: NOT AVAILABLE NOW
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
          highlights={highlights}
          onSelection={handleSelection}
        />
      </div>
    </div>
  );
}
