# Stellar PDF

**This repository is the canonical home for Stellar PDF.** The Electron app, renderer, and Python PDF backend all live here. Clone and run from this repo; older or experimental copies elsewhere should be treated as outdated.

A beautiful, open-source PDF editor for Linux. Fill forms, redact content, and insert text, without Adobe.

## Repository layout

| Path | Role |
|------|------|
| `main.js`, `preload.js` | Electron main process and preload bridge |
| `renderer/` | UI, PDF.js viewing, tools |
| `python/` | PyMuPDF server and `requirements.txt` |
| `diagnose_pdf.py` | Optional PDF inspection helper |

## Features

- **Form Filling:** AcroForm field detection with interactive overlays; visual field detection for flat PDFs
- **Permanent Redaction:** Draw redaction boxes, apply to permanently remove content
- **Text Insertion:** Click to insert text with baseline snapping to existing typography
- **Page Navigation:** Thumbnail sidebar, prev/next, keyboard shortcuts
- **Zoom:** 50% to 300% in steps
- **Dark theme:** Easy on the eyes

## Stack

- [Electron](https://www.electronjs.org/): app shell and file I/O
- [PDF.js](https://mozilla.github.io/pdf.js/): read-only PDF rendering
- [PyMuPDF](https://pymupdf.readthedocs.io/): all PDF mutations (form fill, redact, text insert, save)

## Requirements

- Node.js 18+
- Python 3.10+

## Python tests and lint

From the repository root (use a venv that has dependencies installed):

```bash
./python/venv/bin/pip install -r python/requirements-dev.txt
npm run test:python
npm run lint:python
```

`pytest` uses `pytest.ini` (tests live under `python/tests/`). `pylint` reads `.pylintrc` and checks `python/pdf_server.py`.

## Installation

```bash
git clone https://github.com/BeeGrech/stellarPdf.git
cd stellarPdf

npm install

python3 -m venv python/venv
./python/venv/bin/pip install -r python/requirements.txt
```

## Running

```bash
npm start
```

## Prebuilt Linux AppImage

Binaries are **not** stored in git (`dist/` is ignored). GitHub Actions builds an AppImage on a **daily schedule** (only when the default branch has new commits since the last `nightly` build), on **manual workflow dispatch** (always), and when you push a **`v*` version tag**. Grab the file from the repo [Releases](https://github.com/BeeGrech/stellarPdf/releases) page: the rolling prerelease **Nightly (Linux AppImage)** (tag `nightly`), or the release matching your `v*` tag.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open PDF |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `←` / `→` | Previous / Next page |
| `+` / `-` | Zoom in / out |
| `Ctrl+Shift+I` | Toggle DevTools |

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

Code contributions and issues are welcome on GitHub as well.

## License

MIT. See [LICENSE](LICENSE).
