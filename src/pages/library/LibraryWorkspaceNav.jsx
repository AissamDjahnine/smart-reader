import React from "react";
import {
  Book as BookIcon,
  BarChart3,
  FolderClosed,
  FileText,
  Highlighter,
  CircleUserRound,
  Trash2,
  Inbox
} from "lucide-react";

export function LibraryWorkspaceSidebar({
  librarySection,
  isDarkLibraryTheme,
  isCollabMode = false,
  notesCount,
  highlightsCount,
  inboxCount,
  trashCount,
  onSelectSection,
  className = ""
}) {
  const sidebarButtonBase = "group relative flex h-11 w-full items-center gap-2.5 rounded-2xl border px-3.5 text-sm font-semibold transition";
  const sidebarButtonIdle = isDarkLibraryTheme
    ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-blue-500 hover:text-blue-300"
    : "border-gray-200 bg-white text-[#1A1A2E] hover:border-blue-200 hover:text-blue-700";
  const sidebarButtonActive = isDarkLibraryTheme
    ? "border-blue-500 bg-blue-950/60 text-blue-200"
    : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <aside
      data-testid="library-sidebar"
      className={`workspace-surface hidden h-fit sticky top-8 md:block p-4 ${isDarkLibraryTheme ? "workspace-surface-dark" : "workspace-surface-light library-zone-sidebar-light"} ${className}`}
    >
      <div className={`text-[12px] font-semibold uppercase tracking-[0.16em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-600"}`}>Workspace</div>
      <nav className="mt-3 space-y-2">
        <button
          type="button"
          data-testid="sidebar-my-library"
          onClick={() => onSelectSection("library")}
          className={`${sidebarButtonBase} ${librarySection === "library" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "library" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <BookIcon size={17} className={librarySection === "library" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>My Library</span>
        </button>
        {isCollabMode && (
          <>
            <button
              type="button"
              data-testid="sidebar-borrowed"
              onClick={() => onSelectSection("borrowed")}
              className={`${sidebarButtonBase} ${librarySection === "borrowed" ? sidebarButtonActive : sidebarButtonIdle}`}
            >
              {librarySection === "borrowed" && (
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                    isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
                  }`}
                />
              )}
              <BookIcon size={17} className={librarySection === "borrowed" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
              <span>Borrowed</span>
            </button>
            <button
              type="button"
              data-testid="sidebar-lent"
              onClick={() => onSelectSection("lent")}
              className={`${sidebarButtonBase} ${librarySection === "lent" ? sidebarButtonActive : sidebarButtonIdle}`}
            >
              {librarySection === "lent" && (
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                    isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
                  }`}
                />
              )}
              <BookIcon size={17} className={librarySection === "lent" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
              <span>Lent</span>
            </button>
          </>
        )}
        <button
          type="button"
          data-testid="sidebar-reading-statistics"
          onClick={() => onSelectSection("statistics")}
          className={`${sidebarButtonBase} ${librarySection === "statistics" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "statistics" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <BarChart3 size={17} className={librarySection === "statistics" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>Reading Stats</span>
        </button>
        <button
          type="button"
          data-testid="library-collections-trigger"
          onClick={() => onSelectSection("collections")}
          className={`${sidebarButtonBase} ${librarySection === "collections" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "collections" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <FolderClosed size={17} className={librarySection === "collections" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>My Collections</span>
        </button>
        <button
          type="button"
          data-testid="library-notes-center-toggle"
          onClick={() => onSelectSection("notes")}
          className={`${sidebarButtonBase} ${librarySection === "notes" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "notes" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <FileText size={17} className={librarySection === "notes" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>Notes</span>
          {notesCount > 0 && (
            <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
              librarySection === "notes"
                ? (isDarkLibraryTheme ? "bg-blue-900 text-blue-200" : "bg-blue-100 text-blue-700")
                : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
            }`}>
              {notesCount}
            </span>
          )}
        </button>
        <button
          type="button"
          data-testid="library-highlights-center-toggle"
          onClick={() => onSelectSection("highlights")}
          className={`${sidebarButtonBase} ${librarySection === "highlights" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "highlights" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <Highlighter size={17} className={librarySection === "highlights" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>Highlights</span>
          {highlightsCount > 0 && (
            <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
              librarySection === "highlights"
                ? (isDarkLibraryTheme ? "bg-blue-900 text-blue-200" : "bg-blue-100 text-blue-700")
                : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
            }`}>
              {highlightsCount}
            </span>
          )}
        </button>
        <button
          type="button"
          data-testid="sidebar-inbox"
          onClick={() => onSelectSection("inbox")}
          className={`${sidebarButtonBase} ${librarySection === "inbox" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "inbox" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <Inbox size={17} className={librarySection === "inbox" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>Inbox</span>
          {inboxCount > 0 && (
            <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
              librarySection === "inbox"
                ? (isDarkLibraryTheme ? "bg-blue-900 text-blue-200" : "bg-blue-100 text-blue-700")
                : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
            }`}>
              {inboxCount}
            </span>
          )}
        </button>
        {isCollabMode && (
          <button
            type="button"
            data-testid="sidebar-history"
            onClick={() => onSelectSection("history")}
            className={`${sidebarButtonBase} ${librarySection === "history" ? sidebarButtonActive : sidebarButtonIdle}`}
          >
            {librarySection === "history" && (
              <span
                aria-hidden="true"
                className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                  isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
                }`}
              />
            )}
            <BarChart3 size={17} className={librarySection === "history" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
            <span>History</span>
          </button>
        )}
        <button
          type="button"
          data-testid="sidebar-trash"
          onClick={() => onSelectSection("trash")}
          className={`${sidebarButtonBase} ${librarySection === "trash" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "trash" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <Trash2 size={17} className={librarySection === "trash" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>Trash</span>
          {trashCount > 0 && (
            <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
              librarySection === "trash"
                ? (isDarkLibraryTheme ? "bg-blue-900 text-blue-200" : "bg-blue-100 text-blue-700")
                : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
            }`}>
              {trashCount}
            </span>
          )}
        </button>
        <button
          type="button"
          data-testid="library-account-trigger"
          onClick={() => onSelectSection("account")}
          className={`${sidebarButtonBase} ${librarySection === "account" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          {librarySection === "account" && (
            <span
              aria-hidden="true"
              className={`absolute left-0 top-2.5 h-6 w-1 rounded-r-full ${
                isDarkLibraryTheme ? "bg-blue-400" : "bg-blue-500"
              }`}
            />
          )}
          <CircleUserRound size={17} className={librarySection === "account" ? "" : (isDarkLibraryTheme ? "text-slate-400 group-hover:text-blue-300" : "text-gray-500 group-hover:text-blue-600")} />
          <span>Settings</span>
        </button>
      </nav>
    </aside>
  );
}

export function LibraryWorkspaceMobileNav({ librarySection, onSelectSection, isCollabMode = false }) {
  return (
    <div className="mb-4 md:hidden">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onSelectSection("library")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "library"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <BookIcon size={13} />
          <span>Library</span>
        </button>
        {isCollabMode && (
          <>
            <button
              type="button"
              onClick={() => onSelectSection("borrowed")}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
                librarySection === "borrowed"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              <BookIcon size={13} />
              <span>Borrowed</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectSection("lent")}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
                librarySection === "lent"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              <BookIcon size={13} />
              <span>Lent</span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onSelectSection("statistics")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "statistics"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <BarChart3 size={13} />
          <span>Stats</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSection("collections")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "collections"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <FolderClosed size={13} />
          <span>Collections</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSection("notes")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "notes"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <FileText size={13} />
          <span>Notes</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSection("highlights")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "highlights"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <Highlighter size={13} />
          <span>Highlights</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSection("inbox")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "inbox"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <Inbox size={13} />
          <span>Inbox</span>
        </button>
        <button
          type="button"
          onClick={() => onSelectSection("trash")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "trash"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <Trash2 size={13} />
          <span>Trash</span>
        </button>
        {isCollabMode && (
          <button
            type="button"
            onClick={() => onSelectSection("history")}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
              librarySection === "history"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-white text-gray-700"
            }`}
          >
            <BarChart3 size={13} />
            <span>History</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelectSection("account")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "account"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <CircleUserRound size={13} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
