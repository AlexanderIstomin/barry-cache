import type { Brain, IntakeBatch } from "../core/brain";
import type { StoredAttestation } from "../core/store";

export interface RouterOptions {
  brain: Brain;
  intakeDisabled?: boolean;
  fingerprint: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export function createRouter(opts: RouterOptions): (request: Request) => Promise<Response> {
  const { brain, intakeDisabled = false, fingerprint } = opts;

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (path === "/healthz" && method === "GET") {
      return json({ status: "ok", intake_disabled: intakeDisabled, fingerprint });
    }

    if (path === "/v1/intake" && method === "POST") {
      if (intakeDisabled) return json({ error: "intake disabled" }, 503);
      let batch: IntakeBatch;
      try {
        batch = (await request.json()) as IntakeBatch;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      try {
        return json(await brain.intake(batch));
      } catch (error) {
        return json({ error: (error as Error).message }, 400);
      }
    }

    if (path === "/v1/search" && method === "GET") {
      const q = url.searchParams.get("q");
      if (!q) return json({ error: "missing query parameter: q" }, 400);
      const includeReviewed = url.searchParams.get("tier") === "reviewed";
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Number(limitParam) : undefined;
      const results = await brain.search(q, { includeReviewed, limit: Number.isFinite(limit) ? limit : undefined });
      return json({ query: q, results });
    }

    if (path === "/v1/snapshot" && method === "GET") {
      const snap = await brain.snapshot();
      return json({
        manifest: snap.manifest,
        manifest_sig: snap.signature,
        lessons_jsonl: snap.lessonRows,
        revocations_jsonl: snap.revocationRows,
        search_index: JSON.parse(snap.indexJson),
      });
    }

    if (path === "/v1/attest" && method === "POST") {
      let att: StoredAttestation;
      try {
        att = (await request.json()) as StoredAttestation;
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
      const result = await brain.attest(att);
      return result.ok ? json({ ok: true }) : json({ error: result.reason ?? "rejected" }, 400);
    }

    if (path.startsWith("/v1/lesson/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/v1/lesson/".length));
      const found = await brain.getLesson(id);
      return found ? json(found) : json({ error: "not found" }, 404);
    }

    return json({ error: "not found" }, 404);
  };
}
