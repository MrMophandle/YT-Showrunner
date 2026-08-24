# Agent Rules Index

Generated: 2026-08-24
Indexed: 6 rules (0 human-authored, 6 learned) | Rejected: 0 (unsafe) | Warnings: 1

## Validation Summary

### Health Check
- Total rules: 6
- Human-authored rules: 0
- Learned rules (auto-generated): 6
- Estimated max context: ~241 lines (OK)
- Conflicts detected: 0
- Learned-rule file cap: 6 / 10 (OK)

### ⚠️ Warnings

1. **`testing-patterns.md` promoted to `medium`** (`evidence_count` 2 → 3, the promotion
   threshold, during the `headless-draft-writes` cycle). It is the first rule on this project
   to leave `low`, so it outranks the five remaining `low` learned rules on conflict. No
   conflict currently exists — flagged because the precedence change is silent otherwise.

Two rules (`process-hygiene`, `empirical-verification`) carry the universal `**/*` glob,
combining to ~80 lines of always-on context — still modest, but this is what to watch. A
third `**/*` rule should be resisted in favor of folding into one of these two. This cycle's
new rule (`config-management`) deliberately took narrow globs rather than `**/*`, so the
always-on total is unchanged.

### 🚫 Rejected Rules (Unsafe)
None.

---

## Rules by File Pattern

| Pattern | Rule | Priority | Lines |
|---------|------|----------|-------|
| `**/*` | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low | 26 |
| `**/*` | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low | 54 |
| `**/*.ts` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `**/*.tsx` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `**/*route*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*route*` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 57 |
| `**/*api*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 57 |
| `**/server/**` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*.test.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 57 |
| `**/*.test.tsx` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 57 |
| `**/*.config.ts` | [config-management.md](agent-rules/_learned/config-management.md) | low | 40 |
| `**/*.config.js` | [config-management.md](agent-rules/_learned/config-management.md) | low | 40 |
| `**/server/**` | [config-management.md](agent-rules/_learned/config-management.md) | low | 40 |

## Rules by Path

| Path Contains | Rule | Priority | Lines |
|---------------|------|----------|-------|
| `console/server/` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `console/` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 57 |
| `console/` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `console/` | [config-management.md](agent-rules/_learned/config-management.md) | low | 40 |

## Rules by Topic

| Keywords | Rule | Priority |
|----------|------|----------|
| security, input-validation, untrusted-input | [security-review.md](agent-rules/_learned/security-review.md) | low |
| testing, tdd, error-handling | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** |
| process, sub-agents, git | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low |
| integration, wiring, dead-code, completion-criteria | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low |
| research, external-apis, external-tools, design, assumptions, debugging, attribution | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low |
| config, defaults, 12-factor, dev-server | [config-management.md](agent-rules/_learned/config-management.md) | low |

---

## Effectiveness Signal

| Rule | derived_from | evidence_count | last_validated |
|---|---|---|---|
| [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | conversational-season-drafting, season-chat-conversation-loop, headless-draft-writes | 3 | 2026-08-22 |
| [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | season-chat-conversation-loop, headless-draft-writes | 2 | 2026-08-22 |
| [security-review.md](agent-rules/_learned/security-review.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | season-chat-conversation-loop | 1 | 2026-08-18 |
| [config-management.md](agent-rules/_learned/config-management.md) | console-dev-ports | 1 | 2026-08-24 |

**Changes this cycle (`console-dev-ports`):**
- `config-management.md` — **new file, purely additive.** Two bullets: (1) duplicated
  env-configurable defaults across files must collapse to one shared constant, because a
  drifted duplicate fails silently rather than loudly; (2) dev servers that silently rebind on
  port collision need their fail-fast flag set, since renumbering does not remove that class of
  bug. Took narrow globs (`**/*.config.*`, `**/server/**`) rather than `**/*` per the standing
  warning above. Nothing was merged, retired, expired, or pruned this cycle; no rule crossed
  the promotion threshold.

**Changes in the `headless-draft-writes` cycle:**
- `testing-patterns.md` — **promoted `low` → `medium`** (evidence_count 3 ≥ threshold). One
  bullet appended: an argument vector satisfying every content assertion can still be
  unparseable by the real tool; assert structural defenses (`--` before the positional)
  derived from documented arity, not string contents. This is the rule's third independent
  confirmation and its most direct one — the rule predicted the exact failure that shipped.
- `empirical-verification.md` — two bullets appended (control invocations must remove the
  suspected variable; consult documented arity before blaming the environment). Folded here
  rather than created as a new `debugging.md` to avoid a third always-on `**/*` rule.

No rule is superseded or expired. Nothing was merged, retired, or pruned. `security-review`,
`process-hygiene`, and `integration-wiring` are untouched this cycle. The oldest
`last_validated` is 2026-08-13 (73 days inside the 90-day expiry window).

---

## Conflict Resolutions

None. Overlaps are additive rather than contradictory:

- `security-review.md` and `testing-patterns.md` overlap on route/handler globs, but split
  cleanly between adversarial input tests and failure-mode contract tests. `testing-patterns`
  now outranks it at `medium`; no directive of theirs contradicts, so the precedence change
  has no practical effect today.
- `integration-wiring.md` and `testing-patterns.md` both touch completion criteria, but
  from different angles: "does this export have a real caller" vs. "can this suite actually
  prove this AC."
- `empirical-verification.md` and `testing-patterns.md` now both address external-tool
  contracts, and the split is deliberate: `empirical-verification` governs **when to probe
  and how to isolate** (design-time, debugging-time), `testing-patterns` governs **what a
  test can legitimately assert** about the boundary. Both were confirmed by the same
  `headless-draft-writes` defect from these two distinct angles.
- `empirical-verification.md` and `integration-wiring.md` are sequenced, not competing —
  probe the external boundary before design lock, then verify the wiring reaches it.
