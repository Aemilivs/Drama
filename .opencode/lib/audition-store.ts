/**
 * A file-backed AuditionStore for the host.
 *
 * Auditions and refusals are cached in `src/persona.ts`; this persists them so
 * they survive sessions and belong to the repository rather than the process.
 * It is a host concern — the core stays I/O-free — and it is best-effort: an
 * unreadable or corrupt file simply yields an empty store.
 *
 * Wire it in by handing it to `dressCast` or `StageManager`:
 *
 *   const store = createJsonFileAuditionStore(".opencode/auditions.json");
 *   stage.perform(scene, cast, { personas, auditioner, auditionStore: store });
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Audition, AuditionStore, StoredAudition } from "../../src/index.ts";

export function createJsonFileAuditionStore(filePath: string): AuditionStore {
  let entries: StoredAudition[] = [];
  if (existsSync(filePath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (Array.isArray(parsed)) entries = parsed as StoredAudition[];
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
