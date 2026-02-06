import React, { useEffect, useRef } from 'react';
import ePub from 'epubjs';

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
  onChapterEnd // NEW: Callback for AI summarization
}) {
  const viewerRef = useRef(null);
  const renditionRef = useRef(null);
  const bookRef = useRef(null);
  const lastChapterRef = useRef(null); // Track chapter changes

  const applyTheme = (rendition, theme) => {
    if (!rendition) return;
    const bodyStyles = theme === 'dark' 
      ? { 
          'body': { 'color': '#e5e7eb !important', 'background': '#111827 !important' },
          'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': '#e5e7eb !important' }
        } 
      : { 
          'body': { 'color': '#111827 !important', 'background': '#ffffff !important' },
          'p, span, div, li, h1, h2, h3, h4, h5, h6': { 'color': '#111827 !important' }
        };
    
    rendition.themes.register(theme, bodyStyles);
    rendition.themes.select(theme);
    rendition.themes.fontSize(`${settings.fontSize}%`);
  };

  useEffect(() => {
    if (tocJump && renditionRef.current) {
      renditionRef.current.display(tocJump);
    }
  }, [tocJump]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.annotations.remove('search-hl');
    searchResults.forEach(result => {
      renditionRef.current.annotations.add('highlight', result.cfi, {}, null, 'search-hl', {
        fill: '#facc15', 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply'
      });
    });
  }, [searchResults]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.annotations.remove('hl');
    highlights.forEach(h => {
      renditionRef.current.annotations.add('highlight', h.cfiRange, {}, (e) => {
        if (onSelection) onSelection(h.text, h.cfiRange, { x: e.clientX, y: e.clientY }, true);
      }, 'hl', { fill: h.color, 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' });
    });
  }, [highlights]);

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

    if (onRenditionReady) onRenditionReady(rendition);

    applyTheme(rendition, settings.theme);

    rendition.display(initialLocation || undefined).then(() => {
      highlights.forEach(h => {
        rendition.annotations.add('highlight', h.cfiRange, {}, (e) => {
          if (onSelection) onSelection(h.text, h.cfiRange, { x: e.clientX, y: e.clientY }, true);
        }, 'hl', { fill: h.color, 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' });
      });

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
        if (text && onSelection) {
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
          onSelection(text, cfiRange, { x, y }, false);
        }
      });
    });

    return () => { if (book) book.destroy(); };
  }, [bookData, settings.flow]); 

  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, settings.theme);
  }, [settings.theme, settings.fontSize]);

  const prevPage = () => renditionRef.current?.prev();
  const nextPage = () => renditionRef.current?.next();

  return (
    <div className="h-full flex flex-col relative transition-colors duration-200">
      <div ref={viewerRef} className={`flex-1 h-full w-full ${settings.theme === 'dark' ? 'bg-gray-900' : 'bg-white'}`} />
      {settings.flow === 'paginated' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-2">
          <button onClick={prevPage} className="pointer-events-auto bg-black/20 hover:bg-black/50 text-white p-2 rounded-full">‹</button>
          <button onClick={nextPage} className="pointer-events-auto bg-black/20 hover:bg-black/50 text-white p-2 rounded-full">›</button>
        </div>
      )}
    </div>
  );
}
