# Agent Rules Index

Generated: 2026-08-24
Indexed: 6 rules (0 human-authored, 6 learned) | Rejected: 0 (unsafe) | Warnings: 3

## Validation Summary

### Health Check
- Total rules: 6
- Human-authored rules: 0
- Learned rules (auto-generated): 6
- Estimated max context: ~298 lines (OK)
- Conflicts detected: 0
- Learned-rule file cap: 6 / 10 (OK)

### ⚠️ Warnings

1. **`process-hygiene.md` promoted to `medium`** (`evidence_count` 2 → 3 at the promotion
   threshold, during the `transcript-turn-grouping` cycle). This is the more consequential of
   the two promotions so far: `process-hygiene` carries the universal `**/*` glob, so it is
   now a `medium`-priority rule that loads on **every** file and outranks the four remaining
   `low` rules everywhere, not just within a topic. No conflict currently exists — flagged
   because a precedence change with project-wide reach is silent otherwise.
2. **`testing-patterns.md` is also `medium`** (promoted during `headless-draft-writes`,
   `evidence_count` now 4). Two `medium` rules now exist; they do not overlap (`testing-patterns`
   is scoped to `console/` test files, `process-hygiene` is always-on), so no tie-break is
   needed yet. If a third rule reaches `medium`, check for a genuine conflict rather than
   assuming the pattern scopes stay disjoint.
3. **Always-on context grew again**: `process-hygiene.md` went 43 → 66 lines this cycle, so
   the two universal-`**/*` rules now combine to **~120 lines** (was ~97, ~80 before that).
   That is three consecutive cycles of growth in the always-on set. The previous index asked
   the next consolidation to prefer amending bullets over appending them; this cycle did that
   for two of the three learnings (both `client-styling` bullets received second-instance
   evidence in place) but still added one new bullet, because durable-verification-fixtures
   is a genuinely distinct concept from the four already there. **At the next consolidation,
   treat ~120 always-on lines as the budget ceiling** — prefer merging two existing
   `process-hygiene` bullets over any further append.

Two rules (`process-hygiene`, `empirical-verification`) carry the universal `**/*` glob. A
third `**/*` rule should be resisted in favor of folding into one of these two. Rules added
since (`config-management`) deliberately took narrow globs, so they add nothing always-on.

### 🚫 Rejected Rules (Unsafe)
None.

---

## Rules by File Pattern

| Pattern | Rule | Priority | Lines |
|---------|------|----------|-------|
| `**/*` | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | **medium** | 66 |
| `**/*` | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low | 54 |
| `**/*.ts` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `**/*.tsx` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `**/*route*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*route*` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 73 |
| `**/*api*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 73 |
| `**/server/**` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*.test.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 73 |
| `**/*.test.tsx` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 73 |
| `**/*.config.ts` | [config-management.md](agent-rules/_learned/config-management.md) | low | 41 |
| `**/*.config.js` | [config-management.md](agent-rules/_learned/config-management.md) | low | 41 |
| `**/server/**` | [config-management.md](agent-rules/_learned/config-management.md) | low | 41 |

## Rules by Path

| Path Contains | Rule | Priority | Lines |
|---------------|------|----------|-------|
| `console/server/` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `console/` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** | 73 |
| `console/` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `console/` | [config-management.md](agent-rules/_learned/config-management.md) | low | 41 |

## Rules by Topic

| Keywords | Rule | Priority |
|----------|------|----------|
| security, input-validation, untrusted-input | [security-review.md](agent-rules/_learned/security-review.md) | low |
| testing, tdd, error-handling, fixtures | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | **medium** |
| process, sub-agents, git, workflow, bookkeeping, verification | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | **medium** |
| integration, wiring, dead-code, completion-criteria | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low |
| research, external-apis, external-tools, design, assumptions, debugging, attribution | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low |
| config, defaults, 12-factor, dev-server | [config-management.md](agent-rules/_learned/config-management.md) | low |

---

## Effectiveness Signal

| Rule | derived_from | evidence_count | last_validated |
|---|---|---|---|
| [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | conversational-season-drafting, season-chat-conversation-loop, headless-draft-writes, transcript-turn-grouping | 4 | 2026-08-24 |
| [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | conversational-season-drafting, client-styling, transcript-turn-grouping | 3 | 2026-08-24 |
| [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | season-chat-conversation-loop, headless-draft-writes | 2 | 2026-08-22 |
| [security-review.md](agent-rules/_learned/security-review.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | season-chat-conversation-loop | 1 | 2026-08-18 |
| [config-management.md](agent-rules/_learned/config-management.md) | console-dev-ports | 1 | 2026-08-24 |

**Changes this cycle (`transcript-turn-grouping`):** purely additive — nothing merged,
retired, expired, or pruned.
- `process-hygiene.md` — **amended; crossed the promotion threshold** (evidence_count 2 → 3,
  priority `low` → **`medium`**, 43 → 66 lines). One new bullet: verification evidence held
  only in a running process's memory is not durable, and a file-watching dev server destroys
  it the moment you edit the code under test — snapshot it to disk first. Additionally, both
  bullets `client-styling` contributed received **second-instance evidence in place** rather
  than new bullets: the unticked-roadmap-checkboxes slip repeated exactly (two consecutive
  tasks, so it is a systematic gap in `/bmb:build`, not operator oversight), and the
  open-MUST-AC-at-archive-time case recurred — handled this time by carrying a DO-NOT-MERGE
  callout on the PR, since archiving under `push-and-pr` merges nothing. Topics extended with
  `verification`.
- `testing-patterns.md` — **amended** (evidence_count 3 → 4, 57 → 73 lines). One new bullet:
  build fixtures from real captured output of the tool under test, not hand-written data. A
  hand-invented fixture encodes what you already believe the data looks like, so it omits the
  edge shape that *is* the bug. Evidence: the Claude CLI emits `thinking` blocks containing
  the empty string — exactly why those rows rendered as bare labels, and exactly what no
  hand-written fixture would have contained. Topics extended with `fixtures`.
- Note on the previous index's guidance ("prefer amending existing bullets over appending
  new ones"): followed for two of three learnings; the third was appended because
  durable-verification-fixtures is genuinely distinct from the four bullets already present.
  See Warning 3 for the resulting always-on budget ceiling.

**Changes in the `client-styling` cycle:**
- `process-hygiene.md` — **amended, not a new file** (evidence_count 1 → 2, 26 → 43 lines).
  Two bullets appended: (1) tick Implementation Roadmap checkboxes at phase-completion time,
  since downstream phase gates read the boxes and not the Execution State narrative; (2) do not
  let code merge while a MUST acceptance criterion is still open. Both came from real defects
  this task exposed — six unticked checkboxes that nearly hard-blocked its own `/bmb:reflect`,
  and a merge that landed a full day before AC-VISUAL-1 closed. Folded here rather than spawning
  a seventh file, per the standing `**/*` guidance above. Topics extended with `workflow`,
  `bookkeeping`. Nothing merged, retired, expired, or pruned; no rule crossed the promotion
  threshold.
- `testing-patterns.md` — **not modified**, but worth noting: `client-styling` reused its
  manual-verification carve-out verbatim for AC-VISUAL-1. A reuse without a new bullet, so no
  evidence increment was taken; flagged here so the next consolidation can judge whether the
  pattern deserves one.

**Changes in the `console-dev-ports` cycle:**
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
