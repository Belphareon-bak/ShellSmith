import { build, context } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(root, 'src/renderer/js/app.js')],
  bundle: true,
  outfile: path.join(root, 'src/renderer/dist/bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: ['chrome126'],
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  loader: { '.css': 'css', '.woff2': 'file', '.png': 'dataurl', '.svg': 'dataurl' }
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('esbuild: sleduji změny…');
} else {
  await build(options);
}
