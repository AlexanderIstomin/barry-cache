import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { exists, readText, rel, repoPath, writeText } from "./fs";
import type { CommandIssue } from "./types";

export const adrStatuses = ["active", "superseded", "deprecated"] as const;
export type AdrStatus = typeof adrStatuses[number];

export interface AdrRecord {
  id: string;
  title: string;
  status: AdrStatus;
  date: string;
  supersedes: string[];
  tags: string[];
  path: string;
  content: string;
}

export interface AdrCreateOptions {
  repo: string;
  title: string;
  status?: AdrStatus;
  supersedes?: string[];
  tags?: string[];
  date?: string;
}

export interface AdrCatalog {
  adrs: AdrRecord[];
  errors: CommandIssue[];
}

export async function createAdr(options: AdrCreateOptions): Promise<AdrRecord> {
  const title = options.title.trim();
  if (title.length === 0) throw new Error("ADR title is required");
  const status = options.status ?? "active";
  if (!isAdrStatus(status)) throw new Error(`invalid ADR status: ${status}`);

  const existing = await listAdrFiles(options.repo);
  const id = nextAdrId(existing);
  const path = `docs/context/adrs/${id}-${slug(title)}.md`;
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const content = formatAdr({
    id,
    title,
    status,
    date,
    supersedes: options.supersedes ?? [],
    tags: options.tags ?? [],
  });

  await writeText(repoPath(options.repo, path), content);
  return {
    id,
    title,
    status,
    date,
    supersedes: options.supersedes ?? [],
    tags: options.tags ?? [],
    path,
    content,
  };
}

export async function listAdrs({ repo }: { repo: string }): Promise<AdrRecord[]> {
  const catalog = await readAdrCatalog(repo);
  return catalog.adrs;
}

export async function readAdrCatalog(repo: string): Promise<AdrCatalog> {
  const files = await listAdrFiles(repo);
  const adrs: AdrRecord[] = [];
  const errors: CommandIssue[] = [];

  for (const path of files) {
    const absolute = repoPath(repo, path);
    const content = await readText(absolute);
    const parsed = parseAdr(repo, path, content);
    if (parsed.record) adrs.push(parsed.record);
    errors.push(...parsed.errors);
  }

  adrs.sort((a, b) => a.id.localeCompare(b.id));
  errors.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { adrs, errors };
}

export function linkedAdrsForSources(sources: string[], adrs: AdrRecord[]): AdrRecord[] {
  const linked = new Map<string, AdrRecord>();
  for (const source of sources) {
    for (const adr of adrs) {
      if (adrMatchesSource(adr, source)) linked.set(adr.id, adr);
    }
  }
  return [...linked.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function adrMatchesSource(adr: AdrRecord, source: string): boolean {
  const normalized = source.split("#")[0] ?? source;
  const filename = basename(adr.path);
  return normalized === adr.id ||
    normalized === adr.path ||
    normalized === filename ||
    normalized.endsWith(`/${filename}`);
}

export function looksLikeAdrSource(source: string): boolean {
  const normalized = source.split("#")[0] ?? source;
  return /^ADR-\d{4}\b/.test(normalized) ||
    /(?:^|\/)ADR-\d{4}-.+\.md$/.test(normalized) ||
    normalized.startsWith("docs/context/adrs/");
}

export function adrToText(adr: AdrRecord): string {
  return [
    adr.id,
    adr.title,
    adr.status,
    adr.date,
    ...adr.tags,
    ...adr.supersedes,
    adr.content,
  ].join(" ");
}

async function listAdrFiles(repo: string): Promise<string[]> {
  const dir = repoPath(repo, "docs/context/adrs");
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^ADR-\d{4}-.+\.md$/.test(entry.name))
    .map((entry) => rel(repo, join(dir, entry.name)))
    .sort();
}

function parseAdr(repo: string, path: string, content: string): { record?: AdrRecord; errors: CommandIssue[] } {
  const errors: CommandIssue[] = [];
  const frontmatter = parseFrontmatter(path, content);
  if (!frontmatter.data) return { errors: [frontmatter.error] };

  const id = stringField(frontmatter.data, "id");
  const title = stringField(frontmatter.data, "title");
  const status = stringField(frontmatter.data, "status");
  const date = stringField(frontmatter.data, "date");
  const supersedes = arrayField(frontmatter.data, "supersedes");
  const tags = arrayField(frontmatter.data, "tags");

  if (!id) errors.push({ file: path, message: "missing ADR field: id" });
  if (!title) errors.push({ file: path, message: "missing ADR field: title" });
  if (!status) errors.push({ file: path, message: "missing ADR field: status" });
  if (!date) errors.push({ file: path, message: "missing ADR field: date" });
  if (id && !/^ADR-\d{4}$/.test(id)) errors.push({ file: path, message: `invalid ADR id: ${id}` });
  if (id && !basename(path).startsWith(`${id}-`)) errors.push({ file: path, message: "ADR id does not match filename" });
  if (status && !isAdrStatus(status)) errors.push({ file: path, message: `invalid ADR status: ${status}` });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push({ file: path, message: `invalid ADR date: ${date}` });
  if (errors.length > 0 || !id || !title || !status || !date || !isAdrStatus(status)) return { errors };

  return {
    record: {
      id,
      title,
      status,
      date,
      supersedes,
      tags,
      path: rel(repo, repoPath(repo, path)),
      content,
    },
    errors,
  };
}

function parseFrontmatter(path: string, content: string): { data?: Map<string, string>; error: CommandIssue } {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return { error: { file: path, line: 1, message: "ADR frontmatter is missing" } };
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) return { error: { file: path, line: 1, message: "ADR frontmatter is not closed" } };

  const data = new Map<string, string>();
  for (let index = 1; index < end; index++) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match || !match[1]) {
      return { error: { file: path, line: index + 1, message: "invalid ADR frontmatter line" } };
    }
    data.set(match[1], match[2] ?? "");
  }
  return { data, error: { file: path, message: "" } };
}

function stringField(data: Map<string, string>, key: string): string | undefined {
  const value = data.get(key)?.trim();
  if (!value) return undefined;
  return unquote(value);
}

function arrayField(data: Map<string, string>, key: string): string[] {
  const value = data.get(key)?.trim();
  if (!value || value === "[]") return [];
  const bracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return bracketed.split(",").map((item) => unquote(item.trim())).filter(Boolean);
}

function nextAdrId(files: string[]): string {
  const next = files.reduce((max, path) => {
    const match = basename(path).match(/^ADR-(\d{4})-/);
    return match?.[1] ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;
  return `ADR-${String(next).padStart(4, "0")}`;
}

function formatAdr(options: {
  id: string;
  title: string;
  status: AdrStatus;
  date: string;
  supersedes: string[];
  tags: string[];
}): string {
  return `---
id: ${options.id}
title: ${options.title}
status: ${options.status}
date: ${options.date}
supersedes: ${formatArray(options.supersedes)}
tags: ${formatArray(options.tags)}
---

# ${options.id}: ${options.title}

## Context

Describe the forces, constraints, and history that make this decision necessary.

## Decision

Describe the chosen direction.

## Consequences

Describe the tradeoffs, follow-up work, and facts that should reference this ADR.
`;
}

function formatArray(values: string[]): string {
  return values.length === 0 ? "[]" : `[${values.join(", ")}]`;
}

function isAdrStatus(value: string): value is AdrStatus {
  return (adrStatuses as readonly string[]).includes(value);
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "decision";
}

function unquote(input: string): string {
  return input.replace(/^['"]|['"]$/g, "");
}
