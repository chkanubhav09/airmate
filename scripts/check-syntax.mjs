// Dependency-free syntax check: parses every JS module with `node --check`.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js)$/.test(name)) out.push(p);
  }
  return out;
}

let failed = 0;
for (const file of ['public', 'worker', 'tests', 'scripts'].flatMap((d) => walk(d))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`Syntax error in ${file}\n${e.stderr}`);
  }
}
if (failed) process.exit(1);
console.log('All JS files parse cleanly.');
