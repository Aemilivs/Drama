/**
 * A file-backed AuditionStore for the host.
 *
 * Auditions and refusals are cached in `src/persona.ts`; this persists them so
 * they survive sessions and belong to the repository rather than the process.
 * It is a host concern — the core stays I/O-free — and it is best-effort: an
 * unreadable, corrupt or wrong-shaped file simply yields an empty store.
 *
 * One instance owns the file for its lifetime and rewrites it on every `put`,
 * so two live instances are last-write-wins. Create one per session/process.
 *
 * Wire it in by handing it to `dressCast` or `StageManager`:
 *
 *   const store = createJsonFileAuditionStore(".opencode/auditions.json");
 *   stage.perform(scene, cast, { personas, auditioner, auditionStore: store });
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Audition, AuditionStore, StoredAudition } from "../../src/index.ts";

/** Validate an on-disk entry: a valid file may still hold the wrong shape. */
function isStoredAudition(value: unknown): value is StoredAudition {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.persona === "string" &&
    typeof entry.fingerprint === "string" &&
    typeof entry.accepted === "boolean"
  );
}

export function createJsonFileAuditionStore(filePath: string): AuditionStore {
  let entries: StoredAudition[] = [];
  if (existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (Array.isArray(parsed)) entries = parsed.filter(isStoredAudition);
    } catch {
      entries = [];
    }
  }

  const key = (persona: string, fingerprint: string) => `${persona}::${fingerprint}`;

  const persist = () => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(entries, null, 2));
    } catch {
      // Best-effort: a failed write must never break a performance.
    }
  };

  return {
    get(persona, fingerprint) {
      const wanted = key(persona, fingerprint);
      const entry = entries.find((item) => key(item.persona, item.fingerprint) === wanted);
      return entry ? { ...entry } : undefined;
    },
    put(persona, fingerprint, audition: Audition) {
      const wanted = key(persona, fingerprint);
      entries = entries.filter((item) => key(item.persona, item.fingerprint) !== wanted);
      entries.push({ ...audition, persona, fingerprint });
      persist();
    },
    all() {
      return entries.map((item) => ({ ...item }));
    },
  };
}
