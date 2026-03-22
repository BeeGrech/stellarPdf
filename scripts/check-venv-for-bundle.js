#!/usr/bin/env node
/**
 * electron-builder extraResources copies python/ into the AppImage/deb/rpm.
 * A normal venv uses absolute symlinks (e.g. python3 -> /usr/bin/python3.12),
 * which break inside the mount → spawn ENOENT.
 * Recreate with: python3 -m venv python/venv --copies
 */
const fs = require('fs')
const path = require('path')

/**
 * @param {string} repoRoot Absolute path to repo root (directory containing `python/`)
 * @returns {{ ok: true, message: string } | { ok: false, message: string }}
 */
function validateVenvForBundle(repoRoot) {
  const py = path.join(repoRoot, 'python', 'venv', 'bin', 'python3')

  if (!fs.existsSync(py)) {
    return {
      ok: false,
      message:
        `Missing ${py}\n` +
        'Create a venv and install deps before pack:linux:\n' +
        '  python3 -m venv python/venv --copies\n' +
        '  python/venv/bin/pip install -U pip\n' +
        '  python/venv/bin/pip install -r python/requirements.txt\n',
    }
  }

  let st
  try {
    st = fs.lstatSync(py)
  } catch (e) {
    return { ok: false, message: `Cannot stat ${py}: ${e.message}` }
  }

  if (st.isSymbolicLink()) {
    const target = fs.readlinkSync(py)
    const resolved = path.resolve(path.dirname(py), target)
    const venvRoot = path.join(repoRoot, 'python', 'venv')
    const rel = path.relative(venvRoot, resolved)
    const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    if (!inside) {
      return {
        ok: false,
        message:
          `python/venv uses symlinks outside the venv (${py} -> ${target}).\n` +
          'AppImage/deb/rpm need a relocatable venv. Rebuild with:\n' +
          '  rm -rf python/venv\n' +
          '  python3 -m venv python/venv --copies\n' +
          '  python/venv/bin/pip install -U pip\n' +
          '  python/venv/bin/pip install -r python/requirements.txt\n',
      }
    }
  }

  return { ok: true, message: 'python/venv looks bundle-safe (--copies layout).' }
}

function main() {
  const root = path.join(__dirname, '..')
  const r = validateVenvForBundle(root)
  if (!r.ok) {
    console.error(r.message)
    process.exit(1)
  }
  console.log(r.message)
}

module.exports = { validateVenvForBundle }

if (require.main === module) {
  main()
}
