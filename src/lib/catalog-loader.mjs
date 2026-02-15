const INDEX_URL = "./data/catalog/index.json";

let catalogPromise = null;

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function toCatalogBook(raw) {
  const author =
    raw.author_display ||
    (Array.isArray(raw.authors) && raw.authors[0]) ||
    "未知作者";
  const rawPages = Number(raw.pages);
  const hasPages = Number.isFinite(rawPages) && rawPages > 0;
  const provider = String(raw?.source?.provider || "");
  const pagesEstimated =
    !hasPages ||
    (rawPages === 320 && provider === "douban_hot_repo" && !String(raw?.isbn13 || "").trim());
  return {
    key: `${normalizeText(raw.title)}::${normalizeText(author)}`,
    title: raw.title,
    author,
    isbn: raw.isbn13 || "",
    pages: Math.max(1, hasPages ? rawPages : 320),
    pagesEstimated,
    category: raw.category || "general",
    source: raw.source || null
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    runners.push(run());
  }
  await Promise.all(runners);
  return results;
}

async function loadCatalogInternal() {
  const indexPayload = await fetchJson(INDEX_URL);
  const shardDefs = Array.isArray(indexPayload.shards) ? indexPayload.shards : [];
  const shardPayloads = await fetchWithConcurrency(shardDefs, 6, async (item) => {
    const shard = await fetchJson(item.path);
    return Array.isArray(shard.books) ? shard.books : [];
  });
  const rawBooks = shardPayloads.flat();
  const books = rawBooks.map(toCatalogBook);

  return {
    meta: {
      schema: indexPayload.schema || "catalog_index.unknown",
      source: indexPayload.source || "Open Library",
      generatedAt: indexPayload.generated_at || "",
      total: Number(indexPayload.total_books) || books.length,
      categoryCounts: indexPayload.category_counts || {},
      shardCount: shardDefs.length
    },
    books
  };
}

export function loadCatalogData() {
  if (!catalogPromise) {
    catalogPromise = loadCatalogInternal();
  }
  return catalogPromise;
}
