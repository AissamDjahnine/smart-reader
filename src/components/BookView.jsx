import React, { useEffect, useRef } from 'react';
import ePub from 'epubjs';

const EPUB_THEME_KEY = 'reader-theme';
const SEARCH_ANNOTATION_TYPE = 'mark';
const USER_HIGHLIGHT_ANNOTATION_TYPE = 'highlight';

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
  onChapterEnd // NEW: Callback for AI summarization
}) {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const lastChapterRef = useRef(null); // Track chapter changes
  const onSelectionRef = useRef(onSelection);
  const onSearchResultActivateRef = useRef(onSearchResultActivate);
  const onSearchFocusDismissRef = useRef(onSearchFocusDismiss);
  const appliedHighlightsRef = useRef(new Map());
  const appliedSearchRef = useRef(new Map());
  const selectionCleanupRef = useRef([]);

  useEffect(() => {
    onSelectionRef.current = onSelection;
  }, [onSelection]);

  useEffect(() => {
    onSearchResultActivateRef.current = onSearchResultActivate;
  }, [onSearchResultActivate]);

  useEffect(() => {
    onSearchFocusDismissRef.current = onSearchFocusDismiss;
  }, [onSearchFocusDismiss]);

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
        'box-sizing': 'border-box !important'
      },
      'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': `${textColor} !important` },
      'img, svg, video, canvas': {
        'max-width': '100% !important',
        'height': 'auto !important'
      }
    };
    
    rendition.themes.register(EPUB_THEME_KEY, bodyStyles);
    rendition.themes.select(EPUB_THEME_KEY);
    rendition.themes.fontSize(`${settings.fontSize}%`);
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
      };

      doc.addEventListener('mousedown', dismissFocusedSearch);
      doc.addEventListener('touchstart', dismissFocusedSearch);

      selectionCleanupRef.current.push(() => {
        doc.removeEventListener('mouseup', notifyIfCleared);
        doc.removeEventListener('keyup', notifyIfCleared);
        doc.removeEventListener('touchend', notifyIfCleared);
        doc.removeEventListener('mousedown', dismissFocusedSearch);
        doc.removeEventListener('touchstart', dismissFocusedSearch);
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
        } else {
          searchResults.forEach((result) => {
            if (!result?.cfi) return;
            const cfi = result.cfi;
            const variant = cfi === activeSearchCfi ? 'active' : 'normal';
            if (!nextMap.has(cfi) || variant === 'active') {
              nextMap.set(cfi, variant);
            }
          });
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
    }, 40);
    return () => clearTimeout(timer);
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
    }, 40);
    return () => clearTimeout(timer);
  }, [bookData, highlights, flashingHighlightCfi, flashingHighlightPulse, settings.fontSize, settings.fontFamily, settings.flow, settings.theme]);


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
