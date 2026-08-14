# Agent Rules Index

Generated: 2026-08-13
Indexed: 3 rules (0 human-authored, 3 learned) | Rejected: 0 (unsafe) | Warnings: 0

## Validation Summary

### Health Check
- Total rules: 3
- Human-authored rules: 0
- Learned rules (auto-generated): 3
- Estimated max context: ~78 lines (OK)
- Conflicts detected: 0

### ⚠️ Warnings
None.

### 🚫 Rejected Rules (Unsafe)
None.

---

## Rules by File Pattern

| Pattern | Rule | Priority | Lines |
|---------|------|----------|-------|
| `**/*` | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low | 26 |
| `**/*route*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*route*` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 26 |
| `**/*api*` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/index.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 26 |
| `**/server/**` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `**/*.test.ts` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 26 |
| `**/*.test.tsx` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 26 |

## Rules by Path

| Path Contains | Rule | Priority | Lines |
|---------------|------|----------|-------|
| `console/server/` | [security-review.md](agent-rules/_learned/security-review.md) | low | 26 |
| `console/` | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low | 26 |

## Rules by Topic

| Keywords | Rule | Priority |
|----------|------|----------|
| security, input-validation, untrusted-input | [security-review.md](agent-rules/_learned/security-review.md) | low |
| testing, tdd, error-handling | [testing-patterns.md](agent-rules/_learned/testing-patterns.md) | low |
| process, sub-agents, git | [process-hygiene.md](agent-rules/_learned/process-hygiene.md) | low |

---

## Conflict Resolutions

None. `security-review.md` and `testing-patterns.md` overlap on route/handler globs, but
their instructions are additive (adversarial input tests vs. failure-mode contract tests)
rather than conflicting.
