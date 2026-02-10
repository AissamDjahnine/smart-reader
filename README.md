# Smart Reader

Smart Reader is a modern EPUB reading app designed for people who read deeply.

It helps you organize your library, stay focused while reading, and quickly return to important passages with highlights, notes, bookmarks, and export.

## Why Smart Reader

Most reading apps are either too basic or overloaded.
Smart Reader is built around real reading behavior:

- Find your place fast
- Understand what matters on the page
- Save what you want to remember
- Come back later without friction

## Core Experience

### Library You Can Actually Manage

- Upload EPUB books in seconds
- Bulk upload support (select multiple EPUB files at once)
- Upload feedback: one batch popup with:
  - Overall progress (`current/total` books in the batch)
  - Current file progress (green bar per active file)
- Duplicate upload guard (single or batch): per-file prompt to ignore, replace (with data loss warning), or keep both with numbered duplicate titles (`Duplicate 1`, `Duplicate 2`, etc.)
- Bulk upload path optimized for speed:
  - One library refresh after the full batch (instead of reloading after each file)
  - In-memory duplicate index while processing each file
- Yellow success toast after upload and a 10-second halo on newly added book cards
- Clean cover-based library (grid or list)
- Smart metadata (author, language, estimated pages, genre when available)
- Book Info popover on each card (hover/click) with cleaned EPUB metadata:
  - Prioritized order for key fields (`Title`, `Author`, `Language`)
  - Hidden noisy/empty entries (for example `modified`, `identifier`, and blank values)
  - Language labels shown in full form (`English`, `French`, etc.)
- Clean inline metadata rows on cards (lightweight language/pages display)
- Workspace sidebar for fast section switching: `My Library`, `My Collections`, `Notes Center`, `Highlights Center`, `Account`
- Search, filter, and sort to find the right book fast
- Custom shelves (collections): create, rename, delete, and color-code your own reading buckets
- Assign books to one or many shelves directly from each card
- Dedicated `My Collections` workspace with scalable default layout:
  - `Directory + Detail` view (left collections list, right selected collection books)
  - Built-in collection search for fast switching at scale (`10+` collections)
  - Add books directly from collection view with in-context modal picker
- Optional `Board` toggle for overview mode:
  - Fixed responsive columns (`4` desktop, `2` tablet, `1` mobile)
  - Balanced auto-placement by collection size for cleaner scanning
  - Quick “View all books” jump back into Directory detail mode
- Sticky library toolbar (search, filters, sort, view mode always visible while scrolling)
- Quick filter count chips (`To read`, `In progress`, `Finished`, `Favorites`) with one-click filtering
- Combine `Status` filtering with quick `Favorites` filtering when needed
- One-click `Reset filters` action to return search/filter/sort to default
- Large-library rendering optimization:
  - Incremental card rendering in grid/list views (books are loaded in chunks while scrolling)
  - Helps keep scrolling smooth and initial render faster with heavy libraries
- Manual `TO READ` tagging (create your personal "read next" queue)
- Favorites with cleaner, less cluttered library cards
- Notes Center in Library with cross-book note browsing, inline editing, and jump-to-reader
- Continue Reading rail with progress and session context
- Dedicated Trash workspace (independent from library filters):
  - Trash-specific search and sort
  - Grid/list views
  - Bulk actions: `Select all` / `Unselect all`, `Restore selected`, `Delete selected`, `Restore all`, `Delete all`
  - 30-day retention notice and auto-purge handling
  - Reliable per-book checkbox selection (manual one-by-one and bulk selection parity)
- Permanent delete backup flow:
  - Single book: optional PDF + JSON export (highlights and notes)
  - Multiple books: optional ZIP export with one folder per book (`PDF` + `JSON`)
  - If a book has no highlights/notes, no backup prompt is shown
- Top-right `Dark mode / Light mode` toggle directly in the library header
- Optional performance debug traces for heavy libraries:
  - Set `localStorage.setItem("library-perf-debug", "1")` to log `load/upload` timings in DevTools
  - Read session timings from `window.__smartReaderPerfHistory`

### Reader Built for Focus

- Paginated and infinite-scroll modes
- Centered portrait-style reading column in scroll mode
- Per-book reading preferences:
  - Theme
  - Font size
  - Font family
  - Reading flow
- Light mode, dark mode, and sepia reading mode
- Keyboard navigation support
- Chapter menu + table of contents navigation
- Dictionary lookup cancels stale responses when you close the panel

### Search That Works at Two Levels

- In-reader search with result navigation (`X/N`, next/previous)
- Global search across:
  - Book metadata
  - Highlights
  - Notes
  - Bookmarks
  - In-book content
- Global search opens exact reader location with context preserved

### Highlights, Notes, and Study Workflow

- Multi-color highlights
- Add and edit notes on highlights
- Jump to any saved highlight instantly
- Bookmarks for key pages
- Dictionary and translation from text selection
- Export highlights to PDF (select all or specific items)

### Reading Progress That Feels Useful

- Accurate per-book progress tracking
- Estimated time left
- Reading sessions and “last session” snapshot
- Reading streak badge on home

## Current Status

Smart Reader is fully usable for everyday reading workflows.

AI buttons are visible in the UI, but AI features are currently marked as unavailable.

## Quick Start

```bash
npm install
npm run dev
```

Open the app at the local Vite URL (usually `http://localhost:5173`).

## Main App Areas

- `src/pages/Home.jsx` - Library page orchestrator (state, data loading, feature composition)
- `src/pages/library/LibraryWorkspaceNav.jsx` - Sidebar and mobile workspace navigation
- `src/pages/library/LibraryToolbarSection.jsx` - Library search/filter/sort toolbar + active chips + view toggle
- `src/pages/library/LibraryCollectionsBoard.jsx` - Collections workspace (`Directory + Detail` default, optional balanced board toggle, add-books modal)
- `src/pages/library/LibraryNotesCenterPanel.jsx` - Notes Center panel
- `src/pages/library/LibraryHighlightsCenterPanel.jsx` - Highlights Center panel
- `src/pages/library/LibraryGlobalSearchPanel.jsx` - Global search result panel
- `src/pages/library/LibraryAccountSection.jsx` - Account section form
- `src/pages/Reader.jsx` - Reading experience, contextual tools, highlights, bookmarks, export, and search handoff
- `src/components/BookView.jsx` - EPUB rendering and navigation engine
- `src/services/db.js` - Local-first persistence layer

---

If you want a reader that feels practical on day one and scalable for serious reading habits, Smart Reader is built for that.
