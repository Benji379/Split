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
};

fs.mkdirSync(out, { recursive: true });
for (const [name, src] of Object.entries(files)) {
  fs.copyFileSync(path.join(root, src), path.join(out, name));
  console.log(`vendor/${name}  <-  ${src}`);
}
