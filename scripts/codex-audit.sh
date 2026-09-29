#!/usr/bin/env bash
#
# codex-audit.sh — obtain an independent code review from Codex CLI.
#
#   ./scripts/codex-audit.sh [--container] <profile> <slice-file> <diff-file>
#
# <profile> resolves to $CODEX_HOME/<profile>.config.toml:
#   sol-medium       = gpt-5.6-sol   / medium    sol-high   = gpt-5.6-sol / high
#   terra-high       = gpt-5.6-terra / high
#   terra-extra-high = gpt-5.6-terra / xhigh
#   astra-low        = gpt-6-astra   / low       astra-medium = gpt-6-astra / medium
# An audit's value comes from independence. Re-auditing with the same family at
# a higher effort buys less than a different family at the same effort: two
# runs of one model share its blind spots. When an audit and a re-audit must
# disagree usefully, cross the family boundary.
#
# Default: runs Codex with sandbox=read-only, so an auditor CANNOT modify the
# tree and CANNOT reach Docker — the review is static only.
#
# --container: runs Codex with sandbox=danger-full-access so the auditor can
# reach the Docker daemon and EXECUTE the test suites in the backend container.
# A static auditor cannot tell a test that passes from a test that cannot fail;
# executing it can. The read-only guarantee then stops being enforced by the
# sandbox, so this mode replaces PREVENTION with DETECTION: the working tree is
# fingerprinted before and after the run, and any change to a tracked file, any
# new or deleted file, any move of HEAD, and any change to the stash is a hard
# failure that is reported loudly alongside the audit output. Read that warning
# as invalidating the audit: an auditor that edited the tree may have been
# reviewing its own repairs.
#
# Prints the agent's FINAL MESSAGE ONLY to stdout. The session id is recorded
# so codex-resume.sh can ask one clarification round.
#
# Exit codes: 0 ok · 2 bad usage / unreadable input · 3 no final message ·
#             4 auditor mutated the tree (--container only) · other = Codex's.

set -euo pipefail

usage() {
  echo "usage: $(basename "$0") [--container] <profile> <slice-file> <diff-file>" >&2
  exit 2
}

CONTAINER=0
if [[ "${1:-}" == "--container" ]]; then
  CONTAINER=1
  shift
fi

[[ $# -eq 3 ]] || usage
PROFILE="$1"
SLICE_FILE="$2"
DIFF_FILE="$3"

for f in "$SLICE_FILE" "$DIFF_FILE"; do
  [[ -r "$f" ]] || { echo "$(basename "$0"): not readable: $f" >&2; exit 2; }
done
[[ -s "$DIFF_FILE" ]] || { echo "$(basename "$0"): diff is empty: $DIFF_FILE" >&2; exit 2; }

# AUDIT_REPO_ROOT lets one copy of this script audit a sibling worktree, so a
# script fix does not have to be copied onto every slice branch to be used.
REPO_ROOT="${AUDIT_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
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
PROMPT="$RUN_DIR/$STAMP.audit-prompt.txt"
TRANSCRIPT="$RUN_DIR/$STAMP.audit.transcript.log"
LAST_MSG="$RUN_DIR/$STAMP.audit.last-message.txt"

SANDBOX="read-only"
[[ $CONTAINER -eq 1 ]] && SANDBOX="danger-full-access"

# Fingerprint the tree so a --container auditor's edits cannot pass unnoticed.
# `git status --porcelain -uall` reports content changes to tracked files as
# well as additions and deletions, so HEAD + porcelain + stash covers every
# mutation an auditor could make inside the repository.
tree_fingerprint() {
  git rev-parse HEAD
  git status --porcelain=v1 -uall
  git stash list
}
BEFORE_FP=""
if [[ $CONTAINER -eq 1 ]]; then
  BEFORE_FP="$(tree_fingerprint)"
fi

{
  if [[ $CONTAINER -eq 1 ]]; then
    echo "You are auditing one completed implementation slice."
    echo
    echo "You have full shell access and the Docker daemon is reachable, so you"
    echo "CAN AND SHOULD EXECUTE THE TEST SUITES rather than reasoning about"
    echo "them statically. A static reading cannot distinguish a test that"
    echo "passes from a test that cannot fail; running it, and mutating the"
    echo "code it claims to protect, can. Prefer executed evidence over"
    echo "inference everywhere it is available, and say which of your"
    echo "conclusions rest on execution and which on reading."
    echo
    echo "HOW TO RUN THE BACKEND SUITE. The tests need Postgres and run"
    echo "in-container only — there is no host \`uv\`. One compose stack"
    echo "started from the MAIN repo root mounts the whole repository at"
    echo "/workspace, so this worktree's tests run as:"
    echo
    echo "  docker compose exec -w /workspace/<worktree-relative-path>/backend \\"
    echo "    backend uv run pytest <paths> -q"
    echo
    echo "Run \`docker compose ps\` from the main repo root to find the live"
    echo "stack. The database is a shared, persistent dev database with real"
    echo "data in it: roughly 76 full-suite failures are environmental and"
    echo "pre-existing, so NEVER read a raw failure count as a verdict. To"
    echo "judge whether this branch broke anything, run the same suite at the"
    echo "branch's base commit in a detached worktree and diff the sorted"
    echo "FAILED lists. Never run \`alembic downgrade\` below the current head:"
    echo "sibling slices share this database."
    echo
    echo "YOU ARE STILL A READ-ONLY AUDITOR. Do not modify, create, or delete"
    echo "any file in the repository, do not commit, do not stash, and do not"
    echo "leave a mutation in place. Applying a mutation to prove a test can"
    echo "fail is legitimate and encouraged, but you must restore the file"
    echo "byte-identically afterwards and confirm the suite is green again."
    echo "The tree is fingerprinted before and after this run; any residue is"
    echo "reported as a failure and invalidates your audit."
  else
    echo "You are auditing one completed implementation slice. You are READ-ONLY:"
    echo "do not modify, create, or delete any file."
    echo
    echo "You have no Docker access and cannot execute the suites. Say so"
    echo "plainly and confine your claims to what static reading supports."
  fi
  echo
  echo "Judge the diff against the slice spec. Report correctness defects,"
  echo "scope creep, security issues, and unmet acceptance criteria. For every"
  echo "defect give file:line, the defect, and a concrete failure scenario."
  echo "If the slice is clean, say so plainly rather than inventing findings."
  echo
  echo "===== SLICE SPEC: $SLICE_FILE ====="
  cat "$SLICE_FILE"
  echo
  echo "===== DIFF UNDER REVIEW: $DIFF_FILE ====="
  cat "$DIFF_FILE"
} > "$PROMPT"

set +e
codex exec \
  --profile "$PROFILE" \
  --strict-config \
  --sandbox "$SANDBOX" \
  --output-last-message "$LAST_MSG" \
  - < "$PROMPT" > "$TRANSCRIPT" 2>&1
status=$?
set -e

SESSION_ID="$(grep -m1 -E '^session id:' "$TRANSCRIPT" | sed -E 's/^session id:[[:space:]]*//' || true)"
if [[ -n "$SESSION_ID" ]]; then
  # Audit pointers are NAMESPACED, and per-session sidecars are authoritative.
  # These used to be the same `last-*` files codex-run.sh writes, so auditing a
  # slice clobbered the implementer's profile: the next codex-resume.sh sent the
  # defect list back into the implementer's session under the AUDITOR's model —
  # the same family that had just found the defect then fixed it, silently
  # defeating the different-family rule. Caught live 2026-08-13.
  printf '%s\n' "$SESSION_ID" > "$RUN_DIR/audit-last-session-id"
  printf '%s\n' "$PROFILE"    > "$RUN_DIR/audit-last-profile"
  # The clarification round inherits this run's sandbox.
  printf '%s\n' "$SANDBOX"    > "$RUN_DIR/audit-last-sandbox"
  printf '%s\n' "$PROFILE"    > "$RUN_DIR/session-$SESSION_ID.profile"
  printf '%s\n' "$SANDBOX"    > "$RUN_DIR/session-$SESSION_ID.sandbox"
fi

TREE_DIRTIED=0
if [[ $CONTAINER -eq 1 ]]; then
  AFTER_FP="$(tree_fingerprint)"
  if [[ "$BEFORE_FP" != "$AFTER_FP" ]]; then
    TREE_DIRTIED=1
    {
      echo "=============================================================="
      echo "$(basename "$0"): THE AUDITOR MUTATED THE WORKING TREE."
      echo "This audit is not trustworthy — the reviewer may have been"
      echo "reading its own repairs. Restore the tree and re-run."
      echo "-------------------------------- before ----------------------"
      printf '%s\n' "$BEFORE_FP"
      echo "-------------------------------- after -----------------------"
      printf '%s\n' "$AFTER_FP"
      echo "=============================================================="
    } >&2
  fi
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

[[ $TREE_DIRTIED -eq 1 ]] && exit 4
exit 0
