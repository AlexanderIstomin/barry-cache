#!/usr/bin/env node
import { adrStatuses, createAdr, listAdrs, type AdrStatus } from "./core/adr";
import { buildChangelog, writeChangelog, type WriteChangelogResult } from "./core/changelog";
import { finalizeProject, loadContext, recordValidationFailure, resumeProject, routeTask, searchContext, type ValidationFailureStatus } from "./core/context";
import { importPulpcutKb } from "./core/import-pulpcut";
import { initProject } from "./core/init";
import { buildReviewModel } from "./core/review-model";
import { startReviewServer } from "./core/review-server";
import { buildSharedKbSnapshot, searchSharedKb, validateSharedKbSource, type SharedKbConfidence } from "./core/shared-kb";
import { formatSharedKbContributionMode, readSharedKbConfig, sharedKbContributionModes, toSharedKbContributionMode, writeSharedKbContributionMode, type SharedKbConfig } from "./core/shared-kb-config";
import { buildLessonProposal, listOutboxLessons, writeProposalToOutbox } from "./core/shared-kb-proposal";
import { loadOrCreateValidatorIdentity } from "./core/shared-kb-identity";
import { buildAttestation, buildLessonIntakeBatch, submitAttestation, submitIntakeBatch } from "./core/shared-kb-brain-client";
import { buildHarvestCandidate, readLatestHarvestSources, type HarvestCandidate, type HarvestSource } from "./core/shared-kb-harvest";
import type { AgentInstructionTarget, InitResult } from "./core/types";
import { validateProject } from "./core/validate";

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | boolean>;
}

interface CliArgumentErrorDetails {
  usage?: string | undefined;
  options?: Record<string, string[]> | undefined;
}

class CliArgumentError extends Error {
  usage: string | undefined;
  options: Record<string, string[]> | undefined;

  constructor(message: string, details: CliArgumentErrorDetails = {}) {
    super(message);
    this.name = "CliArgumentError";
    this.usage = details.usage;
    this.options = details.options;
  }
}

const importSources = ["pulpcut-kb"] as const;
const agentTargets = ["all", "none", "codex", "cursor", "copilot", "claude", "gemini", "llms"];
const finalizeStatuses = ["success", "partial", "blocked", "failed"] as const;
const failureStatuses = ["open", "fixed", "wontfix"] as const;

async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const repo = process.cwd();
  const json = parsed.flags.get("json") === true;

  try {
    switch (parsed.command) {
      case "init": {
        const agents = parseAgentTargets(parsed.flags.get("agents") ?? parsed.flags.get("agent"));
        const initOptions: Parameters<typeof initProject>[0] = {
          repo,
          yes: parsed.flags.get("yes") === true,
          dryRun: parsed.flags.get("dry-run") === true,
        };
        if (agents !== undefined) initOptions.agents = agents;
        const result = await initProject(initOptions);
        print(result, json, formatInitMessage(result));
        break;
      }
      case "validate": {
        const result = await validateProject({ repo });
        print(result, json, result.ok ? "Barry Cache context is valid." : `Barry Cache found ${result.errors.length} error(s).`);
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case "routes":
        print(await routeTask({ repo, task: "" }), json);
        break;
      case "route": {
        const task = requiredString(parsed, "task", commandUsage("route"));
        print(await routeTask({ repo, task }), json);
        break;
      }
      case "search": {
        const query = requiredString(parsed, "query", commandUsage("search"));
        print(await searchContext({ repo, query }), json);
        break;
      }
      case "load": {
        const route = requiredString(parsed, "route", commandUsage("load"));
        print(await loadContext({ repo, route }), json);
        break;
      }
      case "resume": {
        const task = requiredString(parsed, "task", commandUsage("resume"));
        print(await resumeProject({ repo, task }), json);
        break;
      }
      case "finalize": {
        const status = optionalChoice(parsed, "status", finalizeStatuses, "success", commandUsage("finalize"));
        const summary = requiredString(parsed, "summary", commandUsage("finalize"), { status: [...finalizeStatuses] });
        const result = await finalizeProject({
          repo,
          status,
          summary,
          files: optionalList(parsed, "files", commandUsage("finalize")),
          tests: optionalList(parsed, "tests", commandUsage("finalize")),
          fixes: optionalList(parsed, "fixes", commandUsage("finalize")),
        });
        const sharing = await readSharedKbConfig({ repo });
        const harvestNudge = sharing.shared_kb.contribution !== "local_only" && (status === "success" || status === "partial");
        print(result, json, formatFinalizeMessage(result) + (harvestNudge ? "\nThis work may hold a reusable lesson — run `barry-cache kb harvest` to draft a sanitized shared KB proposal." : ""));
        break;
      }
      case "failure": {
        await handleFailureCommand(parsed, repo, json);
        break;
      }
      case "kb": {
        await handleKbCommand(parsed, repo, json);
        break;
      }
      case "changelog": {
        const since = optionalString(parsed, "since", commandUsage("changelog"));
        const file = optionalString(parsed, "file", commandUsage("changelog"));
        const rewrite = parsed.flags.get("rewrite") === true;
        const write = parsed.flags.get("write") === true;
        if (write && rewrite) throw new CliArgumentError("Use either --write or --rewrite, not both.", { usage: commandUsage("changelog") });
        if (rewrite && since) throw new CliArgumentError("Use either --rewrite or --since, not both.", { usage: commandUsage("changelog") });
        if (file && !write && !rewrite) throw new CliArgumentError("--file requires --write or --rewrite", { usage: commandUsage("changelog") });
        if (write || rewrite) {
          const result = await writeChangelog({ repo, file, since, rewrite });
          print(result, json, formatChangelogWriteMessage(result));
          break;
        }
        const result = await buildChangelog({ repo, since });
        print(result, json, result.markdown.trimEnd());
        break;
      }
      case "adr": {
        await handleAdrCommand(parsed, repo, json);
        break;
      }
      case "import": {
        const source = requiredString(parsed, "source", commandUsage("import"), { source: [...importSources] });
        const from = requiredString(parsed, "from", commandUsage("import"), { source: [...importSources] });
        if (!isImportSource(source)) {
          throw new CliArgumentError(`Unsupported import source: ${source}`, {
            usage: commandUsage("import"),
            options: { source: [...importSources] },
          });
        }
        const result = await importPulpcutKb({
          repo,
          from,
          dryRun: parsed.flags.get("dry-run") === true,
        });
        print(result, json, `Imported ${result.imported} PulpCut KB feature pack${result.imported === 1 ? "" : "s"}.`);
        break;
      }
      case "review": {
        if (json) {
          print(await buildReviewModel({ repo }), true);
          break;
        }
        const server = await startReviewServer({
          repo,
          port: optionalNumber(parsed, "port", 8787, commandUsage("review")),
          open: parsed.flags.get("open") === true,
        });
        console.log(`Barry Cache review running at ${server.url}`);
        console.log("Press Ctrl+C to stop.");
        process.once("SIGINT", async () => {
          await server.close();
          process.exit(0);
        });
        process.once("SIGTERM", async () => {
          await server.close();
          process.exit(0);
        });
        break;
      }
      case "doctor": {
        const result = await validateProject({ repo });
        print(result, json, result.ok ? "Barry Cache setup looks healthy." : "Barry Cache setup needs attention.");
        if (!result.ok) process.exitCode = 1;
        break;
      }
      case "generate-adapters":
        print({ ok: true, message: "Run barry-cache init to regenerate adapters." }, json);
        break;
      case "lint-wiki":
        print({ ok: true, message: "No wiki lint rules failed." }, json);
        break;
      default:
        if (parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
          console.log(usageText());
        } else {
          console.error(usageText(`Unknown command: ${parsed.command}`));
          process.exitCode = 1;
        }
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify(formatJsonError(error), null, 2));
    } else {
      console.error(formatCliError(error));
    }
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (!arg?.startsWith("--")) {
      if (arg) positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else {
      flags.set(key, true);
    }
  }
  return { command, positionals, flags };
}

function requiredString(parsed: ParsedArgs, key: string, usageValue?: string, options?: Record<string, string[]>): string {
  const value = parsed.flags.get(key);
  if (value === true) throw new CliArgumentError(`--${key} requires a value`, { usage: usageValue, options });
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`Missing required --${key}`, { usage: usageValue, options });
  return value;
}

function optionalNumber(parsed: ParsedArgs, key: string, fallback: number, usageValue?: string): number {
  const value = parsed.flags.get(key);
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`--${key} requires a number`, { usage: usageValue });
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 65535) throw new CliArgumentError(`--${key} must be a port number`, { usage: usageValue });
  return parsedValue;
}

function optionalString(parsed: ParsedArgs, key: string, usageValue?: string): string | undefined {
  const value = parsed.flags.get(key);
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CliArgumentError(`--${key} requires a value`, { usage: usageValue });
  return value;
}

function optionalChoice<const T extends readonly string[]>(parsed: ParsedArgs, key: string, choices: T, fallback: T[number], usageValue?: string): T[number] {
  const value = parsed.flags.get(key);
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) throw new CliArgumentError(`--${key} requires a value`, { usage: usageValue, options: { [key]: [...choices] } });
  if (!(choices as readonly string[]).includes(value)) {
    throw new CliArgumentError(`Unsupported --${key} value: ${value}`, {
      usage: usageValue,
      options: { [key]: [...choices] },
    });
  }
  return value as T[number];
}

function optionalList(parsed: ParsedArgs, key: string, usageValue?: string): string[] {
  const value = parsed.flags.get(key);
  if (value === undefined) return [];
  if (typeof value !== "string") throw new CliArgumentError(`--${key} requires a comma-separated value`, { usage: usageValue });
  return value.split(",").map((item: string) => item.trim()).filter(Boolean);
}

function parseAgentTargets(value: string | boolean | undefined): AgentInstructionTarget[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CliArgumentError("--agents requires a comma-separated list", { usage: commandUsage("init"), options: { agents: agentTargets } });
  const rawTargets = value.split(",").map((item: string) => item.trim().toLowerCase()).filter(Boolean);
  if (rawTargets.length === 0) throw new CliArgumentError("--agents requires at least one target", { usage: commandUsage("init"), options: { agents: agentTargets } });
  if (rawTargets.includes("all")) {
    if (rawTargets.length > 1) throw new CliArgumentError("--agents all cannot be combined with other targets", { usage: commandUsage("init"), options: { agents: agentTargets } });
    return undefined;
  }
  if (rawTargets.includes("none")) {
    if (rawTargets.length > 1) throw new CliArgumentError("--agents none cannot be combined with other targets", { usage: commandUsage("init"), options: { agents: agentTargets } });
    return [];
  }

  const validTargets = new Set<AgentInstructionTarget>(["codex", "cursor", "copilot", "claude", "gemini", "llms"]);
  const targets: AgentInstructionTarget[] = [];
  for (const target of rawTargets) {
    if (!validTargets.has(target as AgentInstructionTarget)) {
      throw new CliArgumentError(`Unsupported --agents target: ${target}`, { usage: commandUsage("init"), options: { agents: agentTargets } });
    }
    if (!targets.includes(target as AgentInstructionTarget)) targets.push(target as AgentInstructionTarget);
  }
  return targets;
}

function print(value: unknown, json: boolean, message?: string): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (message) {
    console.log(message);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function handleAdrCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const action = parsed.positionals[0];
  if (action === "new") {
    const title = requiredString(parsed, "title", commandUsage("adr new"));
    const status = optionalChoice(parsed, "status", adrStatuses, "active", commandUsage("adr new")) as AdrStatus;
    const adr = await createAdr({
      repo,
      title,
      status,
      supersedes: optionalList(parsed, "supersedes", commandUsage("adr new")),
      tags: optionalList(parsed, "tags", commandUsage("adr new")),
    });
    print(adr, json, `Created ${adr.id} at ${adr.path}.`);
    return;
  }

  if (action === "list") {
    const adrs = await listAdrs({ repo });
    print({ adrs }, json, formatAdrList(adrs));
    return;
  }

  throw new CliArgumentError(action ? `Unknown ADR action: ${action}` : "Missing ADR action", {
    usage: commandUsage("adr"),
  });
}

async function handleFailureCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const action = parsed.positionals[0];
  if (action === "record") {
    const failureOptions: Parameters<typeof recordValidationFailure>[0] = {
      repo,
      summary: requiredString(parsed, "summary", commandUsage("failure record")),
      expected: requiredString(parsed, "expected", commandUsage("failure record")),
      actual: requiredString(parsed, "actual", commandUsage("failure record")),
      status: optionalChoice(parsed, "status", failureStatuses, "open", commandUsage("failure record")) as ValidationFailureStatus,
      files: optionalList(parsed, "files", commandUsage("failure record")),
      challenges: optionalList(parsed, "challenges", commandUsage("failure record")),
      fixes: optionalList(parsed, "fixes", commandUsage("failure record")),
    };
    const reporter = optionalString(parsed, "reporter", commandUsage("failure record"));
    if (reporter !== undefined) failureOptions.reporter = reporter;
    const result = await recordValidationFailure(failureOptions);
    print(result, json, `Saved validation failure to ${result.path}.`);
    return;
  }

  throw new CliArgumentError(action ? `Unknown failure action: ${action}` : "Missing failure action", {
    usage: commandUsage("failure"),
  });
}

async function handleKbCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const action = parsed.positionals[0];
  if (action === "sharing") {
    await handleKbSharingCommand(parsed, repo, json);
    return;
  }

  if (action === "validate") {
    const source = requiredString(parsed, "source", commandUsage("kb validate"));
    const result = await validateSharedKbSource({ source });
    print(result, json, result.ok
      ? `Shared KB source is valid. ${result.lessons.length} lesson(s), ${result.revocations.length} revocation(s).`
      : `Shared KB source has ${result.errors.length} error(s).`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (action === "build") {
    const source = requiredString(parsed, "source", commandUsage("kb build"));
    const out = requiredString(parsed, "out", commandUsage("kb build"));
    const privateKeyPath = optionalString(parsed, "private-key", commandUsage("kb build"));
    const publicKeyPath = optionalString(parsed, "public-key", commandUsage("kb build"));
    if ((privateKeyPath && !publicKeyPath) || (!privateKeyPath && publicKeyPath)) {
      throw new CliArgumentError("Use --private-key and --public-key together.", { usage: commandUsage("kb build") });
    }
    const buildOptions: Parameters<typeof buildSharedKbSnapshot>[0] = { source, out };
    if (privateKeyPath && publicKeyPath) {
      buildOptions.privateKeyPath = privateKeyPath;
      buildOptions.publicKeyPath = publicKeyPath;
    }
    const result = await buildSharedKbSnapshot(buildOptions);
    print(result, json, `Built shared KB snapshot at ${result.out} with ${result.published} lesson(s).`);
    return;
  }

  if (action === "search") {
    const source = requiredString(parsed, "source", commandUsage("kb search"));
    const query = requiredString(parsed, "query", commandUsage("kb search"));
    await assertRemoteSharedKbSearchAllowed(repo, source);
    const result = await searchSharedKb({
      source,
      query,
      includeReviewed: parsed.flags.get("include-reviewed") === true,
    });
    print(result, json, formatKbSearchResults(result));
    return;
  }

  if (action === "propose") {
    await handleKbProposeCommand(parsed, repo, json);
    return;
  }

  if (action === "submit") {
    await handleKbSubmitCommand(parsed, repo, json);
    return;
  }

  if (action === "harvest") {
    await handleKbHarvestCommand(parsed, repo, json);
    return;
  }

  if (action === "attest") {
    await handleKbAttestCommand(parsed, repo, json);
    return;
  }

  throw new CliArgumentError(action ? `Unknown KB action: ${action}` : "Missing KB action", {
    usage: commandUsage("kb"),
  });
}

const attestResults = ["confirmed", "contradicted", "not_applicable"] as const;
const attestEvidence = ["observed_success", "observed_failure", "static_review"] as const;

async function handleKbAttestCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution !== "share_enabled") {
    throw new CliArgumentError("Shared KB attest requires share-enabled mode. Run `barry-cache kb sharing set share-enabled`.", {
      usage: commandUsage("kb sharing set"),
      options: { mode: [...sharedKbContributionModes] },
    });
  }
  const lessonId = requiredString(parsed, "lesson-id", commandUsage("kb attest"));
  const result = optionalChoice(parsed, "result", attestResults, "confirmed", commandUsage("kb attest"));
  const evidenceType = optionalChoice(parsed, "evidence-type", attestEvidence, "observed_success", commandUsage("kb attest"));
  const confidenceRaw = optionalString(parsed, "confidence", commandUsage("kb attest"));
  const confidence = confidenceRaw ? Number(confidenceRaw) : 0.8;
  if (!Number.isFinite(confidence) || confidence < 0.01 || confidence > 0.99) {
    throw new CliArgumentError("--confidence must be a number between 0.01 and 0.99", { usage: commandUsage("kb attest") });
  }
  const contextTags = splitCsv(optionalString(parsed, "context-tags", commandUsage("kb attest")) ?? "");
  const upstreamSeen = splitCsv(optionalString(parsed, "upstream-seen", commandUsage("kb attest")) ?? "");
  const brainUrl = optionalString(parsed, "brain", commandUsage("kb attest")) ?? config.shared_kb.brain?.url;
  if (!brainUrl) {
    throw new CliArgumentError("No Brain configured. Pass --brain <url> or set shared_kb.brain.url in .barry-cache/config.json.", { usage: commandUsage("kb attest") });
  }
  const identity = await loadOrCreateValidatorIdentity({ repo, now: new Date().toISOString() });
  const attestation = buildAttestation({ identity, lessonId, result, confidence, contextTags, evidenceType, upstreamSeen, now: new Date().toISOString() });

  if (parsed.flags.get("dry-run") === true) {
    print({ brain: brainUrl, attestation }, json, `Dry run — would attest ${result}/${evidenceType} on ${lessonId} to ${brainUrl}/v1/attest.`);
    return;
  }
  const res = await submitAttestation({ url: brainUrl, attestation });
  if (!res.ok) {
    process.exitCode = 1;
    print(res, json, `Shared KB attest failed (${res.status}): ${res.error ?? "unknown error"}`);
    return;
  }
  print({ ...res, attestation_id: attestation.id, lesson_id: lessonId }, json, `Attested ${result}/${evidenceType} on ${lessonId} to ${brainUrl}.`);
}

const harvestKinds = ["success", "failure"] as const;

async function handleKbHarvestCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution === "local_only") {
    throw new CliArgumentError("Shared KB harvest requires preview-only or share-enabled mode. Run `barry-cache kb sharing set preview-only`.", {
      usage: commandUsage("kb sharing set"),
      options: { mode: [...sharedKbContributionModes] },
    });
  }

  const summary = optionalString(parsed, "summary", commandUsage("kb harvest"));
  let sources: HarvestSource[];
  if (summary) {
    const kind = optionalChoice(parsed, "kind", harvestKinds, "success", commandUsage("kb harvest"));
    sources = [{
      kind,
      summary,
      expected: optionalString(parsed, "expected", commandUsage("kb harvest")),
      actual: optionalString(parsed, "actual", commandUsage("kb harvest")),
      files: optionalList(parsed, "files", commandUsage("kb harvest")),
    }];
  } else {
    sources = await readLatestHarvestSources({ repo });
  }

  const candidates = sources.map(buildHarvestCandidate);
  print({ candidates }, json, formatHarvestCandidates(candidates));
}

function formatHarvestCandidates(candidates: HarvestCandidate[]): string {
  if (candidates.length === 0) {
    return "No recent runs to harvest. Pass --kind/--summary, or finalize a task first.";
  }
  return candidates.map((candidate) => {
    const header = `Harvest candidate (${candidate.source.kind}) — ${candidate.gate.harvest ? "recommended" : "skipped (low value)"}`;
    const why = `Why: ${candidate.gate.reasons.join("; ")}`;
    if (!candidate.gate.harvest) return [header, why].join("\n");
    return [
      header,
      why,
      "Sanitize before proposing:",
      ...candidate.checklist.map((item) => `  - ${item}`),
      "Suggested command (edit before running):",
      `  ${candidate.proposeCommand}`,
    ].join("\n");
  }).join("\n\n");
}

const sharedKbConfidences = ["low", "medium", "high"] as const;

async function handleKbProposeCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const kind = parsed.positionals[1];
  if (kind !== "lesson") {
    throw new CliArgumentError(kind ? `Unsupported proposal kind: ${kind}` : "Missing proposal kind", { usage: commandUsage("kb propose") });
  }
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution === "local_only") {
    throw new CliArgumentError("Shared KB proposals require preview-only or share-enabled mode. Run `barry-cache kb sharing set preview-only`.", {
      usage: commandUsage("kb sharing set"),
      options: { mode: [...sharedKbContributionModes] },
    });
  }
  const confidence = optionalChoice(parsed, "confidence", sharedKbConfidences, "medium", commandUsage("kb propose"));
  const lesson = buildLessonProposal(
    {
      title: requiredString(parsed, "title", commandUsage("kb propose")),
      problem: requiredString(parsed, "problem", commandUsage("kb propose")),
      applies_when: splitCsv(requiredString(parsed, "applies-when", commandUsage("kb propose"))),
      recommendation: requiredString(parsed, "recommendation", commandUsage("kb propose")),
      why: requiredString(parsed, "why", commandUsage("kb propose")),
      avoid_when: splitCsv(requiredString(parsed, "avoid-when", commandUsage("kb propose"))),
      tags: splitCsv(requiredString(parsed, "tags", commandUsage("kb propose"))),
      confidence: confidence as SharedKbConfidence,
    },
    { now: new Date().toISOString() },
  );

  if (parsed.flags.get("dry-run") === true) {
    print({ lesson }, json, `Dry run — lesson ${lesson.id} (not queued):\n${JSON.stringify(lesson, null, 2)}`);
    return;
  }
  const path = await writeProposalToOutbox({ repo, lesson });
  print({ lesson, outbox: path }, json, `Queued lesson ${lesson.id} to the local shared KB outbox.\nRun \`barry-cache kb submit\` (share-enabled) to send it to a Brain.`);
}

async function handleKbSubmitCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution !== "share_enabled") {
    throw new CliArgumentError("Shared KB submit requires share-enabled mode. Run `barry-cache kb sharing set share-enabled`.", {
      usage: commandUsage("kb sharing set"),
      options: { mode: [...sharedKbContributionModes] },
    });
  }
  const brainUrl = optionalString(parsed, "brain", commandUsage("kb submit")) ?? config.shared_kb.brain?.url;
  if (!brainUrl) {
    throw new CliArgumentError("No Brain configured. Pass --brain <url> or set shared_kb.brain.url in .barry-cache/config.json.", { usage: commandUsage("kb submit") });
  }
  const lessons = await listOutboxLessons({ repo });
  if (lessons.length === 0) {
    print({ accepted: 0, lessons: [] }, json, "No pending shared KB proposals to submit.");
    return;
  }
  const identity = await loadOrCreateValidatorIdentity({ repo, now: new Date().toISOString() });
  const batch = buildLessonIntakeBatch({ identity, lessons });

  if (parsed.flags.get("dry-run") === true) {
    print({ brain: brainUrl, batch }, json, `Dry run — would submit ${lessons.length} lesson(s) to ${brainUrl}/v1/intake as validator ${identity.validator_id}.`);
    return;
  }
  const result = await submitIntakeBatch({ url: brainUrl, batch });
  if (!result.ok) {
    process.exitCode = 1;
    print(result, json, `Shared KB submit failed (${result.status}): ${result.error ?? "unknown error"}`);
    return;
  }
  print({ ...result, lessons: lessons.map((l) => l.id) }, json, `Submitted ${lessons.length} lesson(s) to ${brainUrl}. Accepted ${result.accepted ?? 0}, rejected ${result.rejected?.length ?? 0}.`);
}

function splitCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

async function handleKbSharingCommand(parsed: ParsedArgs, repo: string, json: boolean): Promise<void> {
  const action = parsed.positionals[1];
  if (action === "status") {
    const config = await readSharedKbConfig({ repo });
    print(config, json, formatSharedKbSharingMessage(config));
    return;
  }

  if (action === "set") {
    const rawMode = parsed.positionals[2];
    if (!rawMode) {
      throw new CliArgumentError("Missing shared KB contribution mode", {
        usage: commandUsage("kb sharing set"),
        options: { mode: [...sharedKbContributionModes] },
      });
    }
    const mode = toSharedKbContributionMode(rawMode);
    if (!mode) {
      throw new CliArgumentError(`Unsupported shared KB contribution mode: ${rawMode}`, {
        usage: commandUsage("kb sharing set"),
        options: { mode: [...sharedKbContributionModes] },
      });
    }
    const config = await writeSharedKbContributionMode({ repo, mode });
    print(config, json, formatSharedKbSharingMessage(config));
    return;
  }

  throw new CliArgumentError(action ? `Unknown KB sharing action: ${action}` : "Missing KB sharing action", {
    usage: commandUsage("kb sharing"),
  });
}

async function assertRemoteSharedKbSearchAllowed(repo: string, source: string): Promise<void> {
  if (!isRemoteSharedKbSource(source)) return;
  const config = await readSharedKbConfig({ repo });
  if (config.shared_kb.contribution === "share_enabled") return;
  throw new CliArgumentError("Remote shared KB search requires share-enabled mode. Run `barry-cache kb sharing set share-enabled` before crawling community KB sources.", {
    usage: commandUsage("kb sharing set"),
    options: { mode: [...sharedKbContributionModes] },
  });
}

function isRemoteSharedKbSource(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

function formatAdrList(adrs: Awaited<ReturnType<typeof listAdrs>>): string {
  if (adrs.length === 0) return "No ADRs found.";
  return adrs.map((adr) => `${adr.id}  ${adr.status}  ${adr.title} (${adr.path})`).join("\n");
}

function formatFinalizeMessage(result: Awaited<ReturnType<typeof finalizeProject>>): string {
  return [
    `Saved operational handoff to ${result.path}.`,
    "Finalize writes operational memory only; it does not update canonical context in docs/context/.",
    "If this task introduced durable implementation behavior, add or update docs/context/features/*/FACTS.jsonl and run barry-cache validate.",
  ].join("\n");
}

function formatKbSearchResults(result: Awaited<ReturnType<typeof searchSharedKb>>): string {
  if (result.results.length === 0) return "No shared KB lessons matched.";
  return result.results.map((item) => [
    `${item.id}  ${item.status}  ${item.title}`,
    `  ${item.summary}`,
    `  tags: ${item.tags.join(", ")}`,
  ].join("\n")).join("\n");
}

function formatSharedKbSharingMessage(config: SharedKbConfig): string {
  const mode = formatSharedKbContributionMode(config.shared_kb.contribution);
  const lines = [`Shared KB contribution mode: ${mode}`];
  if (config.shared_kb.contribution === "local_only") {
    lines.push("Barry will not send shared KB contributions.");
    lines.push("Use preview-only to inspect anonymized payloads before considering sharing.");
  } else if (config.shared_kb.contribution === "preview_only") {
    lines.push("Barry can show shared KB payloads locally, but sending remains disabled.");
  } else {
    lines.push("Barry may send shared KB contributions only when a send command is invoked.");
    lines.push("Remote shared KB search is enabled.");
  }
  return lines.join("\n");
}

function formatChangelogWriteMessage(result: WriteChangelogResult): string {
  const action = result.mode === "created" ? "Wrote" : result.mode === "rewritten" ? "Rewrote" : "Appended";
  return `${action} changelog at ${result.path}.`;
}

function formatInitMessage(result: InitResult): string {
  if (!result.dryRun) {
    const lines = [`Barry Cache init ${result.changed ? "changed files" : "already up to date"}.`];
    addInstallHint(lines, result, false);
    return lines.join("\n");
  }
  if (!result.changed) {
    const lines = ["Barry Cache init would not change files."];
    addInstallHint(lines, result, true);
    return lines.join("\n");
  }

  const lines = ["Barry Cache init would change files."];
  addPathSection(lines, "Create:", result.written);
  addPathSection(lines, "Update:", result.updated);
  addInstallHint(lines, result, true);
  return `${lines.join("\n")}\n`;
}

function addPathSection(lines: string[], title: string, paths: string[]): void {
  if (paths.length === 0) return;
  lines.push("", title);
  for (const path of paths) lines.push(`  ${path}`);
}

function addInstallHint(lines: string[], result: InitResult, dryRun: boolean): void {
  if (!result.packageManager) return;
  lines.push("", green(`${dryRun ? "After applying, run" : "Run"}: ${result.packageManager.installCommand}`));
}

function green(value: string): string {
  return `\u001b[32m${value}\u001b[0m`;
}

function formatJsonError(error: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = { ok: false, error: errorMessage(error) };
  if (error instanceof CliArgumentError) {
    if (error.usage) payload.usage = error.usage;
    if (error.options) payload.options = error.options;
  }
  return payload;
}

function formatCliError(error: unknown): string {
  if (!(error instanceof CliArgumentError)) return errorMessage(error);
  const lines = [error.message];
  if (error.usage) lines.push("", "Usage:", `  ${error.usage}`);
  if (error.options) {
    for (const [name, values] of Object.entries(error.options)) {
      lines.push("", name === "mode" ? "Available mode values:" : `Available --${name} values:`);
      for (const value of values) lines.push(`  ${value}`);
    }
  }
  return lines.join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function commandUsage(command: string): string | undefined {
  const usages: Record<string, string> = {
    init: "barry-cache init [--yes] [--dry-run] [--agents all|none|codex,cursor,copilot,claude,gemini,llms]",
    adr: "barry-cache adr <new|list> [--json]",
    "adr new": 'barry-cache adr new --title "..." [--status active|superseded|deprecated] [--supersedes ADR-0001] [--tags context,agents] [--json]',
    "adr list": "barry-cache adr list [--json]",
    route: 'barry-cache route --task "..." [--json]',
    search: 'barry-cache search --query "..." [--json]',
    load: 'barry-cache load --route "..." [--json]',
    resume: 'barry-cache resume --task "..." [--json]',
    finalize: 'barry-cache finalize --summary "..." [--status success|partial|blocked|failed] [--files a,b] [--tests a,b] [--fixes failure-id] [--json]',
    failure: "barry-cache failure <record> [--json]",
    "failure record": 'barry-cache failure record --summary "..." --expected "..." --actual "..." [--status open|fixed|wontfix] [--challenges id1,id2] [--files a,b] [--json]',
    kb: "barry-cache kb <validate|build|search|harvest|propose|submit|attest|sharing> [--json]",
    "kb validate": "barry-cache kb validate --source /path/to/shared-kb [--json]",
    "kb build": "barry-cache kb build --source /path/to/shared-kb --out /path/to/dist [--private-key private.pem --public-key public.pem] [--json]",
    "kb search": 'barry-cache kb search --source /path-or-url --query "..." [--include-reviewed] [--json]',
    "kb harvest": 'barry-cache kb harvest [--kind success|failure --summary "..." [--expected "..." --actual "..." --files a,b]] [--json]',
    "kb propose": 'barry-cache kb propose lesson --title "..." --problem "..." --applies-when "a,b" --recommendation "..." --why "..." --avoid-when "x,y" --tags "a,b" [--confidence low|medium|high] [--dry-run] [--json]',
    "kb submit": "barry-cache kb submit [--brain https://your-brain] [--dry-run] [--json]",
    "kb attest": 'barry-cache kb attest --lesson-id lesson-... [--result confirmed|contradicted|not_applicable] [--evidence-type observed_success|observed_failure|static_review] [--confidence 0.8] [--context-tags a,b] [--upstream-seen id1,id2] [--brain https://your-brain] [--dry-run] [--json]',
    "kb sharing": "barry-cache kb sharing <status|set> [--json]",
    "kb sharing set": "barry-cache kb sharing set <local-only|preview-only|share-enabled> [--json]",
    changelog: "barry-cache changelog [--write|--rewrite] [--since YYYY-MM-DD] [--file CHANGELOG.md] [--json]",
    import: "barry-cache import --source pulpcut-kb --from /path/to/repo [--dry-run] [--json]",
    review: "barry-cache review [--port 8787] [--open] [--json]",
  };
  return usages[command];
}

function isImportSource(value: string): value is typeof importSources[number] {
  return (importSources as readonly string[]).includes(value);
}

function usageText(message?: string): string {
  return `${message ? `${message}\n\n` : ""}Barry Cache remembers your repo.

Usage:
  barry-cache init [--yes] [--dry-run] [--agents all|none|codex,cursor,copilot,claude,gemini,llms]
  barry-cache validate [--json]
  barry-cache route --task "..." [--json]
  barry-cache search --query "..." [--json]
  barry-cache load --route "..." [--json]
  barry-cache resume --task "..." [--json]
  barry-cache finalize --summary "..." [--status success] [--json]
  barry-cache failure record --summary "..." --expected "..." --actual "..." [--json]
  barry-cache kb validate --source /path/to/shared-kb [--json]
  barry-cache kb build --source /path/to/shared-kb --out /path/to/dist [--json]
  barry-cache kb search --source /path-or-url --query "..." [--json]
  barry-cache kb harvest [--kind success|failure --summary "..."] [--json]
  barry-cache kb propose lesson --title "..." --problem "..." --recommendation "..." --why "..." [--dry-run] [--json]
  barry-cache kb submit [--brain https://your-brain] [--dry-run] [--json]
  barry-cache kb sharing status [--json]
  barry-cache kb sharing set <local-only|preview-only|share-enabled> [--json]
  barry-cache changelog [--write|--rewrite] [--since YYYY-MM-DD] [--json]
  barry-cache adr new --title "..." [--status active] [--tags context,agents]
  barry-cache adr list [--json]
  barry-cache import --source pulpcut-kb --from /path/to/repo [--dry-run] [--json]
  barry-cache review [--port 8787] [--open]
  barry-cache review --json
`;
}

if (import.meta.main) {
  await main();
}
