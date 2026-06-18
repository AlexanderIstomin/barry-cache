import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSharedKbConfig, sharedKbContributionModes, sharedKbConfigPath, toSharedKbContributionMode, writeSharedKbBrainConfig, writeSharedKbContributionMode } from "../src/core/shared-kb-config";
import { withTempRepo } from "./helpers";

describe("shared KB contribution config", () => {
  test("defaults to local-only when no local config exists", async () => {
    await withTempRepo(async (repo) => {
      const config = await readSharedKbConfig({ repo });

      expect(config.shared_kb.contribution).toBe("local_only");
      expect(sharedKbConfigPath(repo)).toBe(join(repo, ".barry-cache/config.json"));
    });
  });

  test("writes the selected contribution mode to repo-local config", async () => {
    await withTempRepo(async (repo) => {
      await writeSharedKbContributionMode({ repo, mode: "preview_only" });

      const raw = JSON.parse(await readFile(join(repo, ".barry-cache/config.json"), "utf8"));
      expect(raw).toEqual({ shared_kb: { contribution: "preview_only" } });
      expect((await readSharedKbConfig({ repo })).shared_kb.contribution).toBe("preview_only");
    });
  });

  test("accepts only explicit sharing modes", () => {
    expect(sharedKbContributionModes).toEqual(["local-only", "preview-only", "share-enabled"]);
    expect(toSharedKbContributionMode("local-only")).toBe("local_only");
    expect(toSharedKbContributionMode("preview-only")).toBe("preview_only");
    expect(toSharedKbContributionMode("share-enabled")).toBe("share_enabled");
    expect(toSharedKbContributionMode("red-pill")).toBeUndefined();
  });

  test("stores a brain descriptor and preserves the contribution mode", async () => {
    await withTempRepo(async (repo) => {
      await writeSharedKbContributionMode({ repo, mode: "share_enabled" });
      await writeSharedKbBrainConfig({ repo, brain: { url: "https://brain.example.com", scope: "private", trust_policy: "company" } });
      const config = await readSharedKbConfig({ repo });
      expect(config.shared_kb.contribution).toBe("share_enabled");
      expect(config.shared_kb.brain).toEqual({ url: "https://brain.example.com", scope: "private", trust_policy: "company" });
    });
  });

  test("setting contribution mode preserves an existing brain descriptor", async () => {
    await withTempRepo(async (repo) => {
      await writeSharedKbBrainConfig({ repo, brain: { url: "http://localhost:8787", scope: "private" } });
      await writeSharedKbContributionMode({ repo, mode: "preview_only" });
      const config = await readSharedKbConfig({ repo });
      expect(config.shared_kb.contribution).toBe("preview_only");
      expect(config.shared_kb.brain?.url).toBe("http://localhost:8787");
    });
  });

  test("rejects a brain url that is not http(s)", async () => {
    await withTempRepo(async (repo) => {
      await expect(writeSharedKbBrainConfig({ repo, brain: { url: "ftp://nope", scope: "private" } })).rejects.toThrow(/http/i);
    });
  });
});
