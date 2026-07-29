#!/usr/bin/env bash
# Prints this platform's Git line-ending configuration and the tree hash of each
# ref given, so the same refs can be compared across operating systems.
#
# Usage: scripts/tree-hashes.sh v0.1.0-m1 v0.2.0-m2
set -euo pipefail

echo "uname          $(uname -s -r)"
echo "git            $(git --version | awk '{print $3}')"
echo "core.autocrlf  $(git config --get core.autocrlf || echo '(unset)')"
echo "core.eol       $(git config --get core.eol || echo '(unset)')"
echo

for ref in "$@"; do
  printf '%-14s %s\n' "$ref" "$(git rev-parse "${ref}^{tree}")"
done
