import React from "react";
import { ArrowUpDown, Search, X } from "lucide-react";

const VIRTUAL_HIGHLIGHT_ITEM_STYLE = { contentVisibility: "auto", containIntrinsicSize: "180px" };
const VIRTUAL_BOOK_ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "560px" };

export default function LibraryHighlightsCenterPanel({
  highlightsCenterFilteredEntries,
  highlightsCenterPairs,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  contentPanelHeightClass,
  contentScrollHeightClass,
  renderBookCard,
  onClose,
  onOpenReader
}) {
  const trimmedSearchQuery = searchQuery.trim();

  return (
    <section data-testid="highlights-center-panel" className="mb-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div
        data-testid="highlights-local-actions-sticky"
        className="sticky top-3 z-20 mb-3 rounded-2xl border border-gray-200 bg-white/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-white/90"
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              data-testid="highlights-local-search"
              type="text"
              placeholder="Search highlights..."
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
            />
            {trimmedSearchQuery ? (
              <button
                type="button"
                data-testid="highlights-local-search-clear"
                onClick={() => onSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Clear highlights search"
              >
                <X size={14} />
              </button>
            ) : null}
          </label>

          <label className="relative block">
            <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
            <select
              data-testid="highlights-local-sort"
              value={sortBy}
              onChange={(event) => onSortChange(event.target.value)}
              className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="recent">Most recent</option>
              <option value="book-asc">Book title (A-Z)</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
          >
            Back to Library
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A2E]">Highlights Workspace</h2>
          <p className="mt-1 text-xs text-gray-600">
            {highlightsCenterFilteredEntries.length} highlight{highlightsCenterFilteredEntries.length === 1 ? "" : "s"} shown
            {searchQuery.trim() ? ` for "${searchQuery.trim()}"` : ""}
          </p>
        </div>
        <span className="text-xs font-semibold text-gray-500">Manage highlights across books</span>
      </div>

      {highlightsCenterFilteredEntries.length === 0 ? (
        <div data-testid="highlights-center-empty" className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          No highlights found yet. Add highlights in the Reader, then manage them here.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {(highlightsCenterPairs || []).map((pair) => (
            <div
              key={`highlights-pair-${pair.bookId}`}
              data-testid="highlights-center-book-row"
              className="grid grid-cols-1 gap-3 items-start lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.95fr)]"
              style={VIRTUAL_BOOK_ROW_STYLE}
            >
              <div className={`rounded-2xl border border-gray-200 bg-white p-3 ${contentPanelHeightClass}`}>
                <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-indigo-700">
                  Highlights · {pair.title}
                </div>
                <div className={`space-y-3 overflow-y-auto pr-1 pb-2 ${contentScrollHeightClass}`}>
                  {pair.entries.map((entry) => (
                    <article
                      key={entry.id}
                      data-testid="highlights-center-item"
                      className="rounded-xl border border-indigo-100 bg-white p-3"
                      style={VIRTUAL_HIGHLIGHT_ITEM_STYLE}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-900">{entry.bookTitle}</div>
                          <div className="text-xs text-gray-500">{entry.bookAuthor}</div>
                        </div>
                        <button
                          type="button"
                          data-testid="highlights-center-open-reader"
                          onClick={() => onOpenReader(entry)}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                        >
                          Open in Reader
                        </button>
                      </div>

                      <p className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-2 py-2 text-sm text-gray-800">
                        {entry.text}
                      </p>
                      {entry.note && (
                        <p className="mt-2 text-xs italic text-gray-500">
                          Note: {entry.note}
                        </p>
                      )}
                      <div className="mt-2 h-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
                    </article>
                  ))}
                </div>
              </div>
              <div>{renderBookCard(pair.cardItem)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
