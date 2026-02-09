import React from "react";

export default function LibraryGlobalSearchPanel({
  showGlobalSearchSplitColumns,
  globalSearchTotal,
  isContentSearching,
  globalMatchedBookPairs,
  globalOtherGroups,
  globalMatchedBooks,
  contentPanelHeightClass,
  contentScrollHeightClass,
  onOpenResult,
  renderGlobalSearchBookCard
}) {
  return (
    <div className={`mb-4 ${showGlobalSearchSplitColumns ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.95fr)] gap-4 items-start" : ""}`}>
      <section
        data-testid="global-search-panel"
        className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-blue-900">Global Search Results</h2>
          <span className="text-xs font-semibold text-blue-700">
            {globalSearchTotal} match{globalSearchTotal === 1 ? "" : "es"}
          </span>
        </div>
        {isContentSearching && (
          <p data-testid="global-search-scanning" className="mt-2 text-[11px] font-semibold text-blue-800/80">
            Scanning book text...
          </p>
        )}

        {globalSearchTotal === 0 ? (
          <p data-testid="global-search-empty" className="mt-2 text-xs text-blue-800/80">
            No matches found in books, highlights, notes, or bookmarks.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {globalMatchedBookPairs.length > 0 && (
              <div data-testid="global-search-found-books" className="space-y-3">
                {globalMatchedBookPairs.map((pair) => (
                  <div
                    key={`content-pair-${pair.bookId}`}
                    data-testid="global-search-content-book-row"
                    className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.95fr)] gap-3 items-start"
                  >
                    <div
                      data-testid="global-search-group-content"
                      className={`rounded-xl border border-blue-100 bg-white p-3 ${contentPanelHeightClass}`}
                    >
                      <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-blue-700">
                        Book content · {pair.title}
                      </div>
                      <div
                        data-testid="global-search-group-content-scroll"
                        className={`space-y-2 ${contentScrollHeightClass} overflow-y-auto pr-1 pb-2`}
                      >
                        {pair.contentItems.map((item) => (
                          <button
                            key={item.id}
                            data-testid="global-search-result-content"
                            onClick={(e) => onOpenResult(e, item)}
                            className="w-full text-left rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50 px-2 py-2 transition"
                          >
                            <div className="text-xs font-bold text-gray-900 line-clamp-1">{item.title}</div>
                            <div className="text-[11px] text-gray-500 line-clamp-1">{item.subtitle}</div>
                            {item.snippet && (
                              <div className="mt-1 text-[11px] leading-[1.45] text-gray-700 line-clamp-2">{item.snippet}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>{renderGlobalSearchBookCard(pair)}</div>
                  </div>
                ))}
              </div>
            )}

            {globalOtherGroups.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {globalOtherGroups.map((group) => (
                  <div
                    key={group.key}
                    data-testid={`global-search-group-${group.key}`}
                    className="rounded-xl border border-blue-100 bg-white p-3"
                  >
                    <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-blue-700">
                      {group.label}
                    </div>
                    <div className="space-y-2">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          data-testid={`global-search-result-${group.key}`}
                          onClick={(e) => onOpenResult(e, item)}
                          className="w-full text-left rounded-lg border border-transparent hover:border-blue-200 hover:bg-blue-50 px-2 py-2 transition"
                        >
                          <div className="text-xs font-bold text-gray-900 line-clamp-1">{item.title}</div>
                          <div className="text-[11px] text-gray-500 line-clamp-1">{item.subtitle}</div>
                          {item.snippet && (
                            <div className="mt-1 text-[11px] text-gray-700 line-clamp-2">{item.snippet}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {globalMatchedBookPairs.length === 0 && globalOtherGroups.length === 0 && (
              <p className="text-xs text-blue-800/80">
                Book matches are shown on the right.
              </p>
            )}
          </div>
        )}
      </section>
      {showGlobalSearchSplitColumns && (
        <aside
          data-testid="global-search-found-books"
          className="rounded-2xl border border-blue-100 bg-white p-4"
        >
          <div className="text-sm font-bold text-gray-900">Found books</div>
          <p className="mt-1 text-xs text-gray-500">
            {globalMatchedBooks.length} book{globalMatchedBooks.length === 1 ? "" : "s"} found
          </p>
          <div className="mt-3 max-h-[70vh] overflow-y-auto pr-1 space-y-4">
            {globalMatchedBooks.map((item) => renderGlobalSearchBookCard(item))}
          </div>
        </aside>
      )}
    </div>
  );
}
