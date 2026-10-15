import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeIcons } from './scripts/icons.mjs';

const watch = process.argv.includes('--watch');
const out = 'dist';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
manifest.version = pkg.version;
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
cpSync('src/sidepanel/sidepanel.html', `${out}/sidepanel.html`);
writeIcons(`${out}/icons`);

const common = {
  bundle: true,
  target: 'chrome116',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

const builds = [
  // Classic scripts: content scripts can't be ES modules.
  { ...common, entryPoints: { 'main-world': 'src/main-world/index.ts', content: 'src/content/index.ts' }, outdir: out, format: 'iife' },
  { ...common, entryPoints: { background: 'src/background/index.ts' }, outdir: out, format: 'esm' },
  {
    ...common,
    entryPoints: { sidepanel: 'src/sidepanel/index.tsx' },
    outdir: out,
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'css' },
  },
];

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('watching… reload the extension in chrome://extensions after changes');
} else {
  await Promise.all(builds.map((b) => build(b)));
}
