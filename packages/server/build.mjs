import { build } from 'esbuild';
import { chmod, readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  define: { __OPEN_LOOP_VERSION__: JSON.stringify(pkg.version) },
  // CommonJS dependencies inside an ESM bundle still call require().
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __olCreateRequire } from 'node:module';\nconst require = __olCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
await chmod('dist/cli.js', 0o755);
