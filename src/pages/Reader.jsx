import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getBook, updateBookProgress, saveHighlight, deleteHighlight, updateReadingStats, saveChapterSummary, savePageSummary } from '../services/db';
import BookView from '../components/BookView';
import { summarizeChapter } from '../services/ai'; 

import { 
  Moon, Sun, BookOpen, Scroll, Type, 
  ChevronLeft, Menu, X,
  Search as SearchIcon, ChevronUp, ChevronDown, Sparkles, Wand2, User,
  BookOpenText
} from 'lucide-react';

export default function Reader() {
  const [searchParams] = useSearchParams();
  const bookId = searchParams.get('id');
  const [book, setBook] = useState(null);
  const bookRef = useRef(null);
  
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSearchMenu, setShowSearchMenu] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [isPageSummarizing, setIsPageSummarizing] = useState(false);
  const [isChapterSummarizing, setIsChapterSummarizing] = useState(false);
  const [isStoryRecapping, setIsStoryRecapping] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isDefining, setIsDefining] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('chapters');
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchTokenRef = useRef(0);
  const [showDictionary, setShowDictionary] = useState(false);
  const [dictionaryQuery, setDictionaryQuery] = useState("");
  const [dictionaryEntry, setDictionaryEntry] = useState(null);
  const [dictionaryError, setDictionaryError] = useState("");
  const dictionaryTokenRef = useRef(0);

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
        await section.load(book.load.bind(book));
        const matches = section.search(term) || [];
        matches.forEach((match) => {
          results.push({
            ...match,
            href: section.href,
            spineIndex: section.index
          });
        });
        section.unload();
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

  const handleSelection = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    const wordCount = trimmed.split(/\s+/).length;
    const clean = sanitizeDictionaryTerm(trimmed);
    if (!clean) return;
    setShowDictionary(true);
    setDictionaryQuery(clean);
    if (wordCount === 1) {
      lookupDictionary(clean);
    } else {
      setDictionaryEntry(null);
      setDictionaryError('Select a single word to look it up.');
    }
  };

  const handleLocationChange = (loc) => {
    if (!loc?.start || !bookId) return;
    updateBookProgress(bookId, loc.start.cfi, loc.percentage || 0);

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
      const finalChapterSummary = await summarizeChapter(rawText, memory, 'cumulative');
      if (finalChapterSummary) {
        const updatedGlobal = memory ? `${memory}\n\n${finalChapterSummary}` : finalChapterSummary;
        const updatedBook = await saveChapterSummary(currentBook.id, chapterHref, finalChapterSummary, updatedGlobal);
        if (updatedBook) {
          setBook(updatedBook);
        }
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

    try {
      const viewer = rendition.getContents()[0];
      const pageText = viewer.document.body.innerText;
      const memory = getStoryMemory(currentBook);
      const pageSummary = await summarizeChapter(pageText, memory, "contextual");
      if (pageSummary) {
        setPageSummary(pageSummary);
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

    const memory = getStoryMemory(currentBook);
    if (!memory) return;

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
      const recap = await summarizeChapter(pageText, memory, "recap");
      if (recap) {
        setStoryRecap(recap);
      } else {
        setStoryRecap(memory);
      }
    } catch (err) {
      console.error(err);
      setStoryRecap(memory);
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
    try {
      isBackgroundSummarizingRef.current = true;
      const viewer = rendition.getContents()[0];
      const pageText = viewer.document.body.innerText;
      const memory = currentBook.globalSummary || "";
      const snippet = await summarizeChapter(pageText, memory, 'cumulative');
      if (snippet) {
        const updatedGlobal = memory ? `${memory}\n\n${snippet}` : snippet;
        const updatedBook = await savePageSummary(currentBook.id, cfi, snippet, updatedGlobal);
        if (updatedBook) {
          setBook(updatedBook);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      isBackgroundSummarizingRef.current = false;
    }
  };

  useEffect(() => {
    const loadBook = async () => { if (bookId) setBook(await getBook(bookId)); };
    loadBook();
  }, [bookId]);

  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('reader-settings');
    return saved ? JSON.parse(saved) : { fontSize: 100, theme: 'light', flow: 'paginated' };
  });

  const phoneticText =
    dictionaryEntry?.phonetic ||
    dictionaryEntry?.phonetics?.find((p) => p.text)?.text ||
    "";

  if (!book) return <div className="p-10 text-center dark:bg-gray-900 dark:text-gray-400">Loading...</div>;

  return (
    <div className={`h-screen flex flex-col overflow-hidden transition-colors duration-200 ${settings.theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}>
      
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

                <div className="max-h-[55vh] overflow-y-auto pr-2 custom-scrollbar space-y-6">
                  {(() => {
                    const storyMemory = getStoryMemory(book);
                    // Choose the appropriate content based on the mode: the contextual page
                    // explanation or the story-so-far recap.
                    const content =
                      modalMode === 'page'
                        ? pageSummary ||
                          'Summary:\nYour story is unfolding. Read more to see the analysis.'
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

      {showSearchMenu && (
        <div className="fixed inset-0 z-[55]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeSearchMenu}
          />
          <div
            className={`absolute right-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <SearchIcon size={18} className="text-gray-400" />
              <input
                type="text"
                placeholder="Search inside this book..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch(searchQuery);
                }}
                className="flex-1 bg-transparent outline-none text-sm"
              />
              <button
                onClick={closeSearchMenu}
                className="p-1 text-gray-400 hover:text-red-500"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
              <span>
                {isSearching ? 'Searching...' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={goToPrevResult}
                  disabled={!searchResults.length}
                  className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={goToNextResult}
                  disabled={!searchResults.length}
                  className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                >
                  <ChevronDown size={14} />
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
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 max-h-[45vh] overflow-y-auto pr-1 space-y-2">
              {!isSearching && searchQuery && searchResults.length === 0 && (
                <div className="text-xs text-gray-500">No matches found.</div>
              )}
              {searchResults.map((result, idx) => (
                <button
                  key={`${result.cfi}-${idx}`}
                  onClick={() => goToSearchIndex(idx)}
                  className={`w-full text-left p-3 rounded-2xl border transition ${
                    activeSearchIndex === idx
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                      : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700'
                  }`}
                >
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">
                    Result {idx + 1}
                  </div>
                  <div className="text-sm text-gray-700 dark:text-gray-200">
                    {result.excerpt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showDictionary && (
        <div className="fixed inset-0 z-[55]">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={closeDictionary}
          />
          <div
            className={`absolute left-4 top-20 w-[92vw] max-w-md rounded-3xl shadow-2xl p-5 ${
              settings.theme === 'dark' ? 'bg-gray-800 border border-gray-700' : 'bg-white'
            }`}
          >
            <div className="flex items-center gap-2">
              <BookOpenText size={18} className="text-gray-400" />
              <input
                type="text"
                placeholder="Look up a word..."
                value={dictionaryQuery}
                onChange={(e) => setDictionaryQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') lookupDictionary(dictionaryQuery);
                }}
                className="flex-1 bg-transparent outline-none text-sm"
              />
              <button
                onClick={closeDictionary}
                className="p-1 text-gray-400 hover:text-red-500"
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
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold"
              >
                Clear
              </button>
            </div>

            <div className="mt-4 max-h-[45vh] overflow-y-auto pr-1 space-y-4">
              {isDefining && (
                <div className="text-xs text-gray-500">Looking up definition...</div>
              )}
              {!isDefining && dictionaryError && (
                <div className="text-xs text-red-500">{dictionaryError}</div>
              )}
              {!isDefining && dictionaryEntry && (
                <div className="space-y-3">
                  <div>
                    <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      {dictionaryEntry.word}
                    </div>
                    {phoneticText && (
                      <div className="text-xs text-gray-500">{phoneticText}</div>
                    )}
                  </div>

                  {(dictionaryEntry.meanings || []).slice(0, 3).map((meaning, idx) => (
                    <div key={`${meaning.partOfSpeech}-${idx}`} className="space-y-2">
                      <div className="text-xs uppercase tracking-widest text-gray-400">
                        {meaning.partOfSpeech}
                      </div>
                      {(meaning.definitions || []).slice(0, 2).map((def, dIdx) => (
                        <div key={`${idx}-${dIdx}`} className="text-sm text-gray-700 dark:text-gray-200">
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
      )}

      {/* TOP BAR */}
      <div className={`flex items-center justify-between p-3 border-b shadow-sm z-20 ${settings.theme === 'dark' ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-800'}`}>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSidebar(true)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition"><Menu size={20} /></button>
          <Link to="/" className="hover:opacity-70 p-1"><ChevronLeft size={24} /></Link>
          <h2 className="font-bold truncate text-sm max-w-[120px]">{book.title}</h2>
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
            onClick={() => setShowDictionary((s) => !s)}
            className={`p-2 rounded-full transition ${showDictionary ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            title="Dictionary"
          >
            <BookOpenText size={18} />
          </button>
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
          <button onClick={() => setSettings(s => ({...s, theme: s.theme === 'light' ? 'dark' : 'light'}))} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">{settings.theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}</button>
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
          onSelection={(text) => handleSelection(text)}
        />
      </div>
    </div>
  );
}
