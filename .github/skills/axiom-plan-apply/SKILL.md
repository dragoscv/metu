---
name: axiom-plan-apply
description: Write a multi-file change to metu through the AXIOM transactional write gate — compile a Plan, run the `metu` check profile (ripple + protected paths + secrets), dry-run, then apply with the confirmed digest. Use whenever a change touches more than one file, whenever another skill's checklist lists companion files, or when the user says "apply", "plan", "axiom", or "write gate".
---

# Plan → check → apply with AXIOM

AXIOM (`@codai/axiom-mcp`, registered in `.vscode/mcp.json` as server `axiom`)
is the **only** sanctioned way to land a multi-file change in this repo when it
is available. It turns "write eleven files and hope" into one atomic, checked,
journaled transaction:

```
Plan (JSON or .axm)
  → axiom_plan_compile          canonical Manifest + manifestDigest
  → axiom_check  (profile metu) verdict pass|fail — ripple, protected paths, secrets
  → axiom_apply_dry_run         what WOULD be written, nothing touched
  → axiom_apply {confirmDigest} two-phase commit, pre-image re-verified, journaled
```

**Rule: never do raw multi-file writes when AXIOM is available.** One
`create_file`/`apply_patch` for a single-file typo is fine; a page + toolbar +
test + i18n + nav is a Plan. The PreToolUse gate (`.axiom/gate-profile.json`)
additionally denies raw writes to `.env*`, lockfiles, `.github/**`, `.axiom/**`,
`drizzle/**/meta/**` and anything containing a secret pattern.

## What the `metu` profile enforces (`.axiom/profiles/metu.json`)

| check id             | predicate               | what it does                                                                                        |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `repo.noOverwriteOf` | `repo.noOverwriteOf`    | refuses to overwrite `.github/**`, `pnpm-lock.yaml`, `**/*.lock`, `**/drizzle/meta/**`, `.env*`     |
| `content.noSecrets`  | `content.noSecrets`     | refuses any artifact whose content matches a secret/PII pattern (tokens, keys, PAN-like digit runs) |
| `path.deny`          | `path.deny`             | refuses `node_modules`, `.next`, `dist`, `.turbo`                                                   |
| `metu.ripple`        | `repo.requireCompanion` | **the skills' checklists as machine rules** — see the table below                                   |

`metu.ripple` rules (each `when` glob that appears in the Plan requires every
`expect` glob to be satisfied by another artifact _or_ an existing repo file):

| when (you changed…)                         | you must also ship…                                                                                | source skill         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------- |
| `apps/web/src/app/(app)/**/page.tsx`        | `…/__tests__/*.test.tsx`, `apps/web/src/lib/i18n/messages/*.json`, `apps/web/e2e/**/*.spec.ts`     | add-app-page         |
| `apps/web/src/app/actions/*.ts`             | `apps/web/src/lib/__tests__/*.test.ts`                                                             | add-app-page §5      |
| `packages/db/src/schema/*.ts`               | `packages/db/drizzle/*.sql`, `packages/db/drizzle/meta/_journal.json`                              | add-db-migration     |
| `packages/core/src/agent/tools.ts`          | `packages/core/src/agent/__tests__/*.test.ts`                                                      | add-agent-tool       |
| `apps/web/src/app/api/sdk/v1/**/route.ts`   | `…/__tests__/*.test.ts`, `packages/protocol/src/*.ts`, `packages/sdk/src/*.ts`                     | add-sdk-endpoint     |
| `apps/web/src/inngest/functions/*.ts`       | `…/__tests__/*.test.ts`, `apps/web/src/app/api/inngest/route.ts`, `apps/web/src/inngest/client.ts` | add-inngest-function |
| `packages/db/src/schema/integrations.ts`    | `packages/types/src/index.ts`, `packages/db/src/queries/integrations.ts`, `docs/integrations.md`   | add-integration      |
| `apps/web/src/app/api/webhooks/**/route.ts` | `apps/web/src/proxy.ts`                                                                            | add-integration §6   |

A failing rule surfaces as finding id `repo.requireCompanion.<name>`
(e.g. `repo.requireCompanion.page-test`). The fix is always the same: add the
missing companion artifact to the Plan — never delete the rule.

## The loop, tool by tool

1. **Write the Plan.** JSON (`apiVersion: axiom.dev/v2, kind: Plan`) or `.axm`.
   Every file the skill's checklist names is an `artifact`. `op` defaults to
   `create`; use `"op": "overwrite"` for existing files (and carry the FULL new
   content — AXIOM writes whole files, it does not patch). Set `"profile": "metu"`.
2. `axiom_plan_compile { plan }` → returns `manifestDigest` and the bundle.
   (`.axm` input: `axiom_axm_parse` first, or pass the file to `axiom compile`.)
3. `axiom_check { bundle, profile: "metu" }` → `verdict: "pass"` or `"fail"` with
   `findings[]`. Read every finding id; fix the Plan, recompile (digest changes).
4. `axiom_apply_dry_run { bundle }` → `status: "applied"`, `mode: "dry-run"`,
   `files[]` with per-file digests and a unified diff. Nothing is written.
   Review the diff as you would a PR.
5. `axiom_apply { bundle, confirmDigest: <manifestDigest from step 2> }` →
   `status: "applied"`. Pre-image hashes are re-verified at commit; a file that
   changed underneath you → `ERR_PRECONDITION` and nothing lands.
6. Run `pnpm typecheck` / `pnpm lint` as the metu instructions require. AXIOM
   guarantees the _write_ was atomic and checked, not that TypeScript is happy.

CLI equivalent (from any cwd; dist path becomes `npx -y @codai/axiom-mcp` after publish):

```pwsh
$cli = 'E:\gh\axiom\packages\mcp\dist\cli.js'
node $cli compile plan.json -o bundle.json --root E:\gh\metu
node $cli check   bundle.json --root E:\gh\metu --profile metu --json
node $cli apply   bundle.json --root E:\gh\metu --profile metu --dry-run
node $cli apply   bundle.json --root E:\gh\metu --profile metu --confirm sha256:<manifestDigest>
```

## On `fail` / `rolled-back`

| result                                                      | meaning                                                         | what you do                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| check `verdict: "fail"`                                     | a profile rule rejected the _plan_                              | read `findings[].id` + `message`; add the companion / remove the protected path / strip the secret; recompile; re-check. Never edit `.axiom/profiles/metu.json` to make a finding go away.                                          |
| apply `status: "failed"`, `error.code: "ERR_CHECKS_FAILED"` | checks re-ran at apply time and failed                          | same as above — the tree is untouched.                                                                                                                                                                                              |
| `ERR_DIGEST_MISMATCH`                                       | `confirmDigest` ≠ compiled digest                               | you edited the plan after compiling; recompile and pass the new digest.                                                                                                                                                             |
| `ERR_PRECONDITION` / `ERR_EXISTS`                           | a target changed or appeared since compile                      | re-read the file, re-plan with the current pre-image (`op: overwrite`), recompile. Another agent probably wrote it — do not force.                                                                                                  |
| `status: "rolled-back"`                                     | commit failed mid-way; every file restored from `.axiom/backup` | inspect `error`, fix the cause (disk, permissions, locked file), re-apply. The journal in `.axiom/journal/<digest>.json` proves the pre-image was restored; `axiom rollback <digest> --root E:\gh\metu` re-runs it if you doubt it. |
| `ERR_LOCKED`                                                | `.axiom/lock` held by another apply                             | wait; never delete the lock unless the PID is dead.                                                                                                                                                                                 |

## Worked example — add-app-page

Plan for a new authenticated route `/axiom-smoke` following
[add-app-page](../add-app-page/SKILL.md): page, nuqs toolbar, list component,
data helper, colocated test, Playwright spec, i18n keys in **both** locales and
the sidebar entry. The three `overwrite` artifacts are shown abbreviated — a real
Plan carries the full file content.

```json
{
  "apiVersion": "axiom.dev/v2",
  "kind": "Plan",
  "name": "metu-add-app-page-axiom-smoke",
  "intent": "add-app-page: new authenticated route /axiom-smoke with toolbar, list, i18n keys, sidebar nav entry and tests",
  "profile": "metu",
  "capabilities": ["fs"],
  "artifacts": [
    {
      "path": "apps/web/src/app/(app)/axiom-smoke/page.tsx",
      "source": {
        "type": "inline",
        "content": "import { Page, PageHeader, PageSection, Badge } from '@metu/ui';\nimport { auth } from '@/auth';\nimport { redirect } from 'next/navigation';\n/* … see add-app-page §2 … */\n"
      }
    },
    {
      "path": "apps/web/src/components/axiom-smoke/axiom-smoke-toolbar.tsx",
      "source": {
        "type": "inline",
        "content": "'use client';\nimport { useQueryStates, parseAsString } from 'nuqs';\n/* … add-app-page §4, shallow:false … */\n"
      }
    },
    {
      "path": "apps/web/src/components/axiom-smoke/axiom-smoke-list.tsx",
      "source": { "type": "inline", "content": "import { Card } from '@metu/ui';\n/* … */\n" }
    },
    {
      "path": "apps/web/src/lib/axiom-smoke.ts",
      "source": {
        "type": "inline",
        "content": "export async function listAxiomSmoke(input: { workspaceId: string; status?: string; q?: string }) { /* workspace-scoped query */ }\n"
      }
    },
    {
      "path": "apps/web/src/app/(app)/axiom-smoke/__tests__/page.test.tsx",
      "source": {
        "type": "inline",
        "content": "import { describe, expect, it } from 'vitest';\n/* … */\n"
      }
    },
    {
      "path": "apps/web/e2e/axiom-smoke.spec.ts",
      "source": {
        "type": "inline",
        "content": "import { expect, test } from '@playwright/test';\ntest('axiom-smoke page renders one h1', async ({ page }) => { /* … */ });\n"
      }
    },
    {
      "path": "apps/web/src/lib/i18n/messages/en.json",
      "op": "overwrite",
      "source": {
        "type": "inline",
        "content": "{ /* FULL en.json + \"nav\": { \"axiomSmoke\": \"Axiom smoke\" } */ }"
      }
    },
    {
      "path": "apps/web/src/lib/i18n/messages/ro.json",
      "op": "overwrite",
      "source": {
        "type": "inline",
        "content": "{ /* FULL ro.json + \"nav\": { \"axiomSmoke\": \"Test Axiom\" } */ }"
      }
    },
    {
      "path": "apps/web/src/components/sidebar/nav-config.ts",
      "op": "overwrite",
      "source": {
        "type": "inline",
        "content": "// FULL nav-config.ts + { href: '/axiom-smoke', labelKey: 'nav.axiomSmoke', icon: Compass }\n"
      }
    }
  ],
  "checks": [],
  "metadata": { "skill": "add-app-page" }
}
```

Drop the `__tests__`, `e2e` and `messages/*.json` artifacts and `axiom_check`
returns `verdict: "fail"` with `repo.requireCompanion.page-test`. Only that one
fires because `apps/web/e2e/smoke.spec.ts` and `messages/{en,ro}.json` already
exist in the repo and satisfy the other two expectations (an existing file
counts; a _new_ page still needs its own test). Verified 2026-09-18 — see
`E:\gh\axiom\docs\integration\metu.md` for the exact outputs.

### The same Plan in `.axm`

```axm
axiom "2"

plan metu-add-app-page-axiom-smoke {
  intent "add-app-page: new authenticated route /axiom-smoke with toolbar, list, i18n keys, sidebar nav entry and tests"
  profile metu
  capabilities [fs]

  artifact "apps/web/src/app/(app)/axiom-smoke/page.tsx" {
    inline <<TSX
import { Page, PageHeader, PageSection, Badge } from '@metu/ui';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// … add-app-page §2 …
TSX
  }

  artifact "apps/web/src/components/axiom-smoke/axiom-smoke-toolbar.tsx" {
    inline <<TSX
'use client';
import { useQueryStates, parseAsString } from 'nuqs';
// … add-app-page §4 …
TSX
  }

  artifact "apps/web/src/components/axiom-smoke/axiom-smoke-list.tsx" { inline <<TSX
import { Card } from '@metu/ui';
TSX
  }

  artifact "apps/web/src/lib/axiom-smoke.ts" { inline <<TS
export async function listAxiomSmoke(input: { workspaceId: string; status?: string; q?: string }) { return []; }
TS
  }

  artifact "apps/web/src/app/(app)/axiom-smoke/__tests__/page.test.tsx" { inline <<TSX
import { describe, expect, it } from 'vitest';
TSX
  }

  artifact "apps/web/e2e/axiom-smoke.spec.ts" { inline <<TS
import { expect, test } from '@playwright/test';
TS
  }

  artifact "apps/web/src/lib/i18n/messages/en.json" { op overwrite
    inline <<JSON
{ "nav": { "axiomSmoke": "Axiom smoke" } }
JSON
  }

  artifact "apps/web/src/lib/i18n/messages/ro.json" { op overwrite
    inline <<JSON
{ "nav": { "axiomSmoke": "Test Axiom" } }
JSON
  }

  artifact "apps/web/src/components/sidebar/nav-config.ts" { op overwrite
    inline <<TS
// FULL nav-config.ts with the /axiom-smoke entry
TS
  }

  meta {"skill":"add-app-page"}
}
```

Heredoc rule that bites: the newline before the terminator is **not** content,
so a file that must end in `\n` needs a blank line before `TSX`/`TS`/`JSON`.

## Checklist

- [ ] Every companion the source skill lists is an artifact (or already exists in the repo).
- [ ] `overwrite` artifacts carry the FULL new content, both locales updated.
- [ ] `axiom_check` → `pass` on profile `metu` (no finding ids left).
- [ ] `axiom_apply_dry_run` diff reviewed.
- [ ] `axiom_apply` with the `confirmDigest` from the compile you reviewed.
- [ ] `pnpm typecheck` + `pnpm lint` green afterwards.
- [ ] Never edited `.axiom/profiles/metu.json` or `.axiom/gate-profile.json` to silence a finding.
