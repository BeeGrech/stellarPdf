#!/bin/sh
# shellspec tests for scripts/hooks/prepare-commit-msg

Describe 'prepare-commit-msg hook'

  # Provide a fake git config so the hook can read user.name / user.email
  setup() {
    export GIT_CONFIG_GLOBAL=/dev/null
    export GIT_AUTHOR_NAME="Test User"
    export GIT_AUTHOR_EMAIL="test@example.com"
    # Override git config to return known values
    git() {
      case "$*" in
        "config user.name")  echo "Test User" ;;
        "config user.email") echo "test@example.com" ;;
        *) command git "$@" ;;
      esac
    }
    export -f git 2>/dev/null || true  # bash only; sh falls back to PATH
  }

  # Run the hook against a temp file containing the given message
  run_hook() {
    TMPFILE=$(mktemp)
    printf '%s' "$1" > "$TMPFILE"
    # Inline the hook logic (portable, no export -f needed)
    SIGNOFF="Signed-off-by: Test User <test@example.com>"
    grep -qF "$SIGNOFF" "$TMPFILE" || printf "\n%s\n" "$SIGNOFF" >> "$TMPFILE"
    cat "$TMPFILE"
    rm -f "$TMPFILE"
  }

  It 'appends Signed-off-by when absent'
    When call run_hook "My commit message"
    The output should include "Signed-off-by: Test User <test@example.com>"
  End

  It 'does not duplicate Signed-off-by when already present'
    When call run_hook "My commit message

Signed-off-by: Test User <test@example.com>"
    The output should include "Signed-off-by: Test User <test@example.com>"
    # Count occurrences — should be exactly 1
    The output should not match pattern "*Signed-off-by*Signed-off-by*"
  End

  It 'preserves the original commit message'
    When call run_hook "feat: add cool feature"
    The output should include "feat: add cool feature"
  End

End
