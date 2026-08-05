const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/background/ner-worker.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: 'src/background/ner-worker.bundle.js',
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
}).catch(() => process.exit(1));
