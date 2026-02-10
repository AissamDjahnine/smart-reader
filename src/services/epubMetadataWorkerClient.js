import { readEpubMetadata } from "./db";

const WORKER_TIMEOUT_MS = 30000;

let workerInstance = null;
let requestCounter = 0;
const pendingRequests = new Map();

const terminateWorker = () => {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  pendingRequests.forEach(({ reject, timer }) => {
    clearTimeout(timer);
    reject(new Error("EPUB worker terminated"));
  });
  pendingRequests.clear();
};

const createWorker = () => {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  const worker = new Worker(new URL("../workers/epubMetadataWorker.js", import.meta.url), {
    type: "module",
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
      pending.reject(new Error(error || "EPUB worker failed"));
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

const requestWorkerMetadata = async (file) => {
  const worker = getWorker();
  if (!worker) {
    throw new Error("Worker API unavailable");
  }
  const buffer = await file.arrayBuffer();
  const requestId = `${Date.now()}-${++requestCounter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("EPUB worker timed out"));
    }, WORKER_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timer });
    worker.postMessage(
      {
        requestId,
        fileName: file.name || "",
        buffer,
      },
      [buffer]
    );
  });
};

export const readEpubMetadataFast = async (file) => {
  try {
    return await requestWorkerMetadata(file);
  } catch (err) {
    console.warn("EPUB worker fallback to main thread:", err);
    return readEpubMetadata(file);
  }
};

