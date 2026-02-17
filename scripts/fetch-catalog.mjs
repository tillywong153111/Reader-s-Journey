import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import XLSX from "xlsx";

const TARGET_TOTAL = Number(process.env.TOTAL_TARGET || 50400);
const CATEGORY_TARGET = Number(process.env.CATEGORY_TARGET || Math.floor(TARGET_TOTAL / 7));
const CATEGORY_MIN_FLOOR = Number(process.env.CATEGORY_MIN_FLOOR || 1600);
const SHARD_SIZE = Number(process.env.SHARD_SIZE || 800);
const GITHUB_TREE_URL =
  process.env.DOUBAN_TREE_URL ||
  "https://api.github.com/repos/mylove1/doubanbook30000/git/trees/master?recursive=1";
const GITHUB_RAW_PREFIX =
  process.env.DOUBAN_RAW_PREFIX ||
  "https://raw.githubusercontent.com/mylove1/doubanbook30000/master/";
const DOUBAN_TOP250_CSV_URL =
  process.env.DOUBAN_TOP250_CSV_URL ||
  "https://raw.githubusercontent.com/free-learning-center/douban-top250-books/main/douban-top250-20221107.csv";
const FETCH_CONCURRENCY = Math.max(1, Number(process.env.DOUBAN_FETCH_CONCURRENCY || 6));

const CATEGORIES = [
  "logic",
  "psychology",
  "strategy",
  "literature",
  "creativity",
  "philosophy",
  "general"
];

const GENERIC_AUTHOR_LABELS = new Set([
  "小说",
  "文学",
  "经典",
  "历史",
  "电影",
  "艺术",
  "文化",
  "心理学",
  "社会",
  "设计",
  "哲学",
  "散文",
  "诗歌",
  "诗词",
  "青春",
  "漫画",
  "科幻",
  "推理",
  "悬疑",
  "言情",
  "武侠",
  "管理",
  "投资",
  "创业",
  "经济",
  "商业",
  "两性",
  "女性",
  "健康",
  "旅行",
  "科普"
]);

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeCompactText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

function normalizeIsbn13(value) {
  const cleaned = String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (cleaned.length === 13) return cleaned;
  return "";
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchTextWithRetry(url, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "ReadersJourneyCatalogBuilder/3.0"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      await sleep(260 * (attempt + 1));
    }
  }
  throw lastError || new Error("request failed");
}

async function fetchBufferWithRetry(url, retries = 3) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "ReadersJourneyCatalogBuilder/3.0"
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      lastError = error;
      await sleep(260 * (attempt + 1));
    }
  }
  throw lastError || new Error("request failed");
}

function parseYearFromInfo(info) {
  const hit = String(info || "").match(/(19|20)\d{2}/);
  return hit ? Number(hit[0]) : null;
}

function parseAuthorFromInfo(info) {
  const raw = String(info || "").split("/")[0] || "";
  const cleaned = raw
    .replace(/^[\[【（(].*?[\]】）)]\s*/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function parseDoubanSubjectId(url) {
  const hit = String(url || "").match(/subject\/(\d+)/);
  return hit ? hit[1] : "";
}

function classifyCategoryByPath(filePath) {
  const parts = String(filePath || "").split("/");
  const top = parts[1] || "";
  const name = (parts[2] || "").replace(/\.xlsx$/i, "");

  if (top === "文学" || top === "流行") {
    return "literature";
  }

  if (top === "科技") {
    return /科幻|漫画|小说/.test(name) ? "literature" : "logic";
  }

  if (top === "经管") {
    if (/投资|理财|金融|交易|战略|营销|管理|商业|创业|经济/.test(name)) {
      return "strategy";
    }
    if (/心理/.test(name)) {
      return "psychology";
    }
    return "general";
  }

  if (top === "生活") {
    if (/心理|情感|两性|人际/.test(name)) return "psychology";
    if (/设计|艺术|绘本|摄影/.test(name)) return "creativity";
    if (/管理|效率|决策/.test(name)) return "strategy";
    return "general";
  }

  if (top === "文化") {
    if (/心理/.test(name)) return "psychology";
    if (/逻辑|数学|统计|科学/.test(name)) return "logic";
    if (/政治|军事|战略|经济|管理/.test(name)) return "strategy";
    if (/哲学|思想|宗教|佛教|国学/.test(name)) return "philosophy";
    if (/艺术|设计|音乐|绘画|电影|戏剧/.test(name)) return "creativity";
    return "general";
  }

  return "general";
}

function inferCategoryFromText(text, fallback = "general") {
  const source = String(text || "");
  if (!source) return fallback;

  if (/逻辑|数学|统计|算法|推理|思维|证明|批判|概率|计算机|编程|程序|人工智能|机器学习/.test(source)) {
    return "logic";
  }
  if (/心理|情绪|情感|行为|人格|认知|疗愈|精神|亲密关系|焦虑|抑郁|成长/.test(source)) {
    return "psychology";
  }
  if (/战略|策略|管理|商业|领导|组织|战争|投资|决策|谈判|营销|运营|金融|经济/.test(source)) {
    return "strategy";
  }
  if (/文学|小说|诗|散文|随笔|故事|戏剧|古典|科幻|奇幻|武侠|言情|漫画|童话|名著/.test(source)) {
    return "literature";
  }
  if (/创造|创意|设计|写作|艺术|绘画|音乐|摄影|建筑|电影|手工|交互/.test(source)) {
    return "creativity";
  }
  if (/哲学|思想|伦理|宗教|佛|道|儒|存在|国学|历史观|政治哲学/.test(source)) {
    return "philosophy";
  }
  return fallback;
}

function fallbackAuthorByPath(filePath) {
  const parts = String(filePath || "").split("/");
  const name = (parts[2] || "").replace(/\.xlsx$/i, "").trim();
  if (!name || GENERIC_AUTHOR_LABELS.has(name)) {
    return "未知作者";
  }
  return name;
}

function parseHeaderIndexes(headerRow) {
  const headers = headerRow.map((item) => String(item || "").trim());
  let titleIndex = -1;
  let urlIndex = -1;
  let infoIndex = -1;
  let ratingIndex = -1;

  headers.forEach((head, index) => {
    if (titleIndex === -1 && /书籍|书名|名称|标题/.test(head)) {
      titleIndex = index;
    }
    if (urlIndex === -1 && /url|链接|入口/i.test(head)) {
      urlIndex = index;
    }
    if (infoIndex === -1 && /出版|信息|作者/.test(head)) {
      infoIndex = index;
    }
    if (ratingIndex === -1 && /评分|评价|星/.test(head)) {
      ratingIndex = index;
    }
  });

  if (titleIndex === -1) titleIndex = 0;
  if (urlIndex === -1) urlIndex = 1;
  if (infoIndex === -1) infoIndex = 3;
  if (ratingIndex === -1) ratingIndex = 4;

  return { titleIndex, urlIndex, infoIndex, ratingIndex };
}

function parseDoubanWorkbook(buffer, filePath) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) return [];

  const { titleIndex, urlIndex, infoIndex, ratingIndex } = parseHeaderIndexes(rows[0]);
  const fallbackAuthor = fallbackAuthorByPath(filePath);
  const categoryByPath = classifyCategoryByPath(filePath);

  const books = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const title = String(row[titleIndex] || "").trim();
    if (!title || title.length > 200) continue;

    const link = String(row[urlIndex] || "").trim();
    const info = String(row[infoIndex] || "").trim();
    const rating = safeNumber(String(row[ratingIndex] || "").replace(/[^0-9.]/g, ""), null);
    const subjectId = parseDoubanSubjectId(link);
    const parsedAuthor = parseAuthorFromInfo(info);
    const author = parsedAuthor || fallbackAuthor;
    const publishedYear = parseYearFromInfo(info);
    const category = inferCategoryFromText(`${filePath} ${title} ${info}`, categoryByPath);

    books.push({
      book_id: subjectId ? `db-${subjectId}` : `db-${normalizeText(title)}-${normalizeText(author)}`,
      title,
      title_norm: normalizeText(title),
      authors: [author || "未知作者"],
      author_display: author || "未知作者",
      isbn13: "",
      pages: 0,
      pages_estimated: true,
      category,
      language: "chi",
      publisher: "",
      published_year: publishedYear,
      source: {
        provider: "douban_hot_repo",
        work_key: subjectId,
        work_url: link || "https://book.douban.com",
        query: filePath
      },
      _score_meta: {
        rating: Number.isFinite(rating) ? rating : 0
      }
    });
  }

  return books;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function readExistingCatalog() {
  const root = resolve(process.cwd(), "src/data/catalog");
  const indexPath = resolve(root, "index.json");
  try {
    const indexPayload = readJson(indexPath);
    const shards = Array.isArray(indexPayload.shards) ? indexPayload.shards : [];
    const books = [];
    for (const shardDef of shards) {
      const path = resolve(process.cwd(), "src", String(shardDef.path || "").replace(/^\.\//, ""));
      const shard = readJson(path);
      const rows = Array.isArray(shard.books) ? shard.books : [];
      books.push(...rows.map((book) => ({ ...book })));
    }
    return books;
  } catch {
    return [];
  }
}

function parseTop250Csv(text) {
  const workbook = XLSX.read(text, { type: "buffer", codepage: 936 });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  if (rows.length < 2) return [];
  const hot = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const title = String(row[1] || "").trim();
    if (title) hot.push(title);
  }
  return hot;
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

function enrichBookScore(book, top250TitleSet) {
  const title = String(book.title || "");
  const author = String(book.author_display || "");
  const chineseBonus = hasCjk(title) || hasCjk(author) || String(book.language || "").toLowerCase() === "chi" ? 180 : 0;
  const source = String(book.source?.provider || "");
  const sourceBonus = source === "douban_hot_repo" ? 540 : 140;
  const isbnBonus = book.isbn13 ? 35 : 0;
  const ratingBonus = safeNumber(book._score_meta?.rating, 0) || 0;
  const hotBonus = top250TitleSet.has(normalizeHotTitle(title)) ? 320 : 0;
  const recencyBonus = Number.isFinite(Number(book.published_year)) ? Math.max(0, 30 - Math.abs(2026 - Number(book.published_year)) / 2) : 0;
  return sourceBonus + chineseBonus + isbnBonus + ratingBonus * 10 + hotBonus + recencyBonus;
}

function normalizeHotTitle(text) {
  return normalizeCompactText(text)
    .replace(/[《》「」『』【】\[\]\(\)（）]/g, "")
    .replace(/[·•:：,，.。!！?？'"“”‘’_\-—]/g, "");
}

function dedupeBooks(books, top250TitleSet) {
  const byDedupe = new Map();

  for (const rawBook of books) {
    const title = String(rawBook.title || "").trim();
    const author = String(rawBook.author_display || "未知作者").trim() || "未知作者";
    if (!title) continue;
    const source = rawBook.source || {
      provider: "unknown",
      work_key: "",
      work_url: "",
      query: ""
    };
    const parsedPages = Number(rawBook.pages);
    const hasPages = Number.isFinite(parsedPages) && parsedPages > 0;
    const normalizedPages = hasPages ? Math.max(40, Math.min(2000, Math.round(parsedPages))) : 0;
    const syntheticPages =
      normalizedPages === 320 && ["douban_hot_repo", "openlibrary"].includes(String(source.provider || ""));
    const pagesEstimated = Boolean(rawBook.pages_estimated) || !hasPages || syntheticPages;

    const normalized = {
      ...rawBook,
      title,
      title_norm: normalizeText(rawBook.title_norm || title),
      author_display: author,
      authors: Array.isArray(rawBook.authors) && rawBook.authors.length > 0 ? rawBook.authors : [author],
      category: CATEGORIES.includes(rawBook.category) ? rawBook.category : "general",
      isbn13: normalizeIsbn13(rawBook.isbn13 || ""),
      pages: syntheticPages ? 0 : normalizedPages,
      pages_estimated: pagesEstimated,
      language: String(rawBook.language || (hasCjk(title) || hasCjk(author) ? "chi" : "und")),
      publisher: String(rawBook.publisher || ""),
      published_year: Number.isFinite(Number(rawBook.published_year)) ? Number(rawBook.published_year) : null,
      source
    };

    const dedupeKey = `${normalized.title_norm}::${normalizeText(author)}`;
    const score = enrichBookScore(normalized, top250TitleSet);
    const existing = byDedupe.get(dedupeKey);
    if (!existing || score > existing.score) {
      byDedupe.set(dedupeKey, { book: normalized, score });
    }
  }

  return [...byDedupe.values()]
    .map((item) => ({ ...item.book, _score: item.score }))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return a.title_norm.localeCompare(b.title_norm, "zh");
    });
}

function buildTargetByCategory() {
  const out = {};
  for (const key of CATEGORIES) {
    out[key] = Math.max(0, CATEGORY_MIN_FLOOR);
  }
  return out;
}

function pickFinalBooks(candidates) {
  const targetByCategory = buildTargetByCategory();
  const selected = [];
  const selectedIds = new Set();

  const buckets = new Map();
  for (const category of CATEGORIES) {
    buckets.set(category, candidates.filter((book) => book.category === category));
  }

  for (const category of CATEGORIES) {
    const list = buckets.get(category) || [];
    const need = Math.min(targetByCategory[category], list.length);
    let taken = 0;
    for (const book of list) {
      if (taken >= need) break;
      if (selectedIds.has(book.book_id)) continue;
      selected.push(book);
      selectedIds.add(book.book_id);
      taken += 1;
    }
  }

  if (selected.length < TARGET_TOTAL) {
    for (const book of candidates) {
      if (selected.length >= TARGET_TOTAL) break;
      if (selectedIds.has(book.book_id)) continue;
      selected.push(book);
      selectedIds.add(book.book_id);
    }
  }

  return selected.slice(0, TARGET_TOTAL);
}

function ensureUniqueBookIds(books) {
  const seen = new Set();
  return books.map((book, index) => {
    let nextId = String(book.book_id || `book-${index + 1}`);
    if (seen.has(nextId)) {
      let suffix = 2;
      while (seen.has(`${nextId}-${suffix}`)) {
        suffix += 1;
      }
      nextId = `${nextId}-${suffix}`;
    }
    seen.add(nextId);
    return {
      ...book,
      book_id: nextId
    };
  });
}

async function fetchDoubanBooks() {
  const treePayload = JSON.parse(await fetchTextWithRetry(GITHUB_TREE_URL, 3));
  const tree = Array.isArray(treePayload.tree) ? treePayload.tree : [];
  const xlsxPaths = tree
    .map((item) => item.path)
    .filter((path) => /^books\/.+\.xlsx$/i.test(path));

  let pointer = 0;
  const output = [];

  async function worker() {
    while (pointer < xlsxPaths.length) {
      const current = pointer;
      pointer += 1;
      const path = xlsxPaths[current];
      const url = `${GITHUB_RAW_PREFIX}${encodeURI(path)}`;
      try {
        const buffer = await fetchBufferWithRetry(url, 3);
        const books = parseDoubanWorkbook(buffer, path);
        output.push(...books);
        console.log(`[douban] ${current + 1}/${xlsxPaths.length} ${path} -> ${books.length}`);
      } catch (error) {
        console.log(`[douban] ${current + 1}/${xlsxPaths.length} ${path} failed: ${error?.message || error}`);
      }
      await sleep(30);
    }
  }

  const runners = [];
  for (let i = 0; i < Math.min(FETCH_CONCURRENCY, xlsxPaths.length); i += 1) {
    runners.push(worker());
  }
  await Promise.all(runners);
  return output;
}

function computeCoverage(books, top250Titles) {
  const top250Set = new Set(top250Titles.map((title) => normalizeHotTitle(title)).filter(Boolean));
  const top250List = [...top250Set];
  const matchedTop250 = new Set();
  let chineseCount = 0;
  const categoryCounts = {};
  const providerCounts = {};

  for (const category of CATEGORIES) {
    categoryCounts[category] = 0;
  }

  for (const book of books) {
    if (hasCjk(book.title) || hasCjk(book.author_display) || String(book.language || "").toLowerCase() === "chi") {
      chineseCount += 1;
    }
    categoryCounts[book.category] = (categoryCounts[book.category] || 0) + 1;
    const provider = String(book.source?.provider || "unknown");
    providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    const normalizedTitle = normalizeHotTitle(book.title);
    if (top250Set.has(normalizedTitle)) {
      matchedTop250.add(normalizedTitle);
      continue;
    }
    for (const seed of top250List) {
      if (normalizedTitle.startsWith(seed) || seed.startsWith(normalizedTitle)) {
        matchedTop250.add(seed);
      }
    }
  }

  return {
    chinese_books: chineseCount,
    chinese_ratio: Number((chineseCount / Math.max(1, books.length)).toFixed(4)),
    top250_seed_total: top250Set.size,
    top250_seed_hits: matchedTop250.size,
    provider_counts: providerCounts,
    category_counts: categoryCounts
  };
}

async function main() {
  const existingBooks = readExistingCatalog();
  console.log(`[base] loaded existing books: ${existingBooks.length}`);

  const [top250CsvBuffer, doubanBooks] = await Promise.all([
    fetchBufferWithRetry(DOUBAN_TOP250_CSV_URL, 3),
    fetchDoubanBooks()
  ]);
  const top250Titles = parseTop250Csv(top250CsvBuffer);
  const top250Set = new Set(top250Titles.map((title) => normalizeHotTitle(title)).filter(Boolean));

  console.log(`[douban] parsed books: ${doubanBooks.length}`);
  console.log(`[seed] top250 titles: ${top250Titles.length}`);

  const combined = [...doubanBooks, ...existingBooks];
  const deduped = dedupeBooks(combined, top250Set);
  const picked = pickFinalBooks(deduped);
  const finalBooks = ensureUniqueBookIds(picked).map((book) => {
    const { _score, _score_meta, ...rest } = book;
    return rest;
  });

  const coverage = computeCoverage(finalBooks, top250Titles);

  const { root, shardsDir } = ensureCatalogDirs();
  const shardDefs = [];
  const byCategory = {};
  for (const category of CATEGORIES) {
    byCategory[category] = [];
  }
  for (const book of finalBooks) {
    byCategory[book.category] = byCategory[book.category] || [];
    byCategory[book.category].push(book);
  }

  for (const category of CATEGORIES) {
    const list = (byCategory[category] || []).sort((a, b) => a.title_norm.localeCompare(b.title_norm, "zh"));
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
    schema: "catalog_index.v3",
    generated_at: new Date().toISOString(),
    source: "Hybrid: DoubanBook30000 + Existing OpenLibrary Snapshot",
    total_books: finalBooks.length,
    per_category_target: CATEGORY_TARGET,
    category_min_floor: CATEGORY_MIN_FLOOR,
    shard_size: SHARD_SIZE,
    shard_count: shardDefs.length,
    category_counts: coverage.category_counts,
    coverage,
    shards: shardDefs
  };

  writeJson(resolve(root, "index.json"), indexPayload);

  console.log("Catalog build complete");
  console.log(`- total_books: ${finalBooks.length}`);
  console.log(`- chinese_books: ${coverage.chinese_books} (${(coverage.chinese_ratio * 100).toFixed(2)}%)`);
  console.log(`- top250_hits: ${coverage.top250_seed_hits}/${coverage.top250_seed_total}`);
  console.log(`- shard_count: ${shardDefs.length}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
