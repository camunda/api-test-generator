#!/usr/bin/env bash
#
# Fail if any tracked text file begins with a UTF-8 BOM (bytes EF BB BF).
#
# Git's line-ending normalisation (.gitattributes `eol=lf`) only touches
# CR/LF bytes — it does NOT strip a BOM or repair mis-decoded text. BOMs
# slip in from Windows editors/tools that save as "UTF-8 with BOM", and
# Biome does not flag them, so this guard is the gate (see PR #348, where
# several SDK-emitter sources landed with a leading BOM + mojibake).
#
# Run locally with: npm run check:no-bom
#
set -euo pipefail

# git grep's PCRE engine (-P) interprets \xEF as a Unicode codepoint in UTF
# mode, so it will not match a raw BOM byte. Use a basic-regex literal byte
# sequence anchored to the start of the (first) line instead. `-I` skips
# files git treats as binary. Plain `git grep` (no --cached) scans the
# working-tree content of tracked files, so it also catches BOMs in
# modified-but-unstaged edits — not just what is currently staged.
bom_files="$(git grep -I -l -e "^$(printf '\xEF\xBB\xBF')" || true)"

if [ -n "$bom_files" ]; then
  {
    echo "Error: the following tracked files begin with a UTF-8 BOM."
    echo "Re-save them as UTF-8 *without* BOM (see .editorconfig: charset = utf-8):"
    echo "$bom_files" | sed 's/^/  - /'
  } >&2
  exit 1
fi

echo "check:no-bom — OK (no UTF-8 BOMs in tracked files)."
