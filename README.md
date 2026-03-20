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

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+O` | Open PDF |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `←` / `→` | Previous / Next page |
| `+` / `-` | Zoom in / out |
| `Ctrl+Shift+I` | Toggle DevTools |

## License

MIT. See [LICENSE](LICENSE).
