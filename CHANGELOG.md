# Changelog

All notable changes to this project will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## [Unreleased] - v0.1.0

### Added

- AcroForm fill: interactive input overlays (text, checkbox, radio, dropdown) positioned over real PDF form fields
- Visual field detection: detects drawn boxes and underlines on flat PDFs so you can type into them
- Permanent redaction: draw a box, click Apply - content is burned out of the file via PyMuPDF, not just covered
- Text insertion: click anywhere on the page, type, Enter to commit; saved into the PDF content stream
- Undo: Ctrl+Z rolls back the last mutation, up to 20 levels stored as in-memory snapshots
- Page navigation: thumbnail sidebar, prev/next buttons, arrow keys
- Zoom: 50% to 300% in steps; form overlays reposition correctly on zoom change
- Dark theme (bg #1a1a1a, accent #4d9ef7)
- Native app menu: File, Edit, View, Help with keyboard shortcuts dialog
- Support page with crypto addresses and Ko-fi link
- Python test suite: 34 unit tests covering all RPC handlers and redaction security
- UI test suite: 14 Playwright end-to-end tests (smoke, form fill, redaction, undo)
- ShellSpec tests for git hooks (7 examples)
- CI: lint, Python tests, UI tests on every push and PR
- Nightly build: AppImage + deb + rpm published to GitHub Releases rolling prerelease
- Dependency vulnerability scanning: npm audit + pip-audit in CI
- Git hooks: prepare-commit-msg (sign-off), pre-push (lint + tests) tracked in repo

### Packages

- `.AppImage` - universal Linux
- `.deb` - Ubuntu / Debian
- `.rpm` - Fedora / RHEL

---

<!-- next release link updated on tag -->
[Unreleased]: https://github.com/BeeGrech/stellarPdf/compare/main...HEAD
