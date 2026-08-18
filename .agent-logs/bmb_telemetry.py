#!/usr/bin/env python3
"""bmb-telemetry — anonymous, opt-out usage telemetry for the Banyan Memory Bank plugin.

This is a self-contained, dependency-free CLI bundled with the BMB plugin. It buffers
telemetry events locally and (once the ai-portal endpoint is live) ships them in one
authenticated batch at SessionEnd.

Design rules (see docs/plans/2026-07-16-telemetry-feature-plan.md):
  • On by default, trivially easy to opt out (.NET/Next.js precedent).
  • Anonymous but trackable: a random UUIDv4 install_id, never a machine/person id.
  • Never blocks a workflow; fail-silent; always exits 0.
  • Collects only coarse, anonymized, aggregate-friendly data — never code, paths,
    repo names, prompts, or PII.

Subcommands: emit · flush · opt-out · opt-in · status · id
"""

import contextlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Batch-envelope payload schema major. The ai-portal /v1 shape is schema 1 (reconciled
# contract R-F1). This field lives ONLY on the batch envelope, never on individual events.
SCHEMA = 1

# ---------------------------------------------------------------------------
# Config persistence  (user-global: ~/.config/bmb/telemetry.json)
# ---------------------------------------------------------------------------


def load_config(path):
    """Return the persisted config dict, or {} if missing or corrupt (fail-safe)."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(path, config):
    """Persist the config dict, creating parent directories as needed."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def get_or_create_install_id(path):
    """Return the stable anonymous install_id, generating + persisting one if absent.

    A random UUIDv4 — anonymous (not machine/user-derived) yet stable across sessions.
    """
    config = load_config(path)
    iid = config.get("install_id")
    if not iid:
        iid = str(uuid.uuid4())
        config["install_id"] = iid
        save_config(path, config)
    return iid


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------

# Values that mean "not opted out" when they appear in an opt-out env var.
_FALSEY = {"", "0", "false", "no", "off"}


def _is_optout_signal(value):
    """True if an env-var value should be read as an explicit opt-out."""
    if value is None:
        return False
    return str(value).strip().lower() not in _FALSEY


def is_enabled(env, config):
    """Resolve consent. Telemetry is ON by default; OFF if any opt-out signal is present.

    Precedence: an explicit env opt-out (DO_NOT_TRACK or BMB_TELEMETRY_DISABLED) always
    wins; otherwise a persisted config `enabled: false` disables; otherwise enabled.
    """
    if _is_optout_signal(env.get("DO_NOT_TRACK")):
        return False
    if _is_optout_signal(env.get("BMB_TELEMETRY_DISABLED")):
        return False
    if config.get("enabled") is False:
        return False
    return True


# ---------------------------------------------------------------------------
# Events + local buffer
# ---------------------------------------------------------------------------


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def build_event(*, event, props, install_id, session_id, bmb_version, os_name,
                ts=None, event_id=None):
    """Build one telemetry event object (reconciled contract §5).

    Note: the event object carries NO `schema` field — `schema` is a batch-envelope field
    only (R-F1). The server validates these fields strictly.
    """
    return {
        "event_id": event_id or str(uuid.uuid4()),
        "event": event,
        "install_id": install_id,
        "session_id": session_id,
        "bmb_version": bmb_version,
        "os": os_name,
        "ts": ts or _now_iso(),
        "props": props or {},
    }


@contextlib.contextmanager
def _buffer_lock(buffer_path):
    """Advisory exclusive lock serializing buffer access across concurrent sessions.

    Multiple Claude Code sessions on one machine share the user-global buffer; without a
    lock an append landing between a flush's read and its rewrite is clobbered. Uses
    fcntl.flock on a sidecar `.lock` file (advisory, works across processes). Degrades to a
    no-op where fcntl is unavailable (e.g. native Windows) — best-effort, never blocks work.
    """
    buffer_path = Path(buffer_path)
    buffer_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import fcntl
    except Exception:
        yield  # no advisory locking available on this platform
        return
    lock_file = open(str(buffer_path) + ".lock", "w")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        finally:
            lock_file.close()


def append_event(buffer_path, event):
    """Append one event as a JSON line to the local buffer (creates parent dir).

    Holds the buffer lock so a concurrent flush's read+truncate cannot clobber the append.
    """
    buffer_path = Path(buffer_path)
    buffer_path.parent.mkdir(parents=True, exist_ok=True)
    with _buffer_lock(buffer_path):
        with open(buffer_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")


def emit_event(*, buffer_path, env, config, event, props, install_id, session_id,
               bmb_version, os_name, ts=None, event_id=None):
    """Consent-gated emit: buffer the event, or no-op silently when opted out.

    Returns True if the event was buffered, False if telemetry is disabled.
    """
    if not is_enabled(env, config):
        return False
    append_event(buffer_path, build_event(
        event=event, props=props, install_id=install_id, session_id=session_id,
        bmb_version=bmb_version, os_name=os_name, ts=ts, event_id=event_id,
    ))
    return True


# ---------------------------------------------------------------------------
# Token-usage event  (maps a claude_telemetry record → OTel-named event props)
# ---------------------------------------------------------------------------

# Internal bucket key -> OpenTelemetry GenAI semantic-convention attribute name.
_OTEL_TOKEN_NAMES = {
    "input": "gen_ai.usage.input_tokens",
    "cache_read": "gen_ai.usage.cache_read_input_tokens",
    "cache_creation": "gen_ai.usage.cache_creation_input_tokens",
    "output": "gen_ai.usage.output_tokens",
}


def _otel_buckets(bucket):
    """Rename an internal token bucket to non-overlapping OTel-named fields."""
    return {otel: int(bucket.get(internal, 0) or 0)
            for internal, otel in _OTEL_TOKEN_NAMES.items()}


def _agent_event_entry(agent_record):
    """Build one by_agent entry in the reconciled shape (R-F4).

    Top level carries the OTel token fields summed across models — matching the backend's
    documented `{agent: {gen_ai.usage.*}}` shape (forward-compatible with a future per-agent
    rollup). We additionally retain `dispatches` and the per-model breakdown as extra opaque
    keys, so "tokens per model per agent" is preserved (the server stores by_agent opaquely).
    """
    otel_by_model = {m: _otel_buckets(b) for m, b in (agent_record.get("by_model") or {}).items()}
    summed = {name: 0 for name in _OTEL_TOKEN_NAMES.values()}
    for buckets in otel_by_model.values():
        for name, value in buckets.items():
            summed[name] += value
    return {**summed, "dispatches": agent_record.get("dispatches", 0), "by_model": otel_by_model}


# Fixed namespace for deterministic session_token_usage event ids. A cancelled/retried
# SessionEnd flush rebuilds the token event; deriving its id from session_id makes the retry
# collide on the same event_id so the server's proc#<event_id> idempotency dedupes it to
# exactly one token event per session (prevents session-count inflation).
_TOKEN_EVENT_NS = uuid.UUID("6f9b1e2a-0000-4000-8000-000000000001")


def session_token_event_id(session_id):
    """Deterministic UUID for a session's token event, derived from session_id."""
    return str(uuid.uuid5(_TOKEN_EVENT_NS, f"session_token_usage:{session_id}"))


def build_token_event_props(record, complexity_level, multi_task=False):
    """Map a claude_telemetry record into session_token_usage event props (R-F4)."""
    totals = record.get("totals", {}) or {}
    return {
        "complexity_level": complexity_level,
        "multi_task": multi_task,
        "turns_total": totals.get("turns", 0),
        "sub_agent_dispatch_count": totals.get("sub_agent_dispatch_count", 0),
        "by_model": {m: _otel_buckets(b) for m, b in (record.get("by_model") or {}).items()},
        "by_agent": {a: _agent_event_entry(d) for a, d in (record.get("by_agent") or {}).items()},
    }


# ---------------------------------------------------------------------------
# Transport  (authenticated, batched, lossless-retry)
# ---------------------------------------------------------------------------

MAX_BATCH = 500
HTTP_TIMEOUT = 2.0  # seconds — never make a dev wait on telemetry


def build_batch(events, *, sent_at, batch_id):
    """Wrap events in the batch envelope the ai-portal /v1/bmb/events endpoint expects."""
    return {"schema": SCHEMA, "sent_at": sent_at, "batch_id": batch_id, "events": events}


def sign_body(body_bytes, secret):
    """HMAC-SHA256 of the raw body → 'sha256=<hex>'. Obfuscation, not authentication."""
    import hashlib
    import hmac
    digest = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return "sha256=" + digest


def _read_buffer(buffer_path):
    buffer_path = Path(buffer_path)
    if not buffer_path.exists():
        return []
    events = []
    for line in buffer_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except Exception:
            continue
    return events


def _write_buffer(buffer_path, events):
    buffer_path = Path(buffer_path)
    if not events:
        # Fully drained — truncate so a partially-consumed buffer never resends.
        buffer_path.write_text("", encoding="utf-8")
        return
    buffer_path.write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")


def _claim_buffer(buffer_path):
    """Atomically take ownership of all buffered events: read + truncate under the lock.

    Returns the claimed events and leaves the buffer empty, so a concurrent flush sees
    nothing to send and cannot double-send, and concurrent appends land in the now-empty
    buffer (picked up next flush). Unsent events are returned via _requeue_events.
    """
    with _buffer_lock(buffer_path):
        events = _read_buffer(buffer_path)
        _write_buffer(buffer_path, [])
        return events


def _requeue_events(buffer_path, events):
    """Return unsent events to the buffer, ahead of anything appended since the claim."""
    if not events:
        return
    with _buffer_lock(buffer_path):
        current = _read_buffer(buffer_path)
        _write_buffer(buffer_path, events + current)


def urllib_sender(url, body, headers, timeout=HTTP_TIMEOUT):
    """Default transport: POST via stdlib urllib. Returns HTTP status, or 0 on failure."""
    import urllib.request
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except Exception as e:
        code = getattr(e, "code", None)
        return int(code) if isinstance(code, int) else 0


def flush_buffer(*, buffer_path, endpoint, api_key, secret, sender, batch_id, now_iso,
                 max_batch=MAX_BATCH):
    """Drain the buffer into batches, POST each, and keep only what the server rejected.

    A batch is removed from the buffer ONLY on HTTP 202. On any other status or an
    exception, that batch and all following batches stay buffered for next-session retry
    (events carry event_id, so resend is idempotent server-side). Never raises.

    Concurrency-safe: events are claimed (read + truncate) under the buffer lock BEFORE any
    network I/O, so the lock is never held across a POST; unsent events are requeued under
    the lock afterward. Concurrent appends/flushes cannot lose or double-send events.
    """
    events = _claim_buffer(buffer_path)
    if not events:
        return {"sent": 0, "remaining": 0}

    batches = [events[i:i + max_batch] for i in range(0, len(events), max_batch)]
    sent = 0
    remaining = []
    stopped = False
    for i, batch_events in enumerate(batches):
        if stopped:
            remaining.extend(batch_events)
            continue
        payload = build_batch(batch_events, sent_at=now_iso, batch_id=f"{batch_id}-{i}")
        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json", "x-api-key": api_key or ""}
        if secret:
            headers["x-bmb-signature"] = sign_body(body, secret)
        try:
            status = sender(endpoint, body, headers)
        except Exception:
            status = 0
        if status == 202:
            sent += len(batch_events)
        else:
            stopped = True
            remaining.extend(batch_events)

    _requeue_events(buffer_path, remaining)
    return {"sent": sent, "remaining": len(remaining)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

DEFAULT_ENDPOINT = "https://portal.ai.banyansoftware.net/v1/bmb/events"


def resolve_endpoint(env, config):
    """Resolve the ingest endpoint. Production by default; overridable (for dev/staging).

    Precedence: BMB_TELEMETRY_ENDPOINT env var > persisted `endpoint` config key > default.
    Both override mechanisms are intentionally undocumented in the user-facing TELEMETRY.md —
    they exist for internal testing against a dev instance.
    """
    env_ep = (env or {}).get("BMB_TELEMETRY_ENDPOINT")
    if env_ep:
        return env_ep
    cfg_ep = (config or {}).get("endpoint")
    if cfg_ep:
        return cfg_ep
    return DEFAULT_ENDPOINT

# Write-only public ingest key, shipped in the package (Sentry-DSN model — see the auth
# section of the feature plan). This is intentionally public: it grants POST /v1/bmb/events
# only, and the endpoint defends the DATA (dedupe, rate-limit, validate), not the identity.
# Public write-only release key (baked in at release; overridable via BMB_TELEMETRY_API_KEY).
EMBEDDED_API_KEY = "bmb_wk_rel_36daaa3f7dfc07f992e33b4e"
# Optional HMAC secret — obfuscation only (it ships too); overridable via BMB_TELEMETRY_HMAC_SECRET.
# Left empty by default: no signature header is sent unless a secret is configured.
EMBEDDED_HMAC_SECRET = ""
OPTOUT_HELP = (
    "Opt out any time with: `bmb-telemetry opt-out`, or set DO_NOT_TRACK=1 "
    "or BMB_TELEMETRY_DISABLED=1."
)

FIRST_RUN_NOTICE = (
    "\n"
    "  Banyan Memory Bank collects ANONYMOUS usage telemetry to improve the plugin\n"
    "  (which commands run, success/abandon rates, and per-model token usage). It is\n"
    "  tied only to a random install id — never your code, file paths, repo names, or\n"
    "  any personal data. See the bmb plugin's docs/TELEMETRY.md (linked from its\n"
    "  README) for exactly what's collected.\n"
    "  " + OPTOUT_HELP + "\n"
)


def default_config_path(env):
    """User-global config path, honoring XDG_CONFIG_HOME."""
    base = env.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / "bmb" / "telemetry.json"


def detect_os(platform_name):
    """Map sys.platform to a coarse family: darwin | linux | win32 | other."""
    if platform_name.startswith("darwin"):
        return "darwin"
    if platform_name.startswith("linux"):
        return "linux"
    if platform_name.startswith("win"):
        return "win32"
    return "other"


def parse_props(pairs):
    """Parse ['k=v', ...] --prop pairs into a dict (values kept as strings)."""
    props = {}
    for pair in pairs or []:
        if "=" in pair:
            k, v = pair.split("=", 1)
            props[k] = v
    return props


def main(argv=None, *, config_path=None, buffer_path=None, env=None, out=None,
         bmb_version=None, platform_name=None, stdin=None, sender=None):
    import sys
    argv = list(sys.argv[1:] if argv is None else argv)
    env = dict(env if env is not None else os_environ())
    out = out if out is not None else sys.stdout
    config_path = Path(config_path) if config_path else default_config_path(env)
    if buffer_path is None:
        buffer_path = config_path.parent / "telemetry-queue.jsonl"
    buffer_path = Path(buffer_path)
    bmb_version = bmb_version or _read_bmb_version()
    os_name = detect_os(platform_name or _sys_platform())

    if not argv:
        print("usage: bmb-telemetry {emit|flush|opt-out|opt-in|status|id}", file=out)
        return 2
    cmd, rest = argv[0], argv[1:]

    if cmd == "opt-out":
        cfg = load_config(config_path)
        cfg["enabled"] = False
        save_config(config_path, cfg)
        print("BMB telemetry opted OUT. No usage data will be collected or sent.", file=out)
        return 0

    if cmd == "opt-in":
        cfg = load_config(config_path)
        cfg["enabled"] = True
        save_config(config_path, cfg)
        print("BMB telemetry opted IN (anonymous). " + OPTOUT_HELP, file=out)
        return 0

    if cmd == "status":
        cfg = load_config(config_path)
        iid = get_or_create_install_id(config_path)
        state = "enabled" if is_enabled(env, cfg) else "disabled"
        endpoint = resolve_endpoint(env, cfg)
        print(f"BMB telemetry: {state}", file=out)
        print(f"  install_id: {iid}", file=out)
        print(f"  endpoint:   {endpoint}"
              + ("  (overridden)" if endpoint != DEFAULT_ENDPOINT else ""), file=out)
        print(f"  {OPTOUT_HELP}", file=out)
        return 0

    if cmd == "id":
        print(get_or_create_install_id(config_path), file=out)
        return 0

    if cmd == "notice":
        cfg = load_config(config_path)
        force = "--force" in rest
        if cfg.get("first_run_notice_shown") and not force:
            return 0  # already shown — stay silent
        print(FIRST_RUN_NOTICE, file=out)
        if not force:
            cfg["first_run_notice_shown"] = True
            save_config(config_path, cfg)
        return 0

    if cmd == "emit":
        try:
            if not rest:
                return 0  # nothing to emit; hook-safe no-op
            event_name = rest[0]
            props = parse_props([rest[i + 1] for i, a in enumerate(rest) if a == "--prop"
                                 and i + 1 < len(rest)])
            emit_event(
                buffer_path=buffer_path, env=env, config=load_config(config_path),
                event=event_name, props=props,
                install_id=get_or_create_install_id(config_path),
                session_id=env.get("CLAUDE_SESSION_ID", "unknown"),
                bmb_version=bmb_version, os_name=os_name,
            )
        except Exception:
            pass  # never break a workflow
        return 0

    if cmd == "flush":
        # Read the hook JSON BEFORE any detach so the stdin data is captured in memory.
        hook = _read_hook_stdin(stdin)
        # Real runs (no injected sender) detach into a new session so the network POST
        # survives Claude Code cancelling the SessionEnd hook. Tests inject a sender and
        # run inline (no fork). See _detach.
        role = "inline" if sender is not None else _detach()
        if role == "parent":
            return 0  # original hook process returns immediately; work continues detached
        try:
            _do_flush(config_path=config_path, buffer_path=buffer_path, env=env,
                      bmb_version=bmb_version, os_name=os_name, hook=hook, sender=sender)
        except Exception:
            pass  # never break the SessionEnd hook chain
        if role == "child":
            import os
            os._exit(0)  # detached worker must not fall back into the caller
        return 0

    print(f"unknown command: {cmd}", file=out)
    return 2


def _read_hook_stdin(stdin):
    """Parse the SessionEnd hook JSON from the injected string or real stdin (non-tty)."""
    import sys
    raw = stdin
    if raw is None:
        if sys.stdin is None or sys.stdin.isatty():
            return {}
        raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _detach():
    """Double-fork into a new session so telemetry sending outlives the hook.

    Returns 'parent' (the original process — should return immediately), 'child' (the
    detached worker — must os._exit when done), or 'inline' when fork is unavailable
    (e.g. Windows) so the caller just runs the work inline.
    """
    import os
    if not hasattr(os, "fork"):
        return "inline"
    try:
        if os.fork() > 0:
            return "parent"
    except OSError:
        return "inline"
    # first child: become a session leader, then fork again so the worker is not a
    # session leader (can never re-acquire a controlling terminal).
    try:
        os.setsid()
    except OSError:
        pass
    try:
        if os.fork() > 0:
            os._exit(0)
    except OSError:
        pass
    # grandchild (detached worker): drop the hook's stdio so it holds no pipes open.
    try:
        devnull = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
    except OSError:
        pass
    return "child"


def _do_flush(*, config_path, buffer_path, env, bmb_version, os_name, hook, sender):
    config = load_config(config_path)
    if not is_enabled(env, config):
        return  # opted out: send nothing

    install_id = get_or_create_install_id(config_path)
    session_id = hook.get("session_id") or env.get("CLAUDE_SESSION_ID", "unknown")

    # Build + buffer the session token event from the transcript (incl. subagents sidecar).
    transcript_path = hook.get("transcript_path")
    if transcript_path and Path(transcript_path).exists():
        try:
            import claude_telemetry
            events = []
            with open(transcript_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            events.append(json.loads(line))
                        except Exception:
                            continue
            record = claude_telemetry.build_record(events, transcript_path, session_id)
            complexity = env.get("BMB_COMPLEXITY_LEVEL")
            complexity = int(complexity) if complexity and complexity.isdigit() else None
            append_event(buffer_path, build_event(
                event="session_token_usage",
                props=build_token_event_props(record, complexity_level=complexity),
                install_id=install_id, session_id=session_id,
                bmb_version=bmb_version, os_name=os_name,
                event_id=session_token_event_id(session_id),  # deterministic → dedupe on retry
            ))
        except Exception:
            pass  # token event is best-effort; still flush whatever is buffered

    endpoint = resolve_endpoint(env, config)
    api_key = env.get("BMB_TELEMETRY_API_KEY", EMBEDDED_API_KEY)
    secret = env.get("BMB_TELEMETRY_HMAC_SECRET", EMBEDDED_HMAC_SECRET)
    flush_buffer(
        buffer_path=buffer_path, endpoint=endpoint, api_key=api_key, secret=secret,
        sender=sender or urllib_sender, batch_id=str(uuid.uuid4()), now_iso=_now_iso(),
    )


def os_environ():
    import os
    return os.environ


def _sys_platform():
    import sys
    return sys.platform


def _read_bmb_version():
    """Best-effort read of the plugin version from the bundled plugin.json."""
    try:
        manifest = Path(__file__).resolve().parent.parent / ".claude-plugin" / "plugin.json"
        return json.loads(manifest.read_text(encoding="utf-8")).get("version", "unknown")
    except Exception:
        return "unknown"


if __name__ == "__main__":
    import sys
    sys.exit(main())
