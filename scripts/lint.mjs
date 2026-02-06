import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());
const scanTargets = ["src", "scripts", "test"];
const textExtensions = new Set([".mjs", ".js", ".css", ".html", ".md", ".webmanifest"]);
const jsExtensions = new Set([".mjs", ".js"]);

const failures = [];

function walk(path, files = []) {
  const entries = readdirSync(path);
  for (const entry of entries) {
    const fullPath = join(path, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

for (const target of scanTargets) {
  const folder = resolve(root, target);
  try {
    const files = walk(folder);
    for (const file of files) {
      const ext = extname(file);
      if (!textExtensions.has(ext)) {
        continue;
      }

      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (line.includes("\t")) {
          failures.push(`${file}:${index + 1} uses tab indentation`);
        }
        if (/\s+$/.test(line)) {
          failures.push(`${file}:${index + 1} has trailing whitespace`);
        }
      });

      if (jsExtensions.has(ext)) {
        const checked = spawnSync(process.execPath, ["--check", file], {
          encoding: "utf-8"
        });
        if (checked.status !== 0) {
          failures.push(`${file}: syntax error\n${checked.stderr || checked.stdout}`);
        }
      }
    }
  } catch (error) {
    failures.push(`Cannot scan ${folder}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error("Lint failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Lint passed.");
