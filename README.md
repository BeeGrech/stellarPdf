# Stellar PDF

A beautiful, open-source PDF editor for Linux. Fill forms, redact content, and insert text. No Adobe required.

## Features

| Feature | Detail |
|---------|--------|
| **AcroForm fill** | Interactive input overlays positioned over real PDF form fields; text, checkbox, radio, dropdown |
| **Visual field detection** | Detects drawn boxes and underlines on flat PDFs so you can type into them too |
| **Permanent redaction** | Draw a box, click Apply. Content is burned out of the file, not just covered |
| **Text insertion** | Click anywhere, type, Enter to commit; baseline-snaps to match surrounding typography |
| **Undo** | Ctrl+Z rolls back the last mutation (up to 20 levels, stored as in-memory snapshots) |
| **Page navigation** | Thumbnail sidebar, prev/next buttons, arrow keys |
| **Zoom** | 50% – 300% in steps |
| **Dark theme** | Easy on the eyes |
| **Native app menu** | File, Edit, View, Help with keyboard shortcuts dialog |

## Stack

| Layer | Technology |
|-------|-----------|
| App shell | [Electron](https://www.electronjs.org/) 33 |
| PDF rendering | [PDF.js](https://mozilla.github.io/pdf.js/) 4 (read-only, in-process) |
| PDF mutations | [PyMuPDF](https://pymupdf.readthedocs.io/) via a separate Python process, JSON RPC over stdin/stdout |

All write operations (fill, redact, insert, save, undo) live exclusively in the Python process. The renderer never touches the file directly.

## Repository layout

| Path | Role |
|------|------|
| `main.js` / `preload.js` | Electron main process, IPC relay, file dialogs |
| `renderer/` | UI, PDF.js rendering, tool overlays |
| `python/pdf_server.py` | PyMuPDF JSON-RPC server |
| `python/tests/` | Python unit tests (pytest) |
| `spec/` | Shell script tests (ShellSpec) |
| `tests/ui/` | End-to-end UI tests (Playwright + Electron) |
| `scripts/hooks/` | Git hooks (tracked); install with `sh scripts/install-hooks.sh` |
| `.github/workflows/` | CI, nightly package builds, package install smoke tests |

## Requirements

- Node.js 18+
- Python 3.10+

## Installation

```bash
git clone https://github.com/BeeGrech/stellarPdf.git
cd stellarPdf

npm install

python3 -m venv python/venv
./python/venv/bin/pip install -r python/requirements.txt

# Install git hooks (sign-off + pre-push checks)
sh scripts/install-hooks.sh
```

## Running

```bash
npm start
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open PDF |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+Z` | Undo last change |
| `←` / `→` | Previous / Next page |
| `+` / `-` | Zoom in / out |
| `Ctrl+Shift+I` | Toggle DevTools |

## Testing

Three test suites cover the project end-to-end:

### Python unit tests: `npm run test:python`

pytest tests in `python/tests/` exercise every RPC handler directly:

| Suite | Coverage |
|-------|---------|
| `TestHandleOpen` | doc loaded, page count, replaces existing |
| `TestHandleGetFields` | AcroForm fields on page 1, none on page 2 |
| `TestHandleFillForm` | text, checkbox, multiple fields, snapshot |
| `TestHandleSave` | file written, value persists on reopen |
| `TestHandleUndo` | revert fill, stack count, empty stack |
| `TestHandleRedaction` | pending stored, text removed after apply |
| `TestHandleInsertText` | snapshot taken, text present in saved file |
| `TestXrefRefs` / `TestWidgetTypeStr` | internal helpers |

**31 tests.** Run with coverage report:

```bash
npm run coverage:python   # prints term-missing, no threshold enforced
```

Current coverage: **~52% on `pdf_server.py`**. Uncovered paths (`detect_fields`, `diagnose`, RPC loop) are exercised by the Playwright UI tests.

### UI end-to-end tests: `npm run test:ui`

[Playwright](https://playwright.dev/) drives a real Electron instance against a generated fixture PDF (`tests/fixtures/test_form.pdf`).

| Spec | Tests |
|------|-------|
| `01_smoke` | App launch, PDF open, toolbar state, page nav, zoom, tool switching |
| `02_form_fill` | Fill tool loads fields, input accepts value, save persists to disk |
| `03_redaction` | Redact tool activates, draw shows Apply button, text permanently removed |
| `04_undo` | Ctrl+Z reverts a form fill; empty stack shows "Nothing to undo" |

**14 tests.** Run locally (requires a display or Xvfb):

```bash
xvfb-run --auto-servernum npm run test:ui
```

### Shell tests: `npm run test:shell`

[ShellSpec](https://shellspec.info/) tests the two git hooks in `scripts/hooks/`:

| Spec | Tests |
|------|-------|
| `prepare_commit_msg_spec` | Appends sign-off, deduplicates, preserves message |
| `pre_push_spec` | All-pass succeeds; each failing check aborts with the right message |

**7 examples.**

### CI

Every push to `main` runs the full suite (lint → Python tests → UI tests) via the **Test** workflow. The **Build & Publish Linux Packages** workflow builds AppImage + deb + rpm nightly (skipped if no new commits) and on `v*` tag pushes. The **Smoke Test Installed Packages** workflow runs after a successful build to verify each package installs and launches.

## Prebuilt Linux packages

| Format | Distro |
|--------|--------|
| `.AppImage` | Universal |
| `.deb` | Ubuntu / Debian |
| `.rpm` | Fedora / RHEL |

Binaries are not stored in git. Grab them from the [Releases](https://github.com/BeeGrech/stellarPdf/releases) page. The rolling **Nightly** prerelease (tag `nightly`) updates daily; versioned `v*` releases are tagged manually.

## Support the project

If Stellar PDF is useful to you, contributions help keep it maintained.

**Cryptocurrency**

| Asset | Address |
|-------|---------|
| **Ethereum (ETH)** | `0x80D870e56AAF468545471f7Ac92AEbc493FBF6B1` |
| **Bitcoin (BTC)** | `1N19qKsCEQW4afSbAbM6vtVUZvWZDgRWXF` |
| **Monero (XMR)** | `49xjr7jRLswMrJ47SnvQsR8xvKM13gv1BiWxJM8JtxQhEfhwM64hXJFin5DvsUAp2QQ3dGzZFoCoa8HYe1oiJS1BBDQPP7C` |

The desktop app also includes a **Support** flow with QR codes and a MetaMask-friendly ETH link.

**Card / PayPal:** [Ko-fi](https://ko-fi.com/rom12two) (no crypto required).

Code contributions and issues are welcome on GitHub.

## License

MIT. See [LICENSE](LICENSE).
