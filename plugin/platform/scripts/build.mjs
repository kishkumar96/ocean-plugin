import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const esmBuild = `import React from 'react';

function PlatformPlaceholder({ label = 'Ocean Widget Platform Ready' }) {
  return React.createElement('div', { 'data-testid': 'platform-placeholder', style: { display: 'none' } }, label);
}

export { PlatformPlaceholder };
`;

const cjsBuild = `'use strict';

const React = require('react');

function PlatformPlaceholder({ label = 'Ocean Widget Platform Ready' }) {
  return React.createElement('div', { 'data-testid': 'platform-placeholder', style: { display: 'none' } }, label);
}

module.exports = { PlatformPlaceholder };
`;

await mkdir(distDir, { recursive: true });
await writeFile(path.join(distDir, 'ocean-widget-platform.js'), esmBuild);
await writeFile(path.join(distDir, 'ocean-widget-platform.cjs'), cjsBuild);

console.log('Built ocean-widget-platform to dist/.');
