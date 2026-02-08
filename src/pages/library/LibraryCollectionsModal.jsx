import React from "react";
import { Plus, X, Check, Pencil } from "lucide-react";

export default function LibraryCollectionsModal({
  collectionError,
  showCreateCollectionForm,
  collectionNameDraft,
  collectionColorDraft,
  collectionColorOptions,
  collectionFilter,
  isCollectionView,
  collections,
  books,
  editingCollectionId,
  editingCollectionName,
  collectionViewId,
  onBackdropClose,
  onToggleCreateForm,
  onClose,
  onCollectionNameChange,
  onCollectionColorChange,
  onCreateCollection,
  onSelectAllCollections,
  onCollectionRenameStart,
  onCollectionRenameInputChange,
  onCollectionRenameSave,
  onCollectionRenameCancel,
  onCollectionDelete,
  onCollectionShow
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/35"
        onClick={onBackdropClose}
      />
      <section
        data-testid="collections-modal"
        className="relative w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-gray-900">My Collections</h2>
            <p className="mt-1 text-xs text-gray-500">
              Organize your books into custom collections.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="collection-add-toggle"
              onClick={onToggleCreateForm}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
            >
              <Plus size={14} />
              <span>{showCreateCollectionForm ? "Close" : "Add"}</span>
            </button>
            <button
              type="button"
              data-testid="collections-modal-close"
              onClick={onClose}
              className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {showCreateCollectionForm && (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs font-semibold text-gray-700">Add a new collection</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                data-testid="collection-create-input"
                value={collectionNameDraft}
                onChange={(e) => onCollectionNameChange(e.target.value)}
                placeholder="Collection name (e.g. Classics)"
                className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
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

        <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          <button
            type="button"
            data-testid="collection-filter-all"
            onClick={onSelectAllCollections}
            className={`w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold ${
              collectionFilter === "all" && !isCollectionView
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
            }`}
          >
            All collections
          </button>
          {collections.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">
              No collections yet. Click Add to create your first one.
            </div>
          )}
          {collections.map((collection) => {
            const linkedCount = books.filter((book) => Array.isArray(book.collectionIds) && book.collectionIds.includes(collection.id)).length;
            const isEditing = editingCollectionId === collection.id;
            return (
              <div
                key={collection.id}
                data-testid="collection-item"
                className="rounded-2xl border border-gray-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: collection.color }}
                      />
                      {isEditing ? (
                        <input
                          data-testid="collection-rename-input"
                          value={editingCollectionName}
                          onChange={(e) => onCollectionRenameInputChange(e.target.value)}
                          className="h-8 flex-1 rounded-lg border border-gray-200 px-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <div data-testid="collection-item-name" className="truncate text-sm font-bold text-gray-900">
                          {collection.name}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {linkedCount} book{linkedCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          data-testid="collection-rename-save"
                          onClick={onCollectionRenameSave}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"
                        >
                          <Check size={12} />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={onCollectionRenameCancel}
                          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-600"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          data-testid="collection-show-button"
                          onClick={() => onCollectionShow(collection.id)}
                          className={`rounded-lg border px-2 py-1 text-xs font-bold ${
                            collectionViewId === collection.id
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700"
                          }`}
                        >
                          {collectionViewId === collection.id ? "Showing" : "Show"}
                        </button>
                        <button
                          type="button"
                          data-testid="collection-rename-button"
                          onClick={() => onCollectionRenameStart(collection)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 hover:border-blue-200 hover:text-blue-700"
                        >
                          <Pencil size={12} />
                          Rename
                        </button>
                        <button
                          type="button"
                          data-testid="collection-delete-button"
                          onClick={() => onCollectionDelete(collection.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
