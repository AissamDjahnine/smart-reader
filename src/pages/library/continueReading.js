export const buildContinueReadingBooks = ({
  books = [],
  isDuplicateTitleBook = () => false,
  isBookStarted = () => false,
  normalizeNumber = (value) => Number(value || 0),
  normalizeTime = (value) => {
    const timestamp = new Date(value || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  },
  nowMs = Date.now(),
  limit = 8
} = {}) =>
  [...books]
    .filter((book) => {
      if (book?.isDeleted) return false;
      if (isDuplicateTitleBook(book)) return false;
      const progress = normalizeNumber(book?.progress);
      const hasStarted = isBookStarted(book);
      return hasStarted && progress < 100;
    })
    .map((book) => {
      const progress = Math.max(0, Math.min(100, normalizeNumber(book?.progress)));
      const spentSeconds = Math.max(0, Number(book?.readingTime) || 0);
      const estimatedRemainingSeconds =
        progress > 0 && progress < 100 && spentSeconds > 0
          ? Math.round((spentSeconds * (100 - progress)) / progress)
          : 0;
      const lastReadMs = normalizeTime(book?.lastRead);
      const ageDays =
        lastReadMs > 0 ? Math.max(0, (nowMs - lastReadMs) / (1000 * 60 * 60 * 24)) : Number.POSITIVE_INFINITY;
      const recencyScore = Number.isFinite(ageDays) ? 1 / (1 + ageDays) : 0;
      const nearFinishScore = progress / 100;
      const continuePriorityScore = (recencyScore * 0.68) + (nearFinishScore * 0.32);
      return {
        ...book,
        __estimatedRemainingSeconds: estimatedRemainingSeconds,
        __continuePriorityScore: continuePriorityScore
      };
    })
    .sort((left, right) => {
      const priorityDiff = (right.__continuePriorityScore || 0) - (left.__continuePriorityScore || 0);
      if (Math.abs(priorityDiff) > 0.0001) return priorityDiff;
      const recencyDiff = normalizeTime(right.lastRead) - normalizeTime(left.lastRead);
      if (recencyDiff !== 0) return recencyDiff;
      return normalizeNumber(right.progress) - normalizeNumber(left.progress);
    })
    .slice(0, limit);
