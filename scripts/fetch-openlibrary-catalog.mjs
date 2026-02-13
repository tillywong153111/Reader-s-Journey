import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = "https://openlibrary.org/search.json";
const PAGE_LIMIT = 100;
const MAX_PAGE_PER_SUBJECT = 220;
const SHARD_SIZE = 800;
const TARGET_PER_CATEGORY = Number(process.env.CATEGORY_TARGET || 7200);

const CATEGORY_SUBJECTS = {
  logic: ["logic", "reasoning", "critical thinking", "mathematics", "statistics"],
  psychology: ["psychology", "cognitive psychology", "behavioral science", "psychotherapy", "neuroscience"],
  strategy: ["strategy", "game theory", "military strategy", "business strategy", "decision making"],
  literature: ["literature", "fiction", "novel", "poetry", "drama"],
  creativity: ["creativity", "innovation", "design", "art", "writing"],
  philosophy: ["philosophy", "ethics", "metaphysics", "epistemology", "stoicism"],
  general: ["history", "science", "biography", "economics", "social science"]
};

const FIELDS = [
  "key",
  "title",
  "author_name",
  "isbn",
  "number_of_pages_median",
  "first_publish_year",
  "language",
  "publisher"
].join(",");

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeIsbn(value) {
  const cleaned = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 13) return cleaned;
  return "";
}

function pickIsbn13(list) {
  if (!Array.isArray(list)) return "";
  for (const item of list) {
    const parsed = normalizeIsbn(item);
    if (parsed) return parsed;
  }
  return "";
}

function sanitizePages(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 320;
  return Math.max(40, Math.min(2000, Math.round(parsed)));
}

function toBook(doc, category, subject) {
  const title = String(doc.title || "").trim();
  if (title.length < 2 || title.length > 180) return null;
  const author =
    Array.isArray(doc.author_name) && doc.author_name[0]
      ? String(doc.author_name[0]).trim()
      : "";
  if (!author) return null;

  const isbn13 = pickIsbn13(doc.isbn);
  const workKey = String(doc.key || "");
  if (!workKey) return null;

  return {
    book_id: isbn13 || `ol-${workKey.replace(/\//g, "-")}`,
    title,
    title_norm: normalizeText(title),
    authors: [author],
    author_display: author,
    isbn13,
    pages: sanitizePages(doc.number_of_pages_median),
    category,
    language:
      Array.isArray(doc.language) && doc.language[0]
        ? String(doc.language[0])
        : "und",
    publisher:
      Array.isArray(doc.publisher) && doc.publisher[0]
        ? String(doc.publisher[0])
        : "",
    published_year:
      Number.isFinite(Number(doc.first_publish_year))
        ? Number(doc.first_publish_year)
        : null,
    source: {
      provider: "openlibrary",
      work_key: workKey,
      work_url: `https://openlibrary.org${workKey}`,
      query: `subject:${subject}`
    }
  };
}

function requestUrl(subject, page) {
  const params = new URLSearchParams({
    q: subject,
    page: String(page),
    limit: String(PAGE_LIMIT),
    fields: FIELDS
  });
  return `${API_BASE}?${params.toString()}`;
}

async function fetchDocs(subject, page, retries = 3) {
  let lastError = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(requestUrl(subject, page), {
        headers: {
          "user-agent": "ReadersJourneyCatalogBuilder/2.0"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      return Array.isArray(payload.docs) ? payload.docs : [];
    } catch (error) {
      lastError = error;
      await sleep(250 * (i + 1));
    }
  }
  throw lastError || new Error("request failed");
}

function ensureCatalogDirs() {
  const root = resolve(process.cwd(), "src/data/catalog");
  const shardsDir = resolve(root, "shards");
  mkdirSync(root, { recursive: true });
  if (readdirSync(root).includes("shards")) {
    rmSync(shardsDir, { recursive: true, force: true });
  }
  mkdirSync(shardsDir, { recursive: true });
  return { root, shardsDir };
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function chunkArray(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

function buildDistribution(categories, targetPerCategory) {
  const out = {};
  for (const category of categories) {
    out[category] = targetPerCategory;
  }
  return out;
}

async function main() {
  const categories = Object.keys(CATEGORY_SUBJECTS);
  const targetMap = buildDistribution(categories, TARGET_PER_CATEGORY);
  const categoryBooks = {};
  const pageTrack = {};
  const exhaustedSubjects = new Set();
  const seenIsbn = new Set();
  const seenKey = new Set();

  for (const category of categories) {
    categoryBooks[category] = [];
    pageTrack[category] = {};
    for (const subject of CATEGORY_SUBJECTS[category]) {
      pageTrack[category][subject] = 1;
    }
  }

  for (const category of categories) {
    let idleRounds = 0;
    while (categoryBooks[category].length < targetMap[category] && idleRounds < 12) {
      let addedInRound = 0;

      for (const subject of CATEGORY_SUBJECTS[category]) {
        if (categoryBooks[category].length >= targetMap[category]) {
          break;
        }
        const page = pageTrack[category][subject];
        if (page > MAX_PAGE_PER_SUBJECT) {
          exhaustedSubjects.add(`${category}:${subject}`);
          continue;
        }

        const docs = await fetchDocs(subject, page);
        pageTrack[category][subject] = page + 1;
        if (docs.length === 0) {
          exhaustedSubjects.add(`${category}:${subject}`);
          continue;
        }

        let accepted = 0;
        for (const doc of docs) {
          if (categoryBooks[category].length >= targetMap[category]) break;
          const book = toBook(doc, category, subject);
          if (!book) continue;

          const dedupeKey = `${book.title_norm}::${normalizeText(book.author_display)}`;
          if (seenKey.has(dedupeKey)) continue;
          if (book.isbn13 && seenIsbn.has(book.isbn13)) continue;

          seenKey.add(dedupeKey);
          if (book.isbn13) seenIsbn.add(book.isbn13);
          categoryBooks[category].push(book);
          accepted += 1;
        }

        addedInRound += accepted;
        console.log(
          `[${category}] ${categoryBooks[category].length}/${targetMap[category]} | subject="${subject}" page=${page} accepted=${accepted}`
        );
        await sleep(50);
      }

      if (addedInRound === 0) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
      }

      const allExhausted = CATEGORY_SUBJECTS[category].every((subject) =>
        exhaustedSubjects.has(`${category}:${subject}`)
      );
      if (allExhausted) break;
    }
  }

  const { root, shardsDir } = ensureCatalogDirs();
  const shardDefs = [];
  const categoryCounts = {};
  let totalBooks = 0;

  for (const category of categories) {
    const list = categoryBooks[category]
      .sort((a, b) => a.title_norm.localeCompare(b.title_norm, "en"));
    categoryCounts[category] = list.length;
    totalBooks += list.length;
    const chunks = chunkArray(list, SHARD_SIZE);
    chunks.forEach((chunk, index) => {
      const shardFile = `${category}-${String(index + 1).padStart(3, "0")}.json`;
      const shardPath = resolve(shardsDir, shardFile);
      writeJson(shardPath, {
        schema: "catalog_shard.v1",
        category,
        shard_id: shardFile.replace(".json", ""),
        count: chunk.length,
        books: chunk
      });
      shardDefs.push({
        id: shardFile.replace(".json", ""),
        category,
        count: chunk.length,
        path: `./data/catalog/shards/${shardFile}`
      });
    });
  }

  const indexPayload = {
    schema: "catalog_index.v2",
    generated_at: new Date().toISOString(),
    source: "Open Library Search API",
    per_category_target: TARGET_PER_CATEGORY,
    total_books: totalBooks,
    category_counts: categoryCounts,
    shard_size: SHARD_SIZE,
    shard_count: shardDefs.length,
    shards: shardDefs
  };

  writeJson(resolve(root, "index.json"), indexPayload);

  console.log("Catalog build complete");
  console.log(`- total_books: ${totalBooks}`);
  console.log(`- shard_count: ${shardDefs.length}`);
  console.log(`- index: ${resolve(root, "index.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

