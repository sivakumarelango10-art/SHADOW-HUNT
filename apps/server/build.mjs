// Bundles the server (and the shared workspace package) into dist/index.js.
// Runtime dependencies stay external and are installed from package.json.
import { build } from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url)));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@shadow-hunt/'));

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
