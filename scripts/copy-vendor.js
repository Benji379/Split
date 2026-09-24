// Copia las librerías del navegador a vendor/ para que la página
// funcione como sitio estático (sin servidor ni CDN).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'vendor');
const files = {
  'jspdf.umd.min.js': 'node_modules/jspdf/dist/jspdf.umd.min.js',
  'jszip.min.js': 'node_modules/jszip/dist/jszip.min.js',
  'heic2any.min.js': 'node_modules/heic2any/dist/heic2any.min.js',
  'UTIF.js': 'node_modules/utif/UTIF.js',
  'pako_inflate.min.js': fs.existsSync(path.join(root, 'node_modules/utif/node_modules/pako'))
    ? 'node_modules/utif/node_modules/pako/dist/pako_inflate.min.js'
    : 'node_modules/pako/dist/pako_inflate.min.js',
  // Editor de PDF: lectura y dibujo (pdf.js), escritura (pdf-lib) y OCR (tesseract.js)
  // Con extensión .js: algunos servidores sirven .mjs como text/plain y el navegador lo rechaza
  'pdfjs/pdf.min.js': 'node_modules/pdfjs-dist/build/pdf.min.mjs',
  'pdfjs/pdf.worker.min.js': 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'pdf-lib.min.js': 'node_modules/pdf-lib/dist/pdf-lib.min.js',
  'fontkit.umd.min.js': 'node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', // fuentes propias dentro del PDF
  'tesseract/tesseract.min.js': 'node_modules/tesseract.js/dist/tesseract.min.js',
  'tesseract/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  // Solo los núcleos LSTM (el motor que usa el OCR); tesseract elige el que soporte el navegador
  'tesseract/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract/lang/spa.traineddata.gz': 'node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz',
  'tesseract/lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
// Carpetas completas
const dirs = {
  'pdfjs/cmaps': 'node_modules/pdfjs-dist/cmaps',
  'pdfjs/standard_fonts': 'node_modules/pdfjs-dist/standard_fonts',
  'pdfjs/wasm': 'node_modules/pdfjs-dist/wasm',
};

for (const [name, src] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
  fs.copyFileSync(path.join(root, src), path.join(out, name));
  console.log(`vendor/${name}  <-  ${src}`);
}
for (const [name, src] of Object.entries(dirs)) {
  fs.rmSync(path.join(out, name), { recursive: true, force: true });
  fs.cpSync(path.join(root, src), path.join(out, name), { recursive: true });
  console.log(`vendor/${name}/  <-  ${src}/`);
}
