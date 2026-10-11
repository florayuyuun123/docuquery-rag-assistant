/**
 * esbuild bundler script for DocuQuery Lambda handlers.
 * Produces one self-contained JS file per handler under backend/dist/.
 */
import { build } from 'esbuild';
import { readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const srcDir = resolve(__dirname, 'src');
const outDir = resolve(__dirname, 'dist');

// Discover all handler entry points: src/{name}/handler.ts
const entries = readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(srcDir, d.name, 'handler.ts'))
  .filter((p) => existsSync(p));

if (entries.length === 0) {
  console.log('No handler entry points found — skipping bundle.');
  process.exit(0);
}

await build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outdir: outDir,
  // Flatten output: dist/upload-url/handler.js, etc.
  outbase: srcDir,
  // Keep AWS SDK external — Lambda runtime provides it, saving bundle size.
  external: [
    '@aws-sdk/*',
  ],
  sourcemap: true,
  minify: false,
  logLevel: 'info',
});
