import type { SharedKbLesson, SharedKbRevocation } from "../../src/core/shared-kb";

export interface StoredAttestation {
  id: string;
  lesson_id: string;
  validator_id: string;
  result: "confirmed" | "contradicted" | "not_applicable";
  confidence: number;
  context_tags: string[];
  evidence_type: "observed_success" | "observed_failure" | "static_review";
  upstream_seen: string[];
  created_at: string;
  public_key: string;
  signature: string;
}

export interface BrainStore {
  migrate(): Promise<void>;
  upsertLesson(lesson: SharedKbLesson, meta: { submitted_by: string; received_at: string }): Promise<void>;
  getLesson(id: string): Promise<SharedKbLesson | null>;
  listLessons(): Promise<SharedKbLesson[]>;
  addAttestation(att: StoredAttestation): Promise<void>;
  listAttestations(lessonId: string): Promise<StoredAttestation[]>;
  addRevocation(rev: SharedKbRevocation): Promise<void>;
  listRevocations(): Promise<SharedKbRevocation[]>;
  close(): Promise<void>;
}
