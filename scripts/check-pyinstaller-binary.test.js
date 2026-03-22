const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { validatePyInstallerBinary } = require('./check-pyinstaller-binary')

function makeFakeRoot(setup) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyinstaller-test-'))
  fs.mkdirSync(path.join(dir, 'python', 'dist'), { recursive: true })
  setup(dir)
  return dir
}

test('fails when binary is missing', () => {
  const root = makeFakeRoot(() => {})
  const r = validatePyInstallerBinary(root)
  assert.equal(r.ok, false)
  assert.match(r.message, /Missing/)
})

test('fails when binary is not executable', () => {
  const root = makeFakeRoot((dir) => {
    const bin = path.join(dir, 'python', 'dist', 'pdf_server')
    fs.writeFileSync(bin, 'x'.repeat(2 * 1024 * 1024))
    fs.chmodSync(bin, 0o644)
  })
  const r = validatePyInstallerBinary(root)
  assert.equal(r.ok, false)
  assert.match(r.message, /not executable/)
})

test('fails when binary is suspiciously small', () => {
  const root = makeFakeRoot((dir) => {
    const bin = path.join(dir, 'python', 'dist', 'pdf_server')
    fs.writeFileSync(bin, 'small')
    fs.chmodSync(bin, 0o755)
  })
  const r = validatePyInstallerBinary(root)
  assert.equal(r.ok, false)
  assert.match(r.message, /suspiciously small/)
})

test('passes when binary exists, is executable, and is large enough', () => {
  const root = makeFakeRoot((dir) => {
    const bin = path.join(dir, 'python', 'dist', 'pdf_server')
    fs.writeFileSync(bin, 'x'.repeat(2 * 1024 * 1024))
    fs.chmodSync(bin, 0o755)
  })
  const r = validatePyInstallerBinary(root)
  assert.equal(r.ok, true)
  assert.match(r.message, /ready/)
})
