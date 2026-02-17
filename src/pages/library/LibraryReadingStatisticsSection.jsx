import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Clock3, Flame, FileText, ArrowLeftRight, StickyNote, Highlighter } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;

const TIME_RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" }
];

const normalizeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const clampProgress = (value) => Math.max(0, Math.min(100, Math.round(normalizeNumber(value))));

const toLocalDateKey = (dateLike) => {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fromLocalDateKey = (key) => {
  const [year, month, day] = String(key).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const getSessionEndMs = (session) => {
  const endMs = new Date(session?.endAt || session?.startAt || 0).getTime();
  if (!Number.isFinite(endMs)) return null;
  return endMs;
};

const getTimeRangeStartMs = (range) => {
  if (range === "all") return null;
  const now = Date.now();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return now - (days * DAY_MS);
};

const formatDuration = (seconds, { short = false } = {}) => {
  const safeSeconds = Math.max(0, normalizeNumber(seconds));
  if (!safeSeconds) return short ? "0m" : "0 min";
  const minutes = Math.max(1, Math.round(safeSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (short) {
    if (hours <= 0) return `${minutes}m`;
    if (remainder === 0) return `${hours}h`;
    return `${hours}h ${remainder}m`;
  }

  if (hours <= 0) return `${minutes} min`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder} min`;
};

const formatHours = (seconds) => {
  const safeSeconds = Math.max(0, normalizeNumber(seconds));
  if (!safeSeconds) return "0h";
  const hours = safeSeconds / 3600;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${Math.round(hours * 10) / 10}h`;
};

export default function LibraryReadingStatisticsSection({
  isDarkLibraryTheme,
  books,
  borrowedLoans = [],
  lentLoans = [],
  notesCount = 0,
  highlightsCount = 0,
  buildReaderPath,
  onOpenBook,
  onBrowseLibrary
}) {
  const safeBooks = useMemo(() => (Array.isArray(books) ? books : []), [books]);
  const safeBorrowedLoans = useMemo(() => (Array.isArray(borrowedLoans) ? borrowedLoans : []), [borrowedLoans]);
  const safeLentLoans = useMemo(() => (Array.isArray(lentLoans) ? lentLoans : []), [lentLoans]);
  const [timeRange, setTimeRange] = useState("30d");
  const [heatmapMetric, setHeatmapMetric] = useState("time");

  const sessionRows = useMemo(() => (
    safeBooks.flatMap((book) => {
      const sessions = Array.isArray(book?.readingSessions) ? book.readingSessions : [];
      const estimatedPages = Math.max(0, Math.round(normalizeNumber(book?.estimatedPages)));
      const progress = clampProgress(book?.progress);
      const readPagesEstimate = estimatedPages > 0 ? Math.round((estimatedPages * progress) / 100) : 0;
      const readingTime = Math.max(0, normalizeNumber(book?.readingTime));
      const pagesPerSecond = readPagesEstimate > 0 && readingTime > 0 ? readPagesEstimate / readingTime : 0;

      return sessions
        .map((session, index) => {
          const endMs = getSessionEndMs(session);
          if (!endMs) return null;
          const seconds = Math.max(0, normalizeNumber(session?.seconds));
          return {
            id: `${book.id}-${index}-${endMs}`,
            bookId: book.id,
            title: book.title || "Untitled",
            seconds,
            pagesEstimate: Math.max(0, seconds * pagesPerSecond),
            endMs,
            endKey: toLocalDateKey(endMs)
          };
        })
        .filter(Boolean);
    })
  ), [safeBooks]);

  const rangeStartMs = useMemo(() => getTimeRangeStartMs(timeRange), [timeRange]);
  const sessionsInRange = useMemo(
    () => sessionRows.filter((session) => !rangeStartMs || session.endMs >= rangeStartMs),
    [sessionRows, rangeStartMs]
  );

  const dailyAllMap = useMemo(() => {
    const map = new Map();
    sessionRows.forEach((session) => {
      const current = map.get(session.endKey) || { seconds: 0, pages: 0, titles: new Set() };
      current.seconds += session.seconds;
      current.pages += session.pagesEstimate;
      current.titles.add(session.title);
      map.set(session.endKey, current);
    });
    return map;
  }, [sessionRows]);

  const streakStats = useMemo(() => {
    const keys = Array.from(dailyAllMap.keys())
      .map((key) => fromLocalDateKey(key))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime());

    let bestStreak = 0;
    let running = 0;
    let previousMs = null;
    keys.forEach((day) => {
      const currentMs = day.getTime();
      if (previousMs == null || currentMs - previousMs === DAY_MS) {
        running += 1;
      } else {
        running = 1;
      }
      bestStreak = Math.max(bestStreak, running);
      previousMs = currentMs;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - DAY_MS);
    const todayKey = toLocalDateKey(today);
    const yesterdayKey = toLocalDateKey(yesterday);
    const startKey = dailyAllMap.has(todayKey) ? todayKey : (dailyAllMap.has(yesterdayKey) ? yesterdayKey : "");

    let currentStreak = 0;
    if (startKey) {
      let cursor = fromLocalDateKey(startKey);
      while (cursor && dailyAllMap.has(toLocalDateKey(cursor))) {
        currentStreak += 1;
        cursor = new Date(cursor.getTime() - DAY_MS);
      }
    }

    return { currentStreak, bestStreak };
  }, [dailyAllMap]);

  const totalSecondsForRange = useMemo(
    () => sessionsInRange.reduce((sum, session) => sum + session.seconds, 0),
    [sessionsInRange]
  );
  const totalPagesForRange = useMemo(
    () => sessionsInRange.reduce((sum, session) => sum + session.pagesEstimate, 0),
    [sessionsInRange]
  );
  const heatmapData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const monthLabel = firstDay.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const valueByKey = new Map();
    sessionsInRange.forEach((session) => {
      const date = new Date(session.endMs);
      if (!Number.isFinite(date.getTime())) return;
      if (date.getFullYear() !== year || date.getMonth() !== month) return;
      const key = toLocalDateKey(session.endMs);
      const current = valueByKey.get(key) || 0;
      const next = heatmapMetric === "pages" ? session.pagesEstimate : session.seconds;
      valueByKey.set(key, current + next);
    });

    const values = Array.from(valueByKey.values());
    const maxValue = values.length ? Math.max(...values) : 0;
    const days = [];
    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = new Date(year, month, day);
      const dateKey = toLocalDateKey(date);
      const value = valueByKey.get(dateKey) || 0;
      const intensity = maxValue > 0 ? Math.ceil((value / maxValue) * 4) : 0;
      days.push({ dateKey, value, intensity });
    }

    return { monthLabel, days };
  }, [sessionsInRange, heatmapMetric]);

  const topBooks = useMemo(() => {
    const byBook = new Map();
    sessionsInRange.forEach((session) => {
      const current = byBook.get(session.bookId) || 0;
      byBook.set(session.bookId, current + session.seconds);
    });
    return [...safeBooks]
      .map((book) => ({ ...book, trackedSeconds: byBook.get(book.id) || 0 }))
      .filter((book) => book.trackedSeconds > 0)
      .sort((left, right) => right.trackedSeconds - left.trackedSeconds)
      .slice(0, 5);
  }, [safeBooks, sessionsInRange]);

  const loanStats = useMemo(() => {
    const borrowedActive = safeBorrowedLoans.filter((loan) => loan?.status === "ACTIVE");
    const borrowedEnded = safeBorrowedLoans.filter((loan) => ["RETURNED", "EXPIRED", "REVOKED"].includes(String(loan?.status || ""))).length;
    const lentActive = safeLentLoans.filter((loan) => loan?.status === "ACTIVE").length;
    const lentEnded = safeLentLoans.filter((loan) => ["RETURNED", "EXPIRED", "REVOKED"].includes(String(loan?.status || ""))).length;
    return {
      borrowedTotal: safeBorrowedLoans.length,
      borrowedActive: borrowedActive.length,
      borrowedEnded,
      lentTotal: safeLentLoans.length,
      lentActive,
      lentEnded
    };
  }, [safeBorrowedLoans, safeLentLoans]);

  const hasAnyBooks = safeBooks.length > 0;
  const hasAnyReadingData = sessionRows.length > 0;
  return (
    <section
      data-testid="library-reading-statistics-panel"
      className={`workspace-surface mb-4 p-5 md:p-7 ${
        isDarkLibraryTheme ? "workspace-surface-dark" : "workspace-surface-light"
      }`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={`text-lg font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            Reading statistics
          </h2>
          <p className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            Simple overview of reading progress, loans, and annotations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`rounded-xl border px-3 py-2 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
            <span className={`mr-2 text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Range
            </span>
            <select
              data-testid="reading-stats-range"
              value={timeRange}
              onChange={(event) => setTimeRange(event.target.value)}
              className={`rounded-lg border px-2 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-700"
              }`}
            >
              {TIME_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {!hasAnyReadingData && (
        <div
          data-testid="reading-stats-empty-state"
          className={`mb-4 rounded-2xl border p-4 ${
            isDarkLibraryTheme ? "border-blue-700 bg-blue-950/25" : "border-blue-200 bg-blue-50/70"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className={`text-base font-bold ${isDarkLibraryTheme ? "text-blue-100" : "text-blue-900"}`}>
                No reading data yet.
              </h3>
              <p className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-blue-200/90" : "text-blue-700"}`}>
                Start a reading session and this page will show your key reading and collaboration stats.
              </p>
            </div>
            {hasAnyBooks ? (
              <Link
                to={buildReaderPath(safeBooks[0].id)}
                onClick={() => onOpenBook?.(safeBooks[0].id)}
                className="inline-flex h-9 items-center rounded-full bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Start reading now
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => onBrowseLibrary?.()}
                className="inline-flex h-9 items-center rounded-full bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Open library
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Reading time
            </span>
            <Clock3 size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {formatHours(totalSecondsForRange)}
          </div>
        </div>

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Estimated pages
            </span>
            <FileText size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {Math.round(totalPagesForRange)}
          </div>
        </div>

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Current streak
            </span>
            <Flame size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {streakStats.currentStreak} day{streakStats.currentStreak === 1 ? "" : "s"}
          </div>
        </div>

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Books tracked
            </span>
            <BookOpen size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {safeBooks.length}
          </div>
          <div className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>library books</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Borrowed
            </span>
            <ArrowLeftRight size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {loanStats.borrowedActive}
          </div>
          <div className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            active of {loanStats.borrowedTotal} ({loanStats.borrowedEnded} ended)
          </div>
        </div>

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Lent
            </span>
            <ArrowLeftRight size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {loanStats.lentActive}
          </div>
          <div className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            active of {loanStats.lentTotal} ({loanStats.lentEnded} ended)
          </div>
        </div>

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Notes
            </span>
            <StickyNote size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {Math.max(0, Number(notesCount) || 0)}
          </div>
        </div>

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Highlights
            </span>
            <Highlighter size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {Math.max(0, Number(highlightsCount) || 0)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>Monthly heatmap</h3>
            <div className="flex items-center gap-2">
              <span
                data-testid="reading-stats-heatmap-month"
                className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}
              >
                {heatmapData.monthLabel}
              </span>
              <select
                data-testid="reading-stats-heatmap-metric"
                value={heatmapMetric}
                onChange={(event) => setHeatmapMetric(event.target.value)}
                className={`rounded-lg border px-2 py-1 text-xs font-semibold outline-none focus:ring-2 focus:ring-blue-500 ${
                  isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-700"
                }`}
              >
                <option value="time">Time</option>
                <option value="pages">Pages</option>
              </select>
            </div>
          </div>
          <div
            data-testid="reading-stats-monthly-heatmap"
            className="mt-3 grid grid-cols-7 gap-1"
          >
            {heatmapData.days.map((day) => {
              const darkBg = day.intensity === 0
                ? "bg-slate-800/70"
                : day.intensity === 1
                  ? "bg-blue-900/45"
                  : day.intensity === 2
                    ? "bg-blue-700/55"
                    : day.intensity === 3
                      ? "bg-blue-600/75"
                      : "bg-blue-500";
              const lightBg = day.intensity === 0
                ? "bg-gray-100"
                : day.intensity === 1
                  ? "bg-blue-100"
                  : day.intensity === 2
                    ? "bg-blue-200"
                    : day.intensity === 3
                      ? "bg-blue-400"
                      : "bg-blue-600";
              return (
                <div
                  key={day.dateKey}
                  data-testid="reading-heatmap-cell"
                  data-date-key={day.dateKey}
                  data-intensity={day.intensity}
                  title={`${day.dateKey}: ${Math.round(day.value)}`}
                  className={`h-4 rounded-[4px] ${isDarkLibraryTheme ? darkBg : lightBg}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>Top books</h3>
            <BookOpen size={15} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          {topBooks.length === 0 ? (
            <div className={`mt-3 rounded-xl border border-dashed p-4 text-sm ${isDarkLibraryTheme ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-500"}`}>
              No books tracked in this range.
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {topBooks.map((book) => (
                <Link
                  key={`stats-book-${book.id}`}
                  to={buildReaderPath(book.id)}
                  onClick={() => onOpenBook?.(book.id)}
                  className={`group flex items-center gap-3 rounded-xl border p-2.5 transition ${
                    isDarkLibraryTheme ? "border-slate-700 bg-slate-900/80 hover:border-blue-500" : "border-gray-200 bg-white hover:border-blue-200"
                  }`}
                >
                  <div className={`h-12 w-10 shrink-0 overflow-hidden rounded-lg ${isDarkLibraryTheme ? "bg-slate-800" : "bg-gray-100"}`}>
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className={`flex h-full w-full items-center justify-center ${isDarkLibraryTheme ? "text-slate-500" : "text-gray-400"}`}>
                        <BookOpen size={14} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>{book.title}</div>
                    <div className={`mt-0.5 truncate text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>{book.author}</div>
                    <div className={`mt-1 text-xs font-semibold ${isDarkLibraryTheme ? "text-blue-300" : "text-blue-600"}`}>
                      {formatDuration(book.trackedSeconds, { short: true })} • {clampProgress(book?.progress)}%
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
