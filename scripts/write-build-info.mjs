import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

let sha = "unknown";
try {
  sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  // ignore
}

const info = {
  commit: sha,
  builtAt: new Date().toISOString(),
};

mkdirSync("src/worker", { recursive: true });
writeFileSync(
  "src/worker/build-info.ts",
  `export const BUILD_INFO = ${JSON.stringify(info, null, 2)} as const;\n`,
);
console.log("Wrote build-info", info);
