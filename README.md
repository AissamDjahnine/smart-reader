# Smart Reader

Smart Reader is a local-first EPUB library and reading experience with AI-powered page explanations and story recaps. It runs entirely in the browser, storing your books and reading progress locally.

## What It Does

- **EPUB Library**
  - Upload `.epub` files and keep them in a personal library.
  - Store covers, title, author, publisher, and publication date metadata.
  - Search by title/author and filter by favorites or finished books.
  - Track reading progress, total reading time, and last read date.
  - Favorite and delete books.

- **Reader Experience**
  - Open books from the library and continue from the last location.
  - Paginated or scrolling reading modes.
  - Light/dark themes and adjustable font size.
  - Progress bar and page navigation controls.

- **AI-Assisted Understanding**
  - **Background story memory:** Each page change is summarized to build a running story memory.
  - **Explain Page:** Explains the current page using the story memory for context.
  - **Story So Far:** Generates a recap using the story memory (and the current page as the latest scene).
  - **Chapter summaries:** When you finish a chapter, a summary is saved for long-term recall.

## Tech Stack

- React + Vite
- Tailwind CSS
- `epubjs` for EPUB rendering
- `localforage` for local storage
- Google Gemini API for AI summaries

## Running Locally

```bash
npm install
npm run dev
```

Open the URL shown by Vite (usually `http://localhost:5173`).

## Notes

- This app is **local-first**: all books and progress are stored in the browser’s IndexedDB.
- The current AI integration uses a **client-side API key** in `/Users/aissam/my-smart-reader/src/services/ai.js`. For production use, move this to a server-side proxy to avoid exposing the key.

## Scripts

```bash
npm run dev       # start dev server
npm run build     # production build
npm run preview   # preview production build
npm run lint      # lint code
```

## Repo Structure (High Level)

- `/Users/aissam/my-smart-reader/src/pages/Home.jsx` — Library UI and upload/search/filter.
- `/Users/aissam/my-smart-reader/src/pages/Reader.jsx` — Reader UI and AI features.
- `/Users/aissam/my-smart-reader/src/components/BookView.jsx` — EPUB rendering and navigation.
- `/Users/aissam/my-smart-reader/src/services/db.js` — Local data storage and summaries.
- `/Users/aissam/my-smart-reader/src/services/ai.js` — AI summarization logic.
