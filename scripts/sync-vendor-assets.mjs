import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const targets = [
  {
    from: resolve(root, "node_modules/howler/dist/howler.min.js"),
    to: resolve(root, "src/assets/vendor/howler.min.js")
  },
  {
    from: resolve(root, "node_modules/lottie-web/build/player/lottie.min.js"),
    to: resolve(root, "src/assets/vendor/lottie.min.js")
  },
  {
    from: resolve(root, "node_modules/phaser/dist/phaser.min.js"),
    to: resolve(root, "src/assets/vendor/phaser.min.js")
  }
];

for (const item of targets) {
  if (!existsSync(item.from)) {
    console.error(`Missing vendor source: ${item.from}`);
    process.exit(1);
  }
  mkdirSync(resolve(item.to, ".."), { recursive: true });
  copyFileSync(item.from, item.to);
}

console.log("Vendor assets synced to src/assets/vendor");
