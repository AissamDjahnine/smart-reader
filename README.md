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
  - EPUB metadata extraction runs in a Web Worker to keep upload UI responsive on heavy files/batches
  - Automatic fallback to main-thread parsing if Worker is unavailable
- Yellow success toast after upload and a 10-second halo on newly added book cards
- Clean cover-based library (grid or list)
- Smart metadata (author, language, estimated pages, year, and genre when available)
- Genre auto-detection improved from EPUB metadata (`subject`, `dc:subject`, `type`, `dc:type`, and related fields) with normalized labels
- Book Info popover on each card (hover/click) with cleaned EPUB metadata:
  - Prioritized order for key fields (`Title`, `Author`, `Language`)
  - Hidden noisy/empty entries (for example `modified`, `identifier`, and blank values)
  - Language labels shown in full form (`English`, `French`, etc.)
- Clean inline metadata rows on cards (lightweight language/pages display)
- Workspace sidebar for fast section switching: `My Library`, `My Collections`, `Notes`, `Highlights`, `Trash`, `Settings`
- Reading Snapshot panel above the workspace sidebar:
  - Completion donut (`finished / total`)
  - Total hours spent across all books
  - Total pages from completed books only
  - Reading time for today
- Sidebar + snapshot visuals aligned with the same card language as Continue Reading (rounded cards, stronger hierarchy, cleaner iconography)
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
  - Debounced library search and memoized heavy selectors to keep typing and filtering responsive at scale
  - Persistent IndexedDB search index for metadata, highlights, notes, and bookmarks (faster repeat searches after reload)
  - Persistent in-book content index stored in IndexedDB to reduce repeated full-EPUB scans during global content search
  - Worker-assisted section candidate matching before EPUB CFI resolution (fewer sections searched per query)
  - Route-level lazy loading (`Home` / `Reader`) to reduce initial bundle cost
  - On-demand loading for export libraries (`jspdf`, `html2canvas`, `jszip`) only when export actions are used
  - Render culling with `content-visibility: auto` on large repeated rows/cards (library, notes, highlights, global search)
- Manual `TO READ` tagging (create your personal "read next" queue)
- Favorites with cleaner, less cluttered library cards
- Notes Center in Library with cross-book note browsing, inline editing, and jump-to-reader
- Continue Reading rail redesigned with layered cover cards, progress ring, optional favorite marker, and estimated time-left hint
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
- Top-right header controls now include:
  - Notifications bell with unread badge
  - Profile avatar menu (`Profile`, `Reading Statistics`, `Settings`, `FAQ`, `Sign out`)
  - Finish-soon notifications for books that can be completed in under 30 minutes
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
- Keyboard navigation support (Left/Right in paginated mode, Up/Down in infinite mode with gradual acceleration on hold)
- Chapter menu + table of contents navigation
- Reader search keyboard shortcuts (`Ctrl+F` to open search, `Esc` to close)
- Return-to-previous-spot chip after navigation jumps (search, highlights, bookmarks, notes, TOC)
- Dictionary lookup cancels stale responses when you close the panel
- Footnote/endnote marker preview popup:
  - Click in-book note marker links (for example `[1]`) to open an anchored preview
  - Jump directly to the full note target with `Open full note`
  - Quick dismiss on outside click, `Esc`, or viewport change

### Search That Works at Two Levels

- In-reader search with result navigation (`X/N`, next/previous)
- Active search result stays synchronized between text highlight and result list auto-scroll
- In-book search markers are applied reliably while search is active and cleared cleanly on `Clear`/close
- Clicking a search result pins a temporary green focus marker at that exact reading location
- Recent query history in both reader search panels (book search + annotation search) with one-click re-run and reset
- Dedicated in-reader **annotation search** (separate icon/panel) for current-book highlights, highlight notes, and bookmarks
- Annotation search results jump directly to saved CFIs, with highlight/note matches flashing for quick visual confirmation
- Global search across:
  - Book metadata
  - Highlights
  - Notes
  - Bookmarks
  - In-book content
- Global search opens exact reader location with context preserved

### Highlights, Notes, and Study Workflow

- Multi-color highlights
- Highlights panel defaults to no pre-selected items (`Select all` / `Unselect all` workflow)
- Re-clicking an existing highlight opens a contextual action popup anchored next to that highlight (delete, dictionary, translate)
- Existing highlights support in-place color changes from the same contextual popup (no delete/recreate needed)
- Right after choosing a highlight color, an inline note composer opens near the selection so notes can be captured immediately
- Highlights that include notes now show an inline note marker (`✎`) near the text; clicking it opens the note editor directly
- Highlight deletion now includes a 5-second undo toast in the reader
- Add and edit notes on highlights
- Jump to any saved highlight instantly
- Highlight jumps use a single subtle flash cue (in panel and when opening from Highlights Center)
- Bookmarks for key pages
- Dictionary and translation from text selection
- Export highlights to PDF (select all or specific items)

### Reading Progress That Feels Useful

- Accurate per-book progress tracking
- Estimated time left
- Reading sessions and “last session” snapshot (with inline icon cues in library cards)
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
- `src/pages/library/LibraryAccountSection.jsx` - Settings section form
- `src/pages/Reader.jsx` - Reading experience, contextual tools, highlights, bookmarks, export, and search handoff
- `src/components/BookView.jsx` - EPUB rendering and navigation engine
- `src/services/db.js` - Local-first persistence layer
- `src/services/searchIndex.js` - Persistent search index builder/storage for fast library + global search
- `src/services/contentSearchIndex.js` - Persistent in-book section text index for faster content searching
- `src/services/contentSearchWorkerClient.js` - Worker client for fast candidate section matching during content search

---

If you want a reader that feels practical on day one and scalable for serious reading habits, Smart Reader is built for that.
