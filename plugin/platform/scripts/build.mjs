import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const sourceFile = path.join(rootDir, 'src', 'components', 'PlatformPlaceholder.js');

const source = await readFile(sourceFile, 'utf8');

const esmBuild = `${source.trim()}\n`;
const cjsBuild = `${source
  .replace("import React from 'react';", "const React = require('react');")
  .replace(/export\s+function\s+PlatformPlaceholder\s*\(/, 'function PlatformPlaceholder(')
  .trim()}\n\nmodule.exports = { PlatformPlaceholder };\n`;

await mkdir(distDir, { recursive: true });
await writeFile(path.join(distDir, 'ocean-widget-platform.js'), esmBuild);
await writeFile(path.join(distDir, 'ocean-widget-platform.cjs'), cjsBuild);

console.log('Built ocean-widget-platform to dist/.');
