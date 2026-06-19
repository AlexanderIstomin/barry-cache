import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { readText, repoPath, writeText } from "./fs";
import { validateSharedKbLesson, type SharedKbConfidence, type SharedKbKind, type SharedKbLesson } from "./shared-kb";
import { stableStringify } from "./shared-kb-intake";

export interface LessonProposalInput {
  title: string;
  problem: string;
  applies_when: string[];
  recommendation: string;
  why: string;
  avoid_when: string[];
  tags: string[];
  confidence: SharedKbConfidence;
}

export function buildLessonProposal(input: LessonProposalInput, opts: { now: string; kind?: SharedKbKind }): SharedKbLesson {
  const day = opts.now.slice(0, 10).replaceAll("-", "");
  const hash = createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 8);
  const lesson: SharedKbLesson = {
    id: `lesson-${day}-${hash}`,
    kind: opts.kind ?? "lesson",
    status: "submitted",
    title: input.title,
    problem: input.problem,
    applies_when: input.applies_when,
    recommendation: input.recommendation,
    why: input.why,
    avoid_when: input.avoid_when,
    confidence: input.confidence,
    evidence: { source_type: "community_report", count: 1 },
    tags: input.tags,
    updated_at: opts.now,
  };
  const errors = validateSharedKbLesson(lesson);
  if (errors.length > 0) throw new Error(`Invalid lesson proposal:\n${errors.join("\n")}`);
  return lesson;
}

export function outboxDir(repo: string): string {
  return repoPath(repo, ".barry-cache/shared-kb/outbox");
}

export async function writeProposalToOutbox(opts: { repo: string; lesson: SharedKbLesson }): Promise<string> {
  const path = repoPath(outboxDir(opts.repo), `${opts.lesson.id}.json`);
  await writeText(path, `${JSON.stringify(opts.lesson, null, 2)}\n`);
  return path;
}

export async function removeOutboxLesson(opts: { repo: string; id: string }): Promise<void> {
  // The id comes from outbox file content (untrusted), and this is a force-delete: never let a
  // crafted id with path separators or ".." escape the outbox directory.
  if (!/^[A-Za-z0-9._-]+$/.test(opts.id) || opts.id.includes("..")) return;
  await rm(repoPath(outboxDir(opts.repo), `${opts.id}.json`), { force: true });
}

export async function listOutboxLessons(opts: { repo: string }): Promise<SharedKbLesson[]> {
  let files: string[];
  try {
    files = (await readdir(outboxDir(opts.repo))).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const lessons: SharedKbLesson[] = [];
  for (const file of files) {
    try {
      lessons.push(JSON.parse(await readText(repoPath(outboxDir(opts.repo), file))) as SharedKbLesson);
    } catch {
      // Skip a malformed outbox file rather than blocking every other queued lesson at contribute.
    }
  }
  return lessons;
}
