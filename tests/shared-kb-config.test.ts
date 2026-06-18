import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readSharedKbConfig, sharedKbContributionModes, sharedKbConfigPath, toSharedKbContributionMode, writeSharedKbContributionMode } from "../src/core/shared-kb-config";
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
});
