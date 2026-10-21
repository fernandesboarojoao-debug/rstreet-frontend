const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let scripts = 0;
for (const name of fs.readdirSync(root)) {
  const file = path.join(root, name);
  if (!fs.statSync(file).isFile()) continue;
  if (name.endsWith('.js')) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: name });
  if (!name.endsWith('.html')) continue;
  const html = fs.readFileSync(file, 'utf8');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=|application\/(?:ld\+)?json/.test(match[1])) continue;
    new vm.Script(match[2], { filename: name });
    scripts++;
  }
  for (const [, resource] of html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="([^"<>]+)"/gi)) {
    if (/^(?:https?:|data:|blob:|\/\/|#)/i.test(resource) || /[${}]/.test(resource)) continue;
    const local = resource.split(/[?#]/)[0].replace(/^\//, '');
    if (!fs.existsSync(path.join(root, local))) throw new Error(`${name}: recurso ausente: ${local}`);
  }
}
console.log(`Sintaxe e recursos locais válidos (${scripts} scripts inline).`);
