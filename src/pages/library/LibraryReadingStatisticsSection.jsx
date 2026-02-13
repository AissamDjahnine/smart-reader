import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Clock3,
  FileText,
  Flame,
  Timer,
  Trophy,
} from "lucide-react";

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
};

const clampProgress = (value) => Math.max(0, Math.min(100, Math.round(normalizeNumber(value))));

const formatDuration = (seconds, { short = false } = {}) => {
  const safeSeconds = Math.max(0, normalizeNumber(seconds));
  const minutes = Math.max(1, Math.round(safeSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (short) {
    if (hours <= 0) return `${minutes}m`;
    if (remainingMinutes === 0) return `${hours}h`;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (hours <= 0) return `${minutes} min`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes} min`;
};

const formatHours = (seconds) => {
  const safeSeconds = Math.max(0, normalizeNumber(seconds));
  if (!safeSeconds) return "0h";
  const hours = safeSeconds / 3600;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${Math.round(hours * 10) / 10}h`;
};

const getSessionEndMs = (session) => {
  const endAt = new Date(session?.endAt || session?.startAt || 0).getTime();
  return Number.isFinite(endAt) ? endAt : null;
};

const buildLastNDays = (count = 14) => {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const day = new Date(today.getTime() - (index * DAY_MS));
    days.push({
      key: day.toISOString().slice(0, 10),
      label: day.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 1),
      fullLabel: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      seconds: 0
    });
  }
  return days;
};

const getBookStatus = (book) => {
  const progress = clampProgress(book?.progress);
  if (progress >= 100) return "Finished";
  if (progress > 0) return "In progress";
  if (book?.isToRead) return "To read";
  return "Not started";
};

const statusToneClasses = {
  "To read": "border-amber-200 bg-amber-50 text-amber-700",
  "In progress": "border-blue-200 bg-blue-50 text-blue-700",
  "Finished": "border-emerald-200 bg-emerald-50 text-emerald-700",
  "Not started": "border-gray-200 bg-gray-100 text-gray-700"
};

export default function LibraryReadingStatisticsSection({
  isDarkLibraryTheme,
  books,
  buildReaderPath,
  onOpenBook
}) {
  const safeBooks = Array.isArray(books) ? books : [];

  const sessionRows = useMemo(() => (
    safeBooks.flatMap((book) => {
      const sessions = Array.isArray(book?.readingSessions) ? book.readingSessions : [];
      return sessions
        .map((session, index) => {
          const endMs = getSessionEndMs(session);
          if (!endMs) return null;
          return {
            id: `${book.id}-session-${index}-${endMs}`,
            bookId: book.id,
            title: book.title || "Untitled",
            seconds: Math.max(0, normalizeNumber(session?.seconds)),
            endMs
          };
        })
        .filter(Boolean);
    })
  ), [safeBooks]);

  const coreStats = useMemo(() => {
    const totalBooks = safeBooks.length;
    const finishedBooks = safeBooks.filter((book) => clampProgress(book?.progress) >= 100).length;
    const inProgressBooks = safeBooks.filter((book) => {
      const progress = clampProgress(book?.progress);
      return progress > 0 && progress < 100;
    }).length;
    const totalSeconds = safeBooks.reduce((sum, book) => sum + Math.max(0, normalizeNumber(book?.readingTime)), 0);
    const averageSessionSeconds = sessionRows.length
      ? Math.round(sessionRows.reduce((sum, row) => sum + row.seconds, 0) / sessionRows.length)
      : 0;
    const completedPages = safeBooks
      .filter((book) => clampProgress(book?.progress) >= 100)
      .reduce((sum, book) => sum + Math.max(0, Math.round(normalizeNumber(book?.estimatedPages))), 0);

    return {
      totalBooks,
      finishedBooks,
      inProgressBooks,
      totalSeconds,
      completedPages,
      averageSessionSeconds,
      completionRate: totalBooks ? Math.round((finishedBooks / totalBooks) * 100) : 0
    };
  }, [safeBooks, sessionRows]);

  const chartDays = useMemo(() => {
    const days = buildLastNDays(14);
    const dayMap = new Map(days.map((day) => [day.key, day]));
    sessionRows.forEach((session) => {
      const key = new Date(session.endMs).toISOString().slice(0, 10);
      if (!dayMap.has(key)) return;
      const target = dayMap.get(key);
      target.seconds += session.seconds;
    });
    return days;
  }, [sessionRows]);

  const maxDaySeconds = chartDays.reduce((max, day) => Math.max(max, day.seconds), 0);

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

  const topBooks = useMemo(() => (
    [...safeBooks]
      .sort((left, right) => normalizeNumber(right?.readingTime) - normalizeNumber(left?.readingTime))
      .slice(0, 6)
  ), [safeBooks]);

  const topSessions = useMemo(() => (
    [...sessionRows]
      .sort((left, right) => right.seconds - left.seconds)
      .slice(0, 5)
  ), [sessionRows]);

  return (
    <section
      data-testid="library-reading-statistics-panel"
      className={`mb-4 rounded-2xl border p-5 md:p-7 ${
        isDarkLibraryTheme ? "border-slate-700 bg-slate-900/70" : "border-gray-200 bg-white"
      }`}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between">
            <div className={`text-xs font-semibold uppercase tracking-[0.14em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Total Reading Time
            </div>
            <Clock3 size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-3xl font-extrabold tracking-tight ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {formatHours(coreStats.totalSeconds)}
          </div>
          <div className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            {coreStats.inProgressBooks} books currently in progress
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between">
            <div className={`text-xs font-semibold uppercase tracking-[0.14em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Completion
            </div>
            <BadgeCheck size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-3xl font-extrabold tracking-tight ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {coreStats.finishedBooks}/{coreStats.totalBooks}
          </div>
          <div className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            {coreStats.completionRate}% finished
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between">
            <div className={`text-xs font-semibold uppercase tracking-[0.14em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Pages Done
            </div>
            <FileText size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-3xl font-extrabold tracking-tight ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {coreStats.completedPages}
          </div>
          <div className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            Pages from completed books
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between">
            <div className={`text-xs font-semibold uppercase tracking-[0.14em] ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
              Average Session
            </div>
            <Timer size={14} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          <div className={`mt-2 text-3xl font-extrabold tracking-tight ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
            {formatDuration(coreStats.averageSessionSeconds, { short: true })}
          </div>
          <div className={`mt-1 text-sm ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
            Based on {sessionRows.length} logged sessions
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                Reading activity (last 14 days)
              </h3>
              <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                Daily minutes based on reading sessions
              </p>
            </div>
            <Flame size={15} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>

          <div className="mt-5 grid grid-cols-14 items-end gap-2">
            {chartDays.map((day) => {
              const dayPercent = maxDaySeconds > 0 ? Math.max(8, Math.round((day.seconds / maxDaySeconds) * 100)) : 8;
              const dayMinutes = Math.round(day.seconds / 60);
              return (
                <div key={day.key} className="flex flex-col items-center gap-1">
                  <div
                    className={`relative h-28 w-full rounded-full ${
                      isDarkLibraryTheme ? "bg-slate-800" : "bg-gray-100"
                    }`}
                    title={`${day.fullLabel}: ${dayMinutes} min`}
                  >
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-full bg-blue-500 transition-all"
                      style={{ height: `${dayPercent}%` }}
                    />
                  </div>
                  <div className={`text-[10px] font-semibold ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                    {day.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                Status distribution
              </h3>
              <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                How your library is balanced right now
              </p>
            </div>
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
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${status.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                Top books by reading time
              </h3>
              <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                Ranked by total tracked reading time
              </p>
            </div>
            <Trophy size={15} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          {topBooks.length === 0 ? (
            <div className={`mt-3 rounded-xl border border-dashed p-4 text-sm ${isDarkLibraryTheme ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-500"}`}>
              No books yet.
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {topBooks.map((book) => {
                const progress = clampProgress(book?.progress);
                return (
                  <Link
                    key={`stats-book-${book.id}`}
                    to={buildReaderPath(book.id)}
                    onClick={() => onOpenBook?.(book.id)}
                    className={`group flex items-center gap-3 rounded-xl border p-2.5 transition ${
                      isDarkLibraryTheme
                        ? "border-slate-700 bg-slate-900/80 hover:border-blue-500"
                        : "border-gray-200 bg-white hover:border-blue-200"
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
                      <div className={`truncate text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                        {book.title}
                      </div>
                      <div className={`mt-0.5 truncate text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                        {book.author}
                      </div>
                      <div className={`mt-1 text-xs font-semibold ${isDarkLibraryTheme ? "text-blue-300" : "text-blue-600"}`}>
                        {formatDuration(book.readingTime, { short: true })} • {progress}%
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className={`rounded-2xl border p-4 ${isDarkLibraryTheme ? "border-slate-700 bg-slate-900" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className={`text-sm font-bold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                Best sessions
              </h3>
              <p className={`mt-1 text-xs ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                Longest recorded reading sessions
              </p>
            </div>
            <CalendarDays size={15} className={isDarkLibraryTheme ? "text-slate-400" : "text-gray-400"} />
          </div>
          {topSessions.length === 0 ? (
            <div className={`mt-3 rounded-xl border border-dashed p-4 text-sm ${isDarkLibraryTheme ? "border-slate-700 text-slate-400" : "border-gray-200 text-gray-500"}`}>
              No sessions tracked yet.
            </div>
          ) : (
            <ol className="mt-3 space-y-2.5">
              {topSessions.map((session, index) => (
                <li
                  key={session.id}
                  className={`rounded-xl border px-3 py-2.5 ${
                    isDarkLibraryTheme ? "border-slate-700 bg-slate-900/80" : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-slate-400" : "text-gray-500"}`}>
                      #{index + 1}
                    </span>
                    <span className={`text-xs font-semibold ${isDarkLibraryTheme ? "text-emerald-300" : "text-emerald-700"}`}>
                      {formatDuration(session.seconds, { short: true })}
                    </span>
                  </div>
                  <div className={`mt-1 truncate text-sm font-semibold ${isDarkLibraryTheme ? "text-slate-100" : "text-[#1A1A2E]"}`}>
                    {session.title}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
