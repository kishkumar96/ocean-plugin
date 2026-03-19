import { cp, mkdir, rm } from 'node:fs/promises';
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
await cp(path.join(srcDir, 'index.js'), path.join(distDir, 'ocean-widget-platform.js'));

console.log('Built ocean-widget-platform from src/ into dist/.');
