# Smart Reader

Smart Reader is a local-first EPUB app focused on real reading workflows:
library management, strong in-reader tools, highlights/notes, bookmarks, and export.

Everything runs in the browser. No backend required for core reading.

## Current Product Status

- Core reading features are active and stable.
- AI controls are visible in the reader, but currently marked in-app as:
  - `AI FEATURES: NOT AVAILABLE NOW`

## What You Can Do Today

### 1) Build a Personal EPUB Library

- Upload `.epub` books.
- Auto-extract metadata (title, author, publisher, publication date).
- Store and render covers.
- Search by title/author.
- Filter by:
  - All
  - Favorites
  - In progress
  - Finished
  - Has highlights
  - Has notes
- Sort by:
  - Last read (newest/oldest)
  - Added date (newest/oldest)
  - Progress (high to low / low to high)
  - Title (A-Z / Z-A)
  - Author (A-Z / Z-A)
- Active filter/sort chips shown in UI for quick context.
- Library view toggle:
  - Grid view
  - List view
  - Persists across reloads
- Continue Reading rail:
  - Shows recently started, unfinished books
  - Displays progress/time/last-read snapshot
  - Includes quick `View in-progress` action
- Favorite/unfavorite books.
- Delete books.

### 2) Read Comfortably (Per Book)

- Resume from last read location automatically.
- Use either reading flow:
  - Paginated
  - Infinite scroll
- Switch light/dark theme.
- Change font size.
- Change font family (multiple popular fonts available).
- Per-book reader settings persistence:
  - Theme
  - Flow mode
  - Font size
  - Font family

### 3) Navigate Faster

- Top progress indicator with estimated time left.
- Keyboard navigation:
  - `ArrowLeft/ArrowRight` in paginated mode
  - `ArrowUp/ArrowDown` in scroll mode
- Click chapter entries from TOC.
- Save bookmarks from current position and jump back instantly.

### 4) Work on Text While Reading

- Select text to open contextual actions:
  - Dictionary
  - Highlight
  - Translate
- Dictionary and translation popovers open near selection (contextual placement).
- Translation supports source/target language selection.

### 5) Highlight, Annotate, and Export

- Create highlights with multiple colors.
- Open highlights panel to:
  - Browse all highlights
  - Jump directly to a highlight in-book
  - Delete highlights
  - Add/edit notes on highlights
  - Select all or specific highlights
- Export selected highlights to PDF:
  - Clean card layout
  - Compact spacing
  - Includes chapter/page context
  - Includes notes in exported output

### 6) Track Reading Over Time

- Persist reading progress per book.
- Track total reading time.
- Track last-read timestamp.

## Translation Providers

The reader supports free translation options out of the box.

- Default provider: `MyMemory`
- Optional provider: `LibreTranslate`

Environment variables:

```bash
VITE_TRANSLATE_PROVIDER=mymemory
VITE_TRANSLATE_ENDPOINT=https://libretranslate.com/translate
VITE_TRANSLATE_API_KEY=
VITE_TRANSLATE_EMAIL=
```

Notes:

- `VITE_TRANSLATE_EMAIL` increases MyMemory free daily quota if provided.
- If provider is MyMemory, source language selection is required (auto-detect is not available there).

## Tech Stack

- React + Vite
- Tailwind CSS
- epub.js
- localforage (IndexedDB abstraction)
- html2canvas + jsPDF (highlight export)
- Playwright (E2E tests)

## Run Locally

```bash
npm install
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`).

## Scripts

```bash
npm run dev        # start dev server
npm run build      # production build
npm run preview    # preview production build
npm run lint       # run ESLint
npm run test:e2e   # run Playwright tests
```

## Testing

E2E tests live in:

- `tests/e2e/reader.spec.js`
  - Search cancellation behavior
  - Dictionary stale-response race handling
  - Translation behavior
  - Reader iframe remount regression guard
- `tests/e2e/home.spec.js`
  - Library sort/filter behavior
  - Library view toggle persistence
  - Continue Reading rail visibility behavior
  - Favorites filter behavior

To run browser tests locally:

```bash
npx playwright install chromium
npm run test:e2e
```

## Important Security Note

`src/services/ai.js` currently contains a client-side Gemini API key pattern.
If AI features are re-enabled for production, move model calls behind a secure server-side proxy.

## Key Files

- `src/pages/Home.jsx` - library upload/search/sort/filter/view-toggle/continue-reading
- `src/pages/Reader.jsx` - reader UI, contextual tools, highlights, bookmarks, export
- `src/components/BookView.jsx` - epub.js rendering, navigation, location events
- `src/services/db.js` - local data persistence (books, highlights, notes, bookmarks, settings, started-state)
- `src/services/ai.js` - AI summarization integration (currently not active for product flow)
