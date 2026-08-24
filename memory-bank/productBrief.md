# Product Brief

> This document captures the **product and project context** for development teams.
> It ensures all agents understand the product's purpose, users, constraints, **and the project's foundation**.
> (Project foundation — formerly a separate `projectbrief.md` — now lives in the section below.)

## Project Foundation

The engineering-facing "what is this repository" — formerly `projectbrief.md`.

- **Project Name**: YT-Showrunner
- **Objectives**: [Primary engineering objectives and success criteria for the project]
- **Scope**: [What this project does and explicitly does not cover]
- **Repository Structure**: Greenfield — repository currently contains only a LICENSE file; no source tree established yet (single-repo, structure TBD as code is added)
- **Key Stakeholders**: [Teams/owners responsible for this codebase]

## Git Configuration
- **Repository**: Yes
- **Provider**: GitHub
- **CLI Available**: gh
- **Remote URL**: https://github.com/MrMophandle/YT-Showrunner.git
- **Default Branch**: main
- **Metadata Branch**: main
- **Routing Mode**: classic
- **Sync Automation**: none
- **Archive Strategy**: push-and-pr

## Product Overview

- **Name**: [Product name]
- **Value Proposition**: [What problem it solves and for whom]
- **Product Type**: [SaaS/CLI/Library/Platform/API/Mobile App/etc.]
- **Stage**: Concept

## Key Functionality

Core capabilities this product provides:

- **Conversational Season Drafting** (Phase 2-4) — User converses with Claude AI to draft a season's episodes. The system maintains canon context (series overview, character bibles, continuity ledger) throughout the conversation and streams responses in real-time.
- **Draft Preview** (Phase 3) — Live-updating panel showing the current draft (title, logline, threads for each episode) as Claude composes. Polls the server for the last-good draft, gracefully handling in-flight writes.
- **Draft Signoff** (Phase 4) — User can approve the current draft (commits to canon: renders season markdown file and appends dated entry to continuity ledger with addressed threads), or reject with notes (resumes the session with feedback, streaming reply into the same conversation).
- [Additional capability if needed]

## Markets Serviced

- **Primary Market**: [Industry/vertical - e.g., Healthcare, Finance, E-commerce]
- **Secondary Markets**: [Other industries if applicable]
- **Geographic Focus**: [Regions/countries if applicable, or "Global"]
- **Market Size**: [If known - TAM/SAM/SOM estimates]

## Competitive Landscape

- **Direct Competitors**: [List main competitors]
- **Indirect Competitors**: [Alternative solutions users might choose]
- **Key Differentiators**: [What sets this product apart]
- **Competitive Advantages**: [Unique strengths - technology, UX, pricing, etc.]

## Key Personas

### Primary Users

| Persona | Role | Goals | Pain Points | Success Metrics |
|---------|------|-------|-------------|-----------------|
| [Name] | [Job title/role] | [What they want to achieve] | [Current challenges] | [How they measure success] |

### Secondary Users

| Persona | Role | Goals |
|---------|------|-------|
| [Name] | [Job title/role] | [What they want to achieve] |

### Administrators/Operators

| Persona | Role | Responsibilities |
|---------|------|------------------|
| [Name] | [Job title/role] | [What they manage/configure] |

## User Flows

### Primary Flow — the Story-Shaping Session (observed, not hypothesized)

This is the interaction the product exists to serve. It is documented here from a **real
transcript** the product owner shared on 2026-08-23 (an episode-level session shaping ep08,
"The Wall of Silence"), with the explicit note that the same conversation shape is wanted at
**season level** — which is what the `season-drafting` skill drives. Read this before designing
anything that touches the drafting conversation; it is the spec that matters most and the least
obvious from the code.

**The loop**: the assistant states what is already binding, names the open forks, and
recommends; the user rules; the assistant records consequences and surfaces the next fork.
Repeat until the shape is settled. The user's closing move is typically "that's all I have" or
a ruling on the last fork — not a request for prose.

**What the assistant is actually doing** — in rough order of value:

1. **Consistency-checking new fiction against retrieved canon.** The highest-value moment in
   the observed session was catching that a user-invented detail (the Iss-kar radio-silence
   doctrine) collided with an existing canon law (the Mute does not hear radio), which turned
   an ordinary backstory into the episode's central irony. A second instance caught two
   characters independently reaching the same wrong conclusion from the same evidence across
   two episodes. **Neither is generation. Both are retrieval plus contradiction-detection** —
   which is precisely what `context-bundle.ts` delivering canon verbatim exists to enable, and
   why bundle fidelity is the capability to protect above all others.
2. **Holding four distinct states**: *ruled* (canon says it), *unruled* (canon is silent, so
   the user decides), *amendment* (extends canon without conflict), *contradiction* (cannot
   stand). The assistant labels which one applies and cites the source file and line.
3. **Tracking budgets as law, with declared exceptions.** e.g. one guest death per episode
   (`episode-formula.md`), one shard beat per episode (season law). When the user chooses to
   exceed a budget, the assistant records it as a *declared exception with the register named*
   (HONOR, collective) so a later audit does not read it as drift, and a later episode does not
   treat the exception as precedent.
4. **Separating bookkeeping consequences from creative ones**, explicitly flagged ("one
   bookkeeping note…"), so the user can rule on the story without losing the paperwork.
5. **Arguing back, with reasons.** The observed session pushed against the user's own naming
   suggestion on grounds of tonal cost, and offered an alternative that put the humor where it
   was cheaper. Deference is not the goal; the user rules, but unexamined agreement is a
   failure mode.
6. **Recording retro-plants** — obligations a *future* episode must satisfy.
7. **Ending on one fork, not a menu.** "Where do you want to start?" / "What else have you
   got?" One open question at a time.

**Register discipline**: the assistant respects character invariants when proposing (a
character ruled as deflect-with-silence cannot be given a speech), and proposes mechanisms that
honor them instead — which is a constraint on *generation*, downstream of the canon it holds.

**Session-state summary**: the observed transcript carries a running `※ recap:` line
restating where the session is and what is needed next. See § Known Issues for why this is
probably the console's job rather than the model's.

### Onboarding
Not yet designed. Today's entry point is typing a season URL directly
(`/seasons/<id>/chat`); season selection/management is deliberately out of scope so far.

### Key Workflows
- **Season drafting** — the flow above, producing `season.draft.json`, with Draft Preview
  updating live as the model writes.
- **Signoff** — approve (commits to canon: renders the season file and appends a dated
  continuity-ledger entry) or reject with notes (resumes the session with feedback).

## Success Metrics & KPIs

### Business Metrics
- [Revenue, ARR, MRR targets]
- [Conversion rates]
- [Customer retention/churn]

### Product Metrics
- [DAU/MAU targets]
- [Engagement metrics]
- [Feature adoption rates]

### Technical Metrics
- [Uptime targets]
- [Latency targets]
- [Error rate thresholds]

## Non-Functional Requirements

### Performance

- **Response Time**: [Target latency, e.g., p95 < 200ms, p99 < 500ms]
- **Throughput**: [Expected load, e.g., 1000 req/s]
- **Concurrent Users**: [Expected simultaneous users]
- **Page Load Time**: [If web app - e.g., < 3s on 3G]

### Scalability

- **Users**: [Current and projected user count]
- **Data Volume**: [Current and projected data size]
- **Growth Rate**: [Expected growth trajectory]
- **Peak Load**: [Expected peak vs average ratio]

### Security

- **Authentication**: [Method - OAuth 2.0, SAML, API keys, MFA, etc.]
- **Authorization**: [Model - RBAC, ABAC, ACL, etc.]
- **Compliance**: [Standards - SOC2, HIPAA, GDPR, PCI-DSS, FedRAMP, etc.]
- **Data Classification**: [Sensitivity levels handled - Public, Internal, Confidential, Restricted]
- **Encryption**: [At rest, in transit requirements]

### Availability & Reliability

- **Uptime Target**: [SLA, e.g., 99.9%, 99.99%]
- **Recovery Time Objective (RTO)**: [Max acceptable downtime]
- **Recovery Point Objective (RPO)**: [Max acceptable data loss]
- **Disaster Recovery**: [DR strategy - active-active, active-passive, etc.]
- **Backup Strategy**: [Backup frequency and retention]

### Data & Privacy

- **Data Residency**: [Where data must be stored - regions/countries]
- **Data Retention**: [How long data is kept, deletion policies]
- **Privacy Requirements**: [GDPR, CCPA, LGPD, etc.]
- **PII Handling**: [How personal data is collected, stored, processed]
- **Data Portability**: [Export requirements]
- **Right to Deletion**: [Data deletion process]

### Accessibility

- **Target Compliance**: [WCAG level - A, AA, AAA]
- **Key Requirements**:
  - [ ] Screen reader compatibility
  - [ ] Keyboard navigation
  - [ ] Color contrast compliance
  - [ ] Focus indicators
  - [ ] Alt text for images
  - [ ] Captions for video/audio

### Internationalization (i18n)

- **Supported Languages**: [List of languages]
- **Localization Needs**:
  - [ ] Currency formatting
  - [ ] Date/time formatting
  - [ ] Number formatting
  - [ ] RTL support
  - [ ] Cultural considerations

### Browser/Platform Support

- **Browsers**: [Chrome, Firefox, Safari, Edge - versions]
- **Mobile**: [iOS, Android - versions]
- **Desktop**: [Windows, macOS, Linux - if applicable]

## Integration Points

### External Systems

| System | Purpose | Protocol | Direction |
|--------|---------|----------|-----------|
| [System name] | [Why integrated] | [REST/GraphQL/gRPC/etc.] | [Inbound/Outbound/Both] |

### APIs Consumed

| API | Provider | Purpose |
|-----|----------|---------|
| [API name] | [Provider] | [What it's used for] |

### APIs Provided

| API | Purpose | Consumers |
|-----|---------|-----------|
| [API name] | [What it does] | [Who uses it] |

### Data Sources

| Source | Type | Frequency |
|--------|------|-----------|
| [Source name] | [Database/API/File/Stream] | [Real-time/Batch/etc.] |

## Constraints & Assumptions

### Business Constraints

- Local-only tool (no multi-user SaaS scaling in Phase 1)
- Single-user model (no concurrency, auth, or RBAC required in Phase 1)
- Desktop-bound (localhost-only, no mobile or external access)

### Technical Constraints

- **Node.js runtime**: Requires Node.js 22+ for runtime compatibility
- **TypeScript strict mode**: All production code must pass TypeScript strict type checking
- **Single-process model**: Headless `claude -p` spawns per turn; no process pooling in Phase 1
- **Localhost-only binding**: Server binds to `127.0.0.1:6187` exclusively; no external network exposure

### Assumptions

- `claude -p --output-format stream-json` will be available on PATH when the server runs
- `.agent-logs/claude_transcript_to_md.py` is available for reference during development (for stream-json format understanding)
- Session resume (`--resume <id>`) produces deterministic turn results (used for replay and caching in later phases)
- Canon directory structure (`seasons/<seasonId>/`) is writable by the Node process

### Known Issues & Deferred Work

#### Transitive Dev-Only CVEs in Vitest/Vite/esbuild Chain (Deferred Security Bump)
- **Issue**: Vitest 2.1.8 has critical/high/moderate CVEs in transitive dependencies (vite, esbuild)
- **Scope**: Dev-only; no production exposure (no `--ui` flag, no Vite dev server, no external build server)
- **Risk Level**: Low for Phase 1 (local dev only)
- **Mitigation**: Scheduled for dedicated security bump to Vitest 4.x in a later DEDICATED-TASK (separate from feature work)
- **Test Coverage**: No changes to test behavior; CVEs are in test tooling, not test or production code

#### The Draft Artifact Cannot Hold What the Session Produces (design gap, not a bug)
- **Issue**: `SeasonDraftEpisode` is `{ title, logline, threads[] }` (`draft-watcher.ts:18`).
  The story-shaping session documented in § User Flows produces rulings with rationale, canon
  amendments naming a target file, declared budget exceptions with a register, retro-plants
  binding future episodes, new canon terms, per-episode beats, and **live open forks awaiting
  a ruling**. Almost none of that has anywhere to go, so Draft Preview renders two lines per
  episode and the rest is lost when the session ends.
- **Sharpest instance**: an unresolved fork is the *engine* of the whole conversation
  ("three things need you, and the first is the biggest"). A draft schema with no notion of an
  open question cannot represent the thing driving the exchange.
- **Also**: the running `※ recap:` state summary is re-derived by the model every turn.
  The console already knows the session state, so this is plausibly the app's job — spending
  model context on it is waste.
- **Scope**: display + persistence layer. Does not affect the conversation itself, which works
  (the AC-VERIFY-1 walk showed canon-grounded replies citing ledger threads verbatim).
- **Status**: Deferred, and deliberately **not** a schema patch — it is a "what should the
  season-level artifact be" design question and wants its own design conversation. Raised
  2026-08-23; noted so a future agent does not widen the schema field-by-field without
  settling the shape first.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Draft artifact captures a fraction of session value, so work is lost between sessions | High | High | Design the season-level artifact deliberately — see § Known Issues, "The Draft Artifact Cannot Hold What the Session Produces" |
| Canon fidelity in the context bundle regresses, silently degrading the assistant's best capability (contradiction-detection) | Medium | High | Bundle composition is unit-tested (`context-bundle.test.ts`); treat verbatim-canon assertions as protected |

## Open Questions

- [ ] What should the season-level draft artifact actually be, given the session produces
      rulings, amendments, declared exceptions, retro-plants, and open forks rather than just
      episode loglines? (See § Known Issues.)
- [ ] Should the running session-state recap be owned by the console rather than re-derived by
      the model each turn?
- [ ] Should canon amendments the session agrees to be written back to canon files
      automatically, or only proposed for the user to apply at signoff?

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-08-12 | Banyan Init | Initial creation |
| 2026-08-23 | client-styling / transcript-turn-grouping | Documented the story-shaping session as the primary user flow, from a real transcript the product owner shared. Recorded the draft-artifact design gap, two risks, and three open questions it surfaced. |

## Last Refreshed

2026-08-23
