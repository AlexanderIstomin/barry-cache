import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function readText(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

export async function readTextIfExists(path: string): Promise<string> {
  return (await exists(path)) ? await readText(path) : "";
}

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

export async function writeIfChanged(path: string, content: string, dryRun = false): Promise<"written" | "updated" | "skipped"> {
  const currentExists = await exists(path);
  if (currentExists && (await readText(path)) === content) return "skipped";
  if (!dryRun) await writeText(path, content);
  return currentExists ? "updated" : "written";
}

export async function listDirs(path: string): Promise<string[]> {
  if (!(await exists(path))) return [];
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function rel(repo: string, path: string): string {
  return relative(repo, path).replaceAll("\\", "/");
}

export function repoPath(repo: string, ...parts: string[]): string {
  return join(repo, ...parts);
}
