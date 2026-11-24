const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');

test('revoked admin credentials request login but an old response cannot lock a newer session', () => {
  const helper = source.match(/function checkAdminSessionResponse\([^]*?\n}/)[0];
  let current = 'old'; let locked = 0;
  const context = vm.createContext({ getAdminToken: () => current, lockAdminSession: () => { locked++; } });
  vm.runInContext(helper, context);
  context.checkAdminSessionResponse({ status: 200 }, 'old'); assert.equal(locked, 0);
  context.checkAdminSessionResponse({ status: 503 }, 'old'); assert.equal(locked, 0);
  context.checkAdminSessionResponse({ status: 401 }, 'old'); assert.equal(locked, 1);
  current = 'new'; context.checkAdminSessionResponse({ status: 401 }, 'old'); assert.equal(locked, 1);
  assert.match(source, /if \(err.status === 401\) \{ clearTimeout\(adminRetryTimer\); return; \}/);
});
