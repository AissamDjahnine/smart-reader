export const buildLibraryNotifications = ({
  activeBooks,
  streakCount,
  readToday,
  todayKey,
  nowIso,
  normalizeNumber,
  getEstimatedRemainingSeconds,
  formatEstimatedTimeLeft,
  getCalendarDayDiff,
  isBookToRead,
  isBookStarted,
  isDuplicateTitleBook,
  stripDuplicateTitleSuffix
}) => {
  const duplicateReminderWeekKey = Math.floor(Date.now() / (1000 * 60 * 60 * 24 * 7));
  const items = [];
  const duplicateTitleBooks = activeBooks.filter((book) => isDuplicateTitleBook(book));
  const inProgressBooks = activeBooks
    .filter((book) => {
      const progress = Math.max(0, Math.min(100, normalizeNumber(book?.progress)));
      return progress > 0 && progress < 100 && !book?.isDeleted;
    })
    .sort((left, right) => new Date(right.lastRead || 0).getTime() - new Date(left.lastRead || 0).getTime());

  if (streakCount > 0 && !readToday) {
    items.push({
      id: `streak-risk-${todayKey}`,
      kind: "streak-risk",
      title: "Streak at risk",
      message: `Keep your ${streakCount}-day streak alive — read 5 min now.`,
      createdAt: nowIso,
      priority: 0,
      actionType: "open-library-in-progress",
      actionLabel: "Read now"
    });
  }

  inProgressBooks
    .map((book) => {
      const remainingSeconds = getEstimatedRemainingSeconds(book);
      return {
        id: `finish-soon-${book.id}`,
        kind: "finish-soon",
        bookId: book.id,
        title: book.title,
        author: book.author,
        message: `Can be finished in ${formatEstimatedTimeLeft(remainingSeconds).replace(" left", "")}. Pick it up now.`,
        remainingSeconds,
        createdAt: book.lastRead || nowIso,
        priority: 1,
        actionType: "open-reader",
        actionLabel: "Open book"
      };
    })
    .filter((item) => item.remainingSeconds > 0 && item.remainingSeconds <= 30 * 60)
    .sort((left, right) => left.remainingSeconds - right.remainingSeconds)
    .forEach((item) => items.push(item));

  inProgressBooks
    .filter((book) => getCalendarDayDiff(book.lastRead) >= 3)
    .slice(0, 3)
    .forEach((book) => {
      const progress = Math.max(0, Math.min(100, normalizeNumber(book.progress)));
      items.push({
        id: `resume-abandoned-${book.id}`,
        kind: "resume-abandoned",
        bookId: book.id,
        title: "Resume reading",
        author: book.author,
        message: `Back to ${book.title}? You're ${Math.round(progress)}% in.`,
        createdAt: book.lastRead || nowIso,
        priority: 2,
        actionType: "open-reader",
        actionLabel: "Resume"
      });
    });

  inProgressBooks
    .filter((book) => getCalendarDayDiff(book.lastRead) <= 2)
    .slice(0, 4)
    .forEach((book) => {
      const progress = Math.max(0, Math.min(100, normalizeNumber(book.progress)));
      const milestone = [90, 75, 50, 25].find((threshold) => progress >= threshold);
      if (!milestone || progress >= 100) return;
      items.push({
        id: `milestone-${book.id}-${milestone}`,
        kind: "milestone",
        bookId: book.id,
        title: "Milestone reached",
        author: book.author,
        message: `Nice progress — you reached ${milestone}% in ${book.title}.`,
        createdAt: book.lastRead || nowIso,
        priority: 3,
        actionType: "open-reader",
        actionLabel: "Keep going"
      });
    });

  if (!readToday) {
    items.push({
      id: `daily-goal-${todayKey}`,
      kind: "daily-goal",
      title: "Daily micro-goal",
      message: "A 10-minute session today keeps your reading momentum.",
      createdAt: nowIso,
      priority: 4,
      actionType: "open-library-in-progress",
      actionLabel: "Start 10 min"
    });
  }

  const untouchedToRead = activeBooks.filter((book) => {
    if (!isBookToRead(book)) return false;
    if (isBookStarted(book)) return false;
    const ageDays = getCalendarDayDiff(book?.addedAt || book?.lastRead || 0);
    return ageDays >= 7;
  });
  if (untouchedToRead.length > 0) {
    items.push({
      id: `to-read-nudge-${todayKey}`,
      kind: "to-read-nudge",
      title: "To Read reminder",
      message: `Pick your next book: ${untouchedToRead.length} title${untouchedToRead.length === 1 ? "" : "s"} waiting in To Read.`,
      createdAt: nowIso,
      priority: 5,
      actionType: "open-library-to-read",
      actionLabel: "Review list"
    });
  }

  if (duplicateTitleBooks.length > 0) {
    const duplicateBaseTitleSet = new Set(
      duplicateTitleBooks
        .map((book) => stripDuplicateTitleSuffix(book.title))
        .filter(Boolean)
    );
    const sampleTitles = Array.from(duplicateBaseTitleSet).slice(0, 2);
    const sampleLabel = sampleTitles.length
      ? ` (${sampleTitles.join(", ")}${duplicateBaseTitleSet.size > 2 ? ", ..." : ""})`
      : "";
    items.push({
      id: `duplicate-cleanup-${duplicateReminderWeekKey}`,
      kind: "duplicate-cleanup",
      title: "Duplicate cleanup recommended",
      message: `${duplicateTitleBooks.length} duplicate copy${duplicateTitleBooks.length === 1 ? "" : "ies"} detected${sampleLabel}. They add no value and should be deleted.`,
      createdAt: nowIso,
      priority: 4,
      actionType: "open-library-duplicates",
      actionLabel: "Review duplicates"
    });
  }

  return items
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    })
    .slice(0, 16);
};
