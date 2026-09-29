#!/usr/bin/env bash
#
# codex-run.sh — start a fresh Codex CLI session for one implementation slice.
#
#   ./scripts/codex-run.sh <profile> <task-file>
#
# <profile>   a Codex profile name resolving to $CODEX_HOME/<profile>.config.toml
#             sol-medium       = gpt-5.6-sol   / medium
#             sol-high         = gpt-5.6-sol   / high
#             terra-high       = gpt-5.6-terra / high
#             terra-extra-high = gpt-5.6-terra / xhigh
#             astra-low        = gpt-6-astra   / low
#             astra-medium     = gpt-6-astra   / medium
#             The two model families are not interchangeable for audits: when a
#             second opinion is the point, the second opinion must come from a
#             DIFFERENT family, not the same family at a higher effort.
# <task-file> file holding the task text, passed to Codex verbatim on stdin
#
# On success the agent's FINAL MESSAGE ONLY is printed to stdout, so a pipe
# agent can relay it without having to strip transcript noise. The full
# transcript and the session id are kept under .codex/runs/ so that
# codex-resume.sh can continue the same session.
#
# Exit codes: 0 ok · 2 bad usage/unreadable task file · other = Codex's own.

set -euo pipefail

# The implementer MUST be able to run the backend suite, and the backend suite
# runs only inside the dev container (AGENTS.md: there is no host `uv`). Under
# `workspace-write` the sandbox permits writes to the workspace and TMPDIR
# only, and the Docker socket is outside both — so `docker compose exec` could
# not work, and an implementer under that sandbox could write tests it was
# unable to execute. Since a test nobody has run is this programme's most
# common defect, container access is now the default. `--no-container` drops
# back to `workspace-write` for a slice that genuinely needs no test run.
SANDBOX="danger-full-access"
if [[ "${1:-}" == "--no-container" ]]; then
  SANDBOX="workspace-write"
  shift
fi

usage() {
  echo "usage: $(basename "$0") [--no-container] <profile> <task-file>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
PROFILE="$1"
TASK_FILE="$2"

[[ -r "$TASK_FILE" ]] || { echo "$(basename "$0"): task file not readable: $TASK_FILE" >&2; exit 2; }
[[ -s "$TASK_FILE" ]] || { echo "$(basename "$0"): task file is empty: $TASK_FILE" >&2; exit 2; }

# SCRIPT_ROOT is where this script and its preamble live. REPO_ROOT is the
# worktree the implementer actually works in, and RUN_REPO_ROOT overrides it so
# one copy of this script can drive a sibling worktree — without that override
# the script silently cd'd to its OWN worktree and the implementer edited the
# wrong tree while every path in the task text pointed at the right one.
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${RUN_REPO_ROOT:-$SCRIPT_ROOT}"
[[ -d "$REPO_ROOT/.git" || -f "$REPO_ROOT/.git" ]] || {
  echo "$(basename "$0"): not a git worktree: $REPO_ROOT" >&2; exit 2; }
cd "$REPO_ROOT"

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
PROFILE_FILE="$CODEX_HOME_DIR/$PROFILE.config.toml"
[[ -r "$PROFILE_FILE" ]] || {
  echo "$(basename "$0"): no such Codex profile: $PROFILE (expected $PROFILE_FILE)" >&2
  exit 2
}

RUN_DIR="$REPO_ROOT/.codex/runs"
mkdir -p "$RUN_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
TRANSCRIPT="$RUN_DIR/$STAMP.transcript.log"
LAST_MSG="$RUN_DIR/$STAMP.last-message.txt"
PROMPT="$RUN_DIR/$STAMP.prompt.txt"

# The delegation protocol (scope rules + QUESTION protocol) is injected per
# run rather than living in AGENTS.md, which is shared across harnesses.
# The task text follows it verbatim and unmodified.
# From SCRIPT_ROOT, not REPO_ROOT: the preamble is a property of this harness,
# so a target worktree that predates it still gets the current protocol.
PREAMBLE="$SCRIPT_ROOT/scripts/codex-preamble.md"
: > "$PROMPT"
if [[ -r "$PREAMBLE" ]]; then
  cat "$PREAMBLE" >> "$PROMPT"
  printf '\n' >> "$PROMPT"
else
  echo "$(basename "$0"): warning: $PREAMBLE missing; running without the delegation protocol" >&2
fi
echo "# Task" >> "$PROMPT"
printf '\n' >> "$PROMPT"
cat "$TASK_FILE" >> "$PROMPT"

set +e
codex exec \
  --profile "$PROFILE" \
  --strict-config \
  --sandbox "$SANDBOX" \
  --output-last-message "$LAST_MSG" \
  - < "$PROMPT" > "$TRANSCRIPT" 2>&1
status=$?
set -e

# Record the session id so codex-resume.sh continues THIS session.
SESSION_ID="$(grep -m1 -E '^session id:' "$TRANSCRIPT" | sed -E 's/^session id:[[:space:]]*//' || true)"
if [[ -n "$SESSION_ID" ]]; then
  # Per-run pointer: safe under concurrent slices. `last-session-id` is a
  # convenience for the single-run case and IS racy when runs overlap —
  # concurrent callers must pass the id to codex-resume.sh explicitly.
  printf '%s\n' "$SESSION_ID" > "$RUN_DIR/$STAMP.session-id"
  echo "codex session: $SESSION_ID" >&2
  printf '%s\n' "$SESSION_ID" > "$RUN_DIR/last-session-id"
  # `codex exec resume` cannot take --profile and does NOT restore reasoning
  # effort from the session (it comes back as "none"), so remember which
  # profile this session used and let codex-resume.sh re-apply it.
  printf '%s\n' "$PROFILE" > "$RUN_DIR/last-profile"
  printf '%s\n' "$SANDBOX" > "$RUN_DIR/last-sandbox"
  # Per-session sidecars. The `last-*` pointers above are a convenience for the
  # single-run case; these are keyed by session id and cannot be clobbered by a
  # later run, so resuming an explicit session always restores ITS model.
  printf '%s\n' "$PROFILE" > "$RUN_DIR/session-$SESSION_ID.profile"
  printf '%s\n' "$SANDBOX" > "$RUN_DIR/session-$SESSION_ID.sandbox"
fi

if [[ $status -ne 0 ]]; then
  echo "codex exec failed (exit $status). Transcript: $TRANSCRIPT" >&2
  cat "$TRANSCRIPT" >&2
  exit "$status"
fi

if [[ ! -s "$LAST_MSG" ]]; then
  echo "codex exec exited 0 but produced no final message. Transcript: $TRANSCRIPT" >&2
  cat "$TRANSCRIPT" >&2
  exit 3
fi

cat "$LAST_MSG"
