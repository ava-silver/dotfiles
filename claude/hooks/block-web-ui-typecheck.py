#!/usr/bin/env python3
"""
Blocks typecheck/tsc commands when working in web-ui or its worktrees.
They're too slow and memory-intensive to run locally -- use CI instead.
"""
from __future__ import annotations
import json, os, shlex, sys

WEB_UI_PATHS = [
    "/Users/ava.silver/dd/web-ui",
    "/Users/ava.silver/go/src/github.com/DataDog/web-ui",
]
WEB_UI_WORKTREE_PATHS = [
    "/Users/ava.silver/dd/web-ui.worktrees",
    "/Users/ava.silver/go/src/github.com/DataDog/web-ui.worktrees",
]

def in_web_ui() -> bool:
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    for p in WEB_UI_PATHS:
        if project_dir == p or project_dir.startswith(p + "/"):
            return True
    for p in WEB_UI_WORKTREE_PATHS:
        if project_dir.startswith(p + "/"):
            return True
    return False

BLOCK_MSG = (
    "BLOCKED: Typechecking is disabled locally -- it takes too long and uses too much memory.\n"
    "Let CI run it instead (push your branch and check the pipeline)."
)

def is_typecheck(tokens: list[str]) -> bool:
    if not tokens:
        return False
    if tokens[0] == "yarn":
        if len(tokens) >= 2 and (tokens[1].startswith("typecheck") or tokens[1].startswith("tsc")):
            return True
        if len(tokens) >= 3 and tokens[1] == "greyhound" and tokens[2] == "typecheck":
            return True
        if len(tokens) >= 4 and tokens[1] == "workspace" and tokens[3] == "typecheck":
            return True
    if tokens[0] == "tsc" and not any(t in ("--version", "--help", "-v", "-h") for t in tokens[1:]):
        return True
    return False

def main():
    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    if data.get("tool_name") != "Bash" or not in_web_ui():
        sys.exit(0)

    command = data.get("tool_input", {}).get("command", "")
    try:
        tokens = shlex.split(command)
    except ValueError:
        sys.exit(0)

    if is_typecheck(tokens):
        print(BLOCK_MSG, file=sys.stderr)
        sys.exit(2)
    sys.exit(0)

if __name__ == "__main__":
    main()
