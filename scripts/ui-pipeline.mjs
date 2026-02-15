import { spawn } from "node:child_process";

const mode = process.argv[2] || "check";

const PIPELINES = {
  check: [
    "npm run lint",
    "npm test",
    "npm run build",
    "npm run test:e2e",
    "npm run visual:check"
  ],
  baseline: [
    "npm run lint",
    "npm test",
    "npm run build",
    "npm run test:e2e",
    "npm run visual:baseline",
    "npm run visual:check"
  ]
};

function runStep(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: "inherit",
      env: process.env
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`[ui-pipeline] failed: "${command}" exited with ${code}`));
    });
  });
}

async function main() {
  const steps = PIPELINES[mode];
  if (!steps) {
    const modes = Object.keys(PIPELINES).join(", ");
    throw new Error(`[ui-pipeline] unknown mode "${mode}", expected one of: ${modes}`);
  }
  console.log(`[ui-pipeline] mode=${mode}`);
  for (const [index, step] of steps.entries()) {
    console.log(`[ui-pipeline] step ${index + 1}/${steps.length}: ${step}`);
    await runStep(step);
  }
  console.log(`[ui-pipeline] mode=${mode} passed`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
