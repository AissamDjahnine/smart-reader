import React, { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';

const EPUB_THEME_KEY = 'reader-theme';
const SEARCH_ANNOTATION_TYPE = 'highlight';
const USER_HIGHLIGHT_ANNOTATION_TYPE = 'highlight';
const FOOTNOTE_HINT_RE = /(noteref|footnote|endnote|fn|note|doc-noteref|doc-endnote|doc-footnote)/i;

const normalizeWhitespace = (value = '') => value.replace(/\s+/g, ' ').trim();

const clampPreview = (value = '', max = 420) => {
  const text = normalizeWhitespace(value);
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
};

const resolveRelativeHrefPath = (path, basePath = '') => {
  if (!path) return '';
  if (/^(https?:|mailto:|tel:)/i.test(path)) return '';

  const cleanedPath = path.split('?')[0].replace(/^\/+/, '');
  if (!cleanedPath || cleanedPath.startsWith('#')) return '';

  const baseClean = (basePath || '').split('#')[0].replace(/^\/+/, '');
  const baseDir = baseClean.includes('/') ? baseClean.split('/').slice(0, -1).join('/') : '';
  const baseUrl = `https://reader.local/${baseDir ? `${baseDir}/` : ''}`;
  try {
    const resolved = new URL(cleanedPath, baseUrl);
    return resolved.pathname.replace(/^\/+/, '');
  } catch {
    return cleanedPath;
  }
};

const findFootnoteTargetInDoc = (doc, targetId) => {
  if (!doc || !targetId) return null;
  const byId = doc.getElementById(targetId);
  if (byId) return byId;
  const safeId = targetId.replace(/"/g, '\\"');
  return doc.querySelector(`[name="${safeId}"]`);
};

const isLikelyFootnoteAnchor = (anchor) => {
  if (!anchor) return false;
  const href = (anchor.getAttribute('href') || '').trim();
  if (!href || /^(https?:|mailto:|tel:)/i.test(href)) return false;

  const epubType = anchor.getAttribute('epub:type') || '';
  const role = anchor.getAttribute('role') || '';
  const rel = anchor.getAttribute('rel') || '';
  const className = typeof anchor.className === 'string' ? anchor.className : '';
  const markerText = normalizeWhitespace(anchor.textContent || '');
  const composite = `${epubType} ${role} ${rel} ${className} ${href}`.toLowerCase();
  if (FOOTNOTE_HINT_RE.test(composite)) return true;

  if (!href.includes('#')) return false;
  if (!markerText || markerText.length > 8) return false;
  return /^(?:\d|\*|†|‡|§|\[|\]|\(|\))+$/.test(markerText);
};

const findSpineItemByHref = (book, hrefPath) => {
  const target = (hrefPath || '').replace(/^\/+/, '');
  if (!target) return null;
  const spineItems = book?.spine?.spineItems || [];
  return spineItems.find((item) => {
    const itemHref = (item?.href || '').replace(/^\/+/, '');
    return itemHref === target || itemHref.endsWith(`/${target}`) || target.endsWith(`/${itemHref}`);
  }) || null;
};

const parseColorRgb = (color) => {
  if (typeof color !== 'string') return null;
  const hex = color.trim();
  if (/^#([0-9a-fA-F]{6})$/.test(hex)) {
    const value = hex.slice(1);
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16)
    ];
  }
  if (/^#([0-9a-fA-F]{3})$/.test(hex)) {
    const value = hex.slice(1);
    return [
      Number.parseInt(value[0] + value[0], 16),
      Number.parseInt(value[1] + value[1], 16),
      Number.parseInt(value[2] + value[2], 16)
    ];
  }
  const rgbMatch = hex.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbMatch) return null;
  const [r, g, b] = rgbMatch[1]
    .split(',')
    .slice(0, 3)
    .map((value) => Number.parseFloat(value.trim()));
  if (![r, g, b].every(Number.isFinite)) return null;
  return [r, g, b];
};

const getContrastTextColor = (color) => {
  const rgb = parseColorRgb(color);
  if (!rgb) return '#111827';
  const [r, g, b] = rgb;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#111827' : '#ffffff';
};

const normalizeHighlightText = (value = '') => value.toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeHrefMatch = (value = '') => value.toString().split('#')[0].replace(/^\/+/, '');

const isSameHref = (left = '', right = '') => {
  const a = normalizeHrefMatch(left);
  const b = normalizeHrefMatch(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
};

const buildDocTextIndex = (doc) => {
  const root = doc?.body || doc?.documentElement;
  if (!root) return { text: '', segments: [] };
  const nodeFilter = doc.defaultView?.NodeFilter || window.NodeFilter;
  if (!nodeFilter) return { text: '', segments: [] };

  const walker = doc.createTreeWalker(
    root,
    nodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const text = (node?.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return nodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return nodeFilter.FILTER_REJECT;
        if (parent.closest?.('script,style,noscript,svg,math')) return nodeFilter.FILTER_REJECT;
        return nodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const segments = [];
  let text = '';
  let cursor = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const source = node.textContent || '';
    const normalized = source.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    if (text) {
      text += ' ';
      cursor += 1;
    }
    const start = cursor;
    text += normalized;
    cursor += normalized.length;
    segments.push({ node, start, end: cursor, source });
  }

  return { text, segments };
};

const findSegmentAtOffset = (segments, offset) => {
  if (!Array.isArray(segments) || !segments.length) return null;
  return segments.find((segment) => offset >= segment.start && offset < segment.end)
    || segments[segments.length - 1];
};

const resolveNodeOffset = (segment, absoluteOffset) => {
  if (!segment) return 0;
  const localOffset = Math.max(0, absoluteOffset - segment.start);
  const normalizedSource = (segment.source || '').replace(/\s+/g, ' ').trim();
  if (!normalizedSource) return 0;
  return Math.min(normalizedSource.length, localOffset);
};

const findRangeByQuote = (doc, quote, contextPrefix = '', contextSuffix = '') => {
  const normalizedQuote = normalizeHighlightText(quote);
  if (!doc || !normalizedQuote) return null;

  const { text, segments } = buildDocTextIndex(doc);
  if (!text || !segments.length) return null;

  const haystack = normalizeHighlightText(text);
  const variants = [normalizedQuote];
  if (quote && quote.trim()) {
    variants.push(quote.trim().toLowerCase());
  }

  let matches = [];
  variants.forEach((needle) => {
    if (!needle) return;
    let from = 0;
    while (from < haystack.length) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      matches.push({ start: at, end: at + needle.length });
      from = at + 1;
    }
  });
  if (!matches.length) return null;

  const prefixNorm = normalizeHighlightText(contextPrefix);
  const suffixNorm = normalizeHighlightText(contextSuffix);
  matches = matches
    .map((match) => {
      let score = 0;
      if (prefixNorm) {
        const leftWindow = haystack.slice(Math.max(0, match.start - Math.max(12, prefixNorm.length + 6)), match.start);
        if (leftWindow.includes(prefixNorm)) score += 1;
      }
      if (suffixNorm) {
        const rightWindow = haystack.slice(match.end, Math.min(haystack.length, match.end + Math.max(12, suffixNorm.length + 6)));
        if (rightWindow.includes(suffixNorm)) score += 1;
      }
      return { ...match, score };
    })
    .sort((a, b) => b.score - a.score || a.start - b.start);

  const winner = matches[0];
  const startSegment = findSegmentAtOffset(segments, winner.start);
  const endSegment = findSegmentAtOffset(segments, Math.max(winner.end - 1, winner.start));
  if (!startSegment || !endSegment) return null;

  const startOffset = resolveNodeOffset(startSegment, winner.start);
  const endOffsetRaw = resolveNodeOffset(endSegment, winner.end);
  const endOffset = Math.max(endOffsetRaw, startOffset + 1);

  try {
    const range = doc.createRange();
    range.setStart(startSegment.node, Math.min(startOffset, (startSegment.node.textContent || '').length));
    range.setEnd(endSegment.node, Math.min(endOffset, (endSegment.node.textContent || '').length));
    return range;
  } catch (err) {
    console.error('Quote range recovery failed', err);
    return null;
  }
};

export default function BookView({ 
  bookData, 
  settings, 
  onLocationChange, 
  onSelection, 
  initialLocation,
  onTocLoaded,
  tocJump,
  highlights = [],
  onRenditionReady,
  searchResults = [],
  activeSearchCfi = null,
  focusedSearchCfi = null,
  showSearchHighlights = true,
  flashingHighlightCfi = null,
  flashingHighlightPulse = 0,
  onSearchResultActivate,
  onSearchFocusDismiss,
  onSearchHighlightCountChange,
  onInlineNoteMarkerActivate,
  onFootnotePreview,
  onChapterEnd // NEW: Callback for AI summarization
}) {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const lastChapterRef = useRef(null); // Track chapter changes
  const onSelectionRef = useRef(onSelection);
  const onSearchResultActivateRef = useRef(onSearchResultActivate);
  const onSearchFocusDismissRef = useRef(onSearchFocusDismiss);
  const onSearchHighlightCountChangeRef = useRef(onSearchHighlightCountChange);
  const onInlineNoteMarkerActivateRef = useRef(onInlineNoteMarkerActivate);
  const onFootnotePreviewRef = useRef(onFootnotePreview);
  const appliedHighlightsRef = useRef(new Map());
  const resolvedHighlightTargetsRef = useRef(new Map());
  const appliedSearchRef = useRef(new Map());
  const selectionCleanupRef = useRef([]);
  const inlineNoteMarkersRef = useRef([]);
  const [relocationTick, setRelocationTick] = useState(0);

  useEffect(() => {
    onSelectionRef.current = onSelection;
  }, [onSelection]);

  useEffect(() => {
    onSearchResultActivateRef.current = onSearchResultActivate;
  }, [onSearchResultActivate]);

  useEffect(() => {
    onSearchFocusDismissRef.current = onSearchFocusDismiss;
  }, [onSearchFocusDismiss]);

  useEffect(() => {
    onSearchHighlightCountChangeRef.current = onSearchHighlightCountChange;
  }, [onSearchHighlightCountChange]);

  useEffect(() => {
    onInlineNoteMarkerActivateRef.current = onInlineNoteMarkerActivate;
  }, [onInlineNoteMarkerActivate]);

  useEffect(() => {
    onFootnotePreviewRef.current = onFootnotePreview;
  }, [onFootnotePreview]);

  const applyTheme = (rendition, theme) => {
    if (!rendition) return;
    const isScrolled = settings.flow === 'scrolled';
    const isDark = theme === 'dark';
    const isSepia = theme === 'sepia';
    const lineHeight = Number.isFinite(Number(settings.lineSpacing))
      ? Math.min(2.4, Math.max(1.2, Number(settings.lineSpacing)))
      : 1.6;
    const textMargin = Number.isFinite(Number(settings.textMargin))
      ? Math.min(64, Math.max(8, Number(settings.textMargin)))
      : 32;
    const allowedTextAlign = new Set(['left', 'center', 'right', 'justify']);
    const textAlign = allowedTextAlign.has(settings.textAlign) ? settings.textAlign : 'left';
    const scrolledViewportPadding = Math.max(48, textMargin * 2 + 24);
    const textColor = isDark ? '#e5e7eb' : isSepia ? '#3f2f1f' : '#111827';
    const paginatedBackground = isDark ? '#111827' : isSepia ? '#f8efd2' : '#ffffff';
    const scrolledOuterBackground = isDark ? '#0b1220' : isSepia ? '#eadfbd' : '#f3f4f6';
    const scrolledPageBackground = paginatedBackground;
    const bodyStyles = {
      'html': {
        'background': `${isScrolled ? scrolledOuterBackground : paginatedBackground} !important`
      },
      'body': {
        'color': `${textColor} !important`,
        'background': `${scrolledPageBackground} !important`,
        'max-width': isScrolled ? `min(940px, calc(100vw - ${scrolledViewportPadding}px)) !important` : 'none !important',
        'width': '100% !important',
        'margin': isScrolled ? '20px auto 28px auto !important' : '0 !important',
        'padding-left': `${textMargin}px !important`,
        'padding-right': `${textMargin}px !important`,
        'padding-top': '0 !important',
        'padding-bottom': '0 !important',
        'line-height': `${lineHeight} !important`,
        'text-align': `${textAlign} !important`,
        'box-sizing': 'border-box !important',
        'position': 'relative !important'
      },
      'p, span, div, li, blockquote, h1, h2, h3, h4, h5, h6': {
        'color': `${textColor} !important`,
        'line-height': `${lineHeight} !important`,
        'text-align': `${textAlign} !important`
      },
      '.search-hl': {
        'background': 'rgba(250, 204, 21, 0.28) !important',
        'border-radius': '2px !important'
      },
      '.search-hl-active': {
        'background': 'rgba(250, 204, 21, 0.85) !important',
        'border-radius': '2px !important'
      },
      '.search-hl-focus': {
        'background': 'rgba(34, 197, 94, 0.78) !important',
        'border-radius': '2px !important'
      },
      'img, svg, video, canvas': {
        'max-width': '100% !important',
        'height': 'auto !important'
      }
    };
    
    rendition.themes.register(EPUB_THEME_KEY, bodyStyles);
    rendition.themes.select(EPUB_THEME_KEY);
    rendition.themes.fontSize(`${settings.fontSize}%`);
  };

  const clearInlineNoteMarkers = () => {
    inlineNoteMarkersRef.current.forEach(({ element, cleanup }) => {
      try {
        cleanup?.();
      } catch (err) {
        console.error('Inline note marker cleanup callback failed', err);
      }
      try {
        element?.remove?.();
      } catch (err) {
        console.error('Inline note marker removal failed', err);
      }
    });
    inlineNoteMarkersRef.current = [];
  };

  useEffect(() => {
    if (tocJump && renditionRef.current) {
      renditionRef.current.display(tocJump);
    }
  }, [tocJump]);

  useEffect(() => {
    if (!bookData) return;
    const book = ePub(bookData);
    bookRef.current = book;

    book.loaded.navigation.then((nav) => {
      if (onTocLoaded) onTocLoaded(nav.toc);
    });

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      flow: settings.flow, 
      manager: settings.flow === 'scrolled' ? 'continuous' : 'default',
    });
    renditionRef.current = rendition;
    appliedHighlightsRef.current = new Map();
    resolvedHighlightTargetsRef.current = new Map();
    appliedSearchRef.current = new Map();

    if (onRenditionReady) onRenditionReady(rendition);

    applyTheme(rendition, settings.theme);

    const registerSelectionClearWatcher = (contents) => {
      const doc = contents?.document;
      const win = contents?.window;
      if (!doc || !win) return;

      const notifyIfCleared = () => {
        const selectedText = win.getSelection?.()?.toString?.().trim?.() || '';
        if (!selectedText && onSelectionRef.current) {
          onSelectionRef.current('', null, null, false);
        }
      };

      doc.addEventListener('mouseup', notifyIfCleared);
      doc.addEventListener('keyup', notifyIfCleared);
      doc.addEventListener('touchend', notifyIfCleared);

      const dismissFocusedSearch = () => {
        if (onSearchFocusDismissRef.current) {
          onSearchFocusDismissRef.current();
        }
        if (onFootnotePreviewRef.current) {
          onFootnotePreviewRef.current(null);
        }
      };

      doc.addEventListener('mousedown', dismissFocusedSearch);
      doc.addEventListener('touchstart', dismissFocusedSearch);

      const handleFootnoteClick = async (event) => {
        const eventTarget = event?.target;
        const targetElement = eventTarget?.nodeType === 1 ? eventTarget : eventTarget?.parentElement || null;
        const target = targetElement?.closest?.('a') || null;
        if (!target || !isLikelyFootnoteAnchor(target)) return;

        const rawHref = (target.getAttribute('href') || '').trim();
        const hashIndex = rawHref.indexOf('#');
        const hashPart = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : '';
        const hrefPath = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref;
        const targetId = hashPart ? decodeURIComponent(hashPart) : '';
        if (!targetId) return;

        event.preventDefault();
        event.stopPropagation();

        let previewText = '';
        const currentSectionHref = (contents?.section?.href || '').split('#')[0];
        const resolvedPath = resolveRelativeHrefPath(hrefPath, currentSectionHref);
        let targetHref = '';

        try {
          let noteNode = null;
          if (!resolvedPath) {
            noteNode = findFootnoteTargetInDoc(doc, targetId);
            const currentPath = currentSectionHref || '';
            targetHref = currentPath ? `${currentPath}#${targetId}` : `#${targetId}`;
          } else {
            const spineItem = findSpineItemByHref(bookRef.current, resolvedPath);
            if (spineItem) {
              await spineItem.load(bookRef.current.load.bind(bookRef.current));
              noteNode = findFootnoteTargetInDoc(spineItem.document, targetId);
              spineItem.unload();
            }
            targetHref = `${resolvedPath}#${targetId}`;
          }

          if (noteNode) {
            const clone = noteNode.cloneNode(true);
            clone.querySelectorAll?.('a[role="doc-backlink"], a[href*="back"], a[href*="return"], sup').forEach((el) => el.remove());
            previewText = clampPreview(clone.textContent || noteNode.textContent || '');
          }
        } catch (err) {
          console.error('Footnote preview resolve failed', err);
        }

        if (!previewText) {
          previewText = 'Preview unavailable for this note.';
        }

        const rect = target.getBoundingClientRect();
        const frameRect = win.frameElement?.getBoundingClientRect();
        const x = (frameRect?.left || 0) + rect.right;
        const y = (frameRect?.top || 0) + rect.bottom;
        const label = normalizeWhitespace(target.textContent || '').slice(0, 24) || 'Note';

        onFootnotePreviewRef.current?.({
          x,
          y,
          label,
          text: previewText,
          targetHref
        });
      };

      doc.addEventListener('click', handleFootnoteClick, true);

      selectionCleanupRef.current.push(() => {
        doc.removeEventListener('mouseup', notifyIfCleared);
        doc.removeEventListener('keyup', notifyIfCleared);
        doc.removeEventListener('touchend', notifyIfCleared);
        doc.removeEventListener('mousedown', dismissFocusedSearch);
        doc.removeEventListener('touchstart', dismissFocusedSearch);
        doc.removeEventListener('click', handleFootnoteClick, true);
      });
    };

    rendition.hooks?.content?.register(registerSelectionClearWatcher);

    rendition.display(initialLocation || undefined).then(() => {
      book.locations.generate(1024).then(() => {
        const updateProgress = async () => {
            const loc = rendition.currentLocation();
            if (loc?.start) {
                // Handle Progress
                let val = book.locations.percentageFromCfi(loc.start.cfi) ?? loc.start.percentage;
                let cleanPercentage = loc.atEnd ? 100 : Math.min(Math.max(Math.floor(val * 100), 0), 99);
                if (onLocationChange) onLocationChange({ ...loc, percentage: cleanPercentage / 100 });
                setRelocationTick((tick) => tick + 1);

                // --- CHAPTER END DETECTION ---
                const currentHref = loc.start.href;
                
                // If chapter has changed and we have a previous chapter, it means we finished it
                if (lastChapterRef.current && lastChapterRef.current !== currentHref) {
                    const finishedHref = lastChapterRef.current;
                    
                    // Extract text for the finished chapter
                    const spineItem = book.spine.get(finishedHref);
                    if (spineItem) {
                        await spineItem.load(book.load.bind(book));
                        const rawText = spineItem.document.body.innerText;
                        
                        if (onChapterEnd) {
                            onChapterEnd(finishedHref, rawText);
                        }
                        spineItem.unload();
                    }
                }
                lastChapterRef.current = currentHref;
            }
        };
        updateProgress();
        rendition.on('relocated', updateProgress);
      });
    });

    rendition.on('selected', (cfiRange, contents) => {
      const range = contents?.range ? contents.range(cfiRange) : book.getRange(cfiRange);
      Promise.resolve(range).then((resolvedRange) => {
        if (!resolvedRange) return;
        const text = resolvedRange.toString();
        if (text && onSelectionRef.current) {
          const rects = resolvedRange.getClientRects();
          const rect = rects.length ? rects[rects.length - 1] : resolvedRange.getBoundingClientRect();
          let x = rect.right;
          let y = rect.bottom;
          const frame = contents?.window?.frameElement;
          if (frame) {
            const frameRect = frame.getBoundingClientRect();
            x += frameRect.left;
            y += frameRect.top;
          }
          onSelectionRef.current(text, cfiRange, { x, y }, false);
        }
      });
    });

    return () => {
      selectionCleanupRef.current.forEach((cleanup) => cleanup());
      selectionCleanupRef.current = [];
      clearInlineNoteMarkers();
      if (book) book.destroy();
    };
  }, [bookData, settings.flow]); 

  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, settings.theme);
  }, [settings.theme, settings.fontSize, settings.lineSpacing, settings.textMargin, settings.textAlign]);

  useEffect(() => {
    if (!renditionRef.current) return;
    try {
      if (settings.fontFamily && settings.fontFamily !== 'publisher') {
        renditionRef.current.themes.override('font-family', settings.fontFamily);
      } else {
        renditionRef.current.themes.override('font-family', 'inherit');
      }
    } catch (err) {
      console.error('Font override failed', err);
    }
  }, [settings.fontFamily]);

  useEffect(() => {
    if (!renditionRef.current) return;
    const lineHeight = Number.isFinite(Number(settings.lineSpacing))
      ? Math.min(2.4, Math.max(1.2, Number(settings.lineSpacing)))
      : 1.6;
    const allowedTextAlign = new Set(['left', 'center', 'right', 'justify']);
    const textAlign = allowedTextAlign.has(settings.textAlign) ? settings.textAlign : 'left';
    try {
      renditionRef.current.themes.override('line-height', `${lineHeight}`);
      renditionRef.current.themes.override('text-align', textAlign);
    } catch (err) {
      console.error('Typography override failed', err);
    }
  }, [settings.lineSpacing, settings.textAlign]);

  useEffect(() => {
    if (!renditionRef.current) return;
    const timer = setTimeout(() => {
      if (!renditionRef.current) return;
      const rendition = renditionRef.current;
      const nextMap = new Map();
      if (showSearchHighlights) {
        if (focusedSearchCfi) {
          nextMap.set(focusedSearchCfi, 'focus');
        } else if (activeSearchCfi) {
          nextMap.set(activeSearchCfi, 'active');
        }
      }

      nextMap.forEach((variant, cfi) => {
        const prevVariant = appliedSearchRef.current.get(cfi);
        if (prevVariant !== variant) {
          if (prevVariant) {
            try {
              rendition.annotations.remove(cfi, SEARCH_ANNOTATION_TYPE);
            } catch (err) {
              console.error('Search highlight cleanup failed', err);
            }
          }
          try {
            rendition.annotations.add(SEARCH_ANNOTATION_TYPE, cfi, {}, () => {
              if (variant === 'focus' && onSearchFocusDismissRef.current) {
                onSearchFocusDismissRef.current();
              }
              if (onSearchResultActivateRef.current) onSearchResultActivateRef.current(cfi);
            }, variant === 'focus' ? 'search-hl-focus' : variant === 'active' ? 'search-hl-active' : 'search-hl', {
              fill: variant === 'focus' ? '#22c55e' : '#facc15',
              'fill-opacity': variant === 'focus' ? '0.78' : variant === 'active' ? '0.85' : '0.28',
              'mix-blend-mode': 'normal',
              'background-color': variant === 'focus' ? '#22c55e' : '#facc15',
              opacity: variant === 'focus' ? '0.78' : variant === 'active' ? '0.85' : '0.28'
            });
          } catch (err) {
            console.error('Search highlight failed', err);
          }
        }
      });

      appliedSearchRef.current.forEach((_, cfi) => {
        if (nextMap.has(cfi)) return;
        try {
          rendition.annotations.remove(cfi, SEARCH_ANNOTATION_TYPE);
        } catch (err) {
          console.error('Search highlight cleanup failed', err);
        }
      });

      appliedSearchRef.current = nextMap;
      if (onSearchHighlightCountChangeRef.current) {
        onSearchHighlightCountChangeRef.current(nextMap.size);
      }
    }, 40);
    return () => {
      clearTimeout(timer);
      if (onSearchHighlightCountChangeRef.current) {
        onSearchHighlightCountChangeRef.current(0);
      }
    };
  }, [bookData, searchResults, activeSearchCfi, focusedSearchCfi, showSearchHighlights, settings.fontSize, settings.fontFamily, settings.flow, settings.theme, settings.lineSpacing, settings.textMargin, settings.textAlign]);

  useEffect(() => {
    if (!renditionRef.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!renditionRef.current) return;
      const rendition = renditionRef.current;
      const resolveHighlightTargetCfi = async (highlight) => {
        const originalCfi = highlight?.cfiRange;
        if (!originalCfi) return '';

        const quote = (highlight?.textQuote || highlight?.text || '').trim();
        const normalizedQuote = normalizeHighlightText(quote);
        const verifyCfi = async (candidateCfi) => {
          if (!candidateCfi) return false;
          try {
            const range = await Promise.resolve(rendition.book?.getRange?.(candidateCfi));
            if (!range) return false;
            if (!normalizedQuote) return true;
            const candidateText = normalizeHighlightText(range.toString() || '');
            if (!candidateText) return false;
            return candidateText === normalizedQuote
              || candidateText.includes(normalizedQuote)
              || normalizedQuote.includes(candidateText);
          } catch {
            return false;
          }
        };

        const cached = resolvedHighlightTargetsRef.current.get(originalCfi);
        if (cached && await verifyCfi(cached)) return cached;
        if (await verifyCfi(originalCfi)) return originalCfi;
        if (!normalizedQuote) return originalCfi;

        const prefix = highlight?.contextPrefix || '';
        const suffix = highlight?.contextSuffix || '';
        const chapterHref = highlight?.chapterHref || '';
        const renderedContents = rendition.getContents?.() || [];
        const orderedContents = chapterHref
          ? [
              ...renderedContents.filter((content) => isSameHref(content?.section?.href || '', chapterHref)),
              ...renderedContents.filter((content) => !isSameHref(content?.section?.href || '', chapterHref))
            ]
          : renderedContents;

        for (const content of orderedContents) {
          try {
            const doc = content?.document;
            if (!doc || !content?.cfiFromRange) continue;
            const recoveredRange = findRangeByQuote(doc, quote, prefix, suffix);
            if (!recoveredRange) continue;
            const recoveredCfi = content.cfiFromRange(recoveredRange);
            if (recoveredCfi && await verifyCfi(recoveredCfi)) {
              resolvedHighlightTargetsRef.current.set(originalCfi, recoveredCfi);
              return recoveredCfi;
            }
          } catch (err) {
            console.error('Rendered quote recovery failed', err);
          }
        }

        if (chapterHref) {
          try {
            const spineItem = bookRef.current?.spine?.get?.(chapterHref)
              || findSpineItemByHref(bookRef.current, chapterHref);
            if (spineItem) {
              await spineItem.load(bookRef.current.load.bind(bookRef.current));
              const doc = spineItem.document;
              const recoveredRange = findRangeByQuote(doc, quote, prefix, suffix);
              if (recoveredRange && typeof spineItem.cfiFromRange === 'function') {
                const recoveredCfi = spineItem.cfiFromRange(recoveredRange);
                if (recoveredCfi && await verifyCfi(recoveredCfi)) {
                  resolvedHighlightTargetsRef.current.set(originalCfi, recoveredCfi);
                  spineItem.unload?.();
                  return recoveredCfi;
                }
              }
              spineItem.unload?.();
            }
          } catch (err) {
            console.error('Chapter quote recovery failed', err);
          }
        }

        return originalCfi;
      };

      const renderHighlights = async () => {
        const layoutSignature = [
          settings.fontSize,
          settings.fontFamily,
          settings.flow,
          settings.theme,
          settings.lineSpacing,
          settings.textMargin,
          settings.textAlign
        ].join('|');
        const nextMap = new Map();
        const resolvedTargets = new Map();

        for (const h of highlights) {
          if (!h?.cfiRange || !h?.color) continue;
          const targetCfi = await resolveHighlightTargetCfi(h);
          if (!targetCfi) continue;
          resolvedTargets.set(h.cfiRange, targetCfi);

          const isFlashing = flashingHighlightCfi === h.cfiRange && flashingHighlightPulse > 0;
          const flashOn = isFlashing && flashingHighlightPulse % 2 === 1;
          const fillOpacity = flashOn ? '0.78' : '0.35';
          // Include layout signature so highlights are re-applied after text style/layout changes.
          const styleKey = `${h.color}|${fillOpacity}|${layoutSignature}`;
          nextMap.set(h.cfiRange, { styleKey, targetCfi });

          const prevState = appliedHighlightsRef.current.get(h.cfiRange);
          if (
            prevState?.styleKey === styleKey &&
            prevState?.targetCfi === targetCfi
          ) {
            continue;
          }

          if (prevState?.targetCfi) {
            try {
              rendition.annotations.remove(prevState.targetCfi, USER_HIGHLIGHT_ANNOTATION_TYPE);
            } catch (err) {
              console.error('Highlight cleanup failed', err);
            }
          }

          try {
            rendition.annotations.add(USER_HIGHLIGHT_ANNOTATION_TYPE, targetCfi, {}, (e) => {
              if (!onSelectionRef.current) return;
              const toViewportAnchor = (x, y, doc = null) => {
                let nextX = Number(x);
                let nextY = Number(y);
                if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return null;
                const frame = doc?.defaultView?.frameElement || null;
                if (frame) {
                  const frameRect = frame.getBoundingClientRect();
                  nextX += frameRect.left;
                  nextY += frameRect.top;
                }
                if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return null;
                return { x: nextX, y: nextY };
              };

              const emitSelection = (anchor) => {
                if (!anchor || !onSelectionRef.current) return false;
                onSelectionRef.current(h.text, h.cfiRange, anchor, true);
                return true;
              };

              const getRenderedRangeAnchor = () => {
                const contentsList = rendition.getContents?.() || [];
                if (!contentsList.length) return null;

                const ownerDoc = e?.target?.ownerDocument || null;
                const preferred = ownerDoc
                  ? contentsList.find((content) => content?.document === ownerDoc)
                  : null;
                const candidates = preferred
                  ? [preferred, ...contentsList.filter((content) => content !== preferred)]
                  : contentsList;

                for (const content of candidates) {
                  try {
                    const range = content?.range ? content.range(targetCfi) : null;
                    if (!range) continue;
                    const rects = range.getClientRects?.() || [];
                    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect?.();
                    if (!rect) continue;
                    return toViewportAnchor(rect.right, rect.bottom, content?.document || null);
                  } catch (error) {
                    console.error('Highlight rendered-range anchor failed', error);
                  }
                }
                return null;
              };

              if (emitSelection(getRenderedRangeAnchor())) return;
              if (emitSelection(toViewportAnchor(e?.clientX, e?.clientY, e?.target?.ownerDocument || null))) return;

              const rangeCandidate = rendition.book?.getRange?.(targetCfi);
              Promise.resolve(rangeCandidate)
                .then((resolvedRange) => {
                  if (!resolvedRange || !onSelectionRef.current) return;
                  const rects = resolvedRange.getClientRects?.() || [];
                  const rect = rects.length ? rects[rects.length - 1] : resolvedRange.getBoundingClientRect?.();
                  if (!rect) return;
                  const rangeDoc = resolvedRange?.startContainer?.ownerDocument || null;
                  emitSelection(toViewportAnchor(rect.right, rect.bottom, rangeDoc));
                })
                .catch((error) => {
                  console.error('Highlight anchor fallback failed', error);
                });
            }, 'hl', {
              fill: h.color,
              'fill-opacity': fillOpacity,
              'mix-blend-mode': 'normal'
            });
          } catch (err) {
            console.error('Highlight render failed', err);
          }
        }

        if (cancelled) return;

        appliedHighlightsRef.current.forEach((prevState, originalCfi) => {
          if (nextMap.has(originalCfi)) return;
          if (!prevState?.targetCfi) return;
          try {
            rendition.annotations.remove(prevState.targetCfi, USER_HIGHLIGHT_ANNOTATION_TYPE);
          } catch (err) {
            console.error('Highlight cleanup failed', err);
          }
        });
        appliedHighlightsRef.current = nextMap;

        clearInlineNoteMarkers();
        const renderedContents = rendition.getContents?.() || [];
        highlights.forEach((h) => {
          const noteValue = typeof h?.note === 'string' ? h.note.trim() : '';
          if (!noteValue || !h?.cfiRange) return;
          const targetCfi = resolvedTargets.get(h.cfiRange) || h.cfiRange;

          for (const content of renderedContents) {
            try {
              const doc = content?.document;
              const win = content?.window;
              if (!doc || !win || !content?.range) continue;

              const range = content.range(targetCfi);
              if (!range) continue;
              const rects = range.getClientRects?.() || [];
              const firstRect = rects.length ? rects[0] : range.getBoundingClientRect?.();
              if (!firstRect) continue;

              if (doc.defaultView?.getComputedStyle(doc.body).position === 'static') {
                doc.body.style.position = 'relative';
              }

              const marker = doc.createElement('button');
              marker.type = 'button';
              marker.setAttribute('aria-label', 'Open highlight note');
              marker.setAttribute('data-testid', 'inline-note-marker');
              marker.className = 'sr-inline-note-marker';
              marker.textContent = '✎';
              marker.title = noteValue.slice(0, 180);
              marker.style.position = 'absolute';
              marker.style.left = `${firstRect.right + win.scrollX + 2}px`;
              marker.style.top = `${firstRect.top + win.scrollY - 8}px`;
              marker.style.width = '13px';
              marker.style.height = '13px';
              marker.style.display = 'flex';
              marker.style.alignItems = 'center';
              marker.style.justifyContent = 'center';
              marker.style.borderRadius = '999px';
              marker.style.border = '1px solid rgba(15, 23, 42, 0.28)';
              marker.style.background = h.color || '#fca5a5';
              marker.style.color = getContrastTextColor(h.color || '#fca5a5');
              marker.style.fontSize = '9px';
              marker.style.fontWeight = '700';
              marker.style.fontFamily = "'Inter', Arial, sans-serif";
              marker.style.lineHeight = '1';
              marker.style.boxShadow = '0 1px 3px rgba(15, 23, 42, 0.35)';
              marker.style.zIndex = '22';
              marker.style.cursor = 'pointer';
              marker.style.padding = '0';
              marker.style.userSelect = 'none';

              const clickHandler = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!onInlineNoteMarkerActivateRef.current) return;
                const frameRect = win.frameElement?.getBoundingClientRect();
                const anchor = frameRect
                  ? { x: frameRect.left + firstRect.right, y: frameRect.top + firstRect.bottom }
                  : { x: firstRect.right, y: firstRect.bottom };
                onInlineNoteMarkerActivateRef.current({
                  highlight: h,
                  anchor
                });
              };
              marker.addEventListener('click', clickHandler);
              doc.body.appendChild(marker);
              inlineNoteMarkersRef.current.push({
                element: marker,
                cleanup: () => marker.removeEventListener('click', clickHandler)
              });
              break;
            } catch {
              // CFI may not exist in this rendered frame.
            }
          }
        });
      };

      void renderHighlights();
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInlineNoteMarkers();
    };
  }, [bookData, highlights, flashingHighlightCfi, flashingHighlightPulse, settings.fontSize, settings.fontFamily, settings.flow, settings.theme, settings.lineSpacing, settings.textMargin, settings.textAlign, relocationTick]);


  const prevPage = () => renditionRef.current?.prev();
  const nextPage = () => renditionRef.current?.next();

  return (
    <div className="h-full flex flex-col relative transition-colors duration-200">
      <div
        ref={viewerRef}
        className={`flex-1 h-full w-full ${
          settings.theme === 'dark'
            ? 'bg-gray-900'
            : settings.theme === 'sepia'
              ? 'bg-amber-100'
              : 'bg-white'
        }`}
      />
      {settings.flow === 'paginated' && (
        <div className="absolute inset-0 pointer-events-none">
          <button
            type="button"
            onClick={prevPage}
            data-testid="reader-page-prev-zone"
            aria-label="Previous page"
            title="Previous page"
            className="pointer-events-auto absolute inset-y-0 left-0 w-[10vw] min-w-[40px] max-w-[72px] cursor-w-resize bg-transparent"
          />
          <button
            type="button"
            onClick={nextPage}
            data-testid="reader-page-next-zone"
            aria-label="Next page"
            title="Next page"
            className="pointer-events-auto absolute inset-y-0 right-0 w-[10vw] min-w-[40px] max-w-[72px] cursor-e-resize bg-transparent"
          />
        </div>
      )}
    </div>
  );
}
