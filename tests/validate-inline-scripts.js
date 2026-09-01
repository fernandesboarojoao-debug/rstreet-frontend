const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith('.html')).sort();
let scriptCount = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    const attributes = match[1] || '';
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) continue;
    const source = match[2].trim();
    if (!source) continue;
    new vm.Script(source, { filename: `${file}:inline-${index + 1}` });
    scriptCount += 1;
  }
}

console.log(`${htmlFiles.length} arquivos HTML e ${scriptCount} scripts validos.`);
