import { Database } from "bun:sqlite";
import type { SharedKbLesson, SharedKbRevocation } from "../../src/core/shared-kb";
import type { BrainStore, StoredAttestation } from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL,
  submitted_by TEXT NOT NULL, received_at TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, validator_id TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS attestations_lesson ON attestations(lesson_id);
CREATE TABLE IF NOT EXISTS revocations (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, doc TEXT NOT NULL
);
`;

export function createSqliteStore(path: string): BrainStore {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  return {
    async migrate() {
      db.exec(SCHEMA);
    },
    async upsertLesson(lesson, meta) {
      db.query(
        `INSERT INTO lessons (id, status, updated_at, submitted_by, received_at, doc) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, submitted_by=excluded.submitted_by, received_at=excluded.received_at, doc=excluded.doc`,
      ).run(lesson.id, lesson.status, lesson.updated_at, meta.submitted_by, meta.received_at, JSON.stringify(lesson));
    },
    async getLesson(id) {
      const row = db.query(`SELECT doc FROM lessons WHERE id = ?`).get(id) as { doc: string } | null;
      return row ? (JSON.parse(row.doc) as SharedKbLesson) : null;
    },
    async listLessons() {
      const rows = db.query(`SELECT doc FROM lessons ORDER BY updated_at, id`).all() as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as SharedKbLesson);
    },
    async listLessonsWithMeta() {
      const rows = db.query(`SELECT doc, received_at FROM lessons ORDER BY updated_at, id`).all() as Array<{ doc: string; received_at: string }>;
      return rows.map((r) => ({ lesson: JSON.parse(r.doc) as SharedKbLesson, received_at: r.received_at }));
    },
    async updateLessonStatus(id, status) {
      const row = db.query(`SELECT doc FROM lessons WHERE id = ?`).get(id) as { doc: string } | null;
      if (!row) return;
      const lesson = { ...(JSON.parse(row.doc) as SharedKbLesson), status };
      db.query(`UPDATE lessons SET status = ?, doc = ? WHERE id = ?`).run(status, JSON.stringify(lesson), id);
    },
    async addAttestation(att) {
      db.query(`INSERT OR REPLACE INTO attestations (id, lesson_id, validator_id, doc) VALUES (?, ?, ?, ?)`).run(
        att.id,
        att.lesson_id,
        att.validator_id,
        JSON.stringify(att),
      );
    },
    async listAttestations(lessonId) {
      const rows = db.query(`SELECT doc FROM attestations WHERE lesson_id = ? ORDER BY id`).all(lessonId) as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as StoredAttestation);
    },
    async listAllAttestations() {
      const rows = db.query(`SELECT doc FROM attestations ORDER BY id`).all() as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as StoredAttestation);
    },
    async addRevocation(rev) {
      db.query(`INSERT OR REPLACE INTO revocations (id, target, doc) VALUES (?, ?, ?)`).run(rev.id, rev.target, JSON.stringify(rev));
    },
    async listRevocations() {
      const rows = db.query(`SELECT doc FROM revocations ORDER BY id`).all() as Array<{ doc: string }>;
      return rows.map((r) => JSON.parse(r.doc) as SharedKbRevocation);
    },
    async close() {
      db.close();
    },
  };
}
