import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function toModuleConst(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)};\n`;
}

function buildRulesModule() {
  const categoryProfiles = readJson(resolve(process.cwd(), "src/data/category_profiles.json"));
  const rewardPolicies = readJson(resolve(process.cwd(), "src/data/reward_policies.json"));
  const skillRules = readJson(resolve(process.cwd(), "src/data/skill_rules.json"));
  const achievementRules = readJson(resolve(process.cwd(), "src/data/achievement_rules.json"));

  const outputPath = resolve(process.cwd(), "src/lib/tables/rules.mjs");
  const contents = [
    toModuleConst("CATEGORY_PROFILES_TABLE", categoryProfiles.profiles),
    toModuleConst("REWARD_POLICIES", rewardPolicies),
    toModuleConst(
      "SKILL_RULES_TABLE",
      skillRules.rules.map((item) => ({
        id: item.skill_id,
        name: item.name,
        description: item.description,
        condition: item.condition,
        effect: item.effect
      }))
    ),
    toModuleConst("ACHIEVEMENT_RULES_TABLE", achievementRules.rules)
  ].join("\n");

  writeFileSync(outputPath, contents, "utf-8");
  return outputPath;
}

function buildStarterModule() {
  const outputPath = resolve(process.cwd(), "src/lib/tables/starter-books.mjs");
  const starterBooks = [
    {
      id: "starter-prince",
      title: "The Prince",
      author: "Niccolo Machiavelli",
      category: "strategy",
      pages: 176,
      isbn: "9781598181630",
      source: {
        provider: "openlibrary",
        work_url: "https://openlibrary.org/works/OL1089297W"
      }
    },
    {
      id: "starter-logic",
      title: "The power of logical thinking",
      author: "Marilyn Vos Savant",
      category: "logic",
      pages: 176,
      isbn: "9780312139858",
      source: {
        provider: "openlibrary",
        work_url: "https://openlibrary.org/works/OL3473348W"
      }
    },
    {
      id: "starter-psychology",
      title: "Educational psychology",
      author: "Anita Woolfolk Hoy",
      category: "psychology",
      pages: 640,
      isbn: "9780134324524",
      source: {
        provider: "openlibrary",
        work_url: "https://openlibrary.org/works/OL495347W"
      }
    }
  ];
  writeFileSync(outputPath, toModuleConst("STARTER_BOOKS", starterBooks), "utf-8");
  return outputPath;
}

function main() {
  const dir = resolve(process.cwd(), "src/lib/tables");
  mkdirSync(dir, { recursive: true });
  const built = [buildRulesModule(), buildStarterModule()];
  console.log("Generated modules:");
  built.forEach((path) => console.log(`- ${path}`));
}

main();
