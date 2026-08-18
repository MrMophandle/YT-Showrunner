# Agent Rules Index

Generated: 2026-08-18
Indexed: 5 rules (0 human-authored, 5 learned) | Rejected: 0 (unsafe) | Warnings: 0

## Validation Summary

### Health Check
- Total rules: 5
- Human-authored rules: 0
- Learned rules (auto-generated): 5
- Estimated max context: ~167 lines (OK)
- Conflicts detected: 0
- Learned-rule file cap: 5 / 10 (OK)

### ⚠️ Warnings
None. Two rules (`process-hygiene`, `empirical-verification`) carry the universal `**/*`
glob, but both are short and topic-disjoint, so combined always-on context stays modest
(~62 lines).

### 🚫 Rejected Rules (Unsafe)
None.

---

## Rules by File Pattern

| Pattern | Rule | Priority | Lines |
|---------|------|----------|-------|
| `**/*` | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low | 26 |
| `**/*` | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low | 36 |
| `**/*.ts` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `**/*.tsx` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |
| `**/*route*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*route*` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 41 |
| `**/*api*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 41 |
| `**/server/**` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*.test.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 41 |
| `**/*.test.tsx` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 41 |

## Rules by Path

| Path Contains | Rule | Priority | Lines |
|---------------|------|----------|-------|
| `console/server/` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `console/` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 41 |
| `console/` | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low | 38 |

## Rules by Topic

| Keywords | Rule | Priority |
|----------|------|----------|
| security, input-validation, untrusted-input | [security-review.md](agent-rules/_learned/security-review.md) | low |
| testing, tdd, error-handling | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low |
| process, sub-agents, git | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low |
| integration, wiring, dead-code, completion-criteria | [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | low |
| research, external-apis, external-tools, design, assumptions | [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | low |

---

## Effectiveness Signal

| Rule | derived_from | evidence_count | last_validated |
|---|---|---|---|
| [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | conversational-season-drafting, season-chat-conversation-loop | 2 | 2026-08-18 |
| [security-review.md](agent-rules/_learned/security-review.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | conversational-season-drafting | 1 | 2026-08-13 |
| [integration-wiring.md](agent-rules/_learned/integration-wiring.md) | season-chat-conversation-loop | 1 | 2026-08-18 |
| [empirical-verification.md](agent-rules/_learned/empirical-verification.md) | season-chat-conversation-loop | 1 | 2026-08-18 |

No rule has reached the promotion threshold (evidence_count >= 3); all remain `low`.
No rule is superseded or expired. Nothing was merged, retired, or pruned this cycle —
consolidation for `season-chat-conversation-loop` was purely additive.

---

## Conflict Resolutions

None. Overlaps are additive rather than contradictory:

- `security-review.md` and `testing-patterns.md` overlap on route/handler globs, but split
  cleanly between adversarial input tests and failure-mode contract tests.
- `integration-wiring.md` and `testing-patterns.md` both touch completion criteria, but
  from different angles: "does this export have a real caller" vs. "can this suite actually
  prove this AC."
- `empirical-verification.md` and `integration-wiring.md` are sequenced, not competing —
  probe the external boundary before design lock, then verify the wiring reaches it.
