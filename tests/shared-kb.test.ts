import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSharedKbSnapshot, searchSharedKb, validateSharedKbSource, validateSharedKbLesson, verifySharedKbManifestSignature } from "../src/core/shared-kb";
import { withTempRepo } from "./helpers";

function validLesson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "lesson-20260603-a8f3",
    kind: "anti_pattern",
    status: "trusted",
    title: "Treat handoffs as claims until validated",
    problem: "Agents may treat previous handoff summaries as proof of correctness.",
    applies_when: ["multi-agent coding workflow", "handoff records exist", "user validation can contradict prior claims"],
    recommendation: "Record user-observed failures as contradiction events and link later fixes back to them.",
    why: "This preserves stale assumptions without promoting them to canonical project truth.",
    avoid_when: ["the source cannot be safely anonymized", "there is no validated observed failure"],
    confidence: "high",
    evidence: {
      source_type: "anonymized_project_pattern",
      count: 1,
      has_follow_up_fix: true,
    },
    tags: ["agents", "validation", "handoff"],
    updated_at: "2026-06-03T10:00:00.000Z",
    ...overrides,
  };
}

describe("shared KB validation", () => {
  test("accepts anonymized trusted lessons", () => {
    expect(validateSharedKbLesson(validLesson())).toEqual([]);
  });

  test("requires applicability, recommendation, rationale, and evidence", () => {
    const errors = validateSharedKbLesson({
      id: "lesson-20260603-b1c4",
      kind: "lesson",
      status: "trusted",
      title: "Incomplete lesson",
      updated_at: "2026-06-03T10:00:00.000Z",
    });

    expect(errors).toContain("missing required field: problem");
    expect(errors).toContain("missing required field: applies_when");
    expect(errors).toContain("missing required field: recommendation");
    expect(errors).toContain("missing required field: why");
    expect(errors).toContain("missing required field: evidence");
  });

  test("rejects revealing file paths, emails, and secret-looking tokens", () => {
    const errors = validateSharedKbLesson(validLesson({
      recommendation: "Patch src/internal/payments.ts after emailing owner@example.com with token sk-test-1234567890abcdef.",
    }));

    expect(errors).toContain("field recommendation contains revealing file path: src/internal/payments.ts");
    expect(errors).toContain("field recommendation contains email address");
    expect(errors).toContain("field recommendation contains secret-looking token");
  });

  test("validates JSONL source directories and reports duplicate lesson IDs", async () => {
    await withTempRepo(async (repo) => {
      const source = join(repo, "shared-kb");
      await mkdir(join(source, "lessons"), { recursive: true });
      const lesson = validLesson();
      await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(lesson)}\n${JSON.stringify(lesson)}\n`);

      const result = await validateSharedKbSource({ source });

      expect(result.ok).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({
        file: "lessons/agents.jsonl",
        line: 2,
        message: "duplicate lesson id: lesson-20260603-a8f3",
      }));
    });
  });
});

test("builds signed-pack-ready snapshots from reviewed and trusted lessons", async () => {
  await withTempRepo(async (repo) => {
    const source = join(repo, "shared-kb");
    const out = join(repo, "dist/shared-kb");
    await mkdir(join(source, "lessons"), { recursive: true });
    await writeFile(join(source, "lessons", "agents.jsonl"), [
      JSON.stringify(validLesson({ id: "lesson-20260603-a8f3", status: "trusted", tags: ["agents", "validation"] })),
      JSON.stringify(validLesson({ id: "lesson-20260603-b4d1", status: "submitted", tags: ["agents"] })),
      JSON.stringify(validLesson({ id: "lesson-20260603-c7e2", status: "reviewed", tags: ["review"] })),
      "",
    ].join("\n"));
    await writeFile(join(source, "revocations.jsonl"), `${JSON.stringify({
      id: "revocation-20260603-z9b1",
      target: "lesson-20260603-c7e2",
      status: "revoked",
      reason: "Community validation found the recommendation too broad.",
      updated_at: "2026-06-03T11:00:00.000Z",
    })}\n`);

    const result = await buildSharedKbSnapshot({ source, out });

    expect(result.published).toBe(1);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(manifest.version).toBe(1);
    expect(manifest.counts.lessons).toBe(1);
    expect(manifest.revoked).toEqual(["lesson-20260603-c7e2"]);
    expect(manifest.files).toContainEqual(expect.objectContaining({
      path: "lessons/lessons.jsonl",
      records: 1,
    }));
    expect(manifest.files[0].sha256).toMatch(/^sha256:[a-f0-9]{64}$/);

    const index = JSON.parse(await readFile(join(out, "indexes/search-index.json"), "utf8"));
    expect(index.items).toHaveLength(1);
    expect(index.items[0].id).toBe("lesson-20260603-a8f3");
  });
});

test("searches generated snapshots and excludes non-trusted lessons by default", async () => {
  await withTempRepo(async (repo) => {
    const source = join(repo, "shared-kb");
    const out = join(repo, "dist/shared-kb");
    await mkdir(join(source, "lessons"), { recursive: true });
    await writeFile(join(source, "lessons", "agents.jsonl"), [
      JSON.stringify(validLesson({ id: "lesson-20260603-a8f3", status: "trusted", recommendation: "Record validation failures as contradiction events." })),
      JSON.stringify(validLesson({ id: "lesson-20260603-c7e2", status: "reviewed", recommendation: "Use challenge records for questionable community lessons." })),
      "",
    ].join("\n"));
    await buildSharedKbSnapshot({ source, out });

    const trusted = await searchSharedKb({ source: out, query: "challenge records" });
    expect(trusted.results).toHaveLength(0);

    const reviewed = await searchSharedKb({ source: out, query: "challenge records", includeReviewed: true });
    expect(reviewed.results[0]).toEqual(expect.objectContaining({
      id: "lesson-20260603-c7e2",
      status: "reviewed",
    }));
  });
});

test("builds manifest signatures and verifies them", async () => {
  await withTempRepo(async (repo) => {
    const source = join(repo, "shared-kb");
    const out = join(repo, "dist/shared-kb");
    await mkdir(join(source, "lessons"), { recursive: true });
    await writeFile(join(source, "lessons", "agents.jsonl"), `${JSON.stringify(validLesson())}\n`);
    const pair = generateKeyPairSync("ed25519");
    const privateKeyPath = join(repo, "private.pem");
    const publicKeyPath = join(repo, "public.pem");
    await writeFile(privateKeyPath, pair.privateKey.export({ type: "pkcs8", format: "pem" }));
    await writeFile(publicKeyPath, pair.publicKey.export({ type: "spki", format: "pem" }));

    await buildSharedKbSnapshot({ source, out, privateKeyPath, publicKeyPath });

    expect(await verifySharedKbManifestSignature({
      manifestPath: join(out, "manifest.json"),
      signaturePath: join(out, "manifest.sig"),
    })).toBe(true);

    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    manifest.counts.lessons = 99;
    await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    expect(await verifySharedKbManifestSignature({
      manifestPath: join(out, "manifest.json"),
      signaturePath: join(out, "manifest.sig"),
    })).toBe(false);
  });
});
