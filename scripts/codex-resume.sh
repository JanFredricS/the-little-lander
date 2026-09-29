#!/usr/bin/env bash
#
# codex-resume.sh — send a follow-up into the SAME Codex session that
# codex-run.sh most recently started (steering, defect lists, answers to a
# QUESTION:). Never starts a fresh session.
#
#   ./scripts/codex-resume.sh <followup-file> [session-id]
#
# With no session-id it resumes the most recent run. That is only safe when
# runs do not overlap — under parallel slices, pass the id that codex-run.sh
# reported on stderr ("codex session: <id>").
#
# Prints the agent's FINAL MESSAGE ONLY to stdout.
#
# Exit codes: 0 ok · 2 bad usage / unreadable file / no session to resume
#             other = Codex's own.

set -euo pipefail

usage() {
  echo "usage: $(basename "$0") <followup-file> [session-id]" >&2
  exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
FOLLOWUP_FILE="$1"
EXPLICIT_SESSION_ID="${2:-}"

[[ -r "$FOLLOWUP_FILE" ]] || { echo "$(basename "$0"): follow-up file not readable: $FOLLOWUP_FILE" >&2; exit 2; }
[[ -s "$FOLLOWUP_FILE" ]] || { echo "$(basename "$0"): follow-up file is empty: $FOLLOWUP_FILE" >&2; exit 2; }

# RESUME_REPO_ROOT lets one copy of this script resume a session that belongs to
# a sibling worktree, matching RUN_REPO_ROOT / AUDIT_REPO_ROOT. Without it the
# script cd's to its OWN worktree and looks for the session there.
REPO_ROOT="${RESUME_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
[[ -d "$REPO_ROOT/.git" || -f "$REPO_ROOT/.git" ]] || {
  echo "$(basename "$0"): not a git worktree: $REPO_ROOT" >&2; exit 2; }
cd "$REPO_ROOT"

RUN_DIR="$REPO_ROOT/.codex/runs"
if [[ -n "$EXPLICIT_SESSION_ID" ]]; then
  SESSION_ID="$EXPLICIT_SESSION_ID"
else
  SESSION_FILE="$RUN_DIR/last-session-id"
  [[ -r "$SESSION_FILE" ]] || {
    echo "$(basename "$0"): no recorded session to resume ($SESSION_FILE missing) — run codex-run.sh first" >&2
    exit 2
  }
  SESSION_ID="$(<"$SESSION_FILE")"
fi
[[ -n "$SESSION_ID" ]] || { echo "$(basename "$0"): session id is empty" >&2; exit 2; }

# `codex exec resume` takes no --profile, and reasoning effort comes back as
# "none" rather than being restored from the session — so re-apply the model
# and effort recorded when the session was started.
# Inherit the sandbox the session was started under, so an audit session's
# clarification round stays read-only.
#
# Per-session sidecars come FIRST. The shared `last-*` pointers are whatever ran
# most recently in this worktree, which is not necessarily this session: running
# an audit between an implementation run and its fix round used to redirect the
# fix into the auditor's model. Keyed by session id, that cannot happen.
SANDBOX_FILE="$RUN_DIR/session-$SESSION_ID.sandbox"
[[ -r "$SANDBOX_FILE" ]] || SANDBOX_FILE="$RUN_DIR/last-sandbox"
SANDBOX_MODE="workspace-write"
if [[ -r "$SANDBOX_FILE" ]]; then
  SANDBOX_MODE="$(<"$SANDBOX_FILE")"
fi

MODEL_ARGS=()
PROFILE_NAME_FILE="$RUN_DIR/session-$SESSION_ID.profile"
[[ -r "$PROFILE_NAME_FILE" ]] || PROFILE_NAME_FILE="$RUN_DIR/last-profile"
if [[ -r "$PROFILE_NAME_FILE" ]]; then
  PROFILE="$(<"$PROFILE_NAME_FILE")"
  # Announce it. A resume that silently switches model is the failure this
  # whole block exists to prevent, so make it visible in the run log.
  echo "$(basename "$0"): resuming $SESSION_ID with profile $PROFILE (from $(basename "$PROFILE_NAME_FILE"))" >&2
  PROFILE_FILE="${CODEX_HOME:-$HOME/.codex}/$PROFILE.config.toml"
  if [[ -r "$PROFILE_FILE" ]]; then
    while IFS= read -r kv; do
      [[ -n "$kv" ]] && MODEL_ARGS+=(-c "$kv")
    done < <(grep -E '^[[:space:]]*(model|model_reasoning_effort)[[:space:]]*=' "$PROFILE_FILE" \
             | tr -d ' "' )
  else
    echo "$(basename "$0"): warning: profile file $PROFILE_FILE missing; resuming with session defaults" >&2
  fi
else
  echo "$(basename "$0"): warning: no recorded profile; resuming with session defaults" >&2
fi

STAMP="$(date +%Y%m%d-%H%M%S)-$$"
TRANSCRIPT="$RUN_DIR/$STAMP.resume.transcript.log"
LAST_MSG="$RUN_DIR/$STAMP.resume.last-message.txt"

set +e
codex exec resume "$SESSION_ID" \
  --strict-config \
  -c sandbox_mode="$SANDBOX_MODE" \
  ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
  --output-last-message "$LAST_MSG" \
  - < "$FOLLOWUP_FILE" > "$TRANSCRIPT" 2>&1
status=$?
set -e

if [[ $status -ne 0 ]]; then
  echo "codex exec resume failed (exit $status). Transcript: $TRANSCRIPT" >&2
  cat "$TRANSCRIPT" >&2
  exit "$status"
fi

if [[ ! -s "$LAST_MSG" ]]; then
  echo "codex exec resume exited 0 but produced no final message. Transcript: $TRANSCRIPT" >&2
  cat "$TRANSCRIPT" >&2
  exit 3
fi

cat "$LAST_MSG"
