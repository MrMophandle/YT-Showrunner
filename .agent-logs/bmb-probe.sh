#!/usr/bin/env bash
# bmb-probe.sh — Banyan Memory Bank consolidated environment probe.
#
# Read-only. Runs the entire init/discovery gather in ONE invocation so the
# whole sequence costs at most a single permission prompt instead of one per
# compound command. /bmb:init runs this after pre-provisioning permission
# patterns (see commands/init.md Step 0); it matches the pre-approved
# `Bash(bash .agent-logs/*)` allow pattern, so on a hot-reloaded settings file
# it runs with no prompt at all.
#
# Output is a flat, grep-friendly `KEY: value` / `SECTION ===` report. It never
# writes to the repo and never exits non-zero — every probe is best-effort and
# failures degrade to an empty/`(none)` value so the caller can always parse it.
#
# Usage: bash .agent-logs/bmb-probe.sh [metadata_branch]
#   metadata_branch defaults to the remote HEAD branch, else `main`.

set +e  # never abort the probe on a failed sub-probe
q() { "$@" 2>/dev/null; }   # quiet runner

echo "BMB-PROBE v1"
echo "probe_time_epoch: $(q date +%s)"

# ---- GIT base ----
echo "=== GIT ==="
if q git rev-parse --is-inside-work-tree | grep -q true; then
  echo "is_git_repo: true"
  echo "repo_root: $(q git rev-parse --show-toplevel)"
  echo "repo_name: $(basename "$(q git rev-parse --show-toplevel)")"
  echo "current_branch: $(q git branch --show-current)"
  echo "remote_url: $(q git remote get-url origin || echo '(none)')"
  # default branch (origin/HEAD target), falling back to main
  defbranch="$(q git symbolic-ref --quiet refs/remotes/origin/HEAD | sed 's#refs/remotes/origin/##')"
  [ -z "$defbranch" ] && defbranch="main"
  echo "default_branch: $defbranch"
else
  echo "is_git_repo: false"
fi

META="${1:-$defbranch}"
[ -z "$META" ] && META="main"
echo "assumed_metadata_branch: $META"

# ---- Clean-tree gate (invariant 7): uncommitted memory-bank edits in THIS worktree ----
echo "=== STATUS ==="
echo "porcelain_memory_bank:"
q git status --porcelain -- memory-bank/ | sed 's/^/  /'
echo "porcelain_all_count: $(q git status --porcelain | wc -l | tr -d ' ')"

# ---- Synchronous fetch (mutating command policy) ----
echo "=== FETCH ==="
if q git remote get-url origin >/dev/null; then
  q git fetch origin --prune >/dev/null 2>&1 && echo "fetched: true" || echo "fetched: false (offline or no access)"
else
  echo "fetched: false (no remote)"
fi

# ---- In-flight work (local + remote) ----
echo "=== INFLIGHT ==="
echo "local_branches:"
q git branch --list "feature/*" "chore/*" "task/*" --format='  %(refname:short)'
echo "remote_branches:"
q git for-each-ref --format='  %(refname:short)' refs/remotes/origin/feature refs/remotes/origin/chore refs/remotes/origin/task 2>/dev/null
# broader remote glob (covers nested names)
q git ls-remote --heads origin "feature/*" "chore/*" "task/*" 2>/dev/null | awk '{print "  remote: "$2}'

echo "=== WORKTREES ==="
q git worktree list --porcelain | sed 's/^/  /'

# ---- Memory bank presence / structure version ----
echo "=== MB ==="
[ -d memory-bank ] && echo "memory_bank_exists: true" || echo "memory_bank_exists: false"
[ -f CLAUDE.md ] && echo "claude_md_exists: true" || echo "claude_md_exists: false"
[ -f memory-bank/tasks.md ] && echo "v1_tasks_md_present: true" || echo "v1_tasks_md_present: false"
[ -f memory-bank/projectConfig.md ] && echo "project_config_present: true" || echo "project_config_present: false"
[ -f .github/CODEOWNERS ] && echo "codeowners_present: true" || echo "codeowners_present: false"
[ -f memory-bank/c4/c4-glossary.md ] && echo "c4_glossary_present: true" || echo "c4_glossary_present: false"

# ---- Codebase maturity (greenfield vs brownfield classification) ----
echo "=== MATURITY ==="
src_count=$(q find . -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.rb' -o -name '*.php' \) -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.venv/*' | wc -l | tr -d ' ')
echo "source_file_count: ${src_count:-0}"
echo "commit_count: $(q git rev-list --count HEAD || echo 0)"
echo "contributor_count: $(q git log --format='%ae' | sort -u | wc -l | tr -d ' ')"

# ---- PR CLI availability + auth (provider detection) ----
echo "=== PRCLI ==="
if command -v gh >/dev/null 2>&1; then
  q gh auth status >/dev/null 2>&1 && echo "gh: authed" || echo "gh: present-unauthed"
else echo "gh: absent"; fi
command -v glab >/dev/null 2>&1 && echo "glab: present" || echo "glab: absent"
command -v bb   >/dev/null 2>&1 && echo "bb: present"   || echo "bb: absent"

# ---- Ecosystem manifests (for dev-tool permission patterns) ----
echo "=== ECOSYSTEM ==="
for m in package.json tsconfig.json pyproject.toml setup.py requirements.txt go.mod Cargo.toml pom.xml build.gradle Gemfile composer.json; do
  [ -f "$m" ] && echo "manifest: $m"
done
# web/UI surface signal (for UAT offer)
{ [ -f package.json ] || q find . -maxdepth 2 -name '*.html' -not -path '*/.git/*' | grep -q .; } && echo "web_surface: likely" || echo "web_surface: unlikely"

echo "=== END ==="
