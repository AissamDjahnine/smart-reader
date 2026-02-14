import JSZip from "jszip";

const IMAGE_MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const toText = (value) => (value == null ? "" : String(value));

const decodeEntities = (value) =>
  toText(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

const compactWhitespace = (value) =>
  decodeEntities(value).replace(/\s+/g, " ").trim();

const stripQueryHash = (value) => toText(value).split("#")[0].split("?")[0];

const resolvePath = (basePath, nextPath) => {
  const safeBase = stripQueryHash(basePath);
  const safeNext = stripQueryHash(nextPath);
  if (!safeNext) return "";
  if (/^[a-z]+:\/\//i.test(safeNext)) return safeNext;

  const baseSegments = safeBase.includes("/")
    ? safeBase.split("/").slice(0, -1)
    : [];
  const nextSegments = safeNext.replace(/^\/+/, "").split("/");
  const merged = safeNext.startsWith("/")
    ? nextSegments
    : [...baseSegments, ...nextSegments];

  const resolved = [];
  merged.forEach((segment) => {
    if (!segment || segment === ".") return;
    if (segment === "..") {
      resolved.pop();
      return;
    }
    resolved.push(segment);
  });
  return resolved.join("/");
};

const parseAttributes = (tagText) => {
  const attrs = {};
  const regex = /([:@A-Za-z0-9._-]+)\s*=\s*(['"])(.*?)\2/g;
  let match = regex.exec(tagText);
  while (match) {
    attrs[match[1].toLowerCase()] = match[3];
    match = regex.exec(tagText);
  }
  return attrs;
};

const collectTagTexts = (xml, tagName) => {
  if (!xml) return [];
  const values = [];
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match = regex.exec(xml);
  while (match) {
    const text = compactWhitespace(match[1]);
    if (text) values.push(text);
    match = regex.exec(xml);
  }
  return values;
};

const firstTagText = (xml, tagNames) => {
  for (let i = 0; i < tagNames.length; i += 1) {
    const values = collectTagTexts(xml, tagNames[i]);
    if (values.length) return values[0];
  }
  return "";
};

const normalizeGenreLabel = (value) => {
  const clean = compactWhitespace(value);
  if (!clean) return "";
  const lower = clean.toLowerCase();

  if (/\b(science fiction|sci[- ]?fi)\b/.test(lower)) return "Science Fiction";
  if (/\b(fantasy)\b/.test(lower)) return "Fantasy";
  if (/\b(horror)\b/.test(lower)) return "Horror";
  if (/\b(thriller|suspense)\b/.test(lower)) return "Thriller";
  if (/\b(mystery|crime|detective)\b/.test(lower)) return "Mystery";
  if (/\b(romance|love story)\b/.test(lower)) return "Romance";
  if (/\b(classic|classics)\b/.test(lower)) return "Classic";
  if (/\b(historical fiction|historical)\b/.test(lower)) return "Historical";
  if (/\b(poetry|poems)\b/.test(lower)) return "Poetry";
  if (/\b(drama|plays?)\b/.test(lower)) return "Drama";
  if (/\b(biography|memoir|autobiography)\b/.test(lower)) return "Biography";
  if (/\b(history)\b/.test(lower)) return "History";
  if (/\b(philosophy)\b/.test(lower)) return "Philosophy";
  if (/\b(non[- ]?fiction)\b/.test(lower)) return "Nonfiction";
  if (/\b(fiction)\b/.test(lower)) return "Fiction";

  return clean
    .split(" ")
    .map((word) => {
      if (!word) return word;
      const upper = word.toUpperCase();
      if (upper.length <= 3) return upper;
      return upper[0] + word.slice(1).toLowerCase();
    })
    .join(" ");
};

const extractGenreFromMetadata = (metadata = {}) => {
  const candidates = [];
  [
    metadata.genre,
    metadata.subject,
    metadata.subjects,
    metadata.type,
    metadata.types,
    metadata["dc:subject"],
    metadata["dc:type"]
  ].forEach((value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string") {
          item.split(/[,;|/]/).forEach((token) => {
            const clean = compactWhitespace(token);
            if (clean) candidates.push(clean);
          });
        }
      });
      return;
    }
    if (typeof value === "string") {
      value.split(/[,;|/]/).forEach((token) => {
        const clean = compactWhitespace(token);
        if (clean) candidates.push(clean);
      });
    }
  });

  for (const candidate of candidates) {
    const normalized = normalizeGenreLabel(candidate);
    if (normalized) return normalized;
  }
  return "";
};

const readContainerOpfPath = (containerXml) => {
  const match = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml || "");
  return match ? match[1] : "";
};

const getZipFileByPath = (zip, targetPath) => {
  if (!targetPath) return null;
  const direct = zip.file(targetPath);
  if (direct) return direct;
  const normalized = targetPath.toLowerCase();
  let found = null;
  zip.forEach((relativePath, entry) => {
    if (found) return;
    if (relativePath.toLowerCase() === normalized) {
      found = entry;
    }
  });
  return found;
};

const detectCoverHref = (opfXml) => {
  const itemTags = [];
  const itemRegex = /<item\b[^>]*>/gi;
  let itemMatch = itemRegex.exec(opfXml || "");
  while (itemMatch) {
    itemTags.push({
      raw: itemMatch[0],
      attrs: parseAttributes(itemMatch[0]),
    });
    itemMatch = itemRegex.exec(opfXml || "");
  }

  const byCoverProp = itemTags.find((item) =>
    /\bcover-image\b/i.test(item.attrs.properties || "")
  );
  if (byCoverProp?.attrs?.href) return byCoverProp.attrs.href;

  const metaRegex = /<meta\b[^>]*>/gi;
  let metaMatch = metaRegex.exec(opfXml || "");
  while (metaMatch) {
    const attrs = parseAttributes(metaMatch[0]);
    if ((attrs.name || "").toLowerCase() === "cover" && attrs.content) {
      const coverId = attrs.content;
      const byId = itemTags.find((item) => item.attrs.id === coverId);
      if (byId?.attrs?.href) return byId.attrs.href;
    }
    metaMatch = metaRegex.exec(opfXml || "");
  }

  return "";
};

const estimatePagesFromOpf = (opfXml) => {
  const spineItemCount = (opfXml.match(/<itemref\b/gi) || []).length;
  if (spineItemCount > 0) return Math.max(1, Math.round(spineItemCount * 8));
  const xhtmlCount = (opfXml.match(/\.x?html/gi) || []).length;
  if (xhtmlCount > 0) return Math.max(1, Math.round(xhtmlCount * 4));
  return null;
};

const extractMetadata = (opfXml, fileName) => {
  const title =
    firstTagText(opfXml, ["dc:title", "title"]) ||
    toText(fileName).replace(/\.epub$/i, "");
  const creator =
    firstTagText(opfXml, ["dc:creator", "creator"]) || "Unknown Author";
  const language = firstTagText(opfXml, ["dc:language", "language"]);
  const publisher = firstTagText(opfXml, ["dc:publisher", "publisher"]);
  const pubdate = firstTagText(opfXml, ["dc:date", "dc:pubdate", "date"]);
  const identifier = firstTagText(opfXml, ["dc:identifier", "identifier"]);
  const subjects = collectTagTexts(opfXml, "dc:subject");
  const subject = subjects[0] || "";
  const types = collectTagTexts(opfXml, "dc:type");
  const type = types[0] || "";

  return {
    title,
    creator,
    language,
    publisher,
    pubdate,
    identifier,
    subject,
    subjects,
    type,
    types,
  };
};

const buildDataUrlFromZip = async (zip, opfPath, href) => {
  const resolvedPath = resolvePath(opfPath, href);
  if (!resolvedPath) return null;
  const fileEntry = getZipFileByPath(zip, resolvedPath);
  if (!fileEntry) return null;
  const base64 = await fileEntry.async("base64");
  if (!base64) return null;

  const extMatch = /\.([A-Za-z0-9]+)$/.exec(resolvedPath);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";
  const mime = IMAGE_MIME_BY_EXT[ext] || "image/jpeg";
  return `data:${mime};base64,${base64}`;
};

const parseEpubMetadataFromBuffer = async (buffer, fileName) => {
  const zip = await JSZip.loadAsync(buffer);
  const containerEntry = getZipFileByPath(zip, "META-INF/container.xml");
  if (!containerEntry) throw new Error("Missing META-INF/container.xml");
  const containerXml = await containerEntry.async("string");
  const opfPath = readContainerOpfPath(containerXml);
  if (!opfPath) throw new Error("Unable to locate OPF path");

  const opfEntry = getZipFileByPath(zip, opfPath);
  if (!opfEntry) throw new Error(`Missing OPF file: ${opfPath}`);
  const opfXml = await opfEntry.async("string");

  const metadata = extractMetadata(opfXml, fileName);
  const estimatedPages = estimatePagesFromOpf(opfXml);
  const coverHref = detectCoverHref(opfXml);
  const cover = coverHref ? await buildDataUrlFromZip(zip, opfPath, coverHref) : null;

  return {
    metadata,
    estimatedPages,
    genre: extractGenreFromMetadata(metadata),
    cover,
  };
};

self.onmessage = async (event) => {
  const { requestId, fileName, buffer } = event.data || {};
  if (!requestId) return;

  try {
    const payload = await parseEpubMetadataFromBuffer(buffer, fileName);
    self.postMessage({ requestId, ok: true, payload });
  } catch (err) {
    self.postMessage({
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
