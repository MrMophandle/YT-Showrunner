# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Memory Bank System

This project uses the **Banyan Memory Bank** system for structured development and task management. All Memory Bank files are located in the `memory-bank/` directory at the project root.

### Core Memory Bank Files

- **`memory-bank/tasks/<slug>.md`** - Per-task file: full plan, user journey, implementation roadmap, and live execution state for one task. The slug **is** the task ID (kebab-case, derived from the task title — there are no numeric task IDs)
- **`memory-bank/projectConfig.md`** - Plugin version tracking and project configuration (auto-managed by `/bmb:init`), including the v2 git keys: `metadata_branch`, `protected_branches`, `pr_target`, `archive_strategy`, `worktree_root`
- **`memory-bank/productBrief.md`** - Product & project context: project foundation, objectives, repository structure, key functionality, markets, personas, NFRs, and integrations
- **`memory-bank/techContext.md`** - Technology stack, infrastructure, component structure, and development commands
- **`memory-bank/systemPatterns.md`** - System architecture patterns
- **`memory-bank/roadmap/<feat-slug>.md`** - One file per roadmap feature (frontmatter: `version`, `linked_tasks`, `status`); required for Level 2-4 tasks
- **`memory-bank/roadmap/versions/<version-slug>.md`** - One file per version; lists the feature slugs assigned to that version
- **`memory-bank/creative/<slug>-[feature].md`** - Design decisions, prefixed with the task slug
- **`memory-bank/reflection/<slug>-reflection.md`** - Task reviews and learnings
- **`memory-bank/archive/`** - Completed task archives (`<slug>-*.md`)
- **`memory-bank/.local/`** - Gitignored advisory cache (e.g., `feature-index.json`); never a truth source, safe to delete at any time

There are **no mutable registry files** in v2. The v1.x registries were removed and git itself carries that state:

| v1 registry (removed) | v2 source of truth |
|-----------------------|--------------------|
| Task registry (`tasks.md`) | `git ls-tree <metadata_branch> memory-bank/tasks/` |
| Progress timeline (`progress.md`) | `git log` on `metadata_branch` |
| Learning timeline (`learning-log.md`) | `git log -- memory-bank/agent-rules/_learned/` |
| Rule effectiveness (`learning-metrics.md`) | Frontmatter on `_learned/*.md`: `derived_from`, `evidence_count`, `last_validated`, `superseded_by` |

`<metadata_branch>` comes from `memory-bank/projectConfig.md` — it is the source of truth for baseline/global state. **Completion** is recorded by Core State on `metadata_branch` (a roadmap feature's `status: completed` + the `archive/<slug>-archive.md` entry), not by the task file's COMPLETE marker (the task file is Work-Specific and rides the code to `pr_target`).

### Memory-Bank File Taxonomy (where writes land)

Every memory-bank path falls into exactly one bucket. When unsure what to branch off or where a write goes, classify the file here first (authoritative table: `${CLAUDE_PLUGIN_ROOT}/context/branch-routing.md` § Memory-Bank File Taxonomy):

| Bucket | Files | Base ref → flows to |
|---|---|---|
| **Core State** (global truth) | `projectConfig.md`, `productBrief.md`, `systemPatterns.md`, `techContext.md`, `roadmap/**`, `agent-rules/**` (incl. `_learned/**`), `archive/**`, `c4/**`, `ux-patterns.md`, `uat-config.md`, `agent-rules-index.md` | `origin/<metadata_branch>` → `metadata_branch` via `chore/banyan-admin` |
| **Work-Specific** (one task) | `tasks/<slug>.md`, `creative/<slug>-*.md`, `reflection/<slug>-*.md` | `origin/<pr_target>` → `pr_target` riding `feature/<slug>` (`task/<slug>` for L1) with the code |

**Collapse rule:** when `pr_target == metadata_branch` (the single-branch default), both buckets resolve to the same branch/target and everything rides one PR — today's behavior. The split (a separate `dev` `pr_target`) makes archive emit **two PRs**: the feature PR (code + Work-Specific docs → `pr_target`) and the rolling `chore/banyan-admin` PR (Core State bookkeeping → `metadata_branch`).

**Legacy IDs**: projects migrated from pre-2.0 may still see `TASK-XXX` / `FEAT-XXX` references in old PRs, tickets, and threads. These still resolve — migrated files carry `legacy_id` frontmatter, and every banyan command accepts the old IDs and resolves them to the slug-based file.

### Git Rules (v2)

Three invariants govern every memory-bank interaction:

1. **No commits to protected branches.** All memory-bank writes happen on a routed branch (`feature/<slug>`, `task/<slug>`, `chore/banyan-admin`, ...) and reach a protected branch via PR. **Which** protected branch depends on the file's taxonomy bucket (above): Work-Specific artifacts ride the code to `pr_target`; Core State flows to `metadata_branch`. Feature/task branches are cut off `origin/<pr_target>`; chore branches off `origin/<metadata_branch>` (equal when collapsed). See `${CLAUDE_PLUGIN_ROOT}/context/branch-routing.md` for the routing table, base-ref-by-bucket rule, and auto-branching sequence.
2. **Memory-bank reads use `git show <branch>:...`, never the local working tree.** Core State / baseline comes from `<metadata_branch>`; in-flight Work-Specific task state from the `feature/<slug>` (or `task/<slug>`) branch tip. (Exception: a file the command is itself about to write, inside the active checkout it was routed to.)
3. **Banyan refuses to run with uncommitted memory-bank edits.** If `git status --porcelain -- memory-bank/` is non-empty in the current checkout or any worktree, commands HALT until you commit or stash.

### Memory Bank Workflow

When starting work:
1. **Discover in-flight work from git branches** — in-flight tasks/features live on `feature/*`, `task/*`, and `chore/*` branches (local + remote) per the discovery model (`${CLAUDE_PLUGIN_ROOT}/context/discovery.md`); completed state lives on the metadata branch
2. **Read `memory-bank/tasks/<slug>.md`** from its branch tip (`git show feature/<slug>:memory-bank/tasks/<slug>.md`) for the specific task you are working on — this contains the full plan and current execution state
3. Consult `memory-bank/techContext.md` for project-specific commands and component structure
4. **Read `memory-bank/productBrief.md`** to understand product context, personas, and NFRs (especially for Level 2-4 tasks)
5. Consult task-specific creative or reflection docs if they exist

When working:
- Update `memory-bank/tasks/<slug>.md` Execution State section as you complete work items or phases, committing to the active feature branch — there is no registry row to update
- Update `memory-bank/techContext.md` when adding new technologies, libraries, or infrastructure
- Update `memory-bank/systemPatterns.md` when introducing new architectural or design patterns (should be done by Document subagent during build iterations)
- Update `memory-bank/productBrief.md` when adding features, personas, or changing NFRs (should be done by Document subagent during build iterations)
- Follow the complexity-appropriate workflow (see below)

### 12-Factor App Principles

This project follows [12-Factor App](https://12factor.net/) methodology. Key principles enforced during `/build`:

- **Config in Environment** - Store configuration in environment variables, not code
- **No Hardcoded Values** - URLs, credentials, feature flags, and settings must be configurable
- **Dev/Prod Parity** - Use the same configuration approach across all environments

**Detailed instructions** are in the build sub-agent files (`${CLAUDE_PLUGIN_ROOT}/context/agents/build-*.md`) which are loaded during `/bmb:build` execution. This keeps context lean until needed.

### Observability Standards

This project enforces **consistent observability** across all services using OpenTelemetry standards. Key principles enforced during `/build`:

- **OpenTelemetry First** - Use OpenTelemetry SDK for logs, metrics, and traces
- **Distributed Tracing Always** - Every request must have a traceable transaction ID (W3C Trace Context)
- **Structured Logging** - JSON format with traceId, spanId, service, level fields
- **Configuration Over Code** - All observability settings via environment variables (LOG_LEVEL, OTEL_*, etc.)
- **Reusable Abstractions** - Use common logger library across services

**Environment Variables:**
| Variable | Purpose |
|----------|---------|
| `LOG_LEVEL` | Log verbosity (trace/debug/info/warn/error/fatal) |
| `LOG_FORMAT` | Output format (json/text) |
| `LOG_OUTPUT` | Destination (stdout/file/both) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint |
| `OTEL_SERVICE_NAME` | Service identifier for traces |
| `OTEL_TRACES_SAMPLER_ARG` | Sampling ratio for production |

**Blocking Violations:**
- `console.log`/`console.error` in production code
- Missing trace context propagation in HTTP clients
- Sensitive data in logs (passwords, tokens, PII)
- Hardcoded log levels or output destinations

**Detailed requirements** are in `${CLAUDE_PLUGIN_ROOT}/context/observability-requirements.md` which is loaded by build agents during `/bmb:build` execution.

### Complexity Levels

Tasks are classified into 4 complexity levels. Complexity is evaluated:
- During `/bmb:task` for quick tasks
- During `/bmb:roadmap feature create` for features (stored with feature, inherited by linked tasks)
- The `/bmb:archive` command should always be used to clean up the environment and get ready for the next development task

See `${CLAUDE_PLUGIN_ROOT}/context/complexity-evaluation.md` for the shared decision tree.

- **Level 1**: Quick fixes, simple bugs
  - Workflow: `/bmb:task` -> `/bmb:build` -> (optional: `/bmb:uat`) -> (optional: `/bmb:reflect`) -> `/bmb:archive`
  - Does NOT require roadmap feature

- **Level 2**: Simple enhancements
  - Workflow: `/bmb:roadmap feature create` -> `/bmb:plan` -> `/bmb:build` -> (recommended: `/bmb:uat`) -> (optional: `/bmb:reflect` -> `/bmb:archive`)
  - Requires roadmap feature

- **Level 3**: Intermediate features
  - Workflow: `/bmb:roadmap feature create` -> `/bmb:plan` -> `/bmb:creative` -> `/bmb:build` (per phase) -> **`/bmb:uat`** -> `/bmb:build` (E2E impl) -> `/bmb:reflect` -> `/bmb:archive`
  - Requires roadmap feature

- **Level 4**: Enterprise/architectural changes
  - Workflow: `/bmb:roadmap feature create` -> `/bmb:plan` -> `/bmb:creative` -> `/bmb:build` (per phase) -> **`/bmb:uat`** (strongly recommended) -> `/bmb:build` (E2E impl) -> `/bmb:reflect` -> `/bmb:archive`
  - Requires roadmap feature

**Key Notes:**
- **Complexity is stored with features**: When creating a feature in the roadmap, complexity is evaluated and stored. Tasks linked to features inherit this complexity.
- **Level 1 uses `/bmb:task`**: Quick tasks bypass the roadmap entirely
- **Level 2-4 use roadmap features**: Create the feature first, then plan and build
- **Reflection is manual**: Run `/bmb:reflect` after all `/bmb:build` phases complete
- **Git commits**: Phase commits in `/bmb:build`, reflection commit in `/bmb:reflect`
- **Archive strategy**: Configured as `archive_strategy` in `projectConfig.md`. Either `push-and-pr` (pushes feature branch + creates PR) or `local-merge` (merges locally — only valid when the target branch is NOT in `protected_branches`; banyan never commits directly to a protected branch). These are mutually exclusive.

The current task's complexity level is documented in `memory-bank/tasks/<slug>.md` (inherited from the linked roadmap feature for Level 2-4).

### Product Brief

The **productBrief.md** file captures the business and product context that all agents need to understand. It ensures implementations align with product intentions.

#### Key Sections

| Section | Purpose |
|---------|---------|
| **Product Overview** | Name, value proposition, product type, stage |
| **Key Functionality** | Core capabilities the product provides |
| **Markets Serviced** | Target industries, geographic focus, market size |
| **Competitive Landscape** | Competitors and differentiators |
| **Key Personas** | Primary users, secondary users, administrators with goals and pain points |
| **User Flows** | Primary flows, onboarding, key workflows |
| **Success Metrics** | Business, product, and technical KPIs |
| **Non-Functional Requirements** | Performance, scalability, security, availability, accessibility, i18n |
| **Integration Points** | External systems, APIs consumed/provided |
| **Constraints & Risks** | Business/technical constraints, assumptions, risks |

#### When to Use

- **Planning (Level 2-4)**: Read to understand user needs and constraints before planning
- **Creative phases**: Architecture, UI/UX, and algorithm decisions MUST align with productBrief
- **Build phase**: Documentation agent updates productBrief when capabilities change

#### Memory Bank Refresh

When running `/bmb:init` on existing repos, a Product Brief Refresh agent reviews the codebase and updates productBrief.md with any changes to:
- New features or capabilities
- New user personas or roles
- Changed non-functional requirements
- New integrations

### Product Roadmap Management

The project uses a **version-based roadmap** system for tracking features and releases.

#### Roadmap Structure

```
memory-bank/roadmap/
├── versions/
│   ├── next.md (planning) - Backlog for future features
│   ├── <version-slug>.md (active) - Currently being worked on; lists feature slugs
│   └── <version-slug>.md (released) - Deployed, LOCKED
└── <feat-slug>.md - One file per feature
    ├── Frontmatter: version, linked_tasks, status
    ├── Status (planned/in_progress/complete)
    ├── Complexity (Level 1-4) - Evaluated at feature creation
    └── Linked tasks (task slugs in linked_tasks; inherit feature complexity)
```

Roadmap state is read from the metadata branch (`git show <metadata_branch>:memory-bank/roadmap/...`); summary statistics are derived at view time rather than stored.

#### Version Lifecycle

1. **planning** - Accepting features, no timeline commitment
2. **active** - Feature list frozen, target date set
3. **released** - Deployed, **permanently locked** (no feature changes)

#### Feature Linking (Mandatory for Level 2-4)

During `/bmb:plan`, tasks must be linked to roadmap features:
- **Level 1**: Optional (can skip roadmap linking)
- **Level 2-4**: Mandatory (prompts to select or create feature)

When linked, the task file's frontmatter records the feature and the feature file records the task:
```yaml
# memory-bank/tasks/<slug>.md frontmatter
feature: newsletter-distribution

# memory-bank/roadmap/newsletter-distribution.md frontmatter
linked_tasks: [<slug>]
```

The `linked_tasks` edit is Core State (`roadmap/**`). When collapsed (`pr_target == metadata_branch`) it rides the active `feature/<slug>` branch and lands on `metadata_branch` via the feature's PR; when split it routes to `chore/banyan-admin` so it reaches `metadata_branch` (discovery reads the roadmap from there).

#### Git Branches per Task

Planned work (Level 2-4, via `/bmb:plan`):
- **Branch**: `feature/<slug>` — created at plan time; holds the plan and later the implementation
- **Worktree**: under `worktree_root` from `projectConfig.md` (default `~/banyan-wt/<repo-slug>/`); worktrees are reserved for `feature/*` branches
- **Sharing**: Multiple tasks linked to the same feature can share the feature branch/worktree

Quick work (Level 1, via `/bmb:task`):
- **Branch**: `task/<slug>` — created at task time

Full routing for every operation: `${CLAUDE_PLUGIN_ROOT}/context/branch-routing.md`.

#### Release Locking

Released versions are **permanently locked**:
- Cannot add features to released versions
- Cannot remove features from released versions
- Cannot move features to/from released versions

This preserves release history and prevents accidental modifications.

#### /bmb:roadmap Command Quick Reference

| Operation | Command |
|-----------|---------|
| View roadmap | `/bmb:roadmap` |
| Create feature | `/bmb:roadmap feature create [name]` |
| Move feature | `/bmb:roadmap feature move <feat-slug> v1.0.0` |
| Link task | `/bmb:roadmap feature link <feat-slug> <task-slug>` |
| Create version | `/bmb:roadmap version create v1.0.0` |
| Activate version | `/bmb:roadmap version activate v1.0.0` |
| Release version | `/bmb:roadmap version release v1.0.0` |

All roadmap admin operations commit to the rolling `chore/banyan-admin` branch and reach `metadata_branch` via its PR; `feature link` instead rides the active `feature/<slug>` branch.

### User Acceptance Testing (`/bmb:uat`)

`/bmb:uat` walks documented user journeys in a real Chromium browser (via the Claude-in-Chrome MCP), takes the persona of a real user, and emits a categorized findings report. On PASS, it generates a framework-agnostic E2E test specification that the next `/bmb:build` cycle implements as runnable tests.

**When to run:**
- **Level 1**: Optional after `/bmb:build`
- **Level 2**: Recommended after `/bmb:build` and before `/bmb:archive`
- **Level 3**: Run between phase builds and final E2E implementation
- **Level 4**: Strongly recommended at the same point as Level 3

**One-time setup** (auto-prompted by `/bmb:init` and `/bmb:upgrade`):
- Run `/bmb:uat-init` to populate `memory-bank/uat-config.md` (base URL, persona map, auth strategy, isolation strategy)
- Run `/bmb:ux-ingest --scaffold` (or hand-edit) to populate `memory-bank/ux-patterns.md`

**Severity rubric**:
- **Required** — failure of an acceptance criterion, RBAC bypass, accessibility blocker (axe-core `impact: critical`), data corruption, native browser dialog blocking flow. Required > 0 → FAIL.
- **Recommended** — UX-pattern violations, axe-core `impact: serious`/`moderate`, missing empty states, confusing copy. Does NOT block PASS.
- **Optional** — polish, axe-core `impact: minor`. Does NOT block PASS.

Every finding carries `confidence: high | medium | low`. Low-confidence findings are **capped at Recommended** to prevent persona-empathy hallucinations from blocking PASS. Every finding MUST carry evidence (screenshot, console message, network request, DOM snapshot, or axe violation) — empty-evidence findings are dropped at the synthesizer's evidence gate.

**Project-wide UAT defaults** live in `memory-bank/projectConfig.md` `## UAT`:
- `default_sections` — which journey sections (`happy`, `mobile`, `negatives`, `errors`, `all`) UAT walks by default
- `default_skip_ux_check` — bypass UX-conformance pass without the flag
- `default_environment` — which environment from `uat-config.md` to target
- `artifact_git_policy` — `ignore` (default) or `commit` for screenshots/GIFs
- `uat_required_for_archive` — soft enforcement at `/bmb:archive`

**UX patterns cross-file consistency rule**: `ux-patterns.md` is authoritative for **component-usage** and **behavioral-UI** rules (AlertDialog vs Dialog, Drawer vs Modal, primary-action placement, empty-state requirements). It MUST NOT duplicate content covered in `techContext.md` (tech stack, design tokens), `systemPatterns.md` (architecture, error conventions, testing patterns), or `productBrief.md` (personas). Reference, don't restate.

### C4 Architecture Documentation (`/bmb:c4`)

`/bmb:c4` builds robust [C4 model](https://c4model.com/) documentation into the memory bank using a bottom-up approach: it walks every source directory (Code level) → synthesizes logical components (Component level) → maps to deployment topology (Container level) → distills system context with personas (Context level). Designed for **enterprise-scale brownfield codebases** where a complete file-level mapping unlocks better planning, creative, and build decisions.

**When to run:**
- After `/bmb:init` on a large brownfield (auto-prompted in init Step 4.6)
- Before a Level 3-4 `/bmb:plan` so plans can ground in existing topology
- Before `/bmb:creative` (architecture exploration) so the architecture-design agent has current artifacts
- After significant refactors or deployment-topology changes
- Periodically (e.g., quarterly) to detect drift

**Idempotency**: `/bmb:c4` is safe to re-run. It tracks per-directory content hashes in `memory-bank/c4/c4-manifest.md` and only re-walks subtrees whose source has changed. Higher levels regenerate only when their inputs (lower-level docs, deployment defs, productBrief.md) change.

**Sub-agents:**
- **c4-code** (Haiku) — per-directory function/class extraction with file:line refs (parallel-batched, default 5 at a time)
- **c4-component** (Sonnet) — synthesizes code docs into logical components
- **c4-container** (Sonnet) — maps components to deployment units, captures tech stacks and APIs
- **c4-context** (Sonnet) — top-level system context with personas (canonical from `productBrief.md`)
- **c4-annotator** (Haiku) — idempotently adds `## C4 Architecture` to `systemPatterns.md` and `## C4 References` to `techContext.md`
- **c4-verifier** (Haiku) — independent verification across three modes (`coverage`, `drift`, `iac`). The `iac` mode independently re-walks IaC files and cross-checks against per-container docs to catch `MISSING_CONTAINER` (IaC resource without a C4 container), `UNBACKED_CONTAINER` (C4 container without IaC backing), `DOUBLE_MAPPED` (synthesis bug), and `UNTRACEABLE_IMAGE`. Dispatched at end of every `/bmb:c4` run AND from `/bmb:build`'s Documentation Agent

**Outputs (in `memory-bank/c4/`):**
- `c4-index.md` — entry point with refresh status and how-to-use
- `c4-context.md`, `c4-container.md`, `c4-component.md` — master docs per level
- `containers/c4-container-<name>.md` — per-container detail (always-on, one file per container)
- `components/c4-component-<name>.md` — per-component
- `code/c4-code-<sanitized-dir>.md` — per-source-directory
- `c4-manifest.md` — idempotency manifest
- `archive/<run-id>/` — old docs for directories no longer in source

**Cross-file integration**: After completion, `systemPatterns.md` and `techContext.md` are auto-annotated with `## C4 Architecture` and `## C4 References` sections (between AUTO-MANAGED markers). Other agents (TDD Agent, Reflection Agent) discover the C4 docs through these annotations and load them when relevant.

**Common flags:**
```
/bmb:c4                              # incremental refresh (default — interactive approval)
/bmb:c4 --refresh                    # force-refresh all levels
/bmb:c4 --refresh-from container     # rebuild Container + Context only
/bmb:c4 --scope apps/api             # restrict walk to a subtree
/bmb:c4 --levels container,context   # build only these levels
/bmb:c4 --no-annotate                # skip systemPatterns/techContext updates
/bmb:c4 --no-verify                  # skip the post-run c4-verifier sanity check
/bmb:c4 --accept-all                 # bypass approval gate; auto-overwrite (CI)
/bmb:c4 --reject-all                 # never overwrite when removals/alterations exist; defer to user
/bmb:c4 --dry-run                    # print plan without dispatching
```

**Hand-authored content preservation**: each generated C4 doc has USER-MANAGED marker blocks for hand-curated entries (preserved verbatim across regenerations). Common locations:
- `c4-context.md` — `additional-personas`, `additional-external-integrations`
- `c4-container.md` — `additional-containers`
- `c4-container-relationships.md` — `additional-external-integrations`, `additional-edges`
- `containers/c4-container-<name>.md` — `user-notes`

For entries OUTSIDE marker blocks, the agent compares old vs new and prompts before removing/materially altering existing content. See `context/c4-external-integrations.md` for the Material-Change Taxonomy.

**External integration sources** the C4 agents read on every run (in priority order):
1. `productBrief.md` § Integration Points (canonical user-curated)
2. `systemPatterns.md` § Integration Patterns
3. `techContext.md` § External Services + § API & Communication
4. Per-component docs' Dependencies → External Systems
5. IaC (cross-account messaging, webhook routes, event source mappings, external CNAMEs, federated IdPs)
6. Code patterns (outbound API client libraries, env-var patterns like `*_API_KEY`/`*_WEBHOOK_URL`, webhook handler routes, OAuth callbacks)

**Verification artifacts:**
- `memory-bank/c4/c4-verification.md` — written by the c4-verifier at end of every `/bmb:c4` run; reports MISSING / ORPHANED / DRIFTED / BROKEN_LINK counts and a recommended action.
- `memory-bank/c4/c4-verification-<slug>-<phase_name>.md` — written by `/bmb:build`'s Documentation Agent; per-build drift report scoped to the directories the build modified.

### Progressive Discovery

Do not attempt to load all Memory Bank files at once. Use **progressive discovery**:
1. Start with the discovery index (in-flight branches) and the relevant `tasks/<slug>.md` read from its branch tip
2. Load other files as needed based on the task
3. Check for task-specific creative or archive docs if referenced

### Interruption Recovery System

All workflow commands include automatic resumption logic. The `## Execution State` section of `tasks/<slug>.md` is continuously updated with current phase, step, sub-agent statuses, and resumption notes (committed to the active feature branch). Commands check this state on startup — reading from the branch tip — and resume from the last incomplete step. See command files for step-by-step state tracking requirements.

### Phase Gates & Reference Integrity

Commands enforce workflow prerequisites before proceeding. These are **hard blocks** — the command will STOP with an error and suggested fix if prerequisites are not met. There is no skip option; use `/bmb:task` for quick work that doesn't need the full workflow.

**Phase Gates (hard blocks):**

| Command | Key Preconditions |
|---------|-------------------|
| `/bmb:plan` | Task file `tasks/<slug>.md` exists on the feature branch (auto-provisioned from the roadmap feature) |
| `/bmb:creative` | Plan exists, complexity >= Level 2 |
| `/bmb:build` | Plan exists, required creative phases complete |
| `/bmb:reflect` | Build phase completed |
| `/bmb:archive` | Reflection document exists (Task Archive mode) |
| `/bmb:verify` | Implementation present (when a task slug is provided) |
| `/bmb:uat` | Journey doc + uat-config.md + ux-patterns.md (or `--skip-ux-check`) + Claude-in-Chrome MCP reachable + task status >= BUILD_COMPLETE |

**Reference Integrity (fail-fast):**

When a command reads a reference to another file (e.g., a creative doc marked complete in a task file, a task slug listed in a roadmap feature's `linked_tasks`), it verifies the referenced file exists. If a reference is broken, the command stops immediately with an error and suggested fix — it does not silently continue with partial state.

Common reference checks:
- Task file creative phases → `creative/<slug>-*.md` files
- Task file reflection status → `reflection/<slug>-reflection.md`
- `roadmap/<feat-slug>.md` `linked_tasks` slugs → `tasks/<slug>.md` files (on `metadata_branch` or an in-flight branch tip)

**Exempt commands**: `/bmb:init` and `/bmb:upgrade` skip all gates (they bootstrap state).

Validation logic: `${CLAUDE_PLUGIN_ROOT}/context/phase-gates.md`

### Claude Commands (Slash Commands)

This project uses structured workflow commands with **progressive context loading** to optimize token usage.

**Commands:** `${CLAUDE_PLUGIN_ROOT}/commands/`
| Command | Description | When to Use |
|---------|-------------|-------------|
| `/bmb:go` | Entrypoint — infers the next action from git state (`status`, `continue`, `cd <slug>`, `cleanup`) | Anytime; the only command new team members need |
| `/bmb:brainstorm` | Conversational idea → build-ready task (roadmap + plan + creative in one dialogue) | When you have an idea but no task yet; an alternative to running roadmap/plan/creative separately |
| `/bmb:init` | Memory Bank setup | Initialize Memory Bank for a new project |
| `/bmb:task` | Quick task execution | Level 1 tasks (bug fixes, typos, simple changes) |
| `/bmb:roadmap` | Product roadmap management | Create features, manage versions (includes complexity evaluation) |
| `/bmb:plan` | Task planning | Level 2-4 tasks after feature creation |
| `/bmb:creative` | Design decisions | Level 3-4 tasks requiring design exploration |
| `/bmb:build` | Code implementation | After planning/creative phases; one phase at a time |
| `/bmb:auto-build` | Autonomous multi-phase build (Sonnet-orchestrated; one fresh build per phase) | After planning/creative, when you want all remaining phases built end-to-end without per-phase pauses |
| `/bmb:reflect` | Task reflection | After all /bmb:build phases complete |
| `/bmb:archive` | Task archiving + PR creation | After /bmb:reflect completes (mandatory for Level 4) |
| `/bmb:verify` | Code verification & testing | Ad-hoc verification at any time |
| `/bmb:doctor` | Git/config health check | On-demand; before migrations or when banyan behaves unexpectedly |
| `/bmb:uat` | Browser-based User Acceptance Testing | After /bmb:build for features with documented user journeys (Level 2+) |
| `/bmb:uat-init` | UAT configuration setup (one-time) | Project setup; auto-prompted by /bmb:init and /bmb:upgrade |
| `/bmb:ux-ingest` | Scaffold ux-patterns.md (v1.8 stub) | Once before first /bmb:uat run; refresh when UI patterns shift |
| `/bmb:c4` | C4 architecture documentation (Code → Component → Container → Context) | Recommended after /bmb:init on large brownfield codebases; refresh when topology changes |

### Command Task Slug Argument

All workflow commands take the task slug as their argument to support parallel task development:

```
/bmb:plan <slug>
/bmb:creative <slug>
/bmb:build <slug>
/bmb:reflect <slug>
/bmb:archive <slug>
```

Use `/bmb:roadmap view` to see the roadmap; in-flight task phases come from discovery (git branches).

**Workflow by Complexity:**
- **Level 1:** `/bmb:task` -> `/bmb:build <slug>` -> `/bmb:reflect <slug>` (optional) -> `/bmb:archive <slug>`
- **Level 2:** `/bmb:roadmap feature create` -> `/bmb:plan <slug>` -> `/bmb:build <slug>` -> `/bmb:reflect <slug>` (optional) -> `/bmb:archive <slug>`
- **Level 3:** `/bmb:roadmap feature create` -> `/bmb:plan <slug>` -> `/bmb:creative <slug>` -> `/bmb:build <slug>` (per phase) -> `/bmb:reflect <slug>` -> `/bmb:archive <slug>`
- **Level 4:** `/bmb:roadmap feature create` -> `/bmb:plan <slug>` -> `/bmb:creative <slug>` -> `/bmb:build <slug>` (per phase) -> `/bmb:reflect <slug>` -> `/bmb:archive <slug>`

**Multi-Phase Implementation Workflow:**

For tasks with multiple implementation phases (common in Level 3-4):

```
/bmb:roadmap feature create -> /bmb:plan -> /bmb:creative
    |
    v
    Phase 1: /bmb:build -> STOP (human reviews)
    |
    v
    Phase 2: /bmb:build -> STOP (human reviews)
    |
    v
    Phase N: /bmb:build -> STOP (human reviews)
    |
    v
    /bmb:reflect (create reflection document + commit)
    |
    v
    /bmb:archive (push & PR, or local merge - based on project config)
```

**What Happens in Each Command:**
- **/bmb:build**: Implements ONE phase, commits to feature branch, STOPS
- **/bmb:reflect**: Creates reflection document, commits to feature branch
- **/bmb:archive**: Either pushes feature branch + creates PR to `pr_target`, or merges locally (configured per project; local merge is only valid for non-protected target branches). When `pr_target != metadata_branch`, Core State bookkeeping (archive entry, `_learned/`, roadmap status) routes separately to `metadata_branch` via the `chore/banyan-admin` PR — two PRs

**Key Points:**
- `/bmb:build` works on ONE implementation phase at a time
- After each `/bmb:build`, human reviews before proceeding
- `/bmb:reflect` is run MANUALLY after all phases complete
- `/bmb:archive` uses the **Archive Strategy** (`archive_strategy` in `projectConfig.md`) to decide between push+PR or local merge (never both)

### Progressive Context Loading

Commands use a **two-tier system** to minimize token usage: **command files** (`${CLAUDE_PLUGIN_ROOT}/commands/`) contain minimal routing logic, while **context files** (`${CLAUDE_PLUGIN_ROOT}/context/`) contain detailed instructions loaded only when needed. Each command tells you which context file to read based on the complexity level in `memory-bank/tasks/<slug>.md`.

### Model Selection Strategy

Different commands and sub-agents use different Claude models optimized for cost and performance. See `${CLAUDE_PLUGIN_ROOT}/context/model-selection-strategy.md` for details. Key principle: Haiku for simple tasks, Sonnet for coding, Opus for complex planning/architecture.

### Configurable Agent Backends (optional)

BMB runs on Anthropic (Claude) by default, but each content-producing **seam** of the workflow can be routed to a different backend from one place — the `## Agent Backends` block in `projectConfig.md` (the per-project source of truth). Configurable seams: `plan`, `tdd` (build implementation), `code-review`, the four `creative-*` design docs, and the advisory `creative-critique` pass. Each value is `<provider>[:<model>]`:

- **`anthropic[:tier]`** — a Claude sub-agent; the optional `tier` (`haiku`/`sonnet`/`opus`) tunes which model BMB's own sub-agent uses for that seam.
- **`codex[:model]`** — delegate to the OpenAI Codex plugin (`codex@openai-codex`) via its companion runtime, with an optional Codex model.

This lets you, e.g., have Codex write code while Anthropic reviews it (`tdd: codex`, `code-review: anthropic`), or the reverse — independently per seam. A `codex`-configured seam that can't reach Codex never fails the build: it falls back to Anthropic (mandatory-output seams) or skips (the advisory critique), per `availability` (`auto` = silent, `on` = warn). `/bmb:init` and `/bmb:upgrade` auto-detect Codex and, when usable, default `code-review` + `creative-critique` to Codex; `/bmb:doctor` reports health (check C12). The plugin's `context/agent-backends.md` is the read-only procedure; the values live in `projectConfig.md`. With all seams `anthropic` (or Codex absent), BMB behaves exactly as before.

### Sub-Agent Architecture

The `/bmb:plan`, `/bmb:creative`, and `/bmb:build` commands use **sub-agent delegation** to prevent context window overflow. Each command spawns specialized sub-agents via the Task tool, with full methodology files in `${CLAUDE_PLUGIN_ROOT}/agents/`. Sub-agents work independently and write outputs to `memory-bank/`. See the respective command files for details.

**Planning agents:**
- **Spec Writer Agent** (Sonnet for L2-L3, Opus for L4) — Reads product context and codebase, generates feature specification with invocation method, success criteria, and acceptance criteria. Replaces manual Q&A with an agent-drafted spec for human review.

### Process Management for Parallel Agents

When multiple agents run in parallel, they MUST use PID-based process control (never pattern-based kills like `pkill -f`). See `${CLAUDE_PLUGIN_ROOT}/context/process-management.md` for details.

### Tool Usage Rules

Claude Code and all sub-agents MUST follow these rules to avoid unnecessary permission prompts and keep the workflow smooth:

**File creation:**
- **NEVER** use `cat << EOF`, `cat << 'EOF'`, or `echo >` heredocs in Bash to create or write files. Use the **Write** tool instead.
- **NEVER** use `sed`, `awk`, or stream editors to modify files. Use the **Edit** tool instead.

**Bash commands — ONE command per Bash call:**
- **NEVER chain independent commands with `&&`, `;`, or `||`** in a single Bash call. Each command MUST be a separate Bash tool call.
- **NEVER prefix a command with `cd dir &&`**. Instead, use absolute paths, `-chdir` flags, or the `-C` flag (e.g., `git -C /path/to/repo status`).
- When you need to create a file and then run a command on it, use **two separate tool calls**: a Write call to create the file, then a Bash call to run the command.
- Do not pipe file contents through Bash when a dedicated tool exists (e.g., use Read instead of `cat`, Grep instead of `grep`).
- Independent commands in separate Bash calls can run in **parallel**, which is faster than chaining.

```
BAD (chained — triggers permission prompt, blocks execution):
  Bash: cd /project && terraform -chdir=modules/lambda test 2>&1 && terraform -chdir=modules/sns test 2>&1

GOOD (separate calls — each matches permission patterns, can run in parallel):
  Bash call 1: terraform -chdir=/project/modules/lambda test 2>&1
  Bash call 2: terraform -chdir=/project/modules/sns test 2>&1

BAD (cd && git — triggers "compound commands with cd and git require approval"):
  Bash: cd /path/to/repo && git status | grep -E "modified:|new file:"

GOOD (git -C flag — matches Bash(git -C *) permission pattern):
  Bash: git -C /path/to/repo status | grep -E "modified:|new file:"

BAD (cd && npm — doesn't match Bash(npm *)):
  Bash: cd /path/to/project && npm test 2>&1

GOOD (use absolute path or run from correct directory):
  Bash: npm test --prefix /path/to/project 2>&1
```

**Why this matters:**
- Permission patterns like `Bash(terraform *)` only match commands that **start with** `terraform`. A chained command like `cd dir && terraform test` starts with `cd`, so it matches nothing and triggers a manual approval prompt.
- Single-purpose commands match the pre-approved permission patterns in `.claude/settings.local.json`
- Heredocs and chained commands look like arbitrary shell execution to the permission system
- This keeps both sequential and parallel workflows flowing without human interruption

**Preserve output from expensive commands — never discard and re-run:**
- When running commands that are slow (>30s), expensive, or produce diagnostic output you may need to analyze (test suites, builds, linters, infrastructure commands), **always `tee` the full output to a log file**.
- **NEVER** pipe long-running command output through `tail`, `head`, `grep`, or other filters that discard the full output. If you need a summary, tee first and then read/grep the log file separately.
- Use `.claude-logs/` at the project root for log files. Create the directory if it doesn't exist. Name files descriptively: `.claude-logs/{command}-{timestamp}.log` (e.g., `.claude-logs/terraform-test-20260314-1423.log`).
- After the command completes, use Read or Grep on the log file for analysis — do not re-run the command.
- Clean up `.claude-logs/` at the end of each `/bmb:build` or `/bmb:archive` cycle, or when log files are no longer needed.
- Add `.claude-logs/` to `.gitignore` if not already present.

```
BAD (output lost — must re-run 8-minute test to see failures):
  Bash: terraform -chdir=/project test 2>&1 | tail -5

GOOD (full output preserved, summary still visible):
  Bash: mkdir -p .claude-logs
  Bash: terraform -chdir=/project test 2>&1 | tee .claude-logs/terraform-test-20260314-1423.log | tail -20
  # Later, to analyze failures:
  Grep: pattern="FAIL\|Error\|failed" path=".claude-logs/terraform-test-20260314-1423.log"

GOOD (background command with full capture):
  Bash (run_in_background): terraform -chdir=/project test 2>&1 | tee .claude-logs/terraform-test-20260314-1423.log
  # When notified of completion, read the log:
  Read: .claude-logs/terraform-test-20260314-1423.log
```

**Why this matters:**
- Re-running a command just to see its output wastes minutes of wall-clock time and burns tokens/compute for zero new information.
- Captured logs enable parallel analysis — you can grep for different failure patterns without waiting for another full run.
- This is especially critical for infrastructure tests (Terraform, integration suites) where a single run can take 5-15+ minutes.

### Continuous Learning System

This project uses **automatic pattern extraction** from task reflections to improve future tasks.

**How it works:**
1. After `/bmb:reflect`, actionable learnings are extracted into `memory-bank/agent-rules/_learned/` as low-priority agent rules
2. Rules are organized by **topic** (e.g., `error-handling.md`, `testing-patterns.md`) — not per-task
3. New learnings amend existing topic files when possible (consolidate-first)
4. Rules are automatically loaded by sub-agents via the standard agent-rules system
5. Rules reinforced across multiple tasks are promoted to higher priority
6. Rules never reinforced expire after 90 days (judged by `last_validated`)
7. During `/bmb:archive`, consolidation merges overlapping rules and prunes stale ones, reading each rule's frontmatter to decide merge/retire/promote

**Files:**
- `memory-bank/agent-rules/_learned/*.md` - Auto-generated rules (topic-scoped, terse bullet directives). Frontmatter carries the effectiveness signal: `derived_from` (contributing task slugs), `evidence_count`, `last_validated`, `superseded_by`
- The learning timeline is git history: `git log -- memory-bank/agent-rules/_learned/` (there are no narrative learning log/metrics files in v2)

**For humans:**
- Auto-generated rules start at `low` priority — they never override your human-authored rules
- Review `git log -- memory-bank/agent-rules/_learned/` periodically to see what the system is learning
- Promote useful rules by changing their priority to `medium` or `high`
- Delete incorrect rules by removing the file (or specific bullets) and running `/bmb:rules-index`
- Judge a rule's effectiveness from its `evidence_count` / `last_validated` frontmatter; `superseded_by` marks rules merged into another (effectively retired)
- Max 10 learned rule files enforced — the system consolidates aggressively to prevent sprawl

### User-Supplied Agent Rules

Projects can define custom agent rules in `memory-bank/agent-rules/` that get loaded contextually based on file patterns, paths, or topics.

**Directory Structure:**
```
memory-bank/
├── agent-rules/                    # User-created rule files
│   ├── base-standards.md           # globs: ["**/*"], priority: high
│   ├── typescript.md               # globs: ["*.ts", "*.tsx"]
│   ├── testing.md                  # globs: ["*.test.*"]
│   └── [module]-rules.md           # paths: ["src/[module]/"]
└── agent-rules-index.md            # Auto-generated by /bmb:rules-index
```

**Rule File Format:**
```markdown
---
name: TypeScript Standards
globs: ["*.ts", "*.tsx"]
paths: ["src/"]
topics: ["typescript", "frontend"]
priority: medium  # low | medium | high | critical
---

# Your instructions here...
```

**How It Works:**
1. Run `/bmb:rules-index` to scan rules and generate the index
2. `/bmb:plan`, `/bmb:creative`, and `/bmb:build` auto-check if reindex is needed
3. Sub-agents load matching rules based on files they're working on
4. Higher priority rules win on conflicts

**Priority Levels:**
| Level | Use Case |
|-------|----------|
| `low` | General suggestions |
| `medium` | Language/domain standards (default) |
| `high` | Project-specific overrides |
| `critical` | Security/compliance requirements |

**Index Validation:**
- Detects context overload (too many rules matching same files)
- Detects conflicts between rules
- **Rejects unsafe rules** (non-dev instructions, prompt injection attempts)

**Full documentation**: See `${CLAUDE_PLUGIN_ROOT}/docs/agent-rules-examples.md`

