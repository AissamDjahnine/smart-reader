import React from "react";

const VIRTUAL_NOTE_ITEM_STYLE = { contentVisibility: "auto", containIntrinsicSize: "190px" };
const VIRTUAL_BOOK_ROW_STYLE = { contentVisibility: "auto", containIntrinsicSize: "560px" };

export default function LibraryNotesCenterPanel({
  notesCenterFilteredEntries,
  notesCenterPairs,
  searchQuery,
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
  return (
    <section data-testid="notes-center-panel" className="mb-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[#1A1A2E]">Notes Workspace</h2>
          <p
            data-testid="notes-center-count"
            className="mt-1 text-xs text-gray-600"
          >
            {notesCenterFilteredEntries.length} note{notesCenterFilteredEntries.length === 1 ? "" : "s"} shown
            {searchQuery.trim() ? ` for "${searchQuery.trim()}"` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-semibold text-blue-700 hover:text-blue-900"
        >
          Back to Library
        </button>
      </div>

      {notesCenterFilteredEntries.length === 0 ? (
        <div data-testid="notes-center-empty" className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
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
              <div className={`rounded-2xl border border-gray-200 bg-white p-3 ${contentPanelHeightClass}`}>
                <div className="mb-2 text-[11px] uppercase tracking-[0.16em] font-bold text-blue-700">
                  Notes · {pair.title}
                </div>
                <div className={`space-y-3 overflow-y-auto pr-1 pb-2 ${contentScrollHeightClass}`}>
                  {pair.entries.map((entry) => (
                    <article
                      key={entry.id}
                      data-testid="notes-center-item"
                      className="rounded-xl border border-blue-100 bg-white p-3"
                      style={VIRTUAL_NOTE_ITEM_STYLE}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-gray-900">{entry.bookTitle}</div>
                          <div className="text-xs text-gray-500">{entry.bookAuthor}</div>
                        </div>
                        <button
                          type="button"
                          data-testid="notes-center-open-reader"
                          onClick={() => onOpenReader(entry)}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                        >
                          Open in Reader
                        </button>
                      </div>

                      {entry.highlightText && (
                        <p className="mt-2 text-[11px] italic text-gray-500 line-clamp-2">
                          "{entry.highlightText}"
                        </p>
                      )}

                      {editingNoteId === entry.id ? (
                        <div className="mt-2 space-y-2">
                          <textarea
                            data-testid="notes-center-textarea"
                            className="w-full min-h-[88px] rounded-xl border border-gray-200 bg-white p-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
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
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2">
                          <p
                            data-testid="notes-center-note-text"
                            className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2 text-sm text-gray-800"
                          >
                            {entry.note}
                          </p>
                          <button
                            type="button"
                            data-testid="notes-center-edit"
                            onClick={() => onStartEdit(entry)}
                            className="mt-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-200 hover:text-blue-700"
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
