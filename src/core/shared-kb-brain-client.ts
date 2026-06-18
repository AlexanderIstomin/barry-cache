import type { SharedKbLesson } from "./shared-kb";
import { signIntakeBatch, type IntakeBatch, type IntakeItem } from "./shared-kb-intake";
import type { ValidatorIdentity } from "./shared-kb-identity";

export function buildLessonIntakeBatch(opts: { identity: ValidatorIdentity; lessons: SharedKbLesson[] }): IntakeBatch {
  const items: IntakeItem[] = opts.lessons.map((record) => ({ type: "lesson", record }));
  return signIntakeBatch(
    {
      version: 1,
      validator_id: opts.identity.validator_id,
      public_key: Buffer.from(opts.identity.public_key_pem).toString("base64"),
      items,
    },
    opts.identity.private_key_pem,
  );
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  accepted?: number | undefined;
  rejected?: Array<{ index: number; reason: string }> | undefined;
  error?: string | undefined;
}

export async function submitIntakeBatch(opts: { url: string; batch: IntakeBatch; fetch?: typeof fetch }): Promise<SubmitResult> {
  const doFetch = opts.fetch ?? fetch;
  const endpoint = `${opts.url.replace(/\/$/, "")}/v1/intake`;
  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.batch),
  });
  const text = await res.text();
  let body: { accepted?: number; rejected?: Array<{ index: number; reason: string }>; error?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true, status: res.status, accepted: body.accepted, rejected: body.rejected };
}
