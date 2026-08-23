# Agent Rules Index

Generated: 2026-08-22
Indexed: 5 rules (0 human-authored, 5 learned) | Rejected: 0 (unsafe) | Warnings: 1

## Validation Summary

### Health Check
- Total rules: 5
- Human-authored rules: 0
- Learned rules (auto-generated): 5
- Estimated max context: ~201 lines (OK)
- Conflicts detected: 0
- Learned-rule file cap: 5 / 10 (OK)

### ⚠️ Warnings

1. **`testing-patterns.md` promoted to `medium`** this cycle (`evidence_count` 2 → 3, the
   promotion threshold). It is the first rule on this project to leave `low`, so it now
   outranks the four remaining `low` learned rules on conflict. No conflict currently
   exists — flagged because the precedence change is silent otherwise.

Two rules (`process-hygiene`, `empirical-verification`) carry the universal `**/*` glob.
`empirical-verification` grew from 36 → 54 lines this cycle (it absorbed the
control-invocation learning rather than spawning a sixth file), so combined always-on
context is now ~80 lines — still modest, but this is the file to watch. A third `**/*`
rule should be resisted in favor of folding into one of these two.

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

## Rules by Path

| Path Contains | Rule | Priority | Lines |
|---------------|------|----------|-------|
| `console/server/` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `console/` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 57 |
| `console/` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |

## Rules by Topic

| Keywords | Rule | Priority |
|----------|------|----------|
| security, input-validation, untrusted-input | [security-review.md](agent-rules/_learned/security-review.md) | low |
| testing, tdd, error-handling | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** |
| process, sub-agents, git | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low |
| integration, wiring, dead-code, completion-criteria | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low |
| research, external-apis, external-tools, design, assumptions, debugging, attribution | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low |

---

## Effectiveness Signal

| Rule | derived_from | evidence_count | last_validated |
|---|---|---|---|
| [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | conversational-season-drafting, season-chat-conversation-loop, headless-draft-writes | 3 | 2026-08-22 |
| [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | season-chat-conversation-loop, headless-draft-writes | 2 | 2026-08-22 |
| [security-review.md](agent-rules/_learned/security-review.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | season-chat-conversation-loop | 1 | 2026-08-18 |

**Changes this cycle (`headless-draft-writes`):**
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
