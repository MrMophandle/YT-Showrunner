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

- **Primary Flow**: [Main happy path - what most users do most often]
- **Onboarding**: [How new users get started]
- **Key Workflows**:
  - [Critical user journey 1]
  - [Critical user journey 2]

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

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk description] | [High/Medium/Low] | [High/Medium/Low] | [Mitigation strategy] |

## Open Questions

- [ ] [Question needing resolution]
- [ ] [Question needing resolution]

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-08-12 | Banyan Init | Initial creation |

## Last Refreshed

2026-08-12
