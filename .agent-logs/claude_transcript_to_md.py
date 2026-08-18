#!/usr/bin/env python3
"""
Convert Claude Code session transcript (JSONL) to deterministic Markdown log.

Reads hook event JSON from stdin, extracts transcript_path, and generates
a Markdown file in .agent-logs/claude/YYYY-MM-DD/HHmm__<session_id>.md
"""

import json
import re
import sys
import os
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional


SCHEMA_VERSION = 3  # v3: adds sibling claude_telemetry.py (token/turn/latency telemetry) run by the same SessionEnd wrapper
MAX_OUTPUT_LINES = 200  # Trim long outputs to first/last N lines
TASK_ID_PATTERN = re.compile(r'\b(TASK|FEAT)-\d+\b')


def get_repo_root() -> Path:
    """Get the git repository root directory."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True
        )
        return Path(result.stdout.strip())
    except subprocess.CalledProcessError:
        # Fallback: use current directory
        return Path.cwd()


def get_git_metadata() -> Dict[str, Any]:
    """Extract git branch, commit SHA, and dirty status."""
    metadata = {
        "branch": "unknown",
        "commit": "unknown",
        "dirty": False
    }

    try:
        # Get current branch
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True
        )
        metadata["branch"] = result.stdout.strip()
    except subprocess.CalledProcessError:
        pass

    try:
        # Get commit SHA
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True
        )
        metadata["commit"] = result.stdout.strip()
    except subprocess.CalledProcessError:
        pass

    try:
        # Check if working tree is dirty
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True
        )
        metadata["dirty"] = bool(result.stdout.strip())
    except subprocess.CalledProcessError:
        pass

    return metadata


def make_relative_to_home(path: Path) -> str:
    """Convert path to ~/ format if inside home directory."""
    try:
        home = Path.home()
        if path.is_relative_to(home):
            return f"~/{path.relative_to(home)}"
    except (ValueError, AttributeError):
        pass
    return str(path)


def trim_long_output(text: str, max_lines: int = MAX_OUTPUT_LINES) -> tuple[str, bool]:
    """Trim output to first/last N lines if too long. Returns (trimmed_text, was_trimmed)."""
    lines = text.splitlines()
    if len(lines) <= max_lines * 2:
        return text, False

    first_part = lines[:max_lines]
    last_part = lines[-max_lines:]
    trimmed_count = len(lines) - (max_lines * 2)

    trimmed = "\n".join(first_part)
    trimmed += f"\n\n... [{trimmed_count} lines omitted] ...\n\n"
    trimmed += "\n".join(last_part)

    return trimmed, True


def extract_task_ids(events: List[Dict[str, Any]]) -> List[str]:
    """Extract task/feature IDs from transcript events.

    Scans user and assistant message text for patterns like TASK-001 or FEAT-017.
    Returns deduplicated list preserving first-occurrence order.
    """
    seen = set()
    task_ids = []

    for event in events:
        event_type = event.get("type", "")
        if event_type not in ("user", "assistant"):
            continue

        message = event.get("message", {})
        content = message.get("content", "")

        # Collect all text from the message
        texts = []
        if isinstance(content, str):
            texts.append(content)
        elif isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    texts.append(item.get("text", ""))

        # Search for task IDs in collected text
        for text in texts:
            for m in TASK_ID_PATTERN.finditer(text):
                task_id = m.group(0)
                if task_id not in seen:
                    seen.add(task_id)
                    task_ids.append(task_id)

    return task_ids


def format_tool_call(tool_call: Dict[str, Any]) -> str:
    """Format a tool call as JSON."""
    return f"```json\n{json.dumps(tool_call, indent=2, sort_keys=True)}\n```"


def format_tool_result(tool_result: Dict[str, Any]) -> str:
    """Format tool result with summary and optional full output."""
    output = []

    # Extract key fields
    tool_name = tool_result.get("name", "unknown")
    result_data = tool_result.get("result", {})

    output.append(f"**Tool**: `{tool_name}`\n")

    # Handle different result formats
    if isinstance(result_data, dict):
        # Check for common fields
        if "exit_code" in result_data:
            output.append(f"**Exit Code**: {result_data['exit_code']}")

        if "stdout" in result_data:
            stdout = result_data["stdout"]
            if stdout:
                trimmed, was_trimmed = trim_long_output(stdout)
                output.append("\n**Stdout**:")
                output.append(f"```\n{trimmed}\n```")
                if was_trimmed:
                    output.append("*(Output trimmed)*")

        if "stderr" in result_data:
            stderr = result_data["stderr"]
            if stderr:
                trimmed, was_trimmed = trim_long_output(stderr)
                output.append("\n**Stderr**:")
                output.append(f"```\n{trimmed}\n```")
                if was_trimmed:
                    output.append("*(Output trimmed)*")

        # For other structured data
        if not any(k in result_data for k in ["stdout", "stderr", "exit_code"]):
            output.append("\n**Result**:")
            result_str = json.dumps(result_data, indent=2, sort_keys=True)
            trimmed, was_trimmed = trim_long_output(result_str)
            output.append(f"```json\n{trimmed}\n```")
            if was_trimmed:
                output.append("*(Output trimmed)*")
    else:
        # Plain string or other type
        output.append(f"\n**Result**: {result_data}")

    return "\n".join(output)


def parse_transcript(transcript_path: Path) -> List[Dict[str, Any]]:
    """Parse JSONL transcript file into list of events."""
    events = []

    try:
        with open(transcript_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                    events.append(event)
                except json.JSONDecodeError as e:
                    # Include parse errors in output
                    events.append({
                        "type": "parse_error",
                        "line_number": line_num,
                        "error": str(e),
                        "raw_line": line
                    })
    except Exception as e:
        # If file can't be read, return error event
        return [{
            "type": "file_error",
            "error": str(e),
            "path": str(transcript_path)
        }]

    return events


def group_into_turns(events: List[Dict[str, Any]]) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Group events into conversational turns."""
    turns = []
    current_turn = None
    unknown_events = []

    for event in events:
        event_type = event.get("type", "unknown")

        # Handle user and assistant message events
        if event_type in ("user", "assistant"):
            message = event.get("message", {})
            message_role = message.get("role")

            # Skip if no valid message
            if not message or message_role not in ("user", "assistant"):
                unknown_events.append(event)
                continue

            message_content = message.get("content", "")

            # Check if this is a tool result message (user messages with tool_result content)
            if event_type == "user" and isinstance(message_content, list):
                has_tool_result = any(
                    isinstance(item, dict) and item.get("type") == "tool_result"
                    for item in message_content
                )

                # Add tool results to current turn if it exists
                if has_tool_result and current_turn:
                    current_turn["tool_results"].append(event)
                    continue

            # Check if this is an assistant message with tool calls
            tool_calls = []
            text_parts = []
            thinking_parts = []

            if isinstance(message_content, list):
                for item in message_content:
                    if isinstance(item, dict):
                        if item.get("type") == "tool_use":
                            tool_calls.append(item)
                        elif item.get("type") == "text":
                            text_parts.append(item.get("text", ""))
                        elif item.get("type") == "thinking":
                            thinking_parts.append(item.get("thinking", ""))
            elif isinstance(message_content, str):
                text_parts.append(message_content)

            # Start new turn for assistant or user messages
            if current_turn:
                turns.append(current_turn)

            current_turn = {
                "role": message_role,
                "text": "\n\n".join(text_parts) if text_parts else "",
                "thinking": "\n\n".join(thinking_parts) if thinking_parts else "",
                "tool_calls": tool_calls,
                "tool_results": [],
                "timestamp": event.get("timestamp", ""),
                "message_id": message.get("id", "")
            }

        elif event_type in ("file-history-snapshot", "progress", "system"):
            # Known non-conversational events - skip silently
            continue

        else:
            # Unknown event type
            unknown_events.append(event)

    # Add final turn
    if current_turn:
        turns.append(current_turn)

    return turns, unknown_events


def generate_markdown(
    session_id: str,
    transcript_path: Path,
    repo_root: Path,
    git_metadata: Dict[str, Any],
    events: List[Dict[str, Any]],
    task_ids: Optional[List[str]] = None,
) -> str:
    """Generate deterministic Markdown from parsed events."""
    output = []

    # Header
    output.append("# Claude Code Session Log\n")
    output.append(f"**Schema Version**: {SCHEMA_VERSION}\n")
    output.append(f"**Session ID**: `{session_id}`\n")
    output.append(f"**Generated At**: {datetime.now().isoformat()}\n")
    if task_ids:
        output.append(f"**Task IDs**: {', '.join(f'`{tid}`' for tid in task_ids)}\n")
    output.append(f"**Repository Root**: `{repo_root}`\n")
    output.append(f"**Git Branch**: `{git_metadata['branch']}`\n")
    output.append(f"**Git Commit**: `{git_metadata['commit']}`\n")
    output.append(f"**Working Tree Dirty**: {git_metadata['dirty']}\n")
    output.append(f"**Transcript Path**: `{make_relative_to_home(transcript_path)}`\n")
    output.append("\n---\n")

    # Group events into turns
    turns, unknown_events = group_into_turns(events)

    # Render turns
    for turn_num, turn in enumerate(turns, 1):
        output.append(f"\n## Turn {turn_num}\n")

        # User or Assistant section
        role = turn["role"].title()
        output.append(f"\n### {role}\n")

        # Timestamp if available
        if turn.get("timestamp"):
            output.append(f"*{turn['timestamp']}*\n\n")

        # Thinking (for assistant messages)
        if turn.get("thinking"):
            output.append("<details>\n<summary>Thinking</summary>\n\n")
            output.append(turn["thinking"])
            output.append("\n</details>\n\n")

        # Main text content
        if turn.get("text"):
            output.append(turn["text"])
            output.append("\n\n")

        # Tool calls
        if turn["tool_calls"]:
            output.append("\n#### Tool Calls\n")
            for i, tool_call in enumerate(turn["tool_calls"], 1):
                tool_name = tool_call.get("name", "unknown")
                tool_input = tool_call.get("input", {})
                output.append(f"\n**{i}. {tool_name}**\n")
                output.append(f"```json\n{json.dumps(tool_input, indent=2, sort_keys=True)}\n```\n")

        # Tool results
        if turn["tool_results"]:
            output.append("\n#### Tool Results\n")
            for i, result_event in enumerate(turn["tool_results"], 1):
                message = result_event.get("message", {})
                content = message.get("content", [])

                for item in content if isinstance(content, list) else []:
                    if isinstance(item, dict) and item.get("type") == "tool_result":
                        tool_use_id = item.get("tool_use_id", "unknown")
                        result_content = item.get("content", "")
                        is_error = item.get("is_error", False)

                        output.append(f"\n**{i}. Result for {tool_use_id}**")
                        if is_error:
                            output.append(" (Error)")
                        output.append("\n\n")

                        # Format result content
                        if isinstance(result_content, str):
                            if result_content:
                                trimmed, was_trimmed = trim_long_output(result_content)
                                output.append(f"```\n{trimmed}\n```\n")
                                if was_trimmed:
                                    output.append("*(Output trimmed)*\n")
                        else:
                            output.append(f"```json\n{json.dumps(result_content, indent=2, sort_keys=True)}\n```\n")

    # Appendix for unknown events
    if unknown_events:
        output.append("\n---\n")
        output.append("\n## Appendix: Unknown Events\n")
        output.append("\nThe following events were not recognized and are included for completeness:\n")
        for i, event in enumerate(unknown_events, 1):
            output.append(f"\n### Event {i}\n")
            output.append(f"```json\n{json.dumps(event, indent=2, sort_keys=True)}\n```\n")

    return "".join(output)


def main():
    """Main entry point: read hook JSON from stdin and generate Markdown log."""
    try:
        # Read hook event from stdin
        hook_data = json.load(sys.stdin)

        # Extract required fields
        session_id = hook_data.get("session_id", "unknown")
        transcript_path = hook_data.get("transcript_path")

        if not transcript_path:
            print("ERROR: No transcript_path in hook data", file=sys.stderr)
            sys.exit(1)

        transcript_path = Path(transcript_path)

        # Get repository and git metadata
        repo_root = get_repo_root()
        git_metadata = get_git_metadata()

        # Parse transcript
        events = parse_transcript(transcript_path)

        # Extract task IDs from transcript content
        task_ids = extract_task_ids(events)

        # Generate Markdown
        markdown = generate_markdown(
            session_id=session_id,
            transcript_path=transcript_path,
            repo_root=repo_root,
            git_metadata=git_metadata,
            events=events,
            task_ids=task_ids,
        )

        # Determine output path
        now = datetime.now()
        date_dir = now.strftime("%Y-%m-%d")
        time_prefix = now.strftime("%H%M")
        filename = f"{time_prefix}__{session_id}.md"

        output_dir = repo_root / ".agent-logs" / "claude" / date_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        output_path = output_dir / filename

        # Atomic write: write to temp file, then rename
        temp_path = output_path.with_suffix(".tmp")
        with open(temp_path, 'w', encoding='utf-8') as f:
            f.write(markdown)
        temp_path.rename(output_path)

        # Create by-task symlinks for each extracted task ID
        if task_ids:
            by_task_base = repo_root / ".agent-logs" / "claude" / "by-task"
            for task_id in task_ids:
                task_dir = by_task_base / task_id
                task_dir.mkdir(parents=True, exist_ok=True)
                symlink_path = task_dir / filename
                # Relative symlink: by-task/TASK-017/file.md -> ../../2026-02-21/file.md
                relative_target = os.path.relpath(output_path, task_dir)
                if not symlink_path.exists():
                    symlink_path.symlink_to(relative_target)

        task_label = f" [{', '.join(task_ids)}]" if task_ids else ""
        print(f"Generated log{task_label}: {make_relative_to_home(output_path)}", file=sys.stderr)
        sys.exit(0)

    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(0)  # Exit 0 to not break hook chain


if __name__ == "__main__":
    main()
