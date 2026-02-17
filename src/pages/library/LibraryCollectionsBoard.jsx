import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  FolderClosed,
  Check,
  Pencil,
  Trash2,
  X,
  Book as BookIcon,
  Search,
  User,
  PanelsTopLeft,
  KanbanSquare
} from "lucide-react";

const getBoardColumnCount = () => {
  if (typeof window === "undefined") return 4;
  if (window.innerWidth >= 1280) return 4;
  if (window.innerWidth >= 768) return 2;
  return 1;
};

export default function LibraryCollectionsBoard({
  isDarkLibraryTheme = false,
  collections,
  books,
  collectionError,
  showCreateCollectionForm,
  collectionNameDraft,
  collectionColorDraft,
  collectionColorOptions,
  editingCollectionId,
  editingCollectionName,
  onToggleCreateForm,
  onCollectionNameChange,
  onCollectionColorChange,
  onCreateCollection,
  onCollectionRenameStart,
  onCollectionRenameInputChange,
  onCollectionRenameSave,
  onCollectionRenameCancel,
  onCollectionDelete,
  onOpenBook,
  onRemoveFromCollection,
  buildReaderPath
}) {
  const [selectedCollectionId, setSelectedCollectionId] = useState(collections[0]?.id || "");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [collectionsViewMode, setCollectionsViewMode] = useState("directory");
  const [boardColumnCount, setBoardColumnCount] = useState(getBoardColumnCount);
  const [addBooksCollectionId, setAddBooksCollectionId] = useState("");
  const [addBooksSearch, setAddBooksSearch] = useState("");

  const activeBooks = useMemo(
    () => books.filter((book) => !book.isDeleted),
    [books]
  );

  const booksByCollection = useMemo(() => {
    return collections.reduce((acc, collection) => {
      acc[collection.id] = activeBooks
        .filter((book) => Array.isArray(book.collectionIds) && book.collectionIds.includes(collection.id))
        .sort((left, right) => new Date(right.lastRead || 0).getTime() - new Date(left.lastRead || 0).getTime());
      return acc;
    }, {});
  }, [collections, activeBooks]);

  const filteredCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    if (!query) return collections;
    return collections.filter((collection) => (collection.name || "").toLowerCase().includes(query));
  }, [collections, collectionSearch]);

  const activeSelectedCollectionId = useMemo(() => {
    if (!collections.length) return "";
    const baseId = collections.some((collection) => collection.id === selectedCollectionId)
      ? selectedCollectionId
      : collections[0].id;
    if (!filteredCollections.length) return baseId;
    if (filteredCollections.some((collection) => collection.id === baseId)) return baseId;
    return filteredCollections[0].id;
  }, [collections, filteredCollections, selectedCollectionId]);

  useEffect(() => {
    const onResize = () => setBoardColumnCount(getBoardColumnCount());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const selectedCollection = collections.find((collection) => collection.id === activeSelectedCollectionId) || null;
  const selectedCollectionBooks = selectedCollection ? (booksByCollection[selectedCollection.id] || []) : [];
  const addTargetCollection = collections.find((collection) => collection.id === addBooksCollectionId) || null;

  const sortedBoardEntries = useMemo(() => {
    return filteredCollections
      .map((collection) => ({
        collection,
        items: booksByCollection[collection.id] || []
      }))
      .sort((left, right) => {
        if (right.items.length !== left.items.length) return right.items.length - left.items.length;
        return (left.collection.name || "").localeCompare(right.collection.name || "");
      });
  }, [filteredCollections, booksByCollection]);

  const balancedBoardColumns = useMemo(() => {
    const columnCount = Math.max(1, boardColumnCount);
    const columns = Array.from({ length: columnCount }, () => ({ weight: 0, entries: [] }));
    sortedBoardEntries.forEach((entry) => {
      let targetIndex = 0;
      for (let idx = 1; idx < columns.length; idx += 1) {
        if (columns[idx].weight < columns[targetIndex].weight) {
          targetIndex = idx;
        }
      }
      columns[targetIndex].entries.push(entry);
      columns[targetIndex].weight += Math.max(1, entry.items.length);
    });
    return columns.map((column) => column.entries);
  }, [sortedBoardEntries, boardColumnCount]);

  const addBooksCandidates = useMemo(() => {
    if (!addTargetCollection) return [];
    const query = addBooksSearch.trim().toLowerCase();
    return activeBooks
      .filter((book) => !Array.isArray(book.collectionIds) || !book.collectionIds.includes(addTargetCollection.id))
      .filter((book) => {
        if (!query) return true;
        return (book.title || "").toLowerCase().includes(query) || (book.author || "").toLowerCase().includes(query);
      })
      .sort((left, right) => (left.title || "").localeCompare(right.title || ""));
  }, [activeBooks, addTargetCollection, addBooksSearch]);

  const renderCollectionControls = (collection, compact = false) => {
    const isEditing = editingCollectionId === collection.id;
    if (isEditing) {
      return (
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="collection-rename-save"
            onClick={onCollectionRenameSave}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 text-xs font-bold text-emerald-700"
          >
            <Check size={12} />
            Save
          </button>
          <button
            type="button"
            onClick={onCollectionRenameCancel}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-gray-600"
          >
            <X size={12} />
            Cancel
          </button>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="collection-add-book"
          onClick={() => {
            setAddBooksCollectionId(collection.id);
            setAddBooksSearch("");
          }}
          className={`inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-xs font-bold text-blue-700 hover:bg-blue-100 ${compact ? "px-2" : ""}`}
          title="Add books"
        >
          <Plus size={12} />
          {!compact && "Add"}
        </button>
        <button
          type="button"
          data-testid="collection-rename-button"
          onClick={() => onCollectionRenameStart(collection)}
          className={`inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 text-xs font-bold text-gray-700 hover:border-blue-200 hover:text-blue-700 ${compact ? "px-2" : ""}`}
          title="Rename collection"
        >
          <Pencil size={12} />
          {!compact && "Rename"}
        </button>
        <button
          type="button"
          data-testid="collection-delete-button"
          onClick={() => onCollectionDelete(collection.id)}
          className={`inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 text-xs font-bold text-red-600 hover:bg-red-100 ${compact ? "px-2" : ""}`}
          title="Delete collection"
        >
          <Trash2 size={12} />
          {!compact && "Delete"}
        </button>
      </div>
    );
  };

  const handleOpenAddBooks = (collectionId) => {
    setAddBooksCollectionId(collectionId);
    setAddBooksSearch("");
  };

  const handleCloseAddBooks = () => {
    setAddBooksCollectionId("");
    setAddBooksSearch("");
  };

  const handleAddBookToCollection = async (bookId) => {
    if (!addTargetCollection) return;
    await onRemoveFromCollection(bookId, addTargetCollection.id);
  };

  const renderBookItem = (book, collectionId) => {
    return (
      <article
        key={`${collectionId}-${book.id}`}
        data-testid="collection-column-book"
        className="group workspace-interactive-card workspace-interactive-card-light rounded-xl p-2"
      >
        <div className="flex gap-2">
          <Link
            to={buildReaderPath(book.id)}
            onClick={() => onOpenBook(book.id)}
            className="h-16 w-12 shrink-0 overflow-hidden rounded-md border border-gray-100 bg-gray-100"
          >
            {book.cover ? (
              <img src={book.cover} alt={book.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-300">
                <BookIcon size={14} />
              </div>
            )}
          </Link>

          <div className="min-w-0 flex-1">
            <Link
              to={buildReaderPath(book.id)}
              onClick={() => onOpenBook(book.id)}
              className="line-clamp-2 text-sm font-semibold text-gray-900 hover:text-blue-700"
            >
              {book.title}
            </Link>
            <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
              <User size={11} />
              <span className="truncate">{book.author}</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-blue-600">{book.progress || 0}%</div>
          </div>
        </div>
        <button
          type="button"
          data-testid="collection-book-remove"
          onClick={() => onRemoveFromCollection(book.id, collectionId)}
          className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          Remove
        </button>
      </article>
    );
  };

  return (
    <section data-testid="collections-board" className="space-y-4">
      <div className={`flex flex-col gap-3 rounded-2xl border p-4 shadow-sm md:flex-row md:items-center md:justify-between ${
        isDarkLibraryTheme ? "border-slate-700 bg-slate-900/35" : "border-gray-200 bg-white"
      }`}>
        <div>
          <h2 className={`text-lg font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-gray-900"}`}>Collections directory</h2>
          <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            Organize many collections with a scalable directory, and switch to a board overview when needed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className={`inline-flex h-10 items-center rounded-xl border p-1 ${
            isDarkLibraryTheme ? "border-slate-700 bg-slate-800" : "border-gray-200 bg-white"
          }`}>
            <button
              type="button"
              data-testid="collections-view-directory"
              onClick={() => setCollectionsViewMode("directory")}
              className={`inline-flex h-full items-center gap-1 rounded-lg px-3 text-xs font-semibold transition-colors ${
                collectionsViewMode === "directory"
                  ? "bg-blue-600 text-white"
                  : isDarkLibraryTheme
                    ? "text-slate-300 hover:text-slate-100"
                    : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <PanelsTopLeft size={14} />
              Directory
            </button>
            <button
              type="button"
              data-testid="collections-view-board"
              onClick={() => setCollectionsViewMode("board")}
              className={`inline-flex h-full items-center gap-1 rounded-lg px-3 text-xs font-semibold transition-colors ${
                collectionsViewMode === "board"
                  ? "bg-blue-600 text-white"
                  : isDarkLibraryTheme
                    ? "text-slate-300 hover:text-slate-100"
                    : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <KanbanSquare size={14} />
              Board
            </button>
          </div>

          <button
            type="button"
            data-testid="collection-add-toggle"
            onClick={onToggleCreateForm}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-bold transition-colors ${
              isDarkLibraryTheme
                ? "border-blue-700 bg-blue-950/45 text-blue-200 hover:bg-blue-900/55"
                : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
            }`}
          >
            <Plus size={16} />
            <span>{showCreateCollectionForm ? "Close" : "Add collection"}</span>
          </button>
        </div>
      </div>

      {showCreateCollectionForm && (
        <div className={`rounded-2xl border p-4 shadow-sm ${
          isDarkLibraryTheme ? "border-slate-700 bg-slate-900/35" : "border-gray-200 bg-white"
        }`}>
          <div className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-gray-700"}`}>Create a collection</div>
          <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center">
            <input
              data-testid="collection-create-input"
              value={collectionNameDraft}
              onChange={(e) => onCollectionNameChange(e.target.value)}
              placeholder="Collection name (e.g. Classics)"
              className={`h-10 flex-1 rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme
                  ? "border-slate-700 bg-slate-800 text-slate-100 placeholder:text-slate-500"
                  : "border-gray-200 bg-white text-gray-800"
              }`}
            />
            <div className="flex items-center gap-2">
              {collectionColorOptions.map((color) => (
                <button
                  key={`draft-${color}`}
                  type="button"
                  data-testid="collection-color-option"
                  onClick={() => onCollectionColorChange(color)}
                  className={`h-6 w-6 rounded-full border-2 ${collectionColorDraft === color ? "border-gray-900" : "border-white"}`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <button
              type="button"
              data-testid="collection-create-button"
              onClick={onCreateCollection}
              className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
            >
              Create
            </button>
          </div>
          {collectionError && (
            <div className="mt-2 text-xs font-semibold text-red-600">{collectionError}</div>
          )}
        </div>
      )}

      {collections.length === 0 ? (
        <div
          data-testid="collections-empty"
          className={`rounded-3xl border-2 border-dashed p-14 text-center shadow-sm ${
            isDarkLibraryTheme ? "border-slate-700 bg-slate-900/35" : "border-gray-200 bg-white"
          }`}
        >
          <FolderClosed size={44} className={`mx-auto mb-3 ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-300"}`} />
          <div className={`text-lg font-semibold ${isDarkLibraryTheme ? "text-slate-100" : "text-gray-900"}`}>No collections yet</div>
          <div className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>Create your first shelf to organize your reading board.</div>
        </div>
      ) : (
        <>
          {collectionsViewMode === "directory" ? (
            <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="collections-directory-layout">
              <aside className="flex h-[72vh] min-h-[560px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-sm" data-testid="collections-directory-panel">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                  <input
                    data-testid="collections-search"
                    value={collectionSearch}
                    onChange={(e) => setCollectionSearch(e.target.value)}
                    placeholder="Search collections..."
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {filteredCollections.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
                      No collections match your search.
                    </div>
                  ) : (
                    filteredCollections.map((collection) => {
                      const items = booksByCollection[collection.id] || [];
                      const isSelected = collection.id === activeSelectedCollectionId;
                      const isEditing = editingCollectionId === collection.id;

                      return (
                        <article
                          key={collection.id}
                          className={`rounded-xl border p-3 transition-colors ${
                            isSelected ? "border-blue-200 bg-blue-50/60" : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (!isEditing) setSelectedCollectionId(collection.id);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              {isEditing ? (
                                <input
                                  data-testid="collection-rename-input"
                                  value={editingCollectionName}
                                  onChange={(e) => onCollectionRenameInputChange(e.target.value)}
                                  className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                                />
                              ) : (
                                <>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="inline-block h-2.5 w-2.5 rounded-full"
                                      style={{ backgroundColor: collection.color }}
                                    />
                                    <h3 data-testid="collection-item-name" className="truncate text-sm font-bold text-gray-900">
                                      {collection.name}
                                    </h3>
                                  </div>
                                  <p className="mt-1 text-xs text-gray-500">
                                    {items.length} book{items.length === 1 ? "" : "s"}
                                  </p>
                                </>
                              )}
                            </button>

                            <div className="ml-2">{renderCollectionControls(collection, true)}</div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </aside>

              <section className="flex h-[72vh] min-h-[560px] flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" data-testid="collections-detail-panel">
                {!selectedCollection ? (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 text-sm text-gray-500">
                    Select a collection to view its books.
                  </div>
                ) : (
                  <>
                    <header className="mb-3 border-b border-gray-100 pb-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: selectedCollection.color }}
                          />
                          <h3 className="text-base font-bold text-gray-900">{selectedCollection.name}</h3>
                        </div>
                        <button
                          type="button"
                          data-testid="collection-detail-add-book"
                          onClick={() => handleOpenAddBooks(selectedCollection.id)}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                        >
                          <Plus size={12} />
                          Add books
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {selectedCollectionBooks.length} book{selectedCollectionBooks.length === 1 ? "" : "s"} in this collection
                      </p>
                    </header>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      {selectedCollectionBooks.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
                          No books in this collection yet.
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {selectedCollectionBooks.map((book) => renderBookItem(book, selectedCollection.id))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          ) : (
            <div className="space-y-3" data-testid="collections-board-overview">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                <input
                  data-testid="collections-search"
                  value={collectionSearch}
                  onChange={(e) => setCollectionSearch(e.target.value)}
                  placeholder="Search collections..."
                  className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {filteredCollections.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
                  No collections match your search.
                </div>
              ) : (
                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, boardColumnCount)}, minmax(0, 1fr))` }}
                  data-testid="collections-board-columns"
                >
                  {balancedBoardColumns.map((columnEntries, columnIndex) => (
                    <div key={`board-col-${columnIndex}`} className="space-y-4" data-testid="collections-board-column">
                      {columnEntries.map(({ collection, items }) => {
                        const isEditing = editingCollectionId === collection.id;
                        return (
                          <section
                            key={collection.id}
                            data-testid="collection-column"
                            className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm"
                          >
                            <header className="mb-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <input
                                      data-testid="collection-rename-input"
                                      value={editingCollectionName}
                                      onChange={(e) => onCollectionRenameInputChange(e.target.value)}
                                      className="h-8 w-full rounded-lg border border-gray-200 px-2 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="inline-block h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: collection.color }}
                                      />
                                      <h3 data-testid="collection-item-name" className="truncate text-sm font-bold text-gray-900">
                                        {collection.name}
                                      </h3>
                                    </div>
                                  )}
                                  <p className="mt-1 text-xs text-gray-500">
                                    {items.length} book{items.length === 1 ? "" : "s"}
                                  </p>
                                </div>

                                {renderCollectionControls(collection, true)}
                              </div>
                            </header>

                            {items.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
                                No books in this collection yet.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {items.slice(0, 4).map((book) => renderBookItem(book, collection.id))}
                                {items.length > 4 && (
                                  <button
                                    type="button"
                                    className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-blue-700 hover:border-blue-200 hover:bg-blue-50"
                                    onClick={() => {
                                      setSelectedCollectionId(collection.id);
                                      setCollectionsViewMode("directory");
                                    }}
                                  >
                                    View all {items.length} books
                                  </button>
                                )}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {addTargetCollection && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={handleCloseAddBooks}
          data-testid="collection-add-books-modal"
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-gray-900">
                  Add books to {addTargetCollection.name}
                </h3>
                <p className="text-xs text-gray-500">
                  Choose books from your library that are not in this collection yet.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseAddBooks}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
              <input
                value={addBooksSearch}
                onChange={(e) => setAddBooksSearch(e.target.value)}
                placeholder="Search books by title or author..."
                className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {addBooksCandidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  No available books to add.
                </div>
              ) : (
                addBooksCandidates.map((book) => (
                  <div
                    key={`add-${addTargetCollection.id}-${book.id}`}
                    data-testid="collection-add-books-item"
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md border border-gray-100 bg-gray-100">
                        {book.cover ? (
                          <img src={book.cover} alt={book.title} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-gray-300">
                            <BookIcon size={12} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{book.title}</div>
                        <div className="truncate text-xs text-gray-500">{book.author}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="collection-add-books-confirm"
                      onClick={() => handleAddBookToCollection(book.id)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                    >
                      <Plus size={12} />
                      Add
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
