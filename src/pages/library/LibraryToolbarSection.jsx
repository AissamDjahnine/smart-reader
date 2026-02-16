import React from "react";
import { Search, Filter, ArrowUpDown, LayoutGrid, Grid3x3, List } from "lucide-react";

export default function LibraryToolbarSection({
  isDarkLibraryTheme = false,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search books, highlights, notes, bookmarks...",
  statusFilter,
  onStatusFilterChange,
  statusFilterOptions,
  sortBy,
  onSortChange,
  sortOptions,
  getFilterLabel,
  getCollectionFilterLabel,
  flagFilters,
  flagFilterOptions,
  onToggleFlagFilter,
  viewMode,
  onViewModeChange,
  densityMode = "comfortable",
  onDensityModeChange,
  isStatusFilterActive = false,
  isCollectionFilterActive = false,
  isSortActive = false,
  activeFilterCount = 0,
  onClearSearch,
  onClearStatusFilter,
  onClearCollectionFilter,
  onClearSort,
  canShowResetFilters,
  onResetFilters
}) {
  const sortLabel = sortOptions.find((s) => s.value === sortBy)?.label || "Last read (newest)";

  const chipClass =
    "inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100";

  return (
    <>
      <div
        data-testid="library-toolbar-sticky"
        className={`sticky top-3 z-20 mb-3 rounded-2xl pb-2 backdrop-blur ${
          isDarkLibraryTheme
            ? "bg-slate-900/80"
            : "bg-gray-50/95 supports-[backdrop-filter]:bg-gray-50/80"
        }`}
      >
        <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_220px_280px]">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder={searchPlaceholder}
              data-testid="library-search"
              className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 text-base focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select
              data-testid="library-filter"
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
            >
              {statusFilterOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <ArrowUpDown className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <select
              data-testid="library-sort"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              className="h-[52px] w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
          <span data-testid="library-active-filters-label" className="font-semibold text-gray-600">
            Active: {activeFilterCount}
          </span>
          {searchQuery.trim() ? (
            <button
              type="button"
              data-testid="active-search-chip"
              onClick={() => onClearSearch?.()}
              className={chipClass}
              title="Clear search filter"
            >
              <span className="max-w-[160px] truncate">Search: {searchQuery.trim()}</span>
              <span aria-hidden="true">x</span>
            </button>
          ) : null}
          {isStatusFilterActive ? (
            <button
              type="button"
              data-testid="active-status-chip"
              onClick={() => onClearStatusFilter?.()}
              className={chipClass}
              title="Clear status filter"
            >
              <span>Status: {getFilterLabel()}</span>
              <span aria-hidden="true">x</span>
            </button>
          ) : null}
          {isCollectionFilterActive ? (
            <button
              type="button"
              data-testid="active-collection-chip"
              onClick={() => onClearCollectionFilter?.()}
              className={chipClass}
              title="Clear collection filter"
            >
              <span>Collection: {getCollectionFilterLabel()}</span>
              <span aria-hidden="true">x</span>
            </button>
          ) : null}
          {flagFilters.map((flag) => {
            const label = flagFilterOptions.find((item) => item.value === flag)?.label || flag;
            return (
              <button
                key={`active-flag-${flag}`}
                type="button"
                data-testid={`active-flag-chip-${flag}`}
                onClick={() => onToggleFlagFilter(flag)}
                className={chipClass}
                title={`Remove ${label.toLowerCase()} filter`}
              >
                {label}
                <span aria-hidden="true">x</span>
              </button>
            );
          })}
          {isSortActive ? (
            <button
              type="button"
              data-testid="active-sort-chip"
              onClick={() => onClearSort?.()}
              className={chipClass}
              title="Reset sort order"
            >
              <span>Sort: {sortLabel}</span>
              <span aria-hidden="true">x</span>
            </button>
          ) : null}
          {activeFilterCount === 0 ? (
            <span className="px-2 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-500">
              No active filters
            </span>
          ) : null}
          {canShowResetFilters ? (
            <button
              type="button"
              data-testid="library-clear-all-inline"
              onClick={onResetFilters}
              className="px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700 font-semibold"
              title="Clear all active filters"
            >
              Clear all
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
          <div
            className="flex h-[42px] w-[160px] items-center rounded-2xl border border-gray-200 bg-white p-1 shadow-sm"
            data-testid="library-view-toggle"
          >
            <button
              type="button"
              data-testid="library-view-grid"
              aria-pressed={viewMode === "grid" && densityMode !== "compact"}
              onClick={() => {
                onDensityModeChange?.("comfortable");
                onViewModeChange("grid");
              }}
              className={`flex h-full flex-1 items-center justify-center rounded-xl transition-colors ${
                viewMode === "grid" && densityMode !== "compact" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              data-testid="library-view-grid-compact"
              aria-pressed={viewMode === "grid" && densityMode === "compact"}
              onClick={() => {
                onDensityModeChange?.("compact");
                onViewModeChange("grid");
              }}
              className={`flex h-full flex-1 items-center justify-center rounded-xl transition-colors ${
                viewMode === "grid" && densityMode === "compact" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
              title="Compact grid view"
            >
              <Grid3x3 size={16} />
            </button>
            <button
              type="button"
              data-testid="library-view-list"
              aria-pressed={viewMode === "list"}
              onClick={() => onViewModeChange("list")}
              className={`flex h-full flex-1 items-center justify-center rounded-xl transition-colors ${
                viewMode === "list" ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
              title="List view"
            >
              <List size={16} />
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
