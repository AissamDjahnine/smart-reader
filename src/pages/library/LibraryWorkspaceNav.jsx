import React from "react";
import {
  Book as BookIcon,
  FolderClosed,
  FileText,
  Highlighter,
  CircleUserRound
} from "lucide-react";

export function LibraryWorkspaceSidebar({
  librarySection,
  isDarkLibraryTheme,
  notesCount,
  highlightsCount,
  onSelectSection
}) {
  const sidebarButtonBase = "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition";
  const sidebarButtonIdle = isDarkLibraryTheme
    ? "border-slate-700 bg-slate-900 text-slate-200 hover:border-blue-500 hover:text-blue-300"
    : "border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-700";
  const sidebarButtonActive = isDarkLibraryTheme
    ? "border-blue-500 bg-blue-950 text-blue-200"
    : "border-blue-200 bg-blue-50 text-blue-700";

  return (
    <aside
      data-testid="library-sidebar"
      className={`hidden md:block h-fit sticky top-6 rounded-3xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900/80" : "border-gray-200 bg-white/90"}`}
    >
      <div className={`text-[11px] font-bold uppercase tracking-[0.2em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>Workspace</div>
      <nav className="mt-3 space-y-2">
        <button
          type="button"
          data-testid="sidebar-my-library"
          onClick={() => onSelectSection("library")}
          className={`${sidebarButtonBase} ${librarySection === "library" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          <BookIcon size={16} />
          <span>My Library</span>
        </button>
        <button
          type="button"
          data-testid="library-collections-trigger"
          onClick={() => onSelectSection("collections")}
          className={`${sidebarButtonBase} ${librarySection === "collections" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          <FolderClosed size={16} />
          <span>My Collections</span>
        </button>
        <button
          type="button"
          data-testid="library-notes-center-toggle"
          onClick={() => onSelectSection("notes")}
          className={`${sidebarButtonBase} ${librarySection === "notes" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          <FileText size={16} />
          <span>Notes Center</span>
          <span className={`ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
            librarySection === "notes"
              ? (isDarkLibraryTheme ? "bg-blue-900 text-blue-200" : "bg-blue-100 text-blue-700")
              : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
          }`}>
            {notesCount}
          </span>
        </button>
        <button
          type="button"
          data-testid="library-highlights-center-toggle"
          onClick={() => onSelectSection("highlights")}
          className={`${sidebarButtonBase} ${librarySection === "highlights" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          <Highlighter size={16} />
          <span>Highlights Center</span>
          <span className={`ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold ${
            librarySection === "highlights"
              ? (isDarkLibraryTheme ? "bg-blue-900 text-blue-200" : "bg-blue-100 text-blue-700")
              : (isDarkLibraryTheme ? "bg-slate-700 text-slate-300" : "bg-gray-100 text-gray-600")
          }`}>
            {highlightsCount}
          </span>
        </button>
        <button
          type="button"
          data-testid="library-account-trigger"
          onClick={() => onSelectSection("account")}
          className={`${sidebarButtonBase} ${librarySection === "account" ? sidebarButtonActive : sidebarButtonIdle}`}
        >
          <CircleUserRound size={16} />
          <span>Account</span>
        </button>
      </nav>
    </aside>
  );
}

export function LibraryWorkspaceMobileNav({ librarySection, onSelectSection }) {
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
          onClick={() => onSelectSection("account")}
          className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
            librarySection === "account"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-white text-gray-700"
          }`}
        >
          <CircleUserRound size={13} />
          <span>Account</span>
        </button>
      </div>
    </div>
  );
}
