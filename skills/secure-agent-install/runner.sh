#!/usr/bin/env bash
#
# secure-agent-install — thin runner.
#
# Composes the read-only half of the secure install workflow: given a target
# (git URL / dir / SKILL.md / mcp.json) and a SkillSpector report you already
# produced, it asks CallLint whether the requested authority is acceptable and
# prints the joint Trust Packet. It INSTALLS NOTHING and executes neither the
# target nor SkillSpector — it only shells out to `calllint trust prepare`.
#
# Usage:
#   ./runner.sh <target> <skillspector-report.json> [--format json|sarif]
#
# Exit code is CallLint's own (0 SAFE / 10 REVIEW / 20 UNKNOWN|BLOCK-class /
# 2 usage). A non-zero exit means: do not install without human review.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: runner.sh <target> <skillspector-report.json> [--format json|sarif]" >&2
  echo "  target: a git URL, directory, SKILL.md, or mcp.json — the PROPOSED install." >&2
  echo "  the SkillSpector report is one you produced yourself (never run here)." >&2
  exit 2
fi

TARGET="$1"
EVIDENCE="$2"
shift 2

if [ ! -f "$EVIDENCE" ]; then
  echo "error: SkillSpector report not found: $EVIDENCE" >&2
  echo "run SkillSpector yourself first, then pass its report here." >&2
  exit 2
fi

# `calllint` is invoked via npx so this skill pins nothing globally and installs
# nothing. CallLint is offline by default and never executes the target.
CALLLINT="${CALLLINT_BIN:-npx -y calllint}"

echo "secure-agent-install: evaluating requested authority (installs nothing)…" >&2
echo "  target:   $TARGET" >&2
echo "  evidence: $EVIDENCE (SkillSpector report — provided, not run here)" >&2
echo >&2

# Read-only: build artifact identity + authority manifest + decision, attaching
# the SkillSpector report as supporting evidence (never re-scored). This prints
# the joint Trust Packet and exits with CallLint's verdict-based code.
# shellcheck disable=SC2086
exec $CALLLINT trust prepare "$TARGET" --evidence "$EVIDENCE" "$@"
