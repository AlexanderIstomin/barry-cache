export interface ConformanceCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ConformanceReport {
  url: string;
  passed: number;
  failed: number;
  checks: ConformanceCheck[];
}

export async function runConformance(opts: { baseUrl: string; fetch?: typeof fetch }): Promise<ConformanceReport> {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  const checks: ConformanceCheck[] = [];

  async function check(name: string, fn: () => Promise<boolean | { ok: boolean; detail?: string }>): Promise<void> {
    try {
      const result = await fn();
      if (typeof result === "boolean") checks.push({ name, ok: result });
      else checks.push({ name, ok: result.ok, detail: result.detail });
    } catch (error) {
      checks.push({ name, ok: false, detail: (error as Error).message });
    }
  }

  await check("GET /healthz reports ok", async () => {
    const res = await doFetch(`${base}/healthz`);
    const body = (await res.json()) as { status?: string };
    return res.status === 200 && body.status === "ok";
  });

  await check("GET /v1/search returns a results array", async () => {
    const res = await doFetch(`${base}/v1/search?q=example`);
    const body = (await res.json()) as { results?: unknown };
    return res.status === 200 && Array.isArray(body.results);
  });

  await check("GET /v1/snapshot returns a v1 manifest", async () => {
    const res = await doFetch(`${base}/v1/snapshot`);
    const body = (await res.json()) as { manifest?: { version?: number } };
    return res.status === 200 && body.manifest?.version === 1;
  });

  await check("GET /v1/lesson/<unknown> returns 404", async () => {
    const res = await doFetch(`${base}/v1/lesson/lesson-conformance-unknown`);
    await res.text();
    return res.status === 404;
  });

  await check("POST /v1/intake rejects an invalid body (400 or 503)", async () => {
    const res = await doFetch(`${base}/v1/intake`, { method: "POST", body: "{}" });
    await res.text();
    return res.status === 400 || res.status === 503;
  });

  const passed = checks.filter((c) => c.ok).length;
  return { url: base, passed, failed: checks.length - passed, checks };
}
