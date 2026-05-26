import { cp, rm } from "node:fs/promises";

await rm("dist/review-ui", { force: true, recursive: true });
await cp("src/core/review-ui", "dist/review-ui", { recursive: true });
