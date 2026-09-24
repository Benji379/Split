// Convierte una imagen a color en un dibujo de líneas negras para colorear.
// Se usa como Web Worker (postMessage) o, si el navegador no deja crear workers
// (p. ej. al abrir la página con doble clic), directamente en la página con Trazo.process().
//
// Dos estilos:
//  - "cartoon": agrupa los colores en zonas (k-means), limpia las zonas pequeñas y dibuja sus bordes.
//    Ideal para dibujos animados, ilustraciones y logos.
//  - "photo": busca los bordes de la imagen (tipo Canny) y los une en líneas. Para fotos reales.
(function (root) {
  'use strict';

  // ---------- Color ----------
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

  // RGBA (con la transparencia sobre blanco) → planos L, a, b
  function toLab(data, n) {
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const al = data[i + 3] / 255, wh = 255 * (1 - al);
      const r = LIN[Math.round(data[i] * al + wh)], g = LIN[Math.round(data[i + 1] * al + wh)], b = LIN[Math.round(data[i + 2] * al + wh)];
      const x = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const y = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const z = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      L[p] = 116 * y - 16;
      A[p] = 500 * (x - y);
      B[p] = 200 * (y - z);
    }
    return [L, A, B];
  }

  // ---------- Desenfoque gaussiano (3 cajas) ----------
  function boxH(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      const fv = src[o];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[o + Math.min(j, w - 1)];
      for (let x = 0; x < w; x++) {
        val += src[o + Math.min(x + r, w - 1)] - (x - r - 1 >= 0 ? src[o + x - r - 1] : fv);
        dst[o + x] = val * iarr;
      }
    }
  }
  function boxV(src, dst, w, h, r) {
    const iarr = 1 / (r + r + 1);
    for (let x = 0; x < w; x++) {
      const fv = src[x];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += src[Math.min(j, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        val += src[Math.min(y + r, h - 1) * w + x] - (y - r - 1 >= 0 ? src[(y - r - 1) * w + x] : fv);
        dst[y * w + x] = val * iarr;
      }
    }
  }
  function blur(src, w, h, sigma) {
    if (sigma < 0.3) return src.slice();
    // Tamaños de caja que aproximan la gaussiana
    const n = 3, wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    const a = src.slice(), b = new Float32Array(src.length);
    for (let i = 0; i < n; i++) {
      const r = ((i < m ? wl : wl + 2) - 1) / 2;
      boxH(a, b, w, h, r);
      boxV(b, a, w, h, r);
    }
    return a;
  }

  // ---------- Distancia euclídea (Felzenszwalb) ----------
  const INF = 1e20;
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  }
  // Distancia al cuadrado de cada píxel al píxel marcado más cercano
  function edt(mask, w, h) {
    // Float64 y un "infinito" finito: con Float32 la resta de dos infinitos pierde la parábola
    const n = w * h, g = new Float64Array(n), FAR = 1e12;
    for (let i = 0; i < n; i++) g[i] = mask[i] ? 0 : FAR;
    const m = Math.max(w, h);
    const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = g[y * w + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) f[x] = g[o + x];
      edt1d(f, w, d, v, z);
      for (let x = 0; x < w; x++) g[o + x] = d[x];
    }
    return g;
  }

  // ---------- Zonas de color (k-means) ----------
  function kmeans(L, A, B, n, k) {
    // Se entrena con una muestra y luego se asigna cada píxel
    const step = Math.max(1, Math.floor(n / 40000));
    const S = [];
    for (let p = 0; p < n; p += step) S.push(p);
    const m = S.length, sx = new Float32Array(m * 3);
    S.forEach((p, i) => { sx[i * 3] = L[p]; sx[i * 3 + 1] = A[p]; sx[i * 3 + 2] = B[p]; });

    // Inicio k-means++ (determinista para que el resultado no cambie entre ejecuciones)
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const C = new Float32Array(k * 3), dist = new Float32Array(m).fill(INF);
    let first = Math.floor(rnd() * m);
    C.set(sx.subarray(first * 3, first * 3 + 3), 0);
    for (let c = 1; c < k; c++) {
      let sum = 0;
      for (let i = 0; i < m; i++) {
        const dl = sx[i * 3] - C[(c - 1) * 3], da = sx[i * 3 + 1] - C[(c - 1) * 3 + 1], db = sx[i * 3 + 2] - C[(c - 1) * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < dist[i]) dist[i] = d;
        sum += dist[i];
      }
      let t = rnd() * sum, pick = m - 1;
      for (let i = 0; i < m; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } }
      C.set(sx.subarray(pick * 3, pick * 3 + 3), c * 3);
    }

    const lab = new Uint8Array(m), acc = new Float64Array(k * 4);
    for (let it = 0; it < 12; it++) {
      acc.fill(0);
      for (let i = 0; i < m; i++) {
        let best = 0, bd = INF;
        for (let c = 0; c < k; c++) {
          const dl = sx[i * 3] - C[c * 3], da = sx[i * 3 + 1] - C[c * 3 + 1], db = sx[i * 3 + 2] - C[c * 3 + 2];
          const d = dl * dl + da * da + db * db;
          if (d < bd) { bd = d; best = c; }
        }
        lab[i] = best;
        acc[best * 4] += sx[i * 3]; acc[best * 4 + 1] += sx[i * 3 + 1]; acc[best * 4 + 2] += sx[i * 3 + 2]; acc[best * 4 + 3]++;
      }
      for (let c = 0; c < k; c++) {
        const cnt = acc[c * 4 + 3];
        if (cnt) { C[c * 3] = acc[c * 4] / cnt; C[c * 3 + 1] = acc[c * 4 + 1] / cnt; C[c * 3 + 2] = acc[c * 4 + 2] / cnt; }
      }
    }

    const out = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      let best = 0, bd = INF;
      for (let c = 0; c < k; c++) {
        const dl = L[p] - C[c * 3], da = A[p] - C[c * 3 + 1], db = B[p] - C[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      out[p] = best;
    }
    return { labels: out, centers: C };
  }

  // Filtro de mayoría: cada píxel toma la zona más común a su alrededor (quita el ruido de los bordes)
  function majority(lab, w, h, k, r) {
    const out = new Uint8Array(lab.length), cnt = new Int32Array(k);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = lab[y * w + x], bc = 0;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
            const c = ++cnt[lab[yy * w + xx]];
            if (c > bc) { bc = c; best = lab[yy * w + xx]; }
          }
        }
        out[y * w + x] = best;
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) cnt[lab[yy * w + xx]] = 0;
      }
    }
    return out;
  }

  // Suaviza el borde de las zonas: cada píxel toma la zona con más peso a su alrededor
  // (una "mayoría" gaussiana; redondea los escalones y los dientes sin mover las formas grandes)
  function smoothLabels(lab, w, h, k, sigma) {
    if (sigma < 0.5) return lab;
    const n = w * h, best = new Float32Array(n).fill(-1), out = lab.slice(), ind = new Float32Array(n);
    const present = new Uint8Array(k);
    for (let p = 0; p < n; p++) present[lab[p]] = 1;
    for (let c = 0; c < k; c++) {
      if (!present[c]) continue;
      for (let p = 0; p < n; p++) ind[p] = lab[p] === c ? 1 : 0;
      const b = blur(ind, w, h, sigma);
      for (let p = 0; p < n; p++) if (b[p] > best[p]) { best[p] = b[p]; out[p] = c; }
    }
    return out;
  }

  // Une cada zona más pequeña que minArea con la zona vecina que más la rodea
  function mergeSmall(lab, w, h, k, minArea) {
    const n = w * h, comp = new Int32Array(n), queue = new Int32Array(n), cnt = new Int32Array(k);
    for (let pass = 0; pass < 3; pass++) {
      comp.fill(-1);
      let id = 0, changed = false;
      for (let s = 0; s < n; s++) {
        if (comp[s] >= 0) continue;
        const cur = lab[s];
        let head = 0, tail = 0;
        queue[tail++] = s; comp[s] = id;
        while (head < tail) {
          const p = queue[head++], x = p % w;
          if (x > 0 && comp[p - 1] < 0 && lab[p - 1] === cur) { comp[p - 1] = id; queue[tail++] = p - 1; }
          if (x < w - 1 && comp[p + 1] < 0 && lab[p + 1] === cur) { comp[p + 1] = id; queue[tail++] = p + 1; }
          if (p >= w && comp[p - w] < 0 && lab[p - w] === cur) { comp[p - w] = id; queue[tail++] = p - w; }
          if (p < n - w && comp[p + w] < 0 && lab[p + w] === cur) { comp[p + w] = id; queue[tail++] = p + w; }
        }
        if (tail < minArea) {
          cnt.fill(0);
          for (let i = 0; i < tail; i++) {
            const p = queue[i], x = p % w;
            if (x > 0 && lab[p - 1] !== cur) cnt[lab[p - 1]]++;
            if (x < w - 1 && lab[p + 1] !== cur) cnt[lab[p + 1]]++;
            if (p >= w && lab[p - w] !== cur) cnt[lab[p - w]]++;
            if (p < n - w && lab[p + w] !== cur) cnt[lab[p + w]]++;
          }
          let best = -1, bc = 0;
          for (let c = 0; c < k; c++) if (cnt[c] > bc) { bc = cnt[c]; best = c; }
          if (best >= 0) { for (let i = 0; i < tail; i++) lab[queue[i]] = best; changed = true; }
        }
        id++;
      }
      if (!changed) break;
    }
    return lab;
  }

  // Une las franjas angostas (brillos, bordes entre dos colores, antialias) con la zona vecina:
  // una zona cuyo punto más interior está a menos de minHalf px del borde no es una zona para colorear
  function mergeThin(lab, w, h, k, minHalf) {
    if (minHalf < 1) return lab;
    const n = w * h, border = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x, c = lab[p];
        if ((x > 0 && lab[p - 1] !== c) || (x < w - 1 && lab[p + 1] !== c) || (y > 0 && lab[p - w] !== c) || (y < h - 1 && lab[p + w] !== c)) border[p] = 1;
      }
    }
    const d2 = edt(border, w, h), lim = minHalf * minHalf;
    const seen = new Uint8Array(n), queue = new Int32Array(n), cnt = new Int32Array(k);
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      const cur = lab[s];
      let head = 0, tail = 0, maxD = 0;
      queue[tail++] = s; seen[s] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % w;
        if (d2[p] > maxD) maxD = d2[p];
        if (x > 0 && !seen[p - 1] && lab[p - 1] === cur) { seen[p - 1] = 1; queue[tail++] = p - 1; }
        if (x < w - 1 && !seen[p + 1] && lab[p + 1] === cur) { seen[p + 1] = 1; queue[tail++] = p + 1; }
        if (p >= w && !seen[p - w] && lab[p - w] === cur) { seen[p - w] = 1; queue[tail++] = p - w; }
        if (p < n - w && !seen[p + w] && lab[p + w] === cur) { seen[p + w] = 1; queue[tail++] = p + w; }
      }
      if (maxD >= lim) continue;
      // Cada píxel de la franja toma la zona vecina más común
      cnt.fill(0);
      for (let i = 0; i < tail; i++) {
        const p = queue[i], x = p % w;
        if (x > 0 && lab[p - 1] !== cur) cnt[lab[p - 1]]++;
        if (x < w - 1 && lab[p + 1] !== cur) cnt[lab[p + 1]]++;
        if (p >= w && lab[p - w] !== cur) cnt[lab[p - w]]++;
        if (p < n - w && lab[p + w] !== cur) cnt[lab[p + w]]++;
      }
      let best = -1, bc = 0;
      for (let c = 0; c < k; c++) if (cnt[c] > bc) { bc = cnt[c]; best = c; }
      if (best >= 0) for (let i = 0; i < tail; i++) lab[queue[i]] = best;
    }
    return lab;
  }

  // Quita los grupos de píxeles marcados (8 vecinos) con menos de minSize píxeles
  function dropSpecks(mask, w, h, minSize) {
    if (minSize < 2) return mask;
    const n = w * h, seen = new Uint8Array(n), queue = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      if (!mask[s] || seen[s]) continue;
      let head = 0, tail = 0;
      queue[tail++] = s; seen[s] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % w, y = (p - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (mask[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
          }
        }
      }
      if (tail < minSize) for (let i = 0; i < tail; i++) mask[queue[i]] = 0;
    }
    return mask;
  }

  // ---------- Estilo "dibujo animado" ----------
  function cartoonEdges(img, o, sc) {
    const { w, h } = img, n = w * h;
    const [L, A, B] = img.lab;
    const sg = 0.5 * sc;
    const Ls = blur(L, w, h, sg), As = blur(A, w, h, sg), Bs = blur(B, w, h, sg);
    const k = Math.round(4 + o.detail * 1.6); // 6 … 20 colores
    const { labels } = kmeans(Ls, As, Bs, n, k);
    let lab = majority(labels, w, h, k, Math.max(1, Math.round(sc)));
    lab = majority(lab, w, h, k, 1);
    const minArea = Math.round(sc * sc * (4 + o.cleanup * o.cleanup * 4));
    mergeSmall(lab, w, h, k, minArea);
    mergeThin(lab, w, h, k, sc * (1 + o.cleanup * 0.45));
    lab = smoothLabels(lab, w, h, k, o.smooth * 0.55 * sc);
    // Los contornos que ya traía el dibujo (y su borde suavizado) son una zona aparte:
    // así el borde de cada color cae pegado a la línea y no sale una segunda línea al lado
    const dark = darkMask(img, sc, o.smooth);
    const near = edt(dark.thin, w, h), grow = (2.5 * sc) ** 2;
    for (let p = 0; p < n; p++) if (near[p] <= grow) lab[p] = k;

    const edge = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if ((x < w - 1 && lab[p] !== lab[p + 1]) || (y < h - 1 && lab[p] !== lab[p + w])) edge[p] = 1;
      }
    }
    return { edge, dark };
  }

  // ---------- Estilo "foto" ----------
  function photoEdges(img, o, sc) {
    const { w, h } = img, n = w * h;
    const [L, A, B] = img.lab;
    const sg = Math.max(0.7, (4.2 - 0.36 * o.detail)) * sc;
    const P = [blur(L, w, h, sg), blur(A, w, h, sg), blur(B, w, h, sg)];
    const mag = new Float32Array(n), dir = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        let sum = 0, bm = -1, bgx = 0, bgy = 0;
        for (let c = 0; c < 3; c++) {
          const I = P[c];
          const gx = (I[p - w + 1] + 2 * I[p + 1] + I[p + w + 1]) - (I[p - w - 1] + 2 * I[p - 1] + I[p + w - 1]);
          const gy = (I[p + w - 1] + 2 * I[p + w] + I[p + w + 1]) - (I[p - w - 1] + 2 * I[p - w] + I[p - w + 1]);
          const m2 = gx * gx + gy * gy;
          sum += m2;
          if (m2 > bm) { bm = m2; bgx = gx; bgy = gy; }
        }
        mag[p] = Math.sqrt(sum);
        // Dirección del gradiente (y hacia abajo): 0 horizontal, 1 a 45°, 2 vertical, 3 a 135°
        const ang = ((Math.atan2(bgy, bgx) * 180 / Math.PI) + 180) % 180;
        dir[p] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
      }
    }
    // Supresión de no máximos: solo la cresta de cada borde
    const nms = new Float32Array(n);
    let maxM = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x, m = mag[p];
        let a, b;
        switch (dir[p]) {
          case 0: a = mag[p - 1]; b = mag[p + 1]; break;
          case 1: a = mag[p - w - 1]; b = mag[p + w + 1]; break;
          case 2: a = mag[p - w]; b = mag[p + w]; break;
          default: a = mag[p - w + 1]; b = mag[p + w - 1];
        }
        if (m >= a && m >= b) { nms[p] = m; if (m > maxM) maxM = m; }
      }
    }
    // Umbrales por percentil: más detalle = más bordes
    const bins = 1024, hist = new Int32Array(bins);
    let total = 0;
    for (let p = 0; p < n; p++) if (nms[p] > 0) { hist[Math.min(bins - 1, Math.floor(nms[p] / maxM * bins))]++; total++; }
    const keep = 0.06 + o.detail * 0.03; // fracción de crestas que se vuelven líneas fuertes
    let acc = 0, hiBin = bins - 1;
    for (; hiBin > 0; hiBin--) { acc += hist[hiBin]; if (acc >= total * keep) break; }
    const hi = Math.max(hiBin / bins * maxM, 6); // evita dibujar el ruido de imágenes planas
    const lo = hi * 0.45;

    const edge = new Uint8Array(n), queue = new Int32Array(n);
    let tail = 0;
    for (let p = 0; p < n; p++) if (nms[p] >= hi) { edge[p] = 1; queue[tail++] = p; }
    let head = 0;
    while (head < tail) {
      const p = queue[head++];
      for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) {
        const q = p + d;
        if (q >= 0 && q < n && !edge[q] && nms[q] >= lo) { edge[q] = 1; queue[tail++] = q; }
      }
    }
    dropSpecks(edge, w, h, Math.round(sc * (4 + o.cleanup * 5)));
    return { edge, dark: darkMask(img, sc, o.smooth) };
  }

  // Zonas casi negras (contornos que ya traía el dibujo, pelo, ojos).
  // thin: las partes delgadas (líneas), que se dibujan como una sola línea en vez de dos bordes.
  function darkMask(img, sc, smooth = 0) {
    const { w, h } = img, n = w * h;
    const L = blur(img.lab[0], w, h, 0.6 * sc);
    let m = new Float32Array(n);
    for (let p = 0; p < n; p++) m[p] = L[p] < 34 ? 1 : 0;
    // Bordes de lo negro suavizados (sin dientes)
    if (smooth > 0) m = blur(m, w, h, (0.4 + smooth * 0.3) * sc);
    const all = new Uint8Array(n), not = new Uint8Array(n);
    for (let p = 0; p < n; p++) { if (m[p] >= 0.5) all[p] = 1; else not[p] = 1; }
    // Apertura: lo que sobrevive a erosionar y dilatar es "grueso"; el resto son líneas
    // (hasta ~44 px de grosor en una imagen de 1000 px: así los contornos gruesos de un dibujo no quedan huecos)
    const ro = 22 * sc, ro2 = ro * ro;
    const dIn = edt(not, w, h), core = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (all[p] && dIn[p] > ro2) core[p] = 1;
    const dOut = edt(core, w, h), thin = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (all[p] && dOut[p] > ro2) thin[p] = 1;
    return { all, thin };
  }

  // ---------- Proceso completo ----------
  const cache = { img: null, key: '', edges: null };

  function setImage(w, h, data) {
    cache.img = { w, h, rgba: data, lab: toLab(data, w * h) };
    cache.key = '';
    cache.edges = null;
  }

  // o = { mode, detail (1-10), thickness (1-10), cleanup (0-10), smooth (0-10), fillDark, regions }
  function process(o) {
    const img = cache.img;
    if (!img) return null;
    const { w, h } = img, n = w * h;
    const sc = Math.max(w, h) / 1000; // los parámetros están pensados para una imagen de 1000 px
    const key = [o.mode, o.detail, o.cleanup, o.smooth].join('|');
    if (cache.key !== key) {
      cache.edges = o.mode === 'photo' ? photoEdges(img, o, sc) : cartoonEdges(img, o, sc);
      cache.key = key;
    }
    const { edge, dark } = cache.edges;

    // Engrosa las líneas: todo lo que está a menos de r del borde es tinta (con antialias)
    const r = sc * (0.35 + 0.42 * o.thickness);
    const d2 = edt(edge, w, h);
    let f = new Float32Array(n);
    for (let p = 0; p < n; p++) f[p] = Math.max(0, Math.min(1, r + 0.5 - Math.sqrt(d2[p])));
    // Las líneas negras del original se rellenan (una línea, no dos bordes); lo negro grande, si se pide
    const fill = o.fillDark ? dark.all : dark.thin;
    for (let p = 0; p < n; p++) if (fill[p]) f[p] = 1;
    // Suaviza los escalones: desenfoque y vuelve a endurecer el borde.
    // En fotos (bordes sueltos) el suavizado va aquí; se baja el umbral para no adelgazar las líneas.
    const photoSmooth = o.mode === 'photo' ? o.smooth * 0.3 * sc : 0;
    f = blur(f, w, h, 0.7 * sc + photoSmooth);
    const t = photoSmooth ? 0.5 - Math.min(0.2, o.smooth * 0.025) : 0.5;
    const ink = new Uint8ClampedArray(n);
    for (let p = 0; p < n; p++) ink[p] = Math.max(0, Math.min(1, (f[p] - t) * 3.2 + 0.5)) * 255;

    // Puntitos sueltos fuera
    const solid = new Uint8Array(n);
    for (let p = 0; p < n; p++) solid[p] = ink[p] > 96 ? 1 : 0;
    const before = solid.slice();
    dropSpecks(solid, w, h, Math.round(sc * sc * (2 + o.cleanup * 6)));
    for (let p = 0; p < n; p++) if (before[p] && !solid[p]) ink[p] = 0;
    // El antialias alrededor de un puntito borrado también se va
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (ink[p] && ink[p] <= 96 && !solid[p - 1] && !solid[p + 1] && !solid[p - w] && !solid[p + w]) ink[p] = 0;
      }
    }
    return o.regions ? { w, h, ink, ...regions(img, ink) } : { w, h, ink };
  }

  // Zonas cerradas entre las líneas: color promedio original y el mejor lugar para su número
  function regions(img, ink) {
    const { w, h, rgba } = img, n = w * h;
    const map = new Int32Array(n).fill(-1), queue = new Int32Array(n);
    const wall = new Uint8Array(n);
    for (let p = 0; p < n; p++) wall[p] = ink[p] >= 128 ? 1 : 0;
    const list = [];
    for (let s = 0; s < n; s++) {
      if (wall[s] || map[s] >= 0) continue;
      const id = list.length;
      let head = 0, tail = 0, r = 0, g = 0, b = 0, edge = false;
      queue[tail++] = s; map[s] = id;
      while (head < tail) {
        const p = queue[head++], x = p % w;
        const i = p * 4, al = rgba[i + 3] / 255, wh = 255 * (1 - al);
        r += rgba[i] * al + wh; g += rgba[i + 1] * al + wh; b += rgba[i + 2] * al + wh;
        if (x === 0 || x === w - 1 || p < w || p >= n - w) edge = true;
        if (x > 0 && !wall[p - 1] && map[p - 1] < 0) { map[p - 1] = id; queue[tail++] = p - 1; }
        if (x < w - 1 && !wall[p + 1] && map[p + 1] < 0) { map[p + 1] = id; queue[tail++] = p + 1; }
        if (p >= w && !wall[p - w] && map[p - w] < 0) { map[p - w] = id; queue[tail++] = p - w; }
        if (p < n - w && !wall[p + w] && map[p + w] < 0) { map[p + w] = id; queue[tail++] = p + w; }
      }
      list.push({ id, area: tail, r: r / tail, g: g / tail, b: b / tail, edge, x: 0, y: 0, rad: -1 });
    }
    // Distancia a la línea o al borde de la imagen: el número va donde hay más espacio
    for (let x = 0; x < w; x++) { wall[x] = 1; wall[n - w + x] = 1; }
    for (let y = 0; y < h; y++) { wall[y * w] = 1; wall[y * w + w - 1] = 1; }
    const d2 = edt(wall, w, h);
    for (let p = 0; p < n; p++) {
      const id = map[p];
      if (id < 0) continue;
      const R = list[id], d = d2[p];
      if (d > R.rad) { R.rad = d; R.x = p % w; R.y = (p - R.x) / w; }
    }
    for (const R of list) R.rad = Math.sqrt(Math.max(0, R.rad));
    return { map, regions: list };
  }

  const api = { setImage, process };
  root.Trazo = api;

  // Como worker
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'image') { setImage(m.w, m.h, m.data); return; }
      if (m.type === 'run') {
        try {
          const res = process(m.opts);
          root.postMessage({ type: 'done', run: m.run, ...res }, res.map ? [res.ink.buffer, res.map.buffer] : [res.ink.buffer]);
        } catch (err) {
          root.postMessage({ type: 'error', run: m.run, message: String(err && err.message || err) });
        }
      }
    };
  }
})(typeof self !== 'undefined' ? self : this);
