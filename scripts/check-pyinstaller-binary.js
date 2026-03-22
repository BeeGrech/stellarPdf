#!/usr/bin/env node
/**
 * Pre-pack guard: verifies python/dist/pdf_server exists and is executable
 * before electron-builder packages it into the AppImage/deb/rpm.
 *
 * If the binary is missing, the packaged app will show "Backend Error (ENOENT)"
 * on every launch. Build the binary first:
 *   python/venv/bin/pyinstaller --onefile --name pdf_server \
 *     --distpath python/dist python/pdf_server.py
 */
const fs = require('fs')
const path = require('path')

function validatePyInstallerBinary(repoRoot) {
  const bin = path.join(repoRoot, 'python', 'dist', 'pdf_server')

  if (!fs.existsSync(bin)) {
    return {
      ok: false,
      message:
        `Missing ${bin}\n` +
        'Build the PyInstaller binary before pack:linux:\n' +
        '  python/venv/bin/pyinstaller --onefile --name pdf_server \\\n' +
        '    --distpath python/dist python/pdf_server.py\n',
    }
  }

  try {
    fs.accessSync(bin, fs.constants.X_OK)
  } catch {
    return {
      ok: false,
      message:
        `${bin} exists but is not executable.\n` +
        'Fix with: chmod +x python/dist/pdf_server\n',
    }
  }

  const stat = fs.statSync(bin)
  if (stat.size < 1024 * 1024) {
    return {
      ok: false,
      message:
        `${bin} is suspiciously small (${stat.size} bytes) — may be corrupted.\n` +
        'Rebuild with pyinstaller.\n',
    }
  }

  return { ok: true, message: `pdf_server binary ready (${(stat.size / 1024 / 1024).toFixed(1)} MB).` }
}

function main() {
  const root = path.join(__dirname, '..')
  const r = validatePyInstallerBinary(root)
  if (!r.ok) {
    console.error(r.message)
    process.exit(1)
  }
  console.log(r.message)
}

module.exports = { validatePyInstallerBinary }

if (require.main === module) {
  main()
}
