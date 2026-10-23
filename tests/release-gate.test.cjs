const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runChecks } = require('../scripts/verify-release.cjs');

test('Vercel build runs syntax and all tests before publishing', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.equal(config.buildCommand, 'node scripts/verify-release.cjs');
  const calls = [];
  runChecks((node, args) => { calls.push({ node, args }); return { status: 0 }; });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].node, process.execPath);
  assert.deepEqual(calls[0].args, ['scripts/check-static.cjs']);
  assert.equal(calls[1].args[0], '--test');
  assert.ok(calls[1].args.includes('tests/admin-operations.test.cjs'));
});

test('release stops on a failed check, missing process or timeout', () => {
  for (const result of [{ status: 1 }, { status: null }, { error: Error('timeout'), status: null }]) {
    let calls = 0;
    assert.throws(() => runChecks(() => { calls++; return result; }), /Publicacao bloqueada/);
    assert.equal(calls, 1);
  }
});
