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
  return /^[\d*†‡§\[\]()]+$/.test(markerText);
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
        'max-width': isScrolled ? 'min(940px, calc(100vw - 88px)) !important' : 'none !important',
        'width': '100% !important',
        'margin': isScrolled ? '20px auto 28px auto !important' : '0 !important',
        'padding-left': isScrolled ? '32px !important' : '0 !important',
        'padding-right': isScrolled ? '32px !important' : '0 !important',
        'padding-top': '0 !important',
        'padding-bottom': '0 !important',
        'box-sizing': 'border-box !important',
        'position': 'relative !important'
      },
      'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': `${textColor} !important` },
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
  }, [settings.theme, settings.fontSize]);

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
  }, [bookData, searchResults, activeSearchCfi, focusedSearchCfi, showSearchHighlights, settings.fontSize, settings.fontFamily, settings.flow, settings.theme]);

  useEffect(() => {
    if (!renditionRef.current) return;
    const timer = setTimeout(() => {
      if (!renditionRef.current) return;
      const rendition = renditionRef.current;
      const nextMap = new Map();
      highlights.forEach((h) => {
        if (!h?.cfiRange || !h?.color) return;
        const isFlashing = flashingHighlightCfi === h.cfiRange && flashingHighlightPulse > 0;
        const flashOn = isFlashing && flashingHighlightPulse % 2 === 1;
        const fillOpacity = flashOn ? '0.78' : '0.35';
        const styleKey = `${h.color}|${fillOpacity}`;
        nextMap.set(h.cfiRange, styleKey);
        const prevStyle = appliedHighlightsRef.current.get(h.cfiRange);
        if (prevStyle !== styleKey) {
          if (prevStyle) {
            try {
              rendition.annotations.remove(h.cfiRange, USER_HIGHLIGHT_ANNOTATION_TYPE);
            } catch (err) {
              console.error('Highlight cleanup failed', err);
            }
          }
          try {
            rendition.annotations.add(USER_HIGHLIGHT_ANNOTATION_TYPE, h.cfiRange, {}, (e) => {
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
                    const range = content?.range ? content.range(h.cfiRange) : null;
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

              const rangeCandidate = book.getRange(h.cfiRange);
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
      });
      appliedHighlightsRef.current.forEach((_, cfi) => {
        if (!nextMap.has(cfi)) {
          try {
            rendition.annotations.remove(cfi, USER_HIGHLIGHT_ANNOTATION_TYPE);
          } catch (err) {
            console.error('Highlight cleanup failed', err);
          }
        }
      });
      appliedHighlightsRef.current = nextMap;

      clearInlineNoteMarkers();
      const renderedContents = rendition.getContents?.() || [];
      highlights.forEach((h) => {
        const noteValue = typeof h?.note === 'string' ? h.note.trim() : '';
        if (!noteValue || !h?.cfiRange) return;

        for (const content of renderedContents) {
          try {
            const doc = content?.document;
            const win = content?.window;
            if (!doc || !win || !content?.range) continue;

            const range = content.range(h.cfiRange);
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
          } catch (err) {
            // CFI may not exist in this rendered frame.
          }
        }
      });
    }, 40);
    return () => {
      clearTimeout(timer);
      clearInlineNoteMarkers();
    };
  }, [bookData, highlights, flashingHighlightCfi, flashingHighlightPulse, settings.fontSize, settings.fontFamily, settings.flow, settings.theme, relocationTick]);


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
        <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-2">
          <button onClick={prevPage} className="pointer-events-auto bg-black/20 hover:bg-black/50 text-white p-2 rounded-full">‹</button>
          <button onClick={nextPage} className="pointer-events-auto bg-black/20 hover:bg-black/50 text-white p-2 rounded-full">›</button>
        </div>
      )}
    </div>
  );
}
