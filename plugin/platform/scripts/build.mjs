import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await cp(srcDir, path.join(distDir, 'src'), { recursive: true });

await writeFile(
  path.join(distDir, 'ocean-widget-platform.js'),
  "export * from './src/index.js';\n",
  'utf8'
);

const componentSource = await readFile(path.join(srcDir, 'components', 'PlatformPlaceholder.js'), 'utf8');
const exportedFunctions = [...componentSource.matchAll(/export\s+function\s+(\w+)\s*\(/g)].map((match) => match[1]);

if (exportedFunctions.length === 0) {
  throw new Error('No named exports found in PlatformPlaceholder.js');
}

const cjsComponent = componentSource
  .replace(/^import\s+React\s+from\s+['\"]react['\"];?\s*$/m, "const React = require('react');")
  .replace(/export\s+function\s+(\w+)\s*\(/g, 'function $1(')
  .trim();

await writeFile(
  path.join(distDir, 'ocean-widget-platform.cjs'),
  `${cjsComponent}\n\nmodule.exports = { ${exportedFunctions.join(', ')} };\n`,
  'utf8'
);

console.log('Built ocean-widget-platform from src/ into dist/.');
