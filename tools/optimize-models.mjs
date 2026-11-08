// Compress GLBs in place with meshopt (+ quantization). Node names and extras are kept.
// Usage: npm run optimize -- models/head            (folder)  or  a list of .glb files
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (!args.length) args.push('models');
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) readdirSync(p).forEach((f) => walk(join(p, f)));
  else if (p.endsWith('.glb')) files.push(p);
};
args.forEach(walk);

for (const f of files) {
  const before = statSync(f).size;
  execFileSync('npx', ['gltf-transform', 'meshopt', f, f], { stdio: 'inherit' });
  console.log(`${f}: ${(before / 1e6).toFixed(1)} MB -> ${(statSync(f).size / 1e6).toFixed(1)} MB`);
}
