import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function withTempRepo<T>(fn: (repo: string) => Promise<T>): Promise<T> {
  const repo = await mkdtemp(join(tmpdir(), "barry-cache-test-"));
  try {
    return await fn(repo);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}
