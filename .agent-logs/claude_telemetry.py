#!/usr/bin/env python3
"""
Aggregate token + latency telemetry from a Claude Code session transcript.

Reads the SessionEnd hook JSON from stdin, parses the transcript JSONL (main loop
+ inline sub-agent sidechain messages), and appends one authoritative per-session
record to .agent-logs/telemetry.jsonl (gitignored). This is OUT-OF-BAND telemetry:
token counts come from each message's `usage` block (what the harness recorded),
NOT from any model self-report — so it is reliable to trend over time.

Why this exists: wall-clock here is dominated by the COUNT of sequential turns/hops.
This record captures turns, sub-agent dispatch (hop) counts, the cached/uncached
input + output token split, and per-model usage so a turn-reduction / effort /
output-discipline change can be measured against a real baseline.

Schema note: the transcript per-message schema is not formally documented. Every
field is read defensively (missing -> 0 / skipped); the script always exits 0 so it
never breaks the hook chain.
"""

import json
import sys
import subprocess
from datetime import datetime
from pathlib import Path

TELEMETRY_SCHEMA = 1

# Claude API usage-field conventions (read defensively — names not formally documented for transcripts)
USAGE_KEYS = {
    "input": "input_tokens",                       # uncached input
    "cache_read": "cache_read_input_tokens",       # cache hit (≈0.1x cost, ~free TTFT)
    "cache_creation": "cache_creation_input_tokens",
    "output": "output_tokens",                     # serial decode — the latency driver
}


def repo_root() -> Path:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        )
        return Path(r.stdout.strip())
    except Exception:
        return Path.cwd()


def parse_ts(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def empty_bucket():
    return {"turns": 0, "input": 0, "cache_read": 0, "cache_creation": 0, "output": 0}


def add_usage(bucket, usage):
    bucket["turns"] += 1
    for key, api_name in USAGE_KEYS.items():
        v = usage.get(api_name)
        if isinstance(v, (int, float)):
            bucket[key] += int(v)


def with_total_input(bucket):
    return {**bucket, "total_input": bucket["input"] + bucket["cache_read"] + bucket["cache_creation"]}


def find_subagents_dir(transcript_path):
    """Locate the `<session>/subagents/` sidecar dir beside a transcript, or None.

    Modern Claude Code writes dispatched sub-agents to a sibling directory named after the
    session id (the transcript file stem), not inline in the main transcript.
    """
    p = Path(transcript_path)
    candidate = p.parent / p.stem / "subagents"
    return candidate if candidate.is_dir() else None


def read_subagent_tokens(subagents_dir):
    """Aggregate per-agent × per-model token usage from a subagents/ sidecar dir (G1).

    For each `*.meta.json` (carrying `agentType`), sum the `usage` blocks in its sibling
    `*.jsonl` grouped by model. Returns:
        {
          "by_agent": {agentType: {"dispatches": int, "by_model": {model: bucket}}},
          "by_model": {model: bucket},     # aggregate across all sub-agents
          "aggregate": bucket,             # total sub-agent bucket (fixes the isSidechain=0 bug)
        }
    Every read is defensive: a corrupt/missing jsonl contributes zero tokens but still
    counts the dispatch (the meta file proves the agent ran).
    """
    subagents_dir = Path(subagents_dir)
    by_agent = {}
    by_model = {}
    aggregate = empty_bucket()

    for meta_path in sorted(subagents_dir.glob("*.meta.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        agent_type = meta.get("agentType", "(unknown)")
        agent = by_agent.setdefault(agent_type, {"dispatches": 0, "by_model": {}})
        agent["dispatches"] += 1

        # meta file is "agent-<id>.meta.json"; its sibling is "agent-<id>.jsonl"
        jsonl_path = meta_path.parent / (meta_path.name[: -len(".meta.json")] + ".jsonl")
        if not jsonl_path.exists():
            continue
        try:
            with open(jsonl_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except Exception:
                        continue
                    msg = ev.get("message", {}) or {}
                    usage = msg.get("usage")
                    if not (isinstance(usage, dict)
                            and any(k in usage for k in USAGE_KEYS.values())):
                        continue
                    model = msg.get("model", "unknown")
                    add_usage(agent["by_model"].setdefault(model, empty_bucket()), usage)
                    add_usage(by_model.setdefault(model, empty_bucket()), usage)
                    add_usage(aggregate, usage)
        except Exception:
            continue

    return {"by_agent": by_agent, "by_model": by_model, "aggregate": aggregate}


def build_record(events, transcript_path, session_id):
    """Aggregate a session's telemetry record from parsed transcript events.

    Pulls main-loop tokens from the transcript, then merges sub-agent tokens from the
    `<session>/subagents/` sidecar dir (G1) — fixing the old bug where the subagents bucket
    read 0 because modern Claude Code no longer writes inline `isSidechain` messages.
    """
    main_loop = empty_bucket()
    subagents = empty_bucket()          # inline sidechain messages (old format; usually 0 now)
    by_model = {}                       # model id -> bucket
    dispatches = {}                     # subagent_type -> dispatch (hop) count
    timestamps = []
    unrecognized_usage = 0

    for ev in events:
        msg = ev.get("message", {})
        if not isinstance(msg, dict):
            msg = {}

        ts = parse_ts(ev.get("timestamp"))
        if ts:
            timestamps.append(ts)

        # Hop counts: Task/Agent tool_use blocks in the (main-loop) assistant messages
        content = msg.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "tool_use" and item.get("name") in ("Task", "Agent"):
                    inp = item.get("input", {})
                    st = inp.get("subagent_type", "(unspecified)") if isinstance(inp, dict) else "(unspecified)"
                    dispatches[st] = dispatches.get(st, 0) + 1

        # Token usage (assistant messages carry `usage`)
        usage = msg.get("usage")
        if isinstance(usage, dict) and any(k in usage for k in USAGE_KEYS.values()):
            bucket = subagents if ev.get("isSidechain") else main_loop
            add_usage(bucket, usage)
            model = msg.get("model", "unknown")
            add_usage(by_model.setdefault(model, empty_bucket()), usage)
        elif isinstance(usage, dict):
            unrecognized_usage += 1

    # G1: merge sub-agent tokens from the sidecar dir (additive — sidecar messages are NOT
    # in the main transcript, so there is no double count with inline sidechain).
    by_agent = {}
    sidecar_dir = find_subagents_dir(transcript_path)
    if sidecar_dir is not None:
        sidecar = read_subagent_tokens(sidecar_dir)
        by_agent = sidecar["by_agent"]
        for key in ("turns", "input", "cache_read", "cache_creation", "output"):
            subagents[key] += sidecar["aggregate"][key]
        for model, bucket in sidecar["by_model"].items():
            dest = by_model.setdefault(model, empty_bucket())
            for key in dest:
                dest[key] += bucket[key]

    wall_seconds = None
    if len(timestamps) >= 2:
        timestamps.sort()
        wall_seconds = (timestamps[-1] - timestamps[0]).total_seconds()

    return {
        "telemetry_schema": TELEMETRY_SCHEMA,
        "session_id": session_id,
        "generated_at": datetime.now().astimezone().isoformat(),
        # NOTE: wall_seconds spans first->last message timestamp; it INCLUDES tool runs
        # and human-approval idle gaps, so it is NOT pure inference latency. Trend it,
        # but compare token/turn counts for the cleaner signal.
        "wall_seconds_session": wall_seconds,
        "main_loop": with_total_input(main_loop),
        "subagents_aggregate": with_total_input(subagents),
        "by_model": {m: with_total_input(b) for m, b in by_model.items()},
        "by_agent": {
            a: {"dispatches": d["dispatches"],
                "by_model": {m: with_total_input(b) for m, b in d["by_model"].items()}}
            for a, d in by_agent.items()
        },
        "subagent_dispatches": dispatches,
        "totals": {
            "turns": main_loop["turns"] + subagents["turns"],
            "output_tokens": main_loop["output"] + subagents["output"],
            "sub_agent_dispatch_count": sum(dispatches.values()),
        },
        "caveats": {
            "wall_clock_includes_idle_and_tools": True,
            "messages_with_unrecognized_usage": unrecognized_usage,
            "sidechain_attribution": (
                "sub-agent tokens read from the <session>/subagents/ sidecar dir "
                "(agent-*.meta.json agentType + sibling .jsonl usage), grouped per agent "
                "per model. Inline isSidechain messages (old format) are added too."
            ),
        },
    }


def main():
    try:
        hook = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    transcript_path = hook.get("transcript_path")
    session_id = hook.get("session_id", "unknown")
    if not transcript_path:
        sys.exit(0)
    transcript_path = Path(transcript_path)
    if not transcript_path.exists():
        sys.exit(0)

    events = []
    try:
        with open(transcript_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        sys.exit(0)

    record = build_record(events, transcript_path, session_id)
    wall_seconds = record["wall_seconds_session"]

    try:
        base = repo_root() / ".agent-logs" / "telemetry"
        base.mkdir(parents=True, exist_ok=True)
        with open(repo_root() / ".agent-logs" / "telemetry.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        (base / f"{session_id}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
        t = record["totals"]
        print(
            f"Telemetry: {t['turns']} turns · {t['sub_agent_dispatch_count']} sub-agent dispatches · "
            f"{t['output_tokens']} output tokens · wall "
            f"{('%.0fs' % wall_seconds) if wall_seconds is not None else 'n/a'} (incl. idle)",
            file=sys.stderr,
        )
    except Exception as e:
        print(f"telemetry write skipped: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
