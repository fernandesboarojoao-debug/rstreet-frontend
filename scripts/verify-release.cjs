const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runChecks(run = spawnSync) {
  const root = path.resolve(__dirname, '..');
  const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.cjs')).sort();
  if (!tests.length) throw new Error('Nenhum teste encontrado. Publicacao bloqueada.');
  for (const args of [['scripts/check-static.cjs'], ['--test', ...tests.map(name => `tests/${name}`)]]) {
    const result = run(process.execPath, args, { cwd: root, stdio: 'inherit', timeout: 120000 });
    if (result.error || result.status !== 0) throw new Error('Verificacao falhou. Publicacao bloqueada.');
  }
}

module.exports = { runChecks };
if (require.main === module) {
  try { runChecks(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
