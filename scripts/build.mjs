import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");

if (!existsSync(srcDir)) {
  console.error("Missing src directory.");
  process.exit(1);
}

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

mkdirSync(distDir, { recursive: true });
cpSync(srcDir, distDir, { recursive: true });

writeFileSync(
  resolve(distDir, "version.json"),
  JSON.stringify(
    {
      project: "Reader’s Journey",
      builtAt: new Date().toISOString()
    },
    null,
    2
  ),
  "utf-8"
);

console.log("Build completed -> dist/");
