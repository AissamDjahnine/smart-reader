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
- Clean cover-based library (grid or list)
- Smart metadata (author, language, estimated pages, genre when available)
- Search, filter, and sort to find the right book fast
- Custom shelves (collections): create, rename, delete, and color-code your own reading buckets
- Assign books to one or many shelves directly from each card
- Filter library view by shelf to focus on one collection at a time
- Sticky library toolbar (search, filters, sort, view mode always visible while scrolling)
- Quick filter count chips (`To read`, `In progress`, `Finished`, `Favorites`) with one-click filtering
- Combine `Status` filtering with quick `Favorites` filtering when needed
- One-click `Reset filters` action to return search/filter/sort to default
- Manual `TO READ` tagging (create your personal "read next" queue)
- Favorites with cleaner, less cluttered library cards
- Notes Center in Library with cross-book note browsing, inline editing, and jump-to-reader
- Continue Reading rail with progress and session context
- Trash with restore flow and retention handling

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

- `src/pages/Home.jsx` - Library, search, filters, sort, favorites, trash, and global search UI
- `src/pages/Home.jsx` - Library, search, filters, shelves/collections, favorites, trash, and global search UI
- `src/pages/Reader.jsx` - Reading experience, contextual tools, highlights, bookmarks, export, and search handoff
- `src/components/BookView.jsx` - EPUB rendering and navigation engine
- `src/services/db.js` - Local-first persistence layer

---

If you want a reader that feels practical on day one and scalable for serious reading habits, Smart Reader is built for that.
