import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTextIfExists, writeText } from "./fs";
import type { CommandIssue } from "./types";

export const sharedKbKinds = ["lesson", "anti_pattern", "decision_pattern"] as const;
export const sharedKbStatuses = ["submitted", "quarantined", "reviewed", "trusted", "rejected", "challenged", "deprecated", "revoked", "superseded"] as const;
export const sharedKbPublishedStatuses = ["reviewed", "trusted", "challenged", "deprecated", "superseded"] as const;

export type SharedKbKind = typeof sharedKbKinds[number];
export type SharedKbStatus = typeof sharedKbStatuses[number];
export type SharedKbConfidence = "low" | "medium" | "high";

export interface SharedKbEvidence {
  source_type: "anonymized_project_pattern" | "community_report" | "maintainer_review";
  count: number;
  has_follow_up_fix?: boolean;
  notes?: string;
}

export interface SharedKbLesson {
  id: string;
  kind: SharedKbKind;
  status: SharedKbStatus;
  title: string;
  problem: string;
  applies_when: string[];
  recommendation: string;
  why: string;
  avoid_when: string[];
  confidence: SharedKbConfidence;
  evidence: SharedKbEvidence;
  tags: string[];
  updated_at: string;
  supersedes?: string[];
}

export interface SharedKbRevocation {
  id: string;
  target: string;
  status: "challenged" | "deprecated" | "revoked" | "superseded";
  reason: string;
  replacement?: string;
  updated_at: string;
}

export interface SharedKbValidationResult {
  ok: boolean;
  errors: CommandIssue[];
  warnings: CommandIssue[];
  lessons: SharedKbLesson[];
  revocations: SharedKbRevocation[];
}

export interface SharedKbManifestFile {
  path: string;
  sha256: string;
  bytes: number;
  records: number;
}

export interface SharedKbManifest {
  version: 1;
  generated_at: string;
  source: "barry-shared-kb";
  counts: {
    lessons: number;
    revoked: number;
  };
  files: SharedKbManifestFile[];
  lessons: string[];
  revoked: string[];
}

export interface SharedKbSearchIndex {
  version: 1;
  generated_at: string;
  items: SharedKbSearchItem[];
}

export interface SharedKbSearchItem {
  id: string;
  kind: SharedKbKind;
  status: SharedKbStatus;
  title: string;
  summary: string;
  tags: string[];
  confidence: SharedKbConfidence;
  updated_at: string;
  text: string;
}

export interface SharedKbSearchResult {
  query: string;
  results: Array<SharedKbSearchItem & { score: number }>;
}

export interface SharedKbManifestSignature {
  algorithm: "ed25519";
  public_key: string;
  signature: string;
  signed_payload_sha256: string;
}

const requiredLessonFields: Array<keyof SharedKbLesson> = [
  "id",
  "kind",
  "status",
  "title",
  "problem",
  "applies_when",
  "recommendation",
  "why",
  "avoid_when",
  "confidence",
  "evidence",
  "tags",
  "updated_at",
];

export function validateSharedKbLesson(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["lesson must be an object"];
  const lesson = value as Partial<SharedKbLesson>;

  for (const field of requiredLessonFields) {
    if (lesson[field] === undefined) errors.push(`missing required field: ${field}`);
  }

  if (lesson.id !== undefined && (!isString(lesson.id) || !/^lesson-[0-9]{8}[A-Za-z0-9-]*$/.test(lesson.id))) errors.push("invalid field: id");
  if (lesson.kind !== undefined && !sharedKbKinds.includes(lesson.kind as SharedKbKind)) errors.push("invalid field: kind");
  if (lesson.status !== undefined && !sharedKbStatuses.includes(lesson.status as SharedKbStatus)) errors.push("invalid field: status");
  for (const field of ["title", "problem", "recommendation", "why", "updated_at"] as const) {
    if (lesson[field] !== undefined && !isNonEmptyString(lesson[field])) errors.push(`invalid field: ${field}`);
  }
  for (const field of ["applies_when", "avoid_when", "tags", "supersedes"] as const) {
    const fieldValue = lesson[field];
    if (fieldValue !== undefined && (!Array.isArray(fieldValue) || fieldValue.some((item) => !isNonEmptyString(item)))) {
      errors.push(`invalid field: ${field}`);
    }
  }
  if (lesson.confidence !== undefined && !["low", "medium", "high"].includes(String(lesson.confidence))) errors.push("invalid field: confidence");
  if (lesson.evidence !== undefined) errors.push(...validateEvidence(lesson.evidence));
  errors.push(...redactionErrors(lesson));
  return errors;
}

export async function validateSharedKbSource({ source }: { source: string }): Promise<SharedKbValidationResult> {
  const errors: CommandIssue[] = [];
  const warnings: CommandIssue[] = [];
  const lessons: SharedKbLesson[] = [];
  const revocations: SharedKbRevocation[] = [];
  const seenLessonIds = new Set<string>();

  for (const file of await jsonlFiles(join(source, "lessons"))) {
    const rows = await readJsonl(join(source, "lessons", file));
    rows.forEach((row, index) => {
      const displayFile = `lessons/${file}`;
      const line = index + 1;
      if (row.trim().length === 0) return;
      try {
        const parsed = JSON.parse(row) as unknown;
        const recordErrors = validateSharedKbLesson(parsed);
        for (const message of recordErrors) errors.push({ file: displayFile, line, message });
        if (recordErrors.length === 0) {
          const lesson = parsed as SharedKbLesson;
          if (seenLessonIds.has(lesson.id)) {
            errors.push({ file: displayFile, line, message: `duplicate lesson id: ${lesson.id}` });
          } else {
            seenLessonIds.add(lesson.id);
            lessons.push(lesson);
          }
        }
      } catch {
        errors.push({ file: displayFile, line, message: "invalid JSON" });
      }
    });
  }

  const revocationRows = await readJsonl(join(source, "revocations.jsonl"));
  revocationRows.forEach((row, index) => {
    const line = index + 1;
    if (row.trim().length === 0) return;
    try {
      const parsed = JSON.parse(row) as unknown;
      const message = validateRevocation(parsed);
      if (message) errors.push({ file: "revocations.jsonl", line, message });
      if (!message) revocations.push(parsed as SharedKbRevocation);
    } catch {
      errors.push({ file: "revocations.jsonl", line, message: "invalid JSON" });
    }
  });

  for (const revocation of revocations) {
    if (!seenLessonIds.has(revocation.target)) warnings.push({ file: "revocations.jsonl", message: `revocation references missing lesson: ${revocation.target}` });
  }

  return { ok: errors.length === 0, errors, warnings, lessons, revocations };
}

export interface SharedKbSnapshotArtifacts {
  lessonRows: string;
  revocationRows: string;
  indexJson: string;
  manifestJson: string;
  manifest: SharedKbManifest;
  publishedLessons: SharedKbLesson[];
}

export function buildSharedKbSnapshotArtifacts(input: {
  lessons: SharedKbLesson[];
  revocations: SharedKbRevocation[];
  generatedAt: string;
}): SharedKbSnapshotArtifacts {
  const revoked = new Set(input.revocations.filter((record) => record.status === "revoked").map((record) => record.target));
  const lessons = input.lessons
    .filter((lesson) => sharedKbPublishedStatuses.includes(lesson.status as typeof sharedKbPublishedStatuses[number]))
    .filter((lesson) => !revoked.has(lesson.id))
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
  const index: SharedKbSearchIndex = {
    version: 1,
    generated_at: input.generatedAt,
    items: lessons.map(searchItemForLesson),
  };
  const lessonRows = `${lessons.map((lesson) => JSON.stringify(lesson)).join("\n")}${lessons.length ? "\n" : ""}`;
  const revocationRows = `${input.revocations.map((record) => JSON.stringify(record)).join("\n")}${input.revocations.length ? "\n" : ""}`;
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;
  const files: SharedKbManifestFile[] = [
    manifestFile("lessons/lessons.jsonl", lessonRows, lessons.length),
    manifestFile("revocations.jsonl", revocationRows, input.revocations.length),
    manifestFile("indexes/search-index.json", indexJson, index.items.length),
  ];
  const manifest: SharedKbManifest = {
    version: 1,
    generated_at: input.generatedAt,
    source: "barry-shared-kb",
    counts: {
      lessons: lessons.length,
      revoked: revoked.size,
    },
    files,
    lessons: lessons.map((lesson) => lesson.id),
    revoked: [...revoked].sort(),
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  return { lessonRows, revocationRows, indexJson, manifestJson, manifest, publishedLessons: lessons };
}

export async function buildSharedKbSnapshot(options: {
  source: string;
  out: string;
  privateKeyPath?: string;
  publicKeyPath?: string;
}): Promise<{ ok: true; out: string; published: number; manifest: SharedKbManifest }> {
  const validation = await validateSharedKbSource({ source: options.source });
  if (!validation.ok) {
    const rendered = validation.errors.map((error) => `${error.file}${error.line ? `:${error.line}` : ""} ${error.message}`).join("\n");
    throw new Error(`Shared KB source is invalid:\n${rendered}`);
  }

  const artifacts = buildSharedKbSnapshotArtifacts({
    lessons: validation.lessons,
    revocations: validation.revocations,
    generatedAt: new Date().toISOString(),
  });

  await writeText(join(options.out, "lessons/lessons.jsonl"), artifacts.lessonRows);
  await writeText(join(options.out, "revocations.jsonl"), artifacts.revocationRows);
  await writeText(join(options.out, "indexes/search-index.json"), artifacts.indexJson);
  await writeText(join(options.out, "manifest.json"), artifacts.manifestJson);
  if (options.privateKeyPath && options.publicKeyPath) {
    await writeManifestSignature({
      manifestPath: join(options.out, "manifest.json"),
      signaturePath: join(options.out, "manifest.sig"),
      privateKeyPath: options.privateKeyPath,
      publicKeyPath: options.publicKeyPath,
    });
  }
  return { ok: true, out: options.out, published: artifacts.publishedLessons.length, manifest: artifacts.manifest };
}

export async function verifySharedKbManifestSignature(options: { manifestPath: string; signaturePath: string }): Promise<boolean> {
  const manifestBytes = await readFile(options.manifestPath);
  const signature = JSON.parse(await readFile(options.signaturePath, "utf8")) as SharedKbManifestSignature;
  if (signature.algorithm !== "ed25519") return false;
  const expectedHash = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;
  if (signature.signed_payload_sha256 !== expectedHash) return false;
  const publicKeyPem = Buffer.from(signature.public_key, "base64").toString("utf8");
  const publicKey = createPublicKey(publicKeyPem);
  return verify(null, manifestBytes, publicKey, Buffer.from(signature.signature, "base64"));
}

export async function searchSharedKb(options: { source: string; query: string; includeReviewed?: boolean }): Promise<SharedKbSearchResult> {
  const index = await loadSearchIndex(options.source);
  const queryTokens = tokens(options.query);
  const allowedStatuses = options.includeReviewed ? new Set<SharedKbStatus>(["trusted", "reviewed"]) : new Set<SharedKbStatus>(["trusted"]);
  const results = index.items
    .filter((item) => allowedStatuses.has(item.status))
    .map((item) => ({ ...item, score: scoreText(item.text, queryTokens) }))
    .filter((item) => item.score === queryTokens.length)
    .sort((a, b) => b.score - a.score || b.confidence.localeCompare(a.confidence) || a.id.localeCompare(b.id));
  return { query: options.query, results };
}

function validateEvidence(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return ["invalid field: evidence"];
  const evidence = value as Partial<SharedKbEvidence>;
  const errors: string[] = [];
  if (!["anonymized_project_pattern", "community_report", "maintainer_review"].includes(String(evidence.source_type))) errors.push("invalid field: evidence.source_type");
  if (!Number.isInteger(evidence.count) || Number(evidence.count) < 1) errors.push("invalid field: evidence.count");
  if (evidence.has_follow_up_fix !== undefined && typeof evidence.has_follow_up_fix !== "boolean") errors.push("invalid field: evidence.has_follow_up_fix");
  if (evidence.notes !== undefined && !isNonEmptyString(evidence.notes)) errors.push("invalid field: evidence.notes");
  return errors;
}

async function loadSearchIndex(source: string): Promise<SharedKbSearchIndex> {
  if (/^https?:\/\//.test(source)) {
    const url = source.endsWith("/") ? `${source}indexes/search-index.json` : `${source}/indexes/search-index.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch shared KB index: ${response.status} ${response.statusText}`);
    return JSON.parse(await response.text()) as SharedKbSearchIndex;
  }
  return JSON.parse(await readTextIfExists(join(source, "indexes/search-index.json"))) as SharedKbSearchIndex;
}

export function searchItemForLesson(lesson: SharedKbLesson): SharedKbSearchItem {
  const summary = `${lesson.problem} ${lesson.recommendation}`;
  return {
    id: lesson.id,
    kind: lesson.kind,
    status: lesson.status,
    title: lesson.title,
    summary,
    tags: lesson.tags,
    confidence: lesson.confidence,
    updated_at: lesson.updated_at,
    text: [
      lesson.id,
      lesson.kind,
      lesson.status,
      lesson.title,
      lesson.problem,
      lesson.applies_when.join(" "),
      lesson.recommendation,
      lesson.why,
      lesson.avoid_when.join(" "),
      lesson.confidence,
      lesson.tags.join(" "),
    ].join(" ").toLowerCase(),
  };
}

function manifestFile(path: string, content: string, records: number): SharedKbManifestFile {
  return {
    path,
    sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    bytes: Buffer.byteLength(content),
    records,
  };
}

async function writeManifestSignature(options: {
  manifestPath: string;
  signaturePath: string;
  privateKeyPath: string;
  publicKeyPath: string;
}): Promise<void> {
  const manifestBytes = await readFile(options.manifestPath);
  const privateKey = createPrivateKey(await readFile(options.privateKeyPath, "utf8"));
  const publicKeyPem = await readFile(options.publicKeyPath, "utf8");
  const signature: SharedKbManifestSignature = {
    algorithm: "ed25519",
    public_key: Buffer.from(publicKeyPem).toString("base64"),
    signature: sign(null, manifestBytes, privateKey).toString("base64"),
    signed_payload_sha256: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`,
  };
  await writeText(options.signaturePath, `${JSON.stringify(signature, null, 2)}\n`);
}

export function tokens(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)));
}

export function scoreText(text: string, queryTokens: string[]): number {
  return queryTokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

export function signManifestJson(manifestJson: string, privateKeyPem: string, publicKeyPem: string): SharedKbManifestSignature {
  const bytes = Buffer.from(manifestJson);
  return {
    algorithm: "ed25519",
    public_key: Buffer.from(publicKeyPem).toString("base64"),
    signature: sign(null, bytes, createPrivateKey(privateKeyPem)).toString("base64"),
    signed_payload_sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

function validateRevocation(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "revocation must be an object";
  const record = value as Partial<SharedKbRevocation>;
  for (const field of ["id", "target", "status", "reason", "updated_at"] as const) {
    if (!isNonEmptyString(record[field])) return `invalid field: ${field}`;
  }
  const status = record.status;
  if (!isNonEmptyString(status) || !["challenged", "deprecated", "revoked", "superseded"].includes(status)) return "invalid field: status";
  if (record.replacement !== undefined && !isNonEmptyString(record.replacement)) return "invalid field: replacement";
  return null;
}

function redactionErrors(lesson: Partial<SharedKbLesson>): string[] {
  const errors: string[] = [];
  const fields: Array<keyof SharedKbLesson> = ["title", "problem", "recommendation", "why"];
  for (const field of fields) {
    const value = lesson[field];
    if (!isString(value)) continue;
    const path = value.match(/\b(?:src|app|lib|packages|internal|docs|tests)\/[A-Za-z0-9_./-]+\b/);
    if (path) errors.push(`field ${field} contains revealing file path: ${path[0]}`);
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) errors.push(`field ${field} contains email address`);
    if (/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|AKIA[A-Za-z0-9]{8,})\b/.test(value)) errors.push(`field ${field} contains secret-looking token`);
    if (/https?:\/\/(?!example\.com\b)[^\s]+/.test(value)) errors.push(`field ${field} contains non-example URL`);
  }
  return errors;
}

async function jsonlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonl(path: string): Promise<string[]> {
  return (await readTextIfExists(path)).split(/\r?\n/);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
