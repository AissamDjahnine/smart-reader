import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, ChevronLeft, ChevronRight, Clock3, Flame, FileText } from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;
const READING_STATS_PREFS_KEY = "library-reading-statistics-preferences";

const TIME_RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" }
];

const HEATMAP_METRIC_OPTIONS = [
  { value: "hours", label: "Hours" },
  { value: "pages", label: "Pages" }
];

const statusColorClasses = {
  "To read": "bg-amber-500",
  "In progress": "bg-blue-500",
  "Finished": "bg-emerald-500",
  "Not started": "bg-slate-400"
};

const statusToneClasses = {
  "To read": "border-amber-200 bg-amber-50 text-amber-700",
  "In progress": "border-blue-200 bg-blue-50 text-blue-700",
  "Finished": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Not started": "border-gray-200 bg-gray-100 text-gray-700"
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

const getBookStatus = (book) => {
  const progress = clampProgress(book?.progress);
  if (progress >= 100) return "Finished";
  if (progress > 0) return "In progress";
  if (book?.isToRead) return "To read";
  return "Not started";
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

const readStoredPreferences = () => {
  const fallback = {
    timeRange: "30d",
    heatmapMetric: "hours"
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(READING_STATS_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const timeRange = TIME_RANGE_OPTIONS.some((option) => option.value === parsed?.timeRange) ? parsed.timeRange : fallback.timeRange;
    const heatmapMetric = HEATMAP_METRIC_OPTIONS.some((option) => option.value === parsed?.heatmapMetric) ? parsed.heatmapMetric : fallback.heatmapMetric;
    return { timeRange, heatmapMetric };
  } catch {
    return fallback;
  }
};

const getHeatmapCellStyle = (isDarkLibraryTheme, intensity, hasReading) => {
  if (!hasReading) {
    return isDarkLibraryTheme
      ? { backgroundColor: "rgba(30,41,59,0.55)", color: "rgb(148 163 184)" }
      : { backgroundColor: "rgb(243 244 246)", color: "rgb(107 114 128)" };
  }
  const alpha = 0.18 + (Math.min(1, Math.max(0, intensity)) * 0.72);
  return {
    backgroundColor: `rgba(37, 99, 235, ${alpha})`,
    color: intensity >= 0.58 ? "white" : (isDarkLibraryTheme ? "rgb(219 234 254)" : "rgb(30 58 138)")
  };
};

export default function LibraryReadingStatisticsSection({
  isDarkLibraryTheme,
  books,
  buildReaderPath,
  onOpenBook,
  onBrowseLibrary
}) {
  const safeBooks = useMemo(() => (Array.isArray(books) ? books : []), [books]);
  const [preferences, setPreferences] = useState(() => readStoredPreferences());
  const [monthOffset, setMonthOffset] = useState(0);
  const { timeRange, heatmapMetric } = preferences;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(READING_STATS_PREFS_KEY, JSON.stringify(preferences));
    }
  }, [preferences]);

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

  const statusBreakdown = useMemo(() => {
    const statusCounts = new Map([
      ["To read", 0],
      ["In progress", 0],
      ["Finished", 0],
      ["Not started", 0]
    ]);
    safeBooks.forEach((book) => {
      const status = getBookStatus(book);
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    });
    const total = safeBooks.length || 1;
    return Array.from(statusCounts.entries()).map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100)
    }));
  }, [safeBooks]);

  const activeMonth = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);

  const monthLabel = useMemo(
    () => activeMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [activeMonth]
  );

  const monthHeatmap = useMemo(() => {
    const year = activeMonth.getFullYear();
    const month = activeMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const days = [];
    let maxValue = 0;
    let readingDays = 0;

    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber += 1) {
      const date = new Date(year, month, dayNumber);
      const key = toLocalDateKey(date);
      const dayData = dailyAllMap.get(key);
      const seconds = dayData?.seconds || 0;
      const pages = dayData?.pages || 0;
      const value = heatmapMetric === "pages" ? pages : (seconds / 3600);
      if (value > 0) readingDays += 1;
      maxValue = Math.max(maxValue, value);
      days.push({
        key,
        dayNumber,
        seconds,
        pages,
        value
      });
    }

    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ id: `empty-start-${i}`, empty: true });
    }
    days.forEach((day) => {
      const intensity = maxValue > 0 ? day.value / maxValue : 0;
      cells.push({ ...day, empty: false, intensity });
    });
    while (cells.length % 7 !== 0) {
      cells.push({ id: `empty-end-${cells.length}`, empty: true });
    }

    return {
      cells,
      maxValue,
      readingDays
    };
  }, [activeMonth, dailyAllMap, heatmapMetric]);

  const hasAnyBooks = safeBooks.length > 0;
  const hasAnyReadingData = sessionRows.length > 0;
  const canGoToNextMonth = monthOffset < 0;

  const updatePreference = (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

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
            Simple overview with a monthly reading heatmap.
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
              onChange={(event) => updatePreference("timeRange", event.target.value)}
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

          <label className={`rounded-xl border px-3 py-2 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
            <span className={`mr-2 text-xs font-semibold uppercase tracking-[0.12em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Heatmap
            </span>
            <select
              data-testid="reading-stats-heatmap-metric"
              value={heatmapMetric}
              onChange={(event) => updatePreference("heatmapMetric", event.target.value)}
              className={`rounded-lg border px-2 py-1 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500 ${
                isDarkLibraryTheme ? "border-slate-600 bg-slate-800 text-slate-100" : "border-gray-200 bg-white text-slate-700"
              }`}
            >
              {HEATMAP_METRIC_OPTIONS.map((option) => (
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
                Start a session and this page will show trends, streaks, and heatmap activity.
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
              Reading days
            </span>
            <BookOpen size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-2xl font-extrabold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {monthHeatmap.readingDays}
          </div>
          <div className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>in {monthLabel}</div>
        </div>
      </div>

      <div className={`mt-4 ${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
              Monthly heatmap
            </h3>
            <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Darker cells mean more {heatmapMetric === "pages" ? "pages read" : "hours read"} on that day.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonthOffset((current) => current - 1)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                isDarkLibraryTheme ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-gray-200 text-gray-700 hover:bg-gray-50"
              }`}
            >
              <ChevronLeft size={16} />
            </button>
            <div className={`min-w-[130px] text-center text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-200" : "text-gray-800"}`}>
              <span data-testid="reading-stats-heatmap-month">{monthLabel}</span>
            </div>
            <button
              type="button"
              aria-label="Next month"
              disabled={!canGoToNextMonth}
              onClick={() => setMonthOffset((current) => Math.min(0, current + 1))}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
                canGoToNextMonth
                  ? (isDarkLibraryTheme ? "border-slate-600 text-slate-200 hover:bg-slate-800" : "border-gray-200 text-gray-700 hover:bg-gray-50")
                  : "cursor-not-allowed border-gray-200 text-gray-300"
              }`}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div data-testid="reading-stats-monthly-heatmap" className="grid grid-cols-7 gap-2">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className={`pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.12em] ${
                isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"
              }`}
            >
              {label}
            </div>
          ))}
          {monthHeatmap.cells.map((cell) => {
            if (cell.empty) {
              return <div key={cell.id} className="h-11 rounded-lg" aria-hidden="true" />;
            }
            const hasReading = cell.value > 0;
            const style = getHeatmapCellStyle(isDarkLibraryTheme, cell.intensity, hasReading);
            const dayDate = fromLocalDateKey(cell.key);
            const tooltipDate = dayDate
              ? dayDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
              : cell.key;
            const metricValue = heatmapMetric === "pages"
              ? `${Math.round(cell.pages)} pages`
              : `${formatDuration(cell.seconds, { short: true })}`;
            return (
              <div
                key={cell.key}
                data-testid="reading-heatmap-cell"
                data-date-key={cell.key}
                data-intensity={String(cell.intensity)}
                data-value={String(cell.value)}
                title={`${tooltipDate}: ${metricValue}`}
                className="flex h-11 items-center justify-center rounded-lg border border-transparent text-sm font-semibold transition-transform hover:scale-[1.03]"
                style={style}
              >
                {cell.dayNumber}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <span className={`text-[11px] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>Less</span>
          {[0.2, 0.4, 0.6, 0.8, 1].map((sample) => (
            <span
              key={`legend-${sample}`}
              className="h-3 w-6 rounded-sm"
              style={{ backgroundColor: `rgba(37, 99, 235, ${sample})` }}
              aria-hidden="true"
            />
          ))}
          <span className={`text-[11px] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>More</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
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

        <div className={`${isDarkLibraryTheme ? "workspace-card-dark" : "workspace-card"} p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>Status distribution</h3>
            <BookOpen size={15} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className="mt-4 space-y-3">
            {statusBreakdown.map((status) => (
              <div key={status.label}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusToneClasses[status.label]}`}>
                    {status.label}
                  </span>
                  <span className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-300" : "text-gray-600"}`}>
                    {status.count} ({status.percent}%)
                  </span>
                </div>
                <div className={`h-2 rounded-full ${isDarkLibraryTheme ? "bg-slate-800" : "bg-gray-100"}`}>
                  <div className={`h-full rounded-full ${statusColorClasses[status.label]}`} style={{ width: `${status.percent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
