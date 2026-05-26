import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export function reviewUiDir(): string {
  const candidates = [
    join(currentDir, "review-ui"),
    join(currentDir, "core/review-ui"),
    join(process.cwd(), "src/core/review-ui"),
    join(process.cwd(), "dist/review-ui"),
  ];
  const found = candidates.find((candidate) => existsSync(join(candidate, "index.html")));
  if (!found) throw new Error("Barry Cache review UI assets were not found.");
  return found;
}

export function readReviewAsset(path: string): string {
  return readFileSync(join(reviewUiDir(), path), "utf8");
}
