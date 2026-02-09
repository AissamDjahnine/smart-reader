import React from "react";

export default function LibraryHighlightsCenterPanel({
  highlightsCenterFilteredEntries,
  highlightsCenterPairs,
  searchQuery,
  contentPanelHeightClass,
  contentScrollHeightClass,
  renderBookCard,
  onClose,
  onOpenReader
}) {
  return (
    <section data-testid="highlights-center-panel" className="mb-4 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-indigo-900">Highlights Center</h2>
          <p className="mt-1 text-xs text-indigo-700/90">
            {highlightsCenterFilteredEntries.length} highlight{highlightsCenterFilteredEntries.length === 1 ? "" : "s"} shown
            {searchQuery.trim() ? ` for "${searchQuery.trim()}"` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-indigo-700 hover:text-indigo-900"
        >
          Close
        </button>
      </div>

      {highlightsCenterFilteredEntries.length === 0 ? (
        <div data-testid="highlights-center-empty" className="mt-3 rounded-xl border border-indigo-100 bg-white p-3 text-xs text-gray-600">
          No highlights found yet. Add highlights in the Reader, then manage them here.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {(highlightsCenterPairs || []).map((pair) => (
            <div
              key={`highlights-pair-${pair.bookId}`}
              data-testid="highlights-center-book-row"
              className="grid grid-cols-1 gap-3 items-start lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.95fr)]"
            >
              <div className={`rounded-xl border border-indigo-100 bg-white p-3 ${contentPanelHeightClass}`}>
                <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-indigo-700">
                  Highlights · {pair.title}
                </div>
                <div className={`space-y-3 overflow-y-auto pr-1 pb-2 ${contentScrollHeightClass}`}>
                  {pair.entries.map((entry) => (
                    <article key={entry.id} data-testid="highlights-center-item" className="rounded-xl border border-indigo-100 bg-white p-3">
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
