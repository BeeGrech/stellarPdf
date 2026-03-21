#!/bin/sh
# Install git hooks from scripts/hooks/ into .git/hooks/.
# Run once after cloning: sh scripts/install-hooks.sh
set -e
REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$REPO_ROOT/scripts/hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"

for hook in "$HOOKS_SRC"/*; do
  name="$(basename "$hook")"
  ln -sf "$REPO_ROOT/scripts/hooks/$name" "$HOOKS_DST/$name"
  chmod +x "$HOOKS_SRC/$name"
  echo "Installed: .git/hooks/$name -> scripts/hooks/$name"
done

echo "Done."
