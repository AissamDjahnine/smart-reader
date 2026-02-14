import React from "react";
import { ArrowUpDown, Search, X } from "lucide-react";

const VIRTUAL_NOTE_ITEM_STYLE = { contentVisibility: "auto", containIntrinsicSize: "190px" };
const VIRTUAL_BOOK_ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "560px" };

export default function LibraryNotesCenterPanel({
  isDarkLibraryTheme,
  notesCenterFilteredEntries,
  notesCenterPairs,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  contentPanelHeightClass,
  contentScrollHeightClass,
  renderBookCard,
  editingNoteId,
  noteEditorValue,
  isSavingNote,
  onClose,
  onOpenReader,
  onStartEdit,
  onNoteEditorChange,
  onSaveNote,
  onCancelEdit
}) {
  const trimmedSearchQuery = searchQuery.trim();

  return (
    <section
      data-testid="notes-center-panel"
      className={`workspace-surface mb-4 p-5 ${isDarkLibraryTheme ? "workspace-surface-dark" : "workspace-surface-light"}`}
    >
      <div
        data-testid="notes-local-actions-sticky"
        className={`sticky top-3 z-20 mb-3 rounded-2xl border p-3 backdrop-blur ${
          isDarkLibraryTheme
            ? "border-slate-700 bg-slate-900/95 supports-[backdrop-filter]:bg-slate-900/90"
            : "border-gray-200 bg-white/95 supports-[backdrop-filter]:bg-white/90"
        }`}
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <label className="relative block">
            <Search className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-400"}`} size={16} />
            <input
              data-testid="notes-local-search"
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              className={`h-10 w-full rounded-xl border pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800 text-slate-100"
                  : "border-gray-200 bg-white text-gray-800"
              }`}
            />
            {trimmedSearchQuery ? (
              <button
                type="button"
                data-testid="notes-local-search-clear"
                onClick={() => onSearchChange("")}
                className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 ${
                  isDarkLibraryTheme
                    ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                }`}
                aria-label="Clear notes search"
              >
                <X size={14} />
              </button>
            ) : null}
          </label>

          <label className="relative block">
            <ArrowUpDown className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-400"}`} size={15} />
            <select
              data-testid="notes-local-sort"
              value={sortBy}
              onChange={(event) => onSortChange(event.target.value)}
              className={`h-10 w-full rounded-xl border pl-9 pr-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-600 bg-slate-800 text-slate-100"
                  : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              <option value="recent">Most recent</option>
              <option value="book-asc">Book title (A-Z)</option>
            </select>
          </label>

          <button
            type="button"
            onClick={onClose}
            className={`h-10 rounded-xl border px-3 text-xs font-semibold ${
              isDarkLibraryTheme
                ? "border-slate-600 text-slate-200 hover:border-blue-400 hover:text-blue-300"
                : "border-gray-200 text-gray-700 hover:border-blue-200 hover:text-blue-700"
            }`}
          >
            Back to Library
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className={`text-lg font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>Notes Workspace</h2>
          <p
            data-testid="notes-center-count"
            className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-600"}`}
          >
            {notesCenterFilteredEntries.length} note{notesCenterFilteredEntries.length === 1 ? "" : "s"} shown
            {searchQuery.trim() ? ` for "${searchQuery.trim()}"` : ""}
          </p>
        </div>
        <span className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-500"}`}>Manage notes across books</span>
      </div>

      {notesCenterFilteredEntries.length === 0 ? (
        <div
          data-testid="notes-center-empty"
          className={`mt-3 rounded-xl border p-3 text-xs ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900/70 text-slate-300" : "border-gray-200 bg-gray-50 text-gray-600"}`}
        >
          No notes found yet. Add notes on highlights in the Reader, then manage them here.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {(notesCenterPairs || []).map((pair) => (
            <div
              key={`notes-pair-${pair.bookId}`}
              data-testid="notes-center-book-row"
              className="grid grid-cols-1 gap-3 items-start lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.95fr)]"
              style={VIRTUAL_BOOK_ROW_STYLE}
            >
              <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-3 ${contentPanelHeightClass}`}>
                <div className={`mb-2 text-[11px] uppercase tracking-[0.16em] font-bold ${isDarkLibraryTheme ? "text-blue-300" : "text-blue-700"}`}>
                  Notes · {pair.title}
                </div>
                <div className={`space-y-3 overflow-y-auto pr-1 pb-2 ${contentScrollHeightClass}`}>
                  {pair.entries.map((entry) => (
                    <article
                      key={entry.id}
                      data-testid="notes-center-item"
                      className={`rounded-xl border p-3 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900/80" : "border-blue-100 bg-white"}`}
                      style={VIRTUAL_NOTE_ITEM_STYLE}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-gray-900"}`}>{entry.bookTitle}</div>
                          <div className={`text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>{entry.bookAuthor}</div>
                        </div>
                        <button
                          type="button"
                          data-testid="notes-center-open-reader"
                          onClick={() => onOpenReader(entry)}
                          className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                            isDarkLibraryTheme
                              ? "border-slate-600 text-slate-200 hover:border-blue-400 hover:text-blue-300"
                              : "border-gray-200 text-gray-700 hover:border-blue-200 hover:text-blue-700"
                          }`}
                        >
                          Open in Reader
                        </button>
                      </div>

                      {entry.highlightText && (
                        <p className={`mt-2 text-[11px] italic line-clamp-2 ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                          "{entry.highlightText}"
                        </p>
                      )}

                      {editingNoteId === entry.id ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            data-testid="notes-center-textarea"
                            className={`w-full min-h-[88px] rounded-xl border p-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                              isDarkLibraryTheme
                                ? "border-slate-600 bg-slate-800 text-slate-100"
                                : "border-gray-200 bg-white text-gray-800"
                            }`}
                            value={noteEditorValue}
                            onChange={(event) => onNoteEditorChange(event.target.value)}
                            placeholder="Write your note..."
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              data-testid="notes-center-save"
                              onClick={() => onSaveNote(entry)}
                              disabled={isSavingNote}
                              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isSavingNote ? "Saving..." : "Save note"}
                            </button>
                            <button
                              type="button"
                              data-testid="notes-center-cancel"
                              onClick={onCancelEdit}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                                isDarkLibraryTheme
                                  ? "border-slate-600 text-slate-200 hover:bg-slate-800"
                                  : "border-gray-200 text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <p
                            data-testid="notes-center-note-text"
                            className={`rounded-lg border px-2 py-2 text-sm ${
                              isDarkLibraryTheme
                                ? "border-slate-700 bg-slate-800 text-slate-100"
                                : "border-gray-100 bg-gray-50 text-gray-800"
                            }`}
                          >
                            {entry.note}
                          </p>
                          <button
                            type="button"
                            data-testid="notes-center-edit"
                            onClick={() => onStartEdit(entry)}
                            className={`mt-2 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                              isDarkLibraryTheme
                                ? "border-slate-600 text-slate-200 hover:border-blue-400 hover:text-blue-300"
                                : "border-gray-200 text-gray-700 hover:border-blue-200 hover:text-blue-700"
                            }`}
                          >
                            Edit note
                          </button>
                        </div>
                      )}
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
