# Installing drama

Written so an **agent can execute it**: every command is non-interactive, idempotent and safe to
re-run, and section 3 gives an exact expected output to check against. Nothing here edits your
`opencode.json` unless you choose the optional variant in section 2b.

Two scopes, and they are different things:

| Scope | What it means | Use when |
| --- | --- | --- |
| **Project** | drama's files live in a repository's `.opencode/` | you work on drama, or want it vendored into one repo |
| **Host** | the skills and the tool are linked into the OpenCode config directory | you want `drama` available in **every** project on this machine |

This page covers the host install (section 2) and the project install (section 6).

---

## 0. What OpenCode actually discovers

Grounded in the host's own discovery rules — do not substitute guesses:

| Artifact | Where OpenCode looks | Notes |
| --- | --- | --- |
| Tools | `{tool,tools}/*.{js,ts}` in each config directory | **symlinks are followed**; bare import specifiers resolve from the file's real path, so the tool may live in a repo and be linked here |
| Skills | `{skill,skills}/**/SKILL.md` in each config directory | a skill's *filename must be* `SKILL.md`; frontmatter needs at least `name` and `description` |
| Host libraries | nowhere automatically | they are imported by the agent when it performs an audition |

`~/.config/opencode` is a config directory. It can be relocated with **`OPENCODE_CONFIG_DIR`** — use
that variable in the commands below if your setup differs.

---

## 1. Preconditions

```sh
command -v bun            # drama is TypeScript on Bun; nothing is compiled or built
command -v opencode       # the host
```

Choose the config directory and the path to this repository:

```sh
CONF="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
REPO="${DRAMA_REPO:-$PWD}"          # run from the drama checkout, or set DRAMA_REPO
test -f "$REPO/src/index.ts" || { echo "DRAMA_REPO does not look like the drama repo: $REPO"; exit 1; }
test -f "$REPO/.opencode/tools/drama.ts" || { echo "missing the OpenCode integration in $REPO"; exit 1; }
```

## 2. Host install

### 2a. Link the integration (default)

```sh
mkdir -p "$CONF/tools" "$CONF/lib" "$CONF/skills/scene-designer" "$CONF/skills/casting-director"

ln -sfn "$REPO"                              "$CONF/drama"
ln -sfn "$REPO/.opencode/tools/drama.ts"     "$CONF/tools/drama.ts"
ln -sfn "$REPO/.opencode/lib/audition-prompt.ts" "$CONF/lib/audition-prompt.ts"
ln -sfn "$REPO/.opencode/lib/audition-store.ts"  "$CONF/lib/audition-store.ts"
for skill in scene-designer casting-director; do
  ln -sfn "$REPO/.opencode/skills/$skill/SKILL.md" "$CONF/skills/$skill/SKILL.md"
done
```

**Why symlinks rather than copies.** Left as copies, the install silently drifts from the repository
the moment either changes. Linked, there is one source of truth and no reinstall step. The cost is
explicit: the install now depends on `$REPO` staying put (section 5), and the tool's
`@opencode-ai/plugin` import resolves from `$REPO/node_modules` — which is why section 3 verifies by
running it rather than by listing files. For a frozen install, see section 7.

### 2b. Optional: declare the skills in config instead

Skills may also be picked up from a declared path, which avoids writing anything outside the config
file. Add to `$CONF/opencode.jsonc`:

```jsonc
{
  "skills": {
    "paths": ["/absolute/path/to/drama/.opencode/skills"]
  }
}
```

Declared paths are scanned recursively for `**/SKILL.md`; skills use the *same* resolution, so one
entry covers both skills. **Tools have no equivalent** — the tool must be a file in `(tool|tools)/`,
so section 2a still applies for `drama.ts`.

## 3. Verify — do not skip this

The check must run from a **neutral directory**, so that it proves the install does not depend on the
repository being the current working directory:

```sh
cd /tmp && cat > drama-install-check.ts <<'EOF'
const CONF = process.env.OPENCODE_CONFIG_DIR ?? `${process.env.HOME}/.config/opencode`;
const drama = (await import(`${CONF}/tools/drama.ts`)).default;
console.log("tool loaded:", typeof drama?.description === "string");

const scene = JSON.stringify({
  objective: "review the migration",
  success_criteria: ["a review artifact exists"],
  required_capabilities: ["migration_review"],
});
console.log("analyze_scene ->", String(await drama.execute({ operation: "analyze_scene", scene })).split("\n")[0]);

const lib = await import(`${CONF}/drama/src/index.ts`);
console.log("library reachable:", typeof lib.StageManager === "function");
EOF
bun drama-install-check.ts; rm -f drama-install-check.ts
```

A working install prints:

```text
tool loaded: true
analyze_scene -> Scene scene-1: review the migration
library reachable: true
```

If the import throws, the cause is almost always resolution, not drama: either `$REPO/node_modules`
is missing (`bun install` in the repository), or a link is dangling (`ls -l` the paths from 2a). A
non-`true` first line means the file loaded but does not export a tool.

## 4. Restart the host

Tools and skills are read at startup. After a restart `drama` is available in every project — the two
skills (`scene-designer`, `casting-director`) trigger on their descriptions, and the tool is called as
`drama` with `operation` (`analyze_scene` | `validate_cast`), `scene` and `cast` as JSON strings.

**Expected, not a bug:** inside the drama repository itself the same two skills also exist as project
skills, so the host may list them twice. The content is identical.

## 5. Uninstall

```sh
CONF="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
rm -f "$CONF/drama" "$CONF/tools/drama.ts" \
      "$CONF/lib/audition-prompt.ts" "$CONF/lib/audition-store.ts" \
      "$CONF/skills/scene-designer/SKILL.md" "$CONF/skills/casting-director/SKILL.md"
rmdir "$CONF/skills/scene-designer" "$CONF/skills/casting-director" 2>/dev/null || true
```

Nothing else is touched: no config file is edited by the default install, and the repository is never
modified.

## 6. Project-scoped install (one repository)

The integration is already in this repository under `.opencode/`. For **another** repository, copy it
and put the library where the imports expect it:

```sh
DEST="/path/to/other-repo"
mkdir -p "$DEST/.opencode"
cp -R "$REPO/.opencode/skills" "$REPO/.opencode/tools" "$REPO/.opencode/lib" "$DEST/.opencode/"
cp -R "$REPO/src" "$DEST/src"        # or place the library wherever the imports point
cp "$REPO/package.json" "$REPO/tsconfig.json" "$DEST/"   # for the @opencode-ai/plugin devDependency
( cd "$DEST" && bun install )
```

**The trap to know about:** both `tools/drama.ts` and `lib/audition-*.ts` import the library through a
**relative** path, `../../src/index.ts`. That path is correct inside the drama repository's layout
(`.opencode/tools/` → repository root). Copy `.opencode/` alone, without the library at that matching
relative location, and every import breaks. Either keep the layout, or rewrite the two import
specifiers to the library's real location.

## 7. Frozen install

If you want the install to survive the repository moving — and to stop tracking it — copy instead of
linking (section 2a), then fix the imports:

- `$CONF/drama/` ← a copy of the repository (or of `src/` plus `package.json`/`tsconfig.json`),
- in `$CONF/tools/drama.ts` and `$CONF/lib/audition-*.ts`, rewrite `../../src/index.ts` to the copy's
  location, e.g. `../drama/src/index.ts`,
- run `bun install` in `$CONF` so `@opencode-ai/plugin` resolves.

Frozen installs drift: re-run them after any change to the tool, the libraries or the skills. For
development, the linked install is the right default.

## 8. Platform notes

- **macOS / Linux:** verified — the default `~/.config/opencode` layout, `ln -sfn`, and the section 3
  output.
- **Windows:** not verified here. Use `OPENCODE_CONFIG_DIR` to name the config directory explicitly,
  and prefer the config-declared skills (§2b) with a copied tool, since symlink creation needs
  developer mode or elevation. drama itself is platform-independent — no shell-outs, no native code.
