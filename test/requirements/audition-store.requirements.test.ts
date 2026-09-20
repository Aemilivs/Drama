import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonFileAuditionStore } from "../../.opencode/lib/audition-store.ts";
import {
  createActor,
  createCast,
  createProtocol,
  dressCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { Auditioner, Cast, Persona } from "../../src/index.ts";

const ada: Persona = { id: "ada", name: "Ada", source: { kind: "builtin" } };

function withTempFile(use: (file: string, dir: string) => Promise<void> | void) {
  const dir = mkdtempSync(join(tmpdir(), "drama-audition-"));
  const run = async () => use(join(dir, "auditions.json"), dir);
  return Promise.resolve()
    .then(run)
    .finally(() => rmSync(dir, { recursive: true, force: true }));
}

function scene() {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c"],
    required_capabilities: ["research"],
  });
}

function cast(): Cast {
  const researcher = createActor({
    name: "researcher",
    role: "researcher",
    objective: "find facts",
    capabilities: ["research"],
    expectedOutput: ["ResearchReport"],
  });
  return createCast(
    [researcher],
    createProtocol([{ actor: "researcher", instruction: "find", produces: ["ResearchReport"] }]),
  );
}

describe("Persistent audition store requirements", () => {
  test("R-STORE-1 a refusal survives a new store instance", async () => {
    await withTempFile((file) => {
      const first = createJsonFileAuditionStore(file);
      first.put("ada", "fp1", {
        role: "researcher",
        persona: "ada",
        accepted: false,
        reason: "lacks the metrics tool",
      });

      const second = createJsonFileAuditionStore(file);
      expect(second.get("ada", "fp1")?.reason).toBe("lacks the metrics tool");
      expect(second.get("ada", "fp1")?.accepted).toBe(false);
      expect(second.all()).toHaveLength(1);
    });
  });

  test("R-STORE-2 a missing or corrupt file yields an empty store", async () => {
    await withTempFile((file, dir) => {
      expect(createJsonFileAuditionStore(join(dir, "absent.json")).all()).toHaveLength(0);
      writeFileSync(file, "{ not json");
      expect(createJsonFileAuditionStore(file).all()).toHaveLength(0);
    });
  });

  test("R-STORE-4 a valid file with the wrong shape is filtered, never thrown on", async () => {
    await withTempFile((file) => {
      writeFileSync(
        file,
        JSON.stringify([
          null,
          42,
          { persona: "ada" },
          { persona: "ada", fingerprint: "fp", accepted: false, role: "reviewer" },
        ]),
      );
      const store = createJsonFileAuditionStore(file);
      expect(store.all()).toHaveLength(1);
      expect(store.get("ada", "fp")?.accepted).toBe(false);
      expect(store.get("ada", "missing")).toBeUndefined();
    });
  });

  test("R-STORE-3 a persisted audition is a cache hit for the next dressing", async () => {
    await withTempFile(async (file) => {
      let calls = 0;
      const auditioner: Auditioner = () => {
        calls += 1;
        return [{ role: "researcher", persona: "ada", accepted: true, approach: "dig" }];
      };

      await dressCast(cast(), scene(), {
        personas: [ada],
        auditioner,
        auditionStore: createJsonFileAuditionStore(file),
      });
      expect(calls).toBe(1);

      // A fresh store instance reads the persisted answer: no call, still bound.
      const second = await dressCast(cast(), scene(), {
        personas: [ada],
        auditioner,
        auditionStore: createJsonFileAuditionStore(file),
      });
      expect(calls).toBe(1);
      expect(second.cast.actors[0]!.binding?.persona.id).toBe("ada");
      expect(second.auditions[0]!.cached).toBe(true);
    });
  });
});
