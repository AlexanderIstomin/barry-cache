import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readAdrCatalog, type AdrRecord } from "./adr";
import { listDirs, readTextIfExists, rel, repoPath, writeText } from "./fs";
import type { FactRecord, FeaturePack } from "./types";
import { validateFact } from "./validate";

const cacheVersion = 1;
const contextCachePath = ".context-cache/context-index.json";

interface ContextSnapshot {
  features: FeaturePack[];
  adrs: AdrRecord[];
}

interface CachedFeaturePack extends Omit<FeaturePack, "dir"> {
  dir: string;
}

interface ExistingManifestEntry {
  path: string;
  kind: "file" | "dir";
  exists: true;
  mtimeMs: number;
  size: number;
}

interface MissingManifestEntry {
  path: string;
  kind: "file" | "dir";
  exists: false;
}

type ManifestEntry = ExistingManifestEntry | MissingManifestEntry;

interface ContextCacheFile {
  version: typeof cacheVersion;
  generated_at: string;
  manifest: ManifestEntry[];
  features: CachedFeaturePack[];
  adrs: AdrRecord[];
}

export async function readContextSnapshot(repo: string): Promise<ContextSnapshot> {
  const cached = await readFreshContextCache(repo);
  if (cached) return hydrateSnapshot(repo, cached);

  const snapshot = await readContextSnapshotFromDisk(repo);
  await writeContextCache(repo, snapshot);
  return snapshot;
}

async function readFreshContextCache(repo: string): Promise<ContextCacheFile | null> {
  try {
    const parsed = JSON.parse(await readTextIfExists(repoPath(repo, contextCachePath))) as unknown;
    if (!isContextCacheFile(parsed)) return null;
    return (await manifestIsFresh(repo, parsed.manifest)) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeContextCache(repo: string, snapshot: ContextSnapshot): Promise<void> {
  const cache: ContextCacheFile = {
    version: cacheVersion,
    generated_at: new Date().toISOString(),
    manifest: await buildManifest(repo, snapshot),
    features: snapshot.features.map((feature) => ({
      ...feature,
      dir: rel(repo, feature.dir),
    })),
    adrs: snapshot.adrs,
  };

  try {
    await writeText(repoPath(repo, contextCachePath), `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // The cache is disposable; read commands should still work if it cannot be written.
  }
}

async function readContextSnapshotFromDisk(repo: string): Promise<ContextSnapshot> {
  return {
    features: await readFeaturePacksFromDisk(repo),
    adrs: (await readAdrCatalog(repo)).adrs,
  };
}

async function readFeaturePacksFromDisk(repo: string): Promise<FeaturePack[]> {
  const root = repoPath(repo, "docs/context/features");
  const slugs = await listDirs(root);
  const features: FeaturePack[] = [];
  for (const slug of slugs) {
    const dir = join(root, slug);
    features.push({
      slug,
      dir,
      readme: await readTextIfExists(join(dir, "README.md")),
      idmap: await readTextIfExists(join(dir, "IDMAP.md")),
      graph: await readTextIfExists(join(dir, "KG.adj")),
      facts: await readFacts(join(dir, "FACTS.jsonl")),
    });
  }
  return features;
}

async function readFacts(path: string): Promise<FactRecord[]> {
  const rows = (await readTextIfExists(path)).split(/\r?\n/);
  const facts: FactRecord[] = [];
  for (const row of rows) {
    if (row.trim().length === 0) continue;
    const parsed = JSON.parse(row) as unknown;
    if (validateFact(parsed) === null) facts.push(parsed as FactRecord);
  }
  return facts;
}

async function buildManifest(repo: string, snapshot: ContextSnapshot): Promise<ManifestEntry[]> {
  const paths = new Map<string, "file" | "dir">();
  paths.set("docs/context/features", "dir");
  paths.set("docs/context/adrs", "dir");
  paths.set("docs/context/workspaces.json", "file");
  paths.set("docs/context/schema/workspace.schema.json", "file");

  for (const feature of snapshot.features) {
    const dir = rel(repo, feature.dir);
    paths.set(dir, "dir");
    paths.set(`${dir}/README.md`, "file");
    paths.set(`${dir}/IDMAP.md`, "file");
    paths.set(`${dir}/KG.adj`, "file");
    paths.set(`${dir}/FACTS.jsonl`, "file");
  }

  for (const adr of snapshot.adrs) {
    paths.set(adr.path, "file");
  }

  const entries = [...paths.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return await Promise.all(entries.map(([path, kind]) => statManifestEntry(repo, path, kind)));
}

async function manifestIsFresh(repo: string, manifest: ManifestEntry[]): Promise<boolean> {
  for (const entry of manifest) {
    const current = await statManifestEntry(repo, entry.path, entry.kind);
    if (!sameManifestEntry(entry, current)) return false;
  }
  return true;
}

async function statManifestEntry(repo: string, path: string, kind: "file" | "dir"): Promise<ManifestEntry> {
  try {
    const value = await stat(repoPath(repo, path));
    const matchesKind = kind === "dir" ? value.isDirectory() : value.isFile();
    if (!matchesKind) return { path, kind, exists: false };
    return {
      path,
      kind,
      exists: true,
      mtimeMs: value.mtimeMs,
      size: value.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path, kind, exists: false };
    throw error;
  }
}

function sameManifestEntry(left: ManifestEntry, right: ManifestEntry): boolean {
  if (left.path !== right.path || left.kind !== right.kind || left.exists !== right.exists) return false;
  if (!left.exists || !right.exists) return true;
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function hydrateSnapshot(repo: string, cache: ContextCacheFile): ContextSnapshot {
  return {
    features: cache.features.map((feature) => ({
      ...feature,
      dir: repoPath(repo, feature.dir),
    })),
    adrs: cache.adrs,
  };
}

function isContextCacheFile(value: unknown): value is ContextCacheFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ContextCacheFile>;
  return candidate.version === cacheVersion &&
    Array.isArray(candidate.manifest) &&
    Array.isArray(candidate.features) &&
    Array.isArray(candidate.adrs);
}
