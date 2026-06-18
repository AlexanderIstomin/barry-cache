import {
  buildSharedKbSnapshotArtifacts,
  scoreText,
  searchItemForLesson,
  signManifestJson,
  tokens,
  validateSharedKbLesson,
  type SharedKbLesson,
  type SharedKbManifestSignature,
  type SharedKbSnapshotArtifacts,
  type SharedKbStatus,
} from "../../src/core/shared-kb";
import { deriveValidatorId, verifyIntakeBatchSignature, type IntakeBatch, type IntakeItem } from "../../src/core/shared-kb-intake";
import type { BrainIdentity } from "./identity";
import type { BrainStore, StoredAttestation } from "./store";

export type { IntakeBatch, IntakeItem } from "../../src/core/shared-kb-intake";

export type TrustPolicy = "company" | "global";

export interface IntakeResult {
  accepted: number;
  rejected: Array<{ index: number; reason: string }>;
}

export interface SearchHit {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  confidence: string;
  score: number;
}

export interface Brain {
  intake(batch: IntakeBatch): Promise<IntakeResult>;
  search(query: string, opts?: { includeReviewed?: boolean; limit?: number }): Promise<SearchHit[]>;
  getLesson(id: string): Promise<{ lesson: SharedKbLesson; attestations: number } | null>;
  attest(att: StoredAttestation): Promise<{ ok: boolean; reason?: string }>;
  snapshot(): Promise<SharedKbSnapshotArtifacts & { signature: SharedKbManifestSignature }>;
}

export function validateAttestation(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "attestation must be an object";
  const a = value as Record<string, unknown>;
  for (const f of ["id", "lesson_id", "validator_id", "created_at", "public_key", "signature"]) {
    if (typeof a[f] !== "string" || (a[f] as string).trim() === "") return `invalid field: ${f}`;
  }
  if (!["confirmed", "contradicted", "not_applicable"].includes(String(a.result))) return "invalid field: result";
  if (!["observed_success", "observed_failure", "static_review"].includes(String(a.evidence_type))) return "invalid field: evidence_type";
  if (typeof a.confidence !== "number" || a.confidence < 0.01 || a.confidence > 0.99) return "invalid field: confidence";
  if (!Array.isArray(a.context_tags) || (a.context_tags as unknown[]).some((t) => typeof t !== "string")) return "invalid field: context_tags";
  if (!Array.isArray(a.upstream_seen) || (a.upstream_seen as unknown[]).some((t) => typeof t !== "string")) return "invalid field: upstream_seen";
  return null;
}

export function createBrain(opts: { store: BrainStore; identity: BrainIdentity; trustPolicy: TrustPolicy; now: () => string }): Brain {
  const { store, identity, trustPolicy, now } = opts;
  const acceptedLessonStatus: SharedKbStatus = trustPolicy === "company" ? "trusted" : "reviewed";

  return {
    async intake(batch) {
      if (!verifyIntakeBatchSignature(batch)) throw new Error("Shared KB intake batch signature did not verify");
      // Derive the validator id from the verified key; never trust a client-claimed id.
      const validatorId = deriveValidatorId(batch.public_key);
      if (batch.validator_id !== validatorId) {
        throw new Error(`Shared KB intake validator_id does not match its public key (claimed ${batch.validator_id})`);
      }
      const rejected: IntakeResult["rejected"] = [];
      let accepted = 0;
      for (let index = 0; index < batch.items.length; index++) {
        const item = batch.items[index]!;
        if (item.type === "lesson") {
          const errors = validateSharedKbLesson(item.record);
          if (errors.length > 0) {
            rejected.push({ index, reason: errors[0]! });
            continue;
          }
          const lesson = { ...(item.record as SharedKbLesson), status: acceptedLessonStatus };
          await store.upsertLesson(lesson, { submitted_by: validatorId, received_at: now() });
          accepted++;
        } else if (item.type === "attestation") {
          const error = validateAttestation(item.record);
          if (error) {
            rejected.push({ index, reason: error });
            continue;
          }
          await store.addAttestation(item.record as StoredAttestation);
          accepted++;
        } else {
          rejected.push({ index, reason: `unknown item type: ${String((item as { type: unknown }).type)}` });
        }
      }
      return { accepted, rejected };
    },

    async search(query, searchOpts) {
      const queryTokens = tokens(query);
      if (queryTokens.length === 0) return [];
      const allowed = new Set<SharedKbStatus>(["trusted"]);
      if (searchOpts?.includeReviewed) allowed.add("reviewed");
      const revoked = new Set((await store.listRevocations()).filter((r) => r.status === "revoked").map((r) => r.target));
      const items = (await store.listLessons())
        .filter((lesson) => !revoked.has(lesson.id))
        .map(searchItemForLesson)
        .filter((item) => allowed.has(item.status));
      return items
        .map((item) => ({ item, score: scoreText(item.text, queryTokens) }))
        .filter(({ score }) => score === queryTokens.length)
        .sort((a, b) => b.score - a.score || b.item.confidence.localeCompare(a.item.confidence) || a.item.id.localeCompare(b.item.id))
        .slice(0, searchOpts?.limit ?? 5)
        .map(({ item, score }) => ({ id: item.id, title: item.title, summary: item.summary, tags: item.tags, status: item.status, confidence: item.confidence, score }));
    },

    async getLesson(id) {
      const lesson = await store.getLesson(id);
      if (!lesson) return null;
      const attestations = (await store.listAttestations(id)).length;
      return { lesson, attestations };
    },

    async attest(att) {
      const error = validateAttestation(att);
      if (error) return { ok: false, reason: error };
      if (!(await store.getLesson(att.lesson_id))) return { ok: false, reason: "unknown lesson" };
      await store.addAttestation(att);
      return { ok: true };
    },

    async snapshot() {
      const artifacts = buildSharedKbSnapshotArtifacts({
        lessons: await store.listLessons(),
        revocations: await store.listRevocations(),
        generatedAt: now(),
      });
      const signature = signManifestJson(artifacts.manifestJson, identity.private_key_pem, identity.public_key_pem);
      return { ...artifacts, signature };
    },
  };
}
