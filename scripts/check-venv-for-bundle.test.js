'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const os = require('os')

const { validateVenvForBundle } = require('./check-venv-for-bundle.js')

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true })
}

function makeFakeVenv(repoRoot) {
  const bin = path.join(repoRoot, 'python', 'venv', 'bin')
  mkdirp(bin)
  return bin
}

test('missing python/venv/bin/python3 → not ok', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-venv-test-'))
  const r = validateVenvForBundle(root)
  assert.strictEqual(r.ok, false)
  assert.match(r.message, /Missing/)
})

test('regular file python3 → ok', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-venv-test-'))
  const bin = makeFakeVenv(root)
  const py = path.join(bin, 'python3')
  fs.writeFileSync(py, '#!/bin/sh\necho\n', { mode: 0o755 })
  const r = validateVenvForBundle(root)
  assert.strictEqual(r.ok, true)
})

test('symlink python3 → python3.12 inside venv → ok', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-venv-test-'))
  const bin = makeFakeVenv(root)
  fs.writeFileSync(path.join(bin, 'python3.12'), '')
  fs.symlinkSync('python3.12', path.join(bin, 'python3'))
  const r = validateVenvForBundle(root)
  assert.strictEqual(r.ok, true)
})

test('symlink python3 → absolute host interpreter → not ok', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-venv-test-'))
  const bin = makeFakeVenv(root)
  fs.symlinkSync('/usr/bin/python3', path.join(bin, 'python3'))
  const r = validateVenvForBundle(root)
  assert.strictEqual(r.ok, false)
  assert.match(r.message, /symlinks outside the venv/)
})
