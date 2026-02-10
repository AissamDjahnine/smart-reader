const WORKER_TIMEOUT_MS = 10000;

let workerInstance = null;
let requestCounter = 0;
const pendingRequests = new Map();

const compactWhitespace = (value) => (value || "").toString().replace(/\s+/g, " ").trim();
const normalizeText = (value) => compactWhitespace(value).toLowerCase();

const terminateWorker = () => {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  pendingRequests.forEach(({ reject, timer }) => {
    clearTimeout(timer);
    reject(new Error("Content search worker terminated"));
  });
  pendingRequests.clear();
};

const createWorker = () => {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("../workers/contentSearchWorker.js", import.meta.url), {
    type: "module"
  });

  worker.onmessage = (event) => {
    const { requestId, ok, payload, error } = event.data || {};
    if (!requestId) return;
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);
    if (ok) {
      pending.resolve(payload);
    } else {
      pending.reject(new Error(error || "content-search-worker-failed"));
    }
  };

  worker.onerror = () => {
    terminateWorker();
  };

  return worker;
};

const getWorker = () => {
  if (!workerInstance) {
    workerInstance = createWorker();
  }
  return workerInstance;
};

const findCandidatesFallback = (sections, query, maxCandidates = 12) => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const limit = Math.max(1, Number(maxCandidates) || 12);

  const matches = (Array.isArray(sections) ? sections : [])
    .map((section) => {
      if (!section || typeof section.text !== "string") return null;
      const rank = section.text.indexOf(normalizedQuery);
      if (rank < 0) return null;
      return {
        id: section.id || "",
        href: section.href || "",
        chapterLabel: section.chapterLabel || "",
        preview: section.preview || "",
        rank
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      href: item.href,
      chapterLabel: item.chapterLabel,
      preview: item.preview
    }));

  return matches;
};

export const findContentIndexCandidates = async (sections, query, maxCandidates = 12) => {
  if (!Array.isArray(sections) || !sections.length || !query) return [];
  const worker = getWorker();
  if (!worker) {
    return findCandidatesFallback(sections, query, maxCandidates);
  }

  const requestId = `${Date.now()}-${++requestCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("content-search-worker-timeout"));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timer });
    worker.postMessage({
      requestId,
      sections,
      query,
      maxCandidates
    });
  }).catch((err) => {
    console.warn("Content search worker fallback:", err);
    return findCandidatesFallback(sections, query, maxCandidates);
  });
};

