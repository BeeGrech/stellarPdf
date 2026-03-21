#!/bin/sh
# shellspec tests for scripts/hooks/pre-push

Describe 'pre-push hook'

  # Stubs that succeed
  stub_node_ok()  { return 0; }
  stub_npm_ok()   { return 0; }

  # Stubs that fail
  stub_node_bad() { return 1; }
  stub_npm_bad()  { return 1; }

  # Run hook logic with injectable node/npm commands
  run_hook() {
    _node="$1"; _npm="$2"
    (
      set -e
      "$_node" -e "JSON.parse(require('fs').readFileSync('package.json'))" 2>/dev/null \
        || { echo "FAIL: package.json is invalid JSON"; exit 1; }
      "$_npm" run lint:python --silent 2>/dev/null \
        || { echo "FAIL: pylint"; exit 1; }
      "$_npm" run test:python --silent 2>/dev/null \
        || { echo "FAIL: pytest"; exit 1; }
      echo "==> All checks passed."
    )
  }

  It 'succeeds when all checks pass'
    When call run_hook stub_node_ok stub_npm_ok
    The status should be success
    The output should include "All checks passed"
  End

  It 'fails and prints error when package.json check fails'
    When call run_hook stub_node_bad stub_npm_ok
    The status should be failure
    The output should include "FAIL: package.json"
  End

  It 'fails and prints error when pylint fails'
    # node passes, first npm call (lint) fails
    stub_npm_lint_fail() {
      case "$*" in
        *lint:python*) return 1 ;;
        *) return 0 ;;
      esac
    }
    When call run_hook stub_node_ok stub_npm_lint_fail
    The status should be failure
    The output should include "FAIL: pylint"
  End

  It 'fails and prints error when pytest fails'
    # node passes, lint passes, test fails
    call_count=0
    stub_npm_test_fail() {
      call_count=$((call_count + 1))
      case "$*" in
        *test:python*) return 1 ;;
        *) return 0 ;;
      esac
    }
    When call run_hook stub_node_ok stub_npm_test_fail
    The status should be failure
    The output should include "FAIL: pytest"
  End

End
