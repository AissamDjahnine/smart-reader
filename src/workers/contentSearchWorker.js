const compactWhitespace = (value) => (value || "").toString().replace(/\s+/g, " ").trim();
const normalizeText = (value) => compactWhitespace(value).toLowerCase();

const findCandidates = (sections, query, maxCandidates) => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const limit = Math.max(1, Number(maxCandidates) || 12);
  const matches = [];

  for (const section of Array.isArray(sections) ? sections : []) {
    if (!section || typeof section.text !== "string") continue;
    const index = section.text.indexOf(normalizedQuery);
    if (index < 0) continue;
    matches.push({
      id: section.id || "",
      href: section.href || "",
      chapterLabel: section.chapterLabel || "",
      preview: section.preview || "",
      rank: index
    });
  }

  matches.sort((left, right) => left.rank - right.rank);
  return matches.slice(0, limit).map((item) => ({
    id: item.id,
    href: item.href,
    chapterLabel: item.chapterLabel,
    preview: item.preview
  }));
};

self.onmessage = (event) => {
  const { requestId, sections, query, maxCandidates } = event.data || {};
  if (!requestId) return;

  try {
    const payload = findCandidates(sections, query, maxCandidates);
    self.postMessage({
      requestId,
      ok: true,
      payload
    });
  } catch (err) {
    self.postMessage({
      requestId,
      ok: false,
      error: err?.message || "content-search-worker-failed"
    });
  }
};

