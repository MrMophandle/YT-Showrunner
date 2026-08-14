---
name: Security Review (learned)
globs: ["**/*route*", "**/*api*", "**/index.ts", "**/server/**"]
paths: ["console/server/"]
topics: ["security", "input-validation", "untrusted-input"]
priority: low
auto_generated: true
derived_from: [conversational-season-drafting]
evidence_count: 1
last_validated: 2026-08-13
---

# Security Review (learned)

- When a route parameter, filename, or other externally-supplied value reaches a
  filesystem or shell operation, write an explicit adversarial test (path traversal,
  injection, malformed shape) in the SAME TDD pass that writes the happy-path test — do
  not rely on code review to be the first place such a test is written.
  <!-- evidence: conversational-season-drafting Phase 1 — unvalidated `seasonId` reached
       `path.join()`; caught as a blocking code-review finding, not by the TDD pass.
       Fix was an allowlist validator enforced at every trust boundary. -->
- Validate untrusted identifiers with an allowlist (not a denylist) at EVERY boundary that
  consumes them — route entry, storage layer, and any channel/cache keying — rather than
  once at the edge.

See also: [[testing-patterns]]
