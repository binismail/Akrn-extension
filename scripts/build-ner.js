const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const runtimeSource = path.join(__dirname, '../node_modules/onnxruntime-web/dist');
const runtimeTarget = path.join(__dirname, '../src/background/onnx-runtime');
fs.mkdirSync(runtimeTarget, { recursive: true });
for (const file of [
  'ort-wasm.wasm',
  'ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-threaded.worker.js',
]) {
  fs.copyFileSync(path.join(runtimeSource, file), path.join(runtimeTarget, file));
}

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
