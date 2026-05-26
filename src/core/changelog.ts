import { buildReviewModel, type ReviewTimelineItem } from "./review-model";
import { exists, readText, rel, repoPath, writeText } from "./fs";

export interface ChangelogEntry {
  date: string;
  route: string;
  feature: string;
  items: string[];
}

export interface ChangelogResult {
  generated_at: string;
  repo: string;
  since?: string | undefined;
  entries: ChangelogEntry[];
  markdown: string;
}

export interface WriteChangelogResult extends ChangelogResult {
  written: true;
  path: string;
  mode: "created" | "rewritten" | "appended";
}

export class ChangelogExistsError extends Error {
  constructor(path: string) {
    super(`${path} already exists.\nUse --rewrite to replace it.\nUse --write --since YYYY-MM-DD to append filtered entries.`);
    this.name = "ChangelogExistsError";
  }
}

export async function buildChangelog(options: { repo: string; since?: string | undefined }): Promise<ChangelogResult> {
  if (options.since) validateSince(options.since);
  const model = await buildReviewModel({ repo: options.repo });
  const featureLabels = new Map(model.timelineView.features.map((feature) => [feature.route, feature.label]));
  const grouped = new Map<string, ChangelogEntry>();

  for (const item of model.timeline) {
    if (!isChangelogItem(item)) continue;
    const date = changelogDate(item.timestamp);
    if (!date) continue;
    if (options.since && date < options.since) continue;
    const route = item.route || "unknown";
    const key = `${date}\n${route}`;
    const entry = grouped.get(key) ?? {
      date,
      route,
      feature: featureLabels.get(route) || titleFromSlug(route),
      items: [],
    };
    if (!entry.items.includes(item.summary)) entry.items.push(item.summary);
    grouped.set(key, entry);
  }

  const entries = [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date) || a.route.localeCompare(b.route));
  return {
    generated_at: new Date().toISOString(),
    repo: options.repo,
    since: options.since,
    entries,
    markdown: renderChangelog(entries),
  };
}

export async function writeChangelog(options: {
  repo: string;
  file?: string | undefined;
  since?: string | undefined;
  rewrite?: boolean | undefined;
}): Promise<WriteChangelogResult> {
  if (options.rewrite && options.since) throw new Error("Use either --rewrite or --since, not both.");
  const file = options.file || "CHANGELOG.md";
  const path = repoPath(options.repo, file);
  const currentExists = await exists(path);
  const append = Boolean(currentExists && options.since && !options.rewrite);
  if (currentExists && !options.rewrite && !options.since) throw new ChangelogExistsError(file);

  const changelog = await buildChangelog({ repo: options.repo, since: options.since });
  const next = append
    ? `${trimTrailing(await readText(path))}\n\n${trimLeading(changelogAppendBody(changelog.markdown))}`
    : changelog.markdown;
  await writeText(path, next);

  return {
    ...changelog,
    written: true,
    path: rel(options.repo, path),
    mode: append ? "appended" : currentExists ? "rewritten" : "created",
  };
}

function isChangelogItem(item: ReviewTimelineItem): boolean {
  return item.kind === "fact" && stringValue(item.meta.kind) === "implemented";
}

function renderChangelog(entries: ChangelogEntry[]): string {
  const lines = ["# Changelog", ""];
  if (entries.length === 0) {
    lines.push("No changes found.", "");
    return lines.join("\n");
  }

  let currentDate = "";
  for (const entry of entries) {
    if (entry.date !== currentDate) {
      if (currentDate) lines.push("");
      lines.push(`## ${entry.date}`, "");
      currentDate = entry.date;
    }
    lines.push(`### ${entry.feature}`);
    for (const item of entry.items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n");
}

function changelogDate(value: string | undefined): string {
  return value ? value.slice(0, 10) : "";
}

function validateSince(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("--since must use YYYY-MM-DD format.");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function titleFromSlug(value: string): string {
  return value.split(/[-_\s]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || value;
}

function changelogAppendBody(markdown: string): string {
  return markdown.replace(/^# Changelog\r?\n\r?\n/, "");
}

function trimTrailing(value: string): string {
  return value.replace(/\s+$/g, "");
}

function trimLeading(value: string): string {
  return value.replace(/^\s+/g, "");
}
