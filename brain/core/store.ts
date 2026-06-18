import type { SharedKbLesson, SharedKbRevocation, SharedKbStatus } from "../../src/core/shared-kb";
import type { SharedKbAttestation } from "../../src/core/shared-kb-attestation";

export type StoredAttestation = SharedKbAttestation;

export interface StoredLesson {
  lesson: SharedKbLesson;
  received_at: string;
}

export interface BrainStore {
  migrate(): Promise<void>;
  upsertLesson(lesson: SharedKbLesson, meta: { submitted_by: string; received_at: string }): Promise<void>;
  getLesson(id: string): Promise<SharedKbLesson | null>;
  listLessons(): Promise<SharedKbLesson[]>;
  listLessonsWithMeta(): Promise<StoredLesson[]>;
  updateLessonStatus(id: string, status: SharedKbStatus): Promise<void>;
  addAttestation(att: StoredAttestation): Promise<void>;
  listAttestations(lessonId: string): Promise<StoredAttestation[]>;
  listAllAttestations(): Promise<StoredAttestation[]>;
  addRevocation(rev: SharedKbRevocation): Promise<void>;
  listRevocations(): Promise<SharedKbRevocation[]>;
  close(): Promise<void>;
}
