const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
test('email diagnostics block duplicate submits and reuse an uncertain attempt without claiming delivery', async () => {
  const elements = {
    emailTestRecipient: { value: 'qa@example.invalid', disabled: false, reportValidity: () => true },
    emailTestButton: { disabled: false, textContent: 'Enviar teste' }, emailTestStatus: { textContent: '' },
  };
  let resolve; const calls = []; let requests = 0;
  const scope = vm.createContext({
    document: { getElementById: id => elements[id] }, crypto: { randomUUID: () => { requests++; return `fixture-${requests}`; } },
    API: 'https://fixture.invalid/admin', getAdminToken: () => 'fixture', authHeaders: extra => extra,
    checkAdminSessionResponse() {}, AbortSignal,
    fetch: (url, options) => { calls.push({ url, options }); return new Promise(done => { resolve = done; }); },
  });
  const start = html.indexOf('let emailTestAttempt = null;'); const end = html.indexOf('async function loadOperacao()', start);
  assert.ok(start > 0 && end > start); vm.runInContext(html.slice(start, end), scope);
  const pending = scope.sendDiagnosticEmail(); await scope.sendDiagnosticEmail(); assert.equal(calls.length, 1); assert.equal(elements.emailTestRecipient.disabled, true);
  resolve({ ok: false, status: 503, json: async () => ({ erro: 'Teste sem confirmacao' }) }); await pending;
  assert.equal(elements.emailTestButton.disabled, false); assert.equal(elements.emailTestRecipient.disabled, false);
  const retry = scope.sendDiagnosticEmail(); assert.equal(requests, 1); assert.equal(calls[0].options.body, calls[1].options.body);
  assert.match(calls[0].url, /operacao\/teste-email$/);
  resolve({ ok: true, status: 200, json: async () => ({ accepted: true, mensagem: 'Aceito pelo provedor, confirme o recebimento.' }) }); await retry;
  assert.match(elements.emailTestStatus.textContent, /confirme o recebimento/);
  assert.equal(elements.emailTestButton.disabled, false);
});
