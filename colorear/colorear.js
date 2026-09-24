// Dibujos para colorear: convierte una imagen a color en líneas (trazo.js), con números y guía de colores opcionales.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('preview'), ctx = canvas.getContext('2d'), stage = $('stage');
  const selfSrc = document.currentScript ? document.currentScript.src : location.href;

  // Colores de crayón con los que se nombran las zonas
  const PALETTE = [
    ['Rojo', '#e53935'], ['Naranja', '#fb8c00'], ['Amarillo', '#fdd835'], ['Verde claro', '#8bc34a'],
    ['Verde', '#2e7d32'], ['Celeste', '#4fc3f7'], ['Azul', '#1e63d6'], ['Morado', '#8e24aa'],
    ['Rosado', '#f48fb1'], ['Café claro', '#c8a27a'], ['Café', '#795548'], ['Piel', '#f6d2b5'],
    ['Gris', '#9e9e9e'], ['Negro', '#212121'], ['Blanco', '#ffffff'],
  ];
  const WHITE = PALETTE.length - 1;

  const state = {
    img: null,        // imagen original ya girada (canvas)
    rotation: 0,
    source: null,     // imagen cargada sin girar
    work: null,       // { w, h, data } a la resolución de trabajo
    res: null,        // resultado: { w, h, ink, map, regions }
    inkCanvas: null,  // tinta con el color de línea, a la resolución de trabajo
    fileName: 'dibujo',
    view: 'compare',
    split: 0.5,       // posición del divisor en "Comparar"
    overrides: [],    // [{ x, y, c }] c = índice de la paleta o -1 (sin número), por punto de la imagen
    names: {},        // nombres cambiados por el usuario, por índice de la paleta
    run: 0,
  };

  // ---------- Opciones ----------
  const num = (id, min, max, def) => { const v = parseFloat($(id).value); return isNaN(v) ? def : Math.min(max, Math.max(min, v)); };
  const radio = (name) => document.querySelector(`input[name=${name}]:checked`).value;
  function opts() {
    return {
      mode: radio('style'),
      detail: num('detail', 1, 10, 5),
      thickness: num('thick', 1, 10, 4),
      cleanup: num('clean', 0, 10, 5),
      smooth: num('smooth', 0, 10, 5),
      fillDark: $('fillDark').checked,
      regions: $('numOn').checked,
    };
  }
  const SAVE_IDS = ['detail', 'thick', 'clean', 'smooth', 'hq', 'fillDark', 'lineColor', 'numOn', 'skipWhite', 'numSize', 'legendOn', 'legendSwatch', 'paper', 'orient', 'margin', 'nameLine', 'guide', 'dpi'];
  function save() {
    const o = { style: radio('style'), legendStyle: radio('legendStyle'), view: state.view, names: state.names };
    for (const id of SAVE_IDS) o[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    try { localStorage.setItem('colorearOpts', JSON.stringify(o)); } catch {}
  }
  function restore() {
    let o;
    try { o = JSON.parse(localStorage.getItem('colorearOpts') || 'null'); } catch {}
    if (!o) return;
    for (const id of SAVE_IDS) {
      if (!(id in o)) continue;
      if ($(id).type === 'checkbox') $(id).checked = !!o[id];
      else { $(id).value = o[id]; $(id).dispatchEvent(new Event('change')); }
    }
    for (const n of ['style', 'legendStyle']) {
      const r = document.querySelector(`input[name=${n}][value="${o[n]}"]`);
      if (r) r.checked = true;
    }
    if (o.names) state.names = o.names;
    if (o.view) state.view = o.view;
  }

  // ---------- Procesado (en un worker si se puede) ----------
  let worker = null;
  try {
    worker = new Worker(new URL('trazo.js', selfSrc));
    worker.onmessage = (e) => onResult(e.data);
    worker.onerror = (e) => { e.preventDefault(); worker = null; if (state.work) { Trazo.setImage(state.work.w, state.work.h, state.work.data); process(); } };
  } catch { worker = null; }

  let timer = 0, pending = false;
  function process(delay = 0) {
    if (!state.work) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const run = ++state.run;
      $('busy').hidden = false;
      if (worker) worker.postMessage({ type: 'run', run, opts: opts() });
      else {
        // En la página: se deja pintar el aviso antes de bloquear
        pending = true;
        requestAnimationFrame(() => setTimeout(() => {
          if (!pending || run !== state.run) return;
          pending = false;
          try { onResult({ type: 'done', run, ...Trazo.process(opts()) }); } catch (err) { onResult({ type: 'error', run, message: err.message }); }
        }));
      }
    }, delay);
  }

  function onResult(m) {
    if (m.run !== state.run) return; // llegó uno más nuevo
    $('busy').hidden = true;
    if (m.type === 'error') { status('No se pudo convertir la imagen: ' + m.message); return; }
    state.res = m;
    // Se activaron los números mientras se procesaba: faltan las zonas
    if ($('numOn').checked && !m.regions) process();
    buildInk();
    buildLegend();
    render();
    status('');
  }

  function setWork() {
    const src = state.img, sw = src.width, sh = src.height;
    // Resolución de trabajo: 1000–1400 px en el lado largo (2000 con "Mejorar detalles");
    // las pequeñas se agrandan para suavizar las líneas
    const k = Math.min($('hq').checked ? 2000 : 1400, Math.max(1000, Math.max(sw, sh))) / Math.max(sw, sh);
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    const data = g.getImageData(0, 0, w, h).data;
    state.work = { w, h, data };
    state.res = null;
    state.overrides = [];
    if (worker) worker.postMessage({ type: 'image', w, h, data: data.slice() });
    else Trazo.setImage(w, h, data);
    process();
  }

  // Tinta con el color elegido (alfa = intensidad de la línea)
  function buildInk() {
    const { w, h, ink } = state.res;
    const c = state.inkCanvas && state.inkCanvas.width === w && state.inkCanvas.height === h ? state.inkCanvas : document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const im = g.createImageData(w, h), d = im.data;
    const [r, gg, b] = hex2rgb($('lineColor').value);
    for (let p = 0, i = 0; p < ink.length; p++, i += 4) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = ink[p]; }
    g.putImageData(im, 0, 0);
    state.inkCanvas = c;
  }

  // ---------- Colores y números ----------
  const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function rgb2lab(r, g, b) {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    r = lin(r); g = lin(g); b = lin(b);
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const PAL_LAB = PALETTE.map(([, hex]) => rgb2lab(...hex2rgb(hex)));
  function nearest(r, g, b) {
    const [L, A, B] = rgb2lab(r, g, b);
    let best = 0, bd = Infinity;
    PAL_LAB.forEach(([l, a, bb], i) => { const d = (L - l) ** 2 + (A - a) ** 2 + (B - bb) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  const colorName = (i) => (state.names[i] || PALETTE[i][0]);

  // Color de cada zona (automático o elegido) → índice de la paleta, o -1 si no lleva número
  function regionColors() {
    const res = state.res;
    if (!res || !res.regions) return null;
    const out = res.regions.map((R) => nearest(R.r, R.g, R.b));
    if ($('skipWhite').checked) out.forEach((c, i) => { if (c === WHITE) out[i] = -1; });
    for (const o of state.overrides) {
      const id = res.map[Math.round(o.y) * res.w + Math.round(o.x)];
      if (id >= 0) out[id] = o.c;
    }
    return out;
  }

  // Números: los colores usados, en el orden de la paleta
  let legend = []; // [{ c, n }]
  let colors = null;
  function buildLegend() {
    colors = regionColors();
    if (state.img) layout(); // actualiza la escala mm/px con la que se decide si cabe un número
    legend = [];
    if (!colors) { renderLegendList(); return; }
    const used = new Set();
    state.res.regions.forEach((R, i) => { if (colors[i] >= 0 && fits(R)) used.add(colors[i]); });
    legend = [...used].sort((a, b) => a - b).map((c, i) => ({ c, n: i + 1 }));
    renderLegendList();
  }
  const numberOf = (c) => (legend.find((e) => e.c === c) || {}).n;

  function renderLegendList() {
    const ol = $('legendList');
    ol.innerHTML = '';
    for (const e of legend) {
      const li = document.createElement('li');
      li.innerHTML = `<b></b><span class="legend-sw"></span><input type="text" spellcheck="false" aria-label="Nombre del color">`;
      li.querySelector('b').textContent = e.n;
      li.querySelector('.legend-sw').style.background = PALETTE[e.c][1];
      const inp = li.querySelector('input');
      inp.value = colorName(e.c);
      inp.addEventListener('input', () => {
        const v = inp.value.trim();
        if (v && v !== PALETTE[e.c][0]) state.names[e.c] = v; else delete state.names[e.c];
        save();
        render();
      });
      ol.appendChild(li);
    }
    if (!legend.length && $('numOn').checked && state.res && state.res.regions) {
      const li = document.createElement('li');
      li.className = 'legend-empty';
      li.textContent = 'Ninguna zona es lo bastante grande para un número.';
      ol.appendChild(li);
    }
  }

  // ---------- Diseño de la hoja (en mm) ----------
  function pageSize() {
    const [a, b] = $('paper').value.split('x').map(Number);
    let o = $('orient').value;
    if (o === 'auto') o = state.img && state.img.width > state.img.height * 1.1 ? 'landscape' : 'portrait';
    return o === 'landscape' ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
  }

  const NUM_MM = () => 2 + num('numSize', 1, 10, 4) * 0.55; // alto del número en mm
  // Un número cabe si la zona tiene espacio (se mide con la escala de la hoja actual)
  let mmPerPx = 0.15;
  const fits = (R) => R.rad * mmPerPx * 1.7 >= Math.min(NUM_MM(), 2.2);

  function layout() {
    const [W, H] = pageSize();
    const m = num('margin', 0, 40, 10);
    const x0 = m, cw = W - 2 * m;
    let top = m, bottom = H - m;
    const L = { W, H, name: null, legend: null, guide: null, img: null, items: [] };
    if ($('nameLine').checked) { L.name = { x: x0, y: top, w: cw, h: 9 }; top += 14; }

    const showLegend = $('numOn').checked && $('legendOn').checked && legend.length;
    const guide = $('guide').checked && state.img;
    if (showLegend || guide) {
      const gw = guide ? Math.min(cw * (showLegend ? 0.3 : 0.4), 60) : 0;
      const gh = guide ? Math.min(gw * state.img.height / state.img.width, 55) : 0;
      let lh = 0;
      if (showLegend) {
        const lw = cw - (guide ? gw + 6 : 0);
        const sentence = radio('legendStyle') === 'sentence';
        const cellW = sentence ? 62 : 34, cellH = 7.5;
        const cols = Math.max(1, Math.floor(lw / cellW));
        const rows = Math.ceil(legend.length / cols);
        lh = 7 + rows * cellH;
        L.legend = { x: x0, y: 0, w: lw, h: lh, cols, cellW: lw / cols, cellH, sentence };
      }
      const bh = Math.max(lh, gh);
      bottom -= bh;
      if (L.legend) L.legend.y = bottom;
      if (guide) {
        const gwFit = gh < gw * state.img.height / state.img.width ? gh * state.img.width / state.img.height : gw;
        L.guide = { x: x0 + cw - gwFit, y: bottom + (bh - gh), w: gwFit, h: gh };
      }
      bottom -= 5;
    }
    // Dibujo: lo más grande posible sin deformar
    const aw = cw, ah = Math.max(10, bottom - top);
    const ar = state.img ? state.img.width / state.img.height : 1;
    let w = aw, h = aw / ar;
    if (h > ah) { h = ah; w = ah * ar; }
    L.img = { x: x0 + (aw - w) / 2, y: top + (ah - h) / 2, w, h };
    if (state.res) mmPerPx = w / state.res.w;
    return L;
  }

  // Dibuja la hoja completa; g ya está escalado a mm (1 unidad = 1 mm)
  function drawPage(g, L, { ink, original = false, clipX = null } = {}) {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, L.W, L.H);
    const I = L.img;
    if (L.name) {
      const N = L.name;
      g.fillStyle = '#1b1f3b';
      g.font = `600 ${4.2}px system-ui, "Segoe UI", Roboto, sans-serif`;
      g.textBaseline = 'alphabetic';
      g.fillText('Nombre:', N.x, N.y + N.h - 1.5);
      const tx = N.x + g.measureText('Nombre: ').width + 1;
      g.strokeStyle = '#1b1f3b';
      g.lineWidth = 0.3;
      g.beginPath(); g.moveTo(tx, N.y + N.h - 1); g.lineTo(N.x + N.w, N.y + N.h - 1); g.stroke();
    }
    if (original || clipX !== null) g.drawImage(state.img, I.x, I.y, I.w, I.h);
    if (!original && ink) {
      g.save();
      if (clipX !== null) {
        // Del divisor a la derecha: blanco + dibujo
        g.beginPath(); g.rect(clipX, I.y - 1, I.x + I.w - clipX + 1, I.h + 2); g.clip();
        g.fillStyle = '#fff'; g.fillRect(I.x, I.y, I.w, I.h);
      }
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(ink, I.x, I.y, I.w, I.h);
      drawNumbers(g, L);
      g.restore();
    }
    if (L.legend) drawLegend(g, L.legend);
    if (L.guide) {
      const G = L.guide;
      g.drawImage(state.img, G.x, G.y, G.w, G.h);
      g.strokeStyle = '#cdd2e1'; g.lineWidth = 0.3; g.strokeRect(G.x, G.y, G.w, G.h);
    }
  }

  function drawNumbers(g, L) {
    if (!$('numOn').checked || !colors) return;
    const I = L.img, k = I.w / state.res.w, base = NUM_MM();
    g.fillStyle = '#4a4f6a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    state.res.regions.forEach((R, i) => {
      const c = colors[i];
      if (c < 0 || !fits(R)) return;
      const n = numberOf(c);
      if (!n) return;
      const size = Math.min(base, R.rad * k * 1.7);
      g.font = `600 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
      g.fillText(String(n), I.x + (R.x + 0.5) * k, I.y + (R.y + 0.5) * k + size * 0.04);
    });
    g.textAlign = 'left';
  }

  function drawLegend(g, E) {
    g.fillStyle = '#1b1f3b';
    g.textBaseline = 'middle';
    g.font = `700 ${4}px system-ui, "Segoe UI", Roboto, sans-serif`;
    g.fillText(E.sentence ? 'Colorea así:' : 'Guía de colores', E.x, E.y + 2.5);
    const sw = $('legendSwatch').checked;
    legend.forEach((e, i) => {
      const cx = E.x + (i % E.cols) * E.cellW, cy = E.y + 7 + Math.floor(i / E.cols) * E.cellH + E.cellH / 2;
      // Número en un círculo
      g.strokeStyle = '#1b1f3b'; g.lineWidth = 0.3;
      g.beginPath(); g.arc(cx + 2.8, cy, 2.6, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#1b1f3b';
      g.textAlign = 'center';
      g.font = `700 ${3.2}px system-ui, "Segoe UI", Roboto, sans-serif`;
      g.fillText(String(e.n), cx + 2.8, cy + 0.1);
      g.textAlign = 'left';
      let tx = cx + 7;
      if (sw) {
        g.fillStyle = PALETTE[e.c][1];
        g.fillRect(tx, cy - 2.2, 4.4, 4.4);
        g.strokeRect(tx, cy - 2.2, 4.4, 4.4);
        tx += 6.2;
      }
      g.fillStyle = '#1b1f3b';
      g.font = `500 ${3.4}px system-ui, "Segoe UI", Roboto, sans-serif`;
      const name = colorName(e.c);
      const text = E.sentence ? `El ${e.n} se pinta de ${name.toLowerCase()}` : name;
      g.fillText(fitText(g, text, E.cellW - (tx - cx) - 1.5), tx, cy + 0.1);
    });
  }
  function fitText(g, t, max) {
    if (g.measureText(t).width <= max) return t;
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  // ---------- Vista previa ----------
  let lastLayout = null, pageRects = []; // dónde quedó cada hoja en pantalla: [{ x, y, s, kind }]
  function render() {
    const dpr = window.devicePixelRatio || 1;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    pageRects = [];
    const has = !!state.img;
    $('empty').hidden = has;
    $('viewSeg').hidden = !has;
    ['openPdf', 'downloadPdf', 'downloadPng'].forEach((id) => { $(id).disabled = !state.res; });
    if (!has) return;

    const L = (lastLayout = layout());
    const padTop = 70, pad = 24;
    const areaW = cw - pad * 2, areaH = ch - padTop - pad;
    const side = state.view === 'side';
    if (side) {
      // Antes (solo la imagen) | Después (la hoja)
      const gap = 24, halfW = (areaW - gap) / 2;
      const ar = state.img.width / state.img.height;
      let iw = halfW, ih = iw / ar;
      if (ih > areaH - 22) { ih = areaH - 22; iw = ih * ar; }
      const ix = pad + (halfW - iw) / 2, iy = padTop + 22 + (areaH - 22 - ih) / 2;
      shadowBox(ix, iy, iw, ih);
      ctx.drawImage(state.img, ix, iy, iw, ih);
      label('Antes', ix + iw / 2, iy - 10);
      const s = Math.min(halfW / L.W, (areaH - 22) / L.H);
      const px = pad + halfW + gap + (halfW - L.W * s) / 2, py = padTop + 22 + (areaH - 22 - L.H * s) / 2;
      drawSheet(L, px, py, s, {});
      label('Después', px + L.W * s / 2, py - 10);
      return;
    }
    const s = Math.min(areaW / L.W, areaH / L.H);
    const px = pad + (areaW - L.W * s) / 2, py = padTop + (areaH - L.H * s) / 2;
    if (state.view === 'before' || !state.res) drawSheet(L, px, py, s, { original: true });
    else if (state.view === 'after') drawSheet(L, px, py, s, {});
    else {
      const clipX = L.img.x + L.img.w * state.split;
      drawSheet(L, px, py, s, { clipX });
      // Divisor
      const X = px + clipX * s, y0 = py + L.img.y * s, y1 = y0 + L.img.h * s;
      ctx.strokeStyle = '#4f46e5'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X, y0); ctx.lineTo(X, y1); ctx.stroke();
      const ym = (y0 + y1) / 2;
      ctx.fillStyle = '#4f46e5';
      ctx.beginPath(); ctx.arc(X, ym, 14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X - 4, ym - 5); ctx.lineTo(X - 8, ym); ctx.lineTo(X - 4, ym + 5);
      ctx.moveTo(X + 4, ym - 5); ctx.lineTo(X + 8, ym); ctx.lineTo(X + 4, ym + 5); ctx.stroke();
      tag('Antes', px + L.img.x * s + 8, y0 + 8, 'left');
      tag('Después', px + (L.img.x + L.img.w) * s - 8, y0 + 8, 'right');
    }
  }
  function shadowBox(x, y, w, h) {
    ctx.save();
    ctx.shadowColor = 'rgba(27,31,59,.16)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  function drawSheet(L, x, y, s, o) {
    shadowBox(x, y, L.W * s, L.H * s);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath(); ctx.rect(0, 0, L.W, L.H); ctx.clip();
    drawPage(ctx, L, { ink: state.inkCanvas, ...o });
    ctx.restore();
    pageRects.push({ x, y, s });
  }
  function label(t, x, y) {
    ctx.fillStyle = '#6b7090'; ctx.font = '600 13px system-ui, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y); ctx.textAlign = 'left';
  }
  function tag(t, x, y, align) {
    ctx.font = '600 12px system-ui, "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(t).width + 14;
    const bx = align === 'left' ? x : x - w;
    ctx.fillStyle = 'rgba(27,31,59,.72)';
    ctx.beginPath(); ctx.roundRect(bx, y, w, 22, 11); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(t, bx + 7, y + 11.5);
  }

  new ResizeObserver(() => render()).observe(stage);

  // Pantalla → punto del dibujo en px de trabajo
  function toWork(e) {
    const P = pageRects[pageRects.length - 1], L = lastLayout;
    if (!P || !L || !state.res) return null;
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left - P.x) / P.s, my = (e.clientY - r.top - P.y) / P.s;
    const I = L.img;
    const u = (mx - I.x) / I.w, v = (my - I.y) / I.h;
    return { mx, u, v, x: u * state.res.w, y: v * state.res.h, inside: u >= 0 && u <= 1 && v >= 0 && v <= 1 };
  }

  // Arrastrar el divisor / tocar una zona
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    const p = toWork(e);
    if (!p) return;
    if (state.view === 'compare') {
      const L = lastLayout, P = pageRects[0];
      const X = P.x + (L.img.x + L.img.w * state.split) * P.s;
      const r = canvas.getBoundingClientRect();
      if (Math.abs(e.clientX - r.left - X) < 18 || !$('numOn').checked) {
        dragging = true;
        canvas.setPointerCapture(e.pointerId);
        moveSplit(p);
        return;
      }
    }
    if (p.inside && $('numOn').checked && state.view !== 'before' && (state.view !== 'compare' || p.u >= state.split)) openRegion(e, p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) { moveSplit(toWork(e)); return; }
    const p = toWork(e);
    let cur = '';
    if (p && p.inside) {
      if (state.view === 'compare') {
        const L = lastLayout, P = pageRects[0], r = canvas.getBoundingClientRect();
        const X = P.x + (L.img.x + L.img.w * state.split) * P.s;
        cur = Math.abs(e.clientX - r.left - X) < 18 || !$('numOn').checked ? 'ew-resize' : p.u >= state.split ? 'pointer' : '';
      } else if ($('numOn').checked && state.view !== 'before') cur = 'pointer';
    }
    canvas.style.cursor = cur;
  });
  canvas.addEventListener('pointerup', () => { if (dragging) { dragging = false; save(); } });
  function moveSplit(p) {
    if (!p) return;
    state.split = Math.min(1, Math.max(0, p.u));
    render();
  }

  // ---------- Cambiar el color de una zona ----------
  const pop = $('regionPop');
  let popPoint = null;
  $('regionSwatches').innerHTML = PALETTE.map(([n, c], i) =>
    `<button type="button" data-c="${i}" style="--c:${c}" title="${n}"><span></span><small>${n}</small></button>`).join('');
  function openRegion(e, p) {
    if (!state.res.map) return;
    const id = state.res.map[Math.floor(p.y) * state.res.w + Math.floor(p.x)];
    if (id == null || id < 0) { pop.hidden = true; return; }
    popPoint = { x: Math.floor(p.x), y: Math.floor(p.y), id };
    const cur = colors ? colors[id] : -1;
    pop.querySelectorAll('[data-c]').forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i === cur));
      b.querySelector('small').textContent = colorName(i);
    });
    pop.hidden = false;
    const r = stage.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(e.clientX - r.left + 12, r.width - w - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(e.clientY - r.top + 12, r.height - h - 8)) + 'px';
  }
  function setRegion(c) {
    if (!popPoint) return;
    const res = state.res;
    // Reemplaza lo elegido antes para la misma zona
    state.overrides = state.overrides.filter((o) => res.map[o.y * res.w + o.x] !== popPoint.id);
    if (c !== null) state.overrides.push({ x: popPoint.x, y: popPoint.y, c });
    pop.hidden = true;
    buildLegend();
    render();
  }
  $('regionSwatches').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) setRegion(+b.dataset.c); });
  $('regionNone').onclick = () => setRegion(-1);
  $('regionAuto').onclick = () => setRegion(null);
  $('regionClose').onclick = () => { pop.hidden = true; };
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== canvas) pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });

  // ---------- Vistas ----------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('#viewSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    pop.hidden = true;
    render();
  }
  document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => { setView(b.dataset.view); save(); }));

  // ---------- Carga de la imagen ----------
  const status = (t) => { $('status').textContent = t; };
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('formato no soportado')); };
      img.src = url;
    });
  }
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(src, selfSrc).href;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('no se pudo cargar ' + src)); };
      document.head.appendChild(s);
    }));
  }
  // HEIC y TIFF se convierten en el navegador (igual que en el póster)
  async function convertInBrowser(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ascii = String.fromCharCode(...head);
    const isTiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 42);
    if (/ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(ascii) || /\.(heic|heif)$/i.test(file.name)) {
      await loadScript('../vendor/heic2any.min.js');
      const out = await heic2any({ blob: file, toType: 'image/png' });
      return Array.isArray(out) ? out[0] : out;
    }
    if (isTiff) {
      await loadScript('../vendor/pako_inflate.min.js');
      await loadScript('../vendor/UTIF.js');
      const buf = await file.arrayBuffer(), ifds = UTIF.decode(buf);
      let best = null;
      for (const ifd of ifds) { UTIF.decodeImage(buf, ifd); if (ifd.width && (!best || ifd.width * ifd.height > best.width * best.height)) best = ifd; }
      if (!best) throw new Error('TIFF sin imágenes');
      const c = document.createElement('canvas');
      c.width = best.width; c.height = best.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(best).buffer, 0, best.width * best.height * 4), best.width, best.height), 0, 0);
      return await new Promise((res) => c.toBlob(res, 'image/png'));
    }
    throw new Error('formato no soportado por el navegador');
  }

  async function loadFile(file) {
    if (!file) return;
    status('Cargando imagen…');
    $('dropText').textContent = file.name || 'Imagen pegada';
    $('drop').classList.add('has-file');
    let img;
    try { img = await loadImage(file); } catch {
      try { status('Convirtiendo formato…'); img = await loadImage(await convertInBrowser(file)); } catch (err) { status('No se pudo abrir la imagen: ' + err.message); return; }
    }
    state.fileName = ((file.name || '').replace(/\.[^.]+$/, '') || 'dibujo') + '-para-colorear';
    state.source = img;
    state.rotation = 0;
    buildOriented();
    status('');
  }

  function buildOriented() {
    const img = state.source;
    const w = img.naturalWidth || img.width || 1000, h = img.naturalHeight || img.height || 1000;
    const rot = state.rotation % 180 !== 0;
    const c = document.createElement('canvas');
    // Las imágenes muy grandes se reducen: con 2400 px sobra para la guía y la comparación
    const k = Math.min(1, 2400 / Math.max(w, h));
    c.width = Math.round((rot ? h : w) * k); c.height = Math.round((rot ? w : h) * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // transparencia → blanco
    g.translate(c.width / 2, c.height / 2);
    g.rotate((state.rotation * Math.PI) / 180);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (-w * k) / 2, (-h * k) / 2, w * k, h * k);
    state.img = c;
    $('imgInfo').textContent = `${w} × ${h} px`;
    setWork();
    render();
  }

  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item && !e.target.closest('input, textarea')) { e.preventDefault(); loadFile(item.getAsFile()); }
  });
  $('rotL').onclick = () => { if (state.source) { state.rotation = (state.rotation + 270) % 360; buildOriented(); } };
  $('rotR').onclick = () => { if (state.source) { state.rotation = (state.rotation + 90) % 360; buildOriented(); } };

  // ---------- Controles ----------
  const outs = { detail: 'detailOut', thick: 'thickOut', clean: 'cleanOut', smooth: 'smoothOut', numSize: 'numSizeOut' };
  const showOuts = () => Object.entries(outs).forEach(([id, o]) => { $(o).textContent = $(id).value; });
  // Cambian el dibujo (hay que volver a procesar)
  ['detail', 'clean', 'smooth'].forEach((id) => $(id).addEventListener('input', () => { showOuts(); save(); process(250); }));
  $('thick').addEventListener('input', () => { showOuts(); save(); process(120); });
  document.querySelectorAll('input[name=style]').forEach((r) => r.addEventListener('change', () => { save(); process(); }));
  $('fillDark').addEventListener('change', () => { save(); process(); });
  $('hq').addEventListener('change', () => { save(); if (state.img) setWork(); });
  $('numOn').addEventListener('change', () => {
    $('numBox').hidden = !$('numOn').checked;
    save();
    // Las zonas solo se calculan si hacen falta
    if ($('numOn').checked && state.res && !state.res.regions) process(); else { buildLegend(); render(); }
  });
  // Solo cambian cómo se ve
  $('lineColor').addEventListener('input', () => { if (state.res) { buildInk(); render(); } save(); });
  ['skipWhite'].forEach((id) => $(id).addEventListener('change', () => { buildLegend(); render(); save(); }));
  $('numSize').addEventListener('input', () => { showOuts(); buildLegend(); render(); save(); });
  ['legendOn', 'legendSwatch', 'nameLine', 'guide'].forEach((id) => $(id).addEventListener('change', () => {
    $('legendStyleField').hidden = !$('legendOn').checked;
    render(); save();
  }));
  document.querySelectorAll('input[name=legendStyle]').forEach((r) => r.addEventListener('change', () => { render(); save(); }));
  ['paper', 'orient', 'dpi'].forEach((id) => $(id).addEventListener('change', () => { buildLegend(); render(); save(); }));
  $('margin').addEventListener('input', () => { buildLegend(); render(); save(); });

  // ---------- Minimizar panel ----------
  function setCollapsed(on) {
    document.body.classList.toggle('collapsed', on);
    $('togglePanel').setAttribute('aria-expanded', String(!on));
    $('togglePanel').title = on ? 'Mostrar configuración' : 'Ocultar configuración';
    try { localStorage.setItem('colorearPanelCollapsed', on ? '1' : '0'); } catch {}
    setTimeout(render, 260);
  }
  $('togglePanel').onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));
  try { if (localStorage.getItem('colorearPanelCollapsed') === '1') setCollapsed(true); } catch {}

  // ---------- Exportar ----------
  // Tinta agrandada a la resolución de impresión con bordes nítidos (sin escalones)
  function inkAt(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(state.inkCanvas, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), d = im.data;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i] / 255;
      d[i] = Math.max(0, Math.min(1, (a - 0.5) * 2.2 + 0.5)) * 255;
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  function renderSheet() {
    const L = layout();
    const k = num('dpi', 72, 600, 300) / 25.4;
    const c = document.createElement('canvas');
    c.width = Math.round(L.W * k); c.height = Math.round(L.H * k);
    const g = c.getContext('2d');
    g.scale(k, k);
    const ink = inkAt(Math.max(1, Math.round(L.img.w * k)), Math.max(1, Math.round(L.img.h * k)));
    drawPage(g, L, { ink });
    return { c, L };
  }

  const tick = () => new Promise((r) => setTimeout(r, 30));
  async function buildPdf() {
    status('Generando PDF…');
    await tick();
    const { c, L } = renderSheet();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: L.W > L.H ? 'landscape' : 'portrait', unit: 'mm', format: [L.W, L.H], compress: true });
    pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, L.W, L.H, undefined, 'FAST');
    status('');
    return pdf;
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  $('openPdf').onclick = async () => {
    if (!state.res) return;
    const win = window.open('', '_blank');
    if (win) win.document.write('<p style="font-family:sans-serif;padding:20px">Generando PDF…</p>');
    try {
      const pdf = await buildPdf();
      if (win) win.location.href = URL.createObjectURL(pdf.output('blob'));
      else pdf.save(state.fileName + '.pdf');
    } catch (err) { if (win) win.close(); status('Error al generar el PDF: ' + err.message); }
  };
  $('downloadPdf').onclick = async () => {
    if (!state.res) return;
    const b = $('downloadPdf');
    b.classList.add('loading');
    try { (await buildPdf()).save(state.fileName + '.pdf'); } catch (err) { status('Error al generar el PDF: ' + err.message); }
    b.classList.remove('loading');
  };
  $('downloadPng').onclick = async () => {
    if (!state.res) return;
    status('Generando imagen…');
    await tick();
    const { c } = renderSheet();
    c.toBlob((blob) => { saveBlob(blob, state.fileName + '.png'); status(''); }, 'image/png');
  };

  // ---------- Inicio ----------
  restore();
  showOuts();
  $('numBox').hidden = !$('numOn').checked;
  $('legendStyleField').hidden = !$('legendOn').checked;
  setView(state.view);
})();
