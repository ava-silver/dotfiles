#!/usr/bin/env bash

# Stack wrapper execution policy:
# - Noninteractive commands are captured with stdin closed.
# - Interactive commands run directly in the caller's terminal.
# Never force a command into a synthetic PTY while capturing its output: prompts
# become invisible and signals such as Ctrl+C may not reach the child process.
stack_run_noninteractive() {
    "$@" </dev/null 2>&1
}
