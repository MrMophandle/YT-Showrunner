# Project Configuration

## Banyan Memory Bank

This section is auto-managed by `/bmb:init`. Do not edit manually.

- **Banyan Version**: 2.2.1
- **Initialized**: 2026-08-12
- **Last Updated**: 2026-08-12

## Git & Branching (v2)

Read by every banyan command for branch routing and protected-branch enforcement (see `context/branch-routing.md`).

```yaml
metadata_branch: main
protected_branches: [main]
pr_target: main
sync_automation: none
archive_strategy: push-and-pr
worktree_root: ~/banyan-wt/yt-showrunner/
```

## Agent Backends

Which execution backend drives each configurable seam of the workflow. Codex companion not detected on this machine — every seam runs on Anthropic (behavior identical to pre-integration BMB). Re-run `/bmb:init` or `/bmb:doctor` after installing the Codex companion to re-detect.

```yaml
backends:
  plan:                  anthropic
  tdd:                   anthropic
  code-review:           anthropic
  creative-architecture: anthropic
  creative-uiux:         anthropic
  creative-algorithm:    anthropic
  creative-user-journey: anthropic
  creative-critique:     anthropic
  auto-final-review:     anthropic
  availability:          auto
```

## Team

Maps each contributor's git identity (email) to a friendly first name.

```yaml
team:
  92587431+MrMophandle@users.noreply.github.com: Ryan
```

## UAT

Project-wide defaults for `/bmb:uat`. Edit freely — these are read at the start of every UAT run.

- **default_sections**: happy,mobile
- **default_skip_ux_check**: false
- **default_environment**: dev
- **artifact_git_policy**: ignore
- **uat_required_for_archive**: false

## Notes

Add any additional context:
- Known issues or quirks
- Performance considerations
- CI/CD-specific configurations
- Local development tips
