import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fullVerify = process.env.FULL_VERIFY === "1";
const indexPath = resolve(process.cwd(), "src/data/catalog/index.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifySourceLinks(books, sampleSize) {
  const sample = books.slice(0, sampleSize);
  const concurrency = Math.max(1, Number(process.env.VERIFY_CONCURRENCY || 8));
  const acceptedStatus = new Set([200, 301, 302, 303, 307, 308, 401, 403, 405]);
  let failed = 0;
  let pointer = 0;

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function probeUrl(url) {
    const methods = ["HEAD", "GET"];
    for (const method of methods) {
      try {
        const response = await fetch(url, {
          method,
          redirect: "manual",
          headers: method === "GET" ? { Range: "bytes=0-0" } : undefined
        });
        if (acceptedStatus.has(response.status)) {
          return true;
        }
      } catch {
        // try next method
      }
    }
    return false;
  }

  async function worker() {
    while (pointer < sample.length) {
      const index = pointer;
      pointer += 1;
      const book = sample[index];
      const url = book.source?.work_url;
      if (!url) {
        failed += 1;
        continue;
      }
      let ok = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        ok = await probeUrl(url);
        if (ok) break;
        await sleep(180 * (attempt + 1));
      }
      if (!ok) {
        failed += 1;
      }
    }
  }

  if (sample.length === 0) {
    return 0;
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, sample.length) }, () => worker()));
  ensure(failed === 0, `Source link verification failed: ${failed}/${sample.length}`);
  return sample.length;
}

async function main() {
  const indexPayload = readJson(indexPath);
  const shards = Array.isArray(indexPayload.shards) ? indexPayload.shards : [];
  ensure(shards.length > 0, "Catalog index has no shards.");

  let total = 0;
  const allBooks = [];
  const seenBookId = new Set();
  const seenDedupe = new Set();

  for (const shardDef of shards) {
    const shardPath = resolve(process.cwd(), "src", shardDef.path.replace(/^\.\//, ""));
    const shard = readJson(shardPath);
    const books = Array.isArray(shard.books) ? shard.books : [];
    ensure(books.length === Number(shardDef.count), `Shard count mismatch: ${shardDef.id}`);
    total += books.length;

    for (const book of books) {
      ensure(book.book_id, `Missing book_id in ${shardDef.id}`);
      ensure(book.title, `Missing title in ${shardDef.id}`);
      ensure(book.author_display, `Missing author_display in ${shardDef.id}`);
      ensure(book.category, `Missing category in ${shardDef.id}`);
      ensure(book.source?.work_url, `Missing source.work_url in ${shardDef.id}`);
      ensure(!seenBookId.has(book.book_id), `Duplicate book_id: ${book.book_id}`);
      seenBookId.add(book.book_id);

      const dedupeKey = `${String(book.title_norm || "").trim()}::${String(book.author_display || "").toLowerCase().trim()}`;
      if (dedupeKey !== "::") {
        ensure(!seenDedupe.has(dedupeKey), `Duplicate title+author: ${dedupeKey}`);
        seenDedupe.add(dedupeKey);
      }
      allBooks.push(book);
    }
  }

  ensure(total === Number(indexPayload.total_books), "Total count mismatch with index.");
  const sampleSize = fullVerify ? allBooks.length : Number(process.env.VERIFY_SAMPLE_SIZE || 80);
  const checked = await verifySourceLinks(allBooks, sampleSize);

  console.log(
    `Catalog verification passed. total=${total}, shards=${shards.length}, checked_links=${checked}${fullVerify ? " (full)" : " (sample)"}`
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
