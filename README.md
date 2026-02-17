# ariadne

ariadne is a modern EPUB reading app designed for people who read deeply.

Its main feature is this: open any book and return exactly to where you left off.
Then ariadne gives you AI summarization and AI context understanding of what you have already read, so you restart with clarity instead of confusion.

## Why the name "ariadne"?

In the old myth, Ariadne gives a thread so you can always find your way back out.
In this app, that thread is your reading position and your reading memory:
close a book at page 47, come back a week later, and ariadne takes you to the exact line where you paused, then reminds you with AI summaries and context of what came before.

## Why ariadne

Most reading apps are either too basic or overloaded.
ariadne is built around real reading behavior:

- Find your place fast
- Understand what matters on the page with AI context
- Save what you want to remember
- Come back later without friction, exactly where you left off

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
- Clean cover-based library with a 3-mode view toggle:
  - `Grid` (standard cards)
  - `Compact Grid` (denser 3x3-style icon mode for large libraries)
  - `List`
- Compact Grid reduces cover/card footprint to fit more books on screen and keeps only essential card info (`title` + `author`)
- Smart metadata (author, language, estimated pages, year, and genre when available)
- Genre auto-detection improved from EPUB metadata (`subject`, `dc:subject`, `type`, `dc:type`, and related fields) with normalized labels
- Book Info popover on each card (hover/click) with cleaned EPUB metadata:
  - Prioritized order for key fields (`Title`, `Author`, `Language`)
  - Hidden noisy/empty entries (for example `modified`, `identifier`, and blank values)
  - Language labels shown in full form (`English`, `French`, etc.)
- Clean inline metadata rows on cards (lightweight language/pages display)
- Workspace sidebar for fast section switching: `My Library`, `My Collections`, `Notes`, `Highlights`, `Trash`, `Settings`
- Dedicated brand slot at the top of the left sidebar for app identity:
  - `public/brand/logo-light.png` in light mode
  - `public/brand/logo-dark.png` in dark mode
- Reading Snapshot panel above the workspace sidebar:
  - Completion donut (`finished / total`)
  - Total hours spent across all books
  - Total pages from completed books only
  - Reading time for today
- Dedicated Reading Statistics workspace with focused, simple metrics:
  - Reading Time and Estimated Pages
  - Current streak and monthly reading days
  - Monthly heatmap (darker = more reading, lighter = less)
  - Status distribution and top books
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
- Dedicated Notes workspace with cross-book note browsing, inline editing, and jump-to-reader
- Dedicated Highlights workspace with cross-book highlight browsing and jump-to-reader
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
  - Custom profile pictures and display names (set in Settings)
  - Notification Center with `All` / `Unread` tabs
  - Notification actions menu (`...`) per item: `Open in Reader`, `Mark as read/unread`, `Archive`, `Delete`
  - Notification card click focuses/highlights the related book in `Continue Reading`
  - Reading nudges and activity alerts:
    - Finish-soon (`<= 30 min`)
    - Streak risk
    - Resume abandoned in-progress books
    - Daily micro-goal
    - Milestone reached (25/50/75/90%)
    - To-read reminder
- Optional performance debug traces for heavy libraries:
  - Set `localStorage.setItem("library-perf-debug", "1")` to log `load/upload` timings in DevTools
  - Read session timings from `window.__smartReaderPerfHistory`

### Reader Built for Focus

- Paginated and infinite-scroll modes
- First-open reading mode choice is mandatory per book:
  - choose `Book view` or `Infinite scrolling` once before reading starts
  - chosen mode stays locked while the book is in progress
  - reopening an already in-progress book does not re-trigger this chooser
  - changing mode later uses a guided flow (`Change reading mode`) with mandatory relocation:
    - `Restart book`:
      - jumps to the beginning
      - resets book progress to `0%`
    - `Choose chapter`:
      - jumps to selected chapter
      - updates progress based on that chapter position in the table of contents
- Paginated mode supports subtle edge click/tap zones for next/previous page turns (no intrusive on-page arrow buttons)
- Centered portrait-style reading column in scroll mode
- Per-book reading preferences:
  - Theme
  - Font size
  - Font family
  - Line spacing (continuous slider, not fixed presets)
  - Text alignment
  - Page width control (available in `Infinite scrolling` mode only)
  - Reading flow
- Light mode, dark mode, and sepia reading mode
- Reader text settings control uses the standard `Aa` icon
- Upper-right reader icon controls include hover tooltips for faster discoverability
- Keyboard navigation support (Left/Right in paginated mode, Up/Down in infinite mode with gradual acceleration on hold)
- Chapter menu + table of contents navigation
- Centered current chapter label in the reader header (derived from TOC + current location)
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
- Highlight anchors are content-stable across reader style/layout changes:
  - same highlighted text is preserved when changing font size/family, line spacing, margins, alignment, and flow mode
  - quote/context recovery is used when a raw CFI no longer maps cleanly after reflow
- One-click `Highlight` now applies your most recently used color
- `Colors` chooser is ordered by recency (last used color appears first)
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

ariadne is fully usable for everyday reading workflows.

AI buttons are visible in the UI, but AI features are currently marked as unavailable.

## Quick Start

```bash
npm install
npm run dev
```

Open the app at the local Vite URL (usually `http://localhost:5173`).

### Reader mode behavior test (local)

1. Open a new book, choose reading mode, read enough to create non-zero progress, close reader.
2. Reopen the same book:
   - expected: no mode chooser appears.
3. In reader, click `Change reading mode` then `Restart book`:
   - expected: progress becomes `0%`.
4. In reader, click `Change reading mode` then `Choose chapter`:
   - expected: progress updates relative to selected chapter position.

## Shared Server Mode

This repository now includes a collaborative backend for multi-user sharing on one server.

### Topology

- One shared server runs `docker-compose` (backend + postgres).
- All users access the app from a browser over your private network.
- No per-user Docker setup is required.
- Public internet exposure is optional.

### Run on shared server

1. Copy backend env:

```bash
cp server/.env.example server/.env
```

2. Set at least:
- `JWT_SECRET` to a strong secret.
- `APP_BASE_URL` to your backend URL, for example `http://<SERVER_IP>:4000`.

3. Start backend + DB:

```bash
docker compose up -d --build backend db
```

4. Optional: run frontend in Docker too:

```bash
docker compose --profile frontend up -d --build frontend
```

### Frontend env for collaborative mode

Set `VITE_API_BASE_URL` to your backend URL (for example `http://<SERVER_IP>:4000`).
When this variable is set:

- Email/password registration/login is enabled.
- Display name is required at signup.
- JWT auth is required.
- Books/progress/highlights are loaded from shared backend.
- Recommendation Inbox, Borrowed, Lent, and History sections are enabled.
- Profile avatar upload and profile name updates are enabled.

### Collaboration model (current)

- `Book` is global/shared by `epubHash`.
- Per-user progress is in `UserBook`.
- Sharing is recommendation-first:
  - `Share` sends book recommendation metadata.
  - Recipient chooses whether to borrow.
- Lending creates a `BookLoan` with immutable permission snapshot at creation/accept.
- Borrower progress is always independent from lender progress.
- Notes/highlights use scoped visibility:
  - `OWNER`
  - `LENDER_VISIBLE`
  - `PRIVATE_BORROWER`
- Borrowed annotation permissions are enforceable per loan:
  - add/edit notes
  - add/edit highlights
  - borrower cannot edit/delete lender annotations.
- Lender can choose whether borrower can see lender existing annotations (`shareLenderAnnotations`).
- Borrower annotations do not affect lender reading state or progress.
- Book access requires `UserBook` relation.
- Recommendation records are stored in `BookShare`.
- Loan events/timeline are stored in `LoanAuditEvent` and shown in `History`.
- Loan state visibility in UI:
  - Book cover badges in library and continue-reading:
    - no badge = owned/non-loan
    - `Borrowed` badge = active borrowed loan
    - `Lent` badge = active lent loan
  - Library filter includes `Borrowed books` and `Lent books`.
- Collaboration workspace tabs:
  - `My library`, `Borrowed`, `Lent`, `History`, `Inbox`.
- Borrowed/Lent pages include richer book-first cards with cover thumbnails and view controls:
  - `Grid`
  - `Compact`
  - `List`
- History is grouped at book level:
  - all lifecycle events for the same book are shown together
  - each event row shows actor/target identity with small avatar chips.
- Inbox has two collaboration streams:
  - recommendation shares (`BookShare`)
  - loan inbox (`BookLoan` requests).
- Borrow reminders are surfaced in both:
  - Notification Center events (`due soon`, `overdue`)
  - Inbox `Borrow Reminders` panel.

### Borrow/Lend lifecycle

- `PENDING` -> `ACTIVE` on borrower accept.
- `ACTIVE` can become:
  - `RETURNED` (borrower returns),
  - `REVOKED` (lender revokes anytime),
  - `EXPIRED` (due + grace exceeded).
- On `RETURNED` / `REVOKED` / `EXPIRED`:
  - reader access is blocked immediately,
  - book appears as ended state in Borrowed view,
  - only export actions remain available.

### Export window (ended loans)

- Borrower can export their annotations for **14 days** after loan end.
- Export formats in UI:
  - `JSON`
  - `PDF` (summary export)
- After export window ends, annotations are no longer accessible through loan export endpoints.

### Borrow reminder setting

- In `Settings`, users can define `Borrow reminder (days before due)` with range `0..30`.
- `0` disables due-soon reminders.
- Due-soon and overdue reminders are generated from active borrowed loans.

### Backend migrations

When pulling latest collaboration changes, run migrations on the server DB:

```bash
docker compose exec backend npx prisma migrate deploy
```

## Main App Areas

- `src/pages/Home.jsx` - Library page orchestrator (state, data loading, feature composition)
- `src/pages/library/LibraryWorkspaceNav.jsx` - Sidebar and mobile workspace navigation
- `src/pages/library/LibraryToolbarSection.jsx` - Library search/filter/sort toolbar + active chips + view toggle
- `src/pages/library/LibraryCollectionsBoard.jsx` - Collections workspace (`Directory + Detail` default, optional balanced board toggle, add-books modal)
- `src/pages/library/LibraryNotesCenterPanel.jsx` - Notes workspace page
- `src/pages/library/LibraryHighlightsCenterPanel.jsx` - Highlights workspace page
- `src/pages/library/LibraryGlobalSearchPanel.jsx` - Global search result panel
- `src/pages/library/LibraryAccountSection.jsx` - Settings section form
- `src/pages/Reader.jsx` - Reading experience, contextual tools, highlights, bookmarks, export, and search handoff
- `src/components/BookView.jsx` - EPUB rendering and navigation engine
- `src/services/db.js` - Local-first persistence layer
- `src/services/searchIndex.js` - Persistent search index builder/storage for fast library + global search
- `src/services/contentSearchIndex.js` - Persistent in-book section text index for faster content searching
- `src/services/contentSearchWorkerClient.js` - Worker client for fast candidate section matching during content search

---

If you want a reader that feels practical on day one and scalable for serious reading habits, ariadne is built for that.
