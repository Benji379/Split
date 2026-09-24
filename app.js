(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  const state = {
    // Capas de abajo hacia arriba; cada una: { id, name, img, src, natW, natH, rotation, flipH, flipV, mode, rect, thumb }
    layers: [],
    selId: null,      // capa seleccionada
    noLayerMode: 'contain',
    customPaper: null,   // {w, h} en mm cuando se elige "Personalizado"
    prevPaper: '210x297', // último tamaño aplicado, para volver si se cancela
    fileName: 'poster',
    view: { s: 1, ox: 0, oy: 0 },
    drag: null,
  };

  // state.img, state.rect, state.mode… leen y escriben la capa seleccionada
  // (rect = posición de la imagen en mm dentro del póster {x, y, w, h})
  const selLayer = () => state.layers.find((l) => l.id === state.selId) || null;
  const LAYER_DEFAULTS = { img: null, src: null, natW: 0, natH: 0, rotation: 0, flipH: false, flipV: false, rect: null };
  for (const k of [...Object.keys(LAYER_DEFAULTS), 'mode']) {
    Object.defineProperty(state, k, {
      get() { const l = selLayer(); return l ? l[k] : k === 'mode' ? state.noLayerMode : LAYER_DEFAULTS[k]; },
      set(v) { const l = selLayer(); if (l) l[k] = v; else if (k === 'mode') state.noLayerMode = v; },
    });
  }
  let nextLayerId = 1;

  const HANDLE_PX = 9;
  const RULER = 32; // grosor de las reglas en px

  // ---------- Layout de hojas ----------
  function layout() {
    const [a, b] = paperDims();
    const landscape = $('orient').value === 'landscape';
    const pageW = landscape ? Math.max(a, b) : Math.min(a, b);
    const pageH = landscape ? Math.min(a, b) : Math.max(a, b);
    const cols = clampInt($('cols').value, 1, 20);
    const rows = clampInt($('rows').value, 1, 20);
    const margin = clampNum($('margin').value, 0, Math.min(pageW, pageH) / 3);
    const printW = pageW - 2 * margin;
    const printH = pageH - 2 * margin;
    // Pestaña de pegado: la hoja siguiente se pega encima de esta franja
    const overlap = clampNum($('glue').value, 0, 5) * 10;
    const stepX = printW - overlap;
    const stepY = printH - overlap;
    return {
      pageW, pageH, cols, rows, margin, printW, printH, overlap, stepX, stepY,
      posterW: stepX * (cols - 1) + printW,
      posterH: stepY * (rows - 1) + printH,
    };
  }

  function paperDims() {
    const v = $('paper').value;
    if (v !== 'custom') return v.split('x').map(Number);
    if (state.customPaper) return [state.customPaper.w, state.customPaper.h];
    return state.prevPaper.split('x').map(Number); // mientras se decide en el diálogo
  }

  function clampInt(v, min, max) { v = parseInt(v, 10); return isNaN(v) ? min : Math.min(max, Math.max(min, v)); }
  function clampNum(v, min, max) { v = parseFloat(v); return isNaN(v) ? min : Math.min(max, Math.max(min, v)); }

  function fitRect(mode, L, layer = selLayer()) {
    const { posterW: W, posterH: H } = L;
    if (mode === 'stretch') return { x: 0, y: 0, w: W, h: H };
    const ar = layer.natW / layer.natH;
    let w, h;
    const containWide = W / H < ar;
    if ((mode === 'contain') === containWide) { w = W; h = W / ar; } else { h = H; w = H * ar; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function applyMode() {
    const L = layout();
    for (const l of state.layers) {
      if (l.mode !== 'free' || !l.rect) l.rect = fitRect(l.mode === 'free' ? 'contain' : l.mode, L, l);
      else l.rect = boundRect(l.rect);
    }
    render();
  }

  // ---------- Vista previa ----------
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const r = stage.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function render() {
    const L = layout();
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    ctx.clearRect(0, 0, cw, ch);
    updateInfo(L);

    // Escala: el póster (con márgenes de hoja) cabe en el área con padding
    const pad = 30;
    const totalW = L.posterW + 2 * L.margin, totalH = L.posterH + 2 * L.margin;
    const s = Math.min((cw - RULER - 2 * pad) / totalW, (ch - RULER - 2 * pad) / totalH);
    const ox = RULER + (cw - RULER - L.posterW * s) / 2, oy = RULER + (ch - RULER - L.posterH * s) / 2;
    state.view = { s, ox, oy };
    const X = (mm) => ox + mm * s, Y = (mm) => oy + mm * s;

    // Póster armado: un solo papel; el margen blanco solo existe en el contorno exterior
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.18)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(X(-L.margin), Y(-L.margin), (L.posterW + 2 * L.margin) * s, (L.posterH + 2 * L.margin) * s);
    ctx.restore();
    // Margen pintado (solo en pantalla; en el papel queda en blanco)
    if ($('showMargin').checked && L.margin > 0) {
      ctx.fillStyle = 'rgba(79,70,229,.1)';
      ctx.beginPath();
      ctx.rect(X(-L.margin), Y(-L.margin), (L.posterW + 2 * L.margin) * s, (L.posterH + 2 * L.margin) * s);
      ctx.rect(X(0), Y(0), L.posterW * s, L.posterH * s);
      ctx.fill('evenodd');
    }

    const drawn = state.layers.filter((l) => l.src && l.rect && l.id !== editing);
    if (drawn.length) {
      // Parte fuera del póster, tenue
      ctx.globalAlpha = 0.25;
      for (const l of drawn) ctx.drawImage(l.src, X(l.rect.x), Y(l.rect.y), l.rect.w * s, l.rect.h * s);
      ctx.globalAlpha = 1;
      // Parte imprimible, de abajo hacia arriba
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(0), Y(0), L.posterW * s, L.posterH * s);
      ctx.clip();
      for (const l of drawn) ctx.drawImage(l.src, X(l.rect.x), Y(l.rect.y), l.rect.w * s, l.rect.h * s);
      ctx.restore();
    }

    // Franjas de pegado: solo en las uniones entre hojas, nunca en el contorno exterior
    if (L.overlap > 0) {
      ctx.fillStyle = 'rgba(120,120,120,.3)';
      for (let c = 0; c < L.cols - 1; c++) ctx.fillRect(X((c + 1) * L.stepX), Y(0), L.overlap * s, L.posterH * s);
      for (let r = 0; r < L.rows - 1; r++) ctx.fillRect(X(0), Y((r + 1) * L.stepY), L.posterW * s, L.overlap * s);
    }

    // Uniones (donde se recorta y se pega cada hoja) y numeración
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(31,111,235,.9)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    for (let c = 1; c < L.cols; c++) { ctx.moveTo(X(c * L.stepX) + .5, Y(0)); ctx.lineTo(X(c * L.stepX) + .5, Y(L.posterH)); }
    for (let r = 1; r < L.rows; r++) { ctx.moveTo(X(0), Y(r * L.stepY) + .5); ctx.lineTo(X(L.posterW), Y(r * L.stepY) + .5); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeRect(X(0) + .5, Y(0) + .5, L.posterW * s, L.posterH * s);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(31,111,235,.9)';
    ctx.font = '600 12px system-ui, sans-serif';
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      ctx.fillText(String(r * L.cols + c + 1), X(c * L.stepX) + 6, Y(r * L.stepY) + 16);
    }

    // Con varias capas se marca cuál está seleccionada
    if (state.rect && state.mode !== 'free' && state.layers.length > 1) {
      const R = state.rect;
      ctx.strokeStyle = '#1f6feb';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(X(R.x), Y(R.y), R.w * s, R.h * s);
      ctx.setLineDash([]);
    }

    // Tiradores para modo libre
    if (state.src && state.rect && state.mode === 'free') {
      const R = state.rect;
      ctx.strokeStyle = '#1f6feb';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(X(R.x), Y(R.y), R.w * s, R.h * s);
      ctx.fillStyle = '#fff';
      for (const [hx, hy] of corners(R)) {
        ctx.beginPath();
        ctx.rect(X(hx) - HANDLE_PX / 2, Y(hy) - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
        ctx.fill();
        ctx.stroke();
      }
    }

    drawRulers(L, cw, ch);
    $('empty').style.display = state.src ? 'none' : 'flex';
  }

  // Parte de la imagen que realmente queda impresa en el póster armado (mm)
  function printedRect(L) {
    const R = state.rect;
    if (!R) return null;
    const x0 = Math.max(0, R.x), y0 = Math.max(0, R.y);
    const x1 = Math.min(L.posterW, R.x + R.w), y1 = Math.min(L.posterH, R.y + R.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ---------- Reglas en cm (0 = esquina del póster ya armado) ----------
  function drawRulers(L, cw, ch) {
    const { s, ox, oy } = state.view;
    const pxPerCm = s * 10;
    const steps = [1, 2, 5, 10, 20, 50, 100];
    const major = steps.find((v) => v * pxPerCm >= 45) || 100;
    const div = major * pxPerCm / 10 >= 5 ? 10 : 5; // marcas pequeñas por cada marca grande
    const minor = major / div;
    const P = printedRect(L);

    ctx.save();
    ctx.fillStyle = '#f6f8fa';
    ctx.fillRect(0, 0, cw, RULER);
    ctx.fillRect(0, 0, RULER, ch);

    // Extensión del póster (gris) y de la imagen impresa (azul)
    ctx.fillStyle = 'rgba(0,0,0,.07)';
    ctx.fillRect(ox, 0, L.posterW * s, RULER);
    ctx.fillRect(0, oy, RULER, L.posterH * s);
    if (P) {
      ctx.fillStyle = 'rgba(31,111,235,.22)';
      ctx.fillRect(ox + P.x * s, 0, P.w * s, RULER);
      ctx.fillRect(0, oy + P.y * s, RULER, P.h * s);
    }

    ctx.strokeStyle = '#6e7781';
    ctx.fillStyle = '#57606a';
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.beginPath();
    // Horizontal
    for (let i = Math.ceil((RULER - ox) / pxPerCm / minor); ox + i * minor * pxPerCm <= cw; i++) {
      const cm = i * minor, x = Math.round(ox + cm * pxPerCm) + .5;
      const isMajor = i % div === 0;
      ctx.moveTo(x, RULER);
      ctx.lineTo(x, RULER - (isMajor ? 10 : 5));
      if (isMajor) ctx.fillText(String(Math.round(cm)), x + 2, 3);
    }
    // Vertical
    for (let i = Math.ceil((RULER - oy) / pxPerCm / minor); oy + i * minor * pxPerCm <= ch; i++) {
      const cm = i * minor, y = Math.round(oy + cm * pxPerCm) + .5;
      const isMajor = i % div === 0;
      ctx.moveTo(RULER, y);
      ctx.lineTo(RULER - (isMajor ? 10 : 5), y);
      if (isMajor) ctx.fillText(String(Math.round(cm)), 2, y + 2); // números horizontales
    }
    ctx.stroke();

    // Medida total de la imagen impresa, en tiempo real
    if (P) {
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      // Etiquetas siempre horizontales; en la regla vertical va en dos líneas (valor / cm)
      const tag = (lines, x, y) => {
        const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 8;
        const h = lines.length * 13 + 4;
        ctx.save();
        ctx.fillStyle = '#4f46e5';
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        lines.forEach((t, i) => ctx.fillText(t, x, y - h / 2 + 9 + i * 13));
        ctx.restore();
      };
      tag([`${(P.w / 10).toFixed(1)} cm`], ox + (P.x + P.w / 2) * s, RULER / 2);
      ctx.font = '600 10px system-ui, sans-serif';
      tag([(P.h / 10).toFixed(1), 'cm'], RULER / 2, oy + (P.y + P.h / 2) * s);
    }

    // Posición del mouse
    if (state.mouse) {
      ctx.strokeStyle = '#cf222e';
      ctx.beginPath();
      ctx.moveTo(state.mouse.x + .5, 0); ctx.lineTo(state.mouse.x + .5, RULER);
      ctx.moveTo(0, state.mouse.y + .5); ctx.lineTo(RULER, state.mouse.y + .5);
      ctx.stroke();
    }

    ctx.fillStyle = '#eaeef2';
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.fillStyle = '#57606a';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('cm', RULER / 2, RULER / 2);
    ctx.strokeStyle = '#d0d7de';
    ctx.beginPath();
    ctx.moveTo(0, RULER + .5); ctx.lineTo(cw, RULER + .5);
    ctx.moveTo(RULER + .5, 0); ctx.lineTo(RULER + .5, ch);
    ctx.stroke();
    ctx.restore();
  }

  function corners(R) {
    return [[R.x, R.y], [R.x + R.w, R.y], [R.x + R.w, R.y + R.h], [R.x, R.y + R.h]];
  }

  function updateInfo(L) {
    const cm = (mm) => (mm / 10).toFixed(1);
    $('posterInfo').textContent =
      `${L.cols * L.rows} hojas · póster de ${cm(L.posterW)} × ${cm(L.posterH)} cm`;
    if (state.rect) {
      const dpi = Math.round(state.natW / (state.rect.w / 25.4));
      const P = printedRect(L) || { w: 0, h: 0 };
      $('imgSize').textContent =
        `Imagen impresa y armada: ${cm(P.w)} × ${cm(P.h)} cm · ~${dpi} dpi` +
        (dpi < 100 ? ' (puede verse pixelada)' : '');
    } else {
      $('imgSize').textContent = '';
    }
  }

  // ---------- Interacción con el mouse ----------
  function toMM(e) {
    const b = canvas.getBoundingClientRect();
    const { s, ox, oy } = state.view;
    return { x: (e.clientX - b.left - ox) / s, y: (e.clientY - b.top - oy) / s };
  }

  function hitHandle(p) {
    const tol = (HANDLE_PX + 4) / state.view.s;
    const cs = corners(state.rect);
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p.x - cs[i][0]) <= tol && Math.abs(p.y - cs[i][1]) <= tol) return i;
    }
    return -1;
  }

  function inRect(p, R) { return p.x >= R.x && p.x <= R.x + R.w && p.y >= R.y && p.y <= R.y + R.h; }

  // Capa visible más arriba bajo el punto
  function layerAt(p) {
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const l = state.layers[i];
      if (l.rect && inRect(p, l.rect)) return l;
    }
    return null;
  }

  function setMode(mode) {
    state.mode = mode; // de la capa seleccionada
    document.querySelector(`input[name=mode][value=${mode}]`).checked = true;
    $('freeOpts').classList.toggle('on', mode === 'free');
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (editing) finishInlineEdit();
    const p = toMM(e);
    const h = state.rect && state.mode === 'free' ? hitHandle(p) : -1;
    if (h < 0) {
      const l = layerAt(p);
      if (!l) { closeTextPop(); return; } // clic en una zona vacía
      if (l.id !== state.selId) selectLayer(l.id);
      if (l.kind !== 'text') closeTextPop();
    }
    if (state.mode !== 'free') setMode('free');
    canvas.setPointerCapture(e.pointerId);
    state.drag = { type: h >= 0 ? 'resize' : 'move', corner: h, start: p, rect: { ...state.rect }, sx: e.clientX, sy: e.clientY };
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toMM(e);
    const b = canvas.getBoundingClientRect();
    state.mouse = { x: e.clientX - b.left, y: e.clientY - b.top };
    if (!state.drag) {
      if (!state.rect) return render();
      const h = state.mode === 'free' ? hitHandle(p) : -1;
      canvas.style.cursor = h === 0 || h === 2 ? 'nwse-resize' : h === 1 || h === 3 ? 'nesw-resize'
        : layerAt(p) ? 'move' : 'default';
      return render();
    }
    const d = state.drag, R0 = d.rect;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
    if (d.type === 'move') {
      state.rect = boundRect({ ...R0, x: R0.x + p.x - d.start.x, y: R0.y + p.y - d.start.y });
    } else {
      // La esquina opuesta queda fija
      const cs = corners(R0);
      let [ax, ay] = cs[(d.corner + 2) % 4];
      const left = p.x < ax, top = p.y < ay;
      let maxW = Infinity, maxH = Infinity;
      if (isBounded()) {
        // Al chocar con el borde de las hojas ya no crece más
        const L = layout();
        ax = Math.min(Math.max(ax, 0), L.posterW);
        ay = Math.min(Math.max(ay, 0), L.posterH);
        maxW = Math.max(5, left ? ax : L.posterW - ax);
        maxH = Math.max(5, top ? ay : L.posterH - ay);
      }
      let w = Math.min(maxW, Math.max(5, Math.abs(p.x - ax)));
      let h = Math.min(maxH, Math.max(5, Math.abs(p.y - ay)));
      if ($('keepRatio').checked) {
        const ar = R0.w / R0.h;
        if (w / h > ar) h = w / ar; else w = h * ar;
        if (w > maxW) { w = maxW; h = w / ar; }
        if (h > maxH) { h = maxH; w = h * ar; }
      }
      state.rect = { x: left ? ax - w : ax, y: top ? ay - h : ay, w, h };
    }
    render();
  });

  const endDrag = () => {
    const d = state.drag;
    state.drag = null;
    // Un clic (sin arrastrar) sobre un texto abre su configuración
    if (d && !d.moved && selLayer()?.kind === 'text') openTextPop();
    else if (textPopOpen) placeTextPop();
  };
  canvas.addEventListener('pointerleave', () => { state.mouse = null; render(); });
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    if (!state.rect) return;
    e.preventDefault();
    if (state.mode !== 'free') setMode('free');
    zoomAt(toMM(e), e.deltaY < 0 ? 1.08 : 1 / 1.08);
  }, { passive: false });

  function zoomAt(p, f) {
    const R = state.rect;
    const w = Math.max(5, R.w * f), h = w * (R.h / R.w);
    const k = w / R.w;
    state.rect = boundRect({ x: p.x - (p.x - R.x) * k, y: p.y - (p.y - R.y) * k, w, h });
    render();
  }

  function isBounded() { return $('bounded').checked; }

  // Con "No salir de los bordes" activo, encoge la imagen si es más grande que el póster y la mete dentro
  function boundRect(R) {
    if (!isBounded()) return R;
    const L = layout();
    let { x, y, w, h } = R;
    if (w > L.posterW || h > L.posterH) {
      if ($('keepRatio').checked) {
        const k = Math.min(L.posterW / w, L.posterH / h);
        w *= k; h *= k;
      } else {
        w = Math.min(w, L.posterW); h = Math.min(h, L.posterH);
      }
    }
    x = Math.min(Math.max(x, 0), L.posterW - w);
    y = Math.min(Math.max(y, 0), L.posterH - h);
    return { x, y, w, h };
  }

  const posterCenter = () => { const L = layout(); return { x: L.posterW / 2, y: L.posterH / 2 }; };
  $('zoomIn').onclick = () => state.rect && zoomAt(posterCenter(), 1.15);
  $('zoomOut').onclick = () => state.rect && zoomAt(posterCenter(), 1 / 1.15);
  $('center').onclick = () => {
    if (!state.rect) return;
    const c = posterCenter();
    state.rect = boundRect({ ...state.rect, x: c.x - state.rect.w / 2, y: c.y - state.rect.h / 2 });
    render();
  };
  $('resetFit').onclick = () => { if (state.src) { state.rect = fitRect('contain', layout()); render(); } };

  // ---------- Carga de imágenes ----------
  const fileInput = $('file'), drop = $('drop');
  fileInput.addEventListener('change', () => fileInput.files[0] && loadFile(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
  // También permite soltar la imagen sobre la vista previa
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no decodificable')); };
      img.src = url;
    });
  }

  // Carga una librería de vendor/ solo cuando hace falta (relativa a app.js, no a la página)
  const scripts = {};
  const appBase = document.currentScript ? document.currentScript.src : location.href;
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(src, appBase).href;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('no se pudo cargar ' + src)); };
      document.head.appendChild(s);
    }));
  }

  // Convierte en el navegador los formatos que no se pueden mostrar directamente
  async function convertInBrowser(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const ascii = String.fromCharCode(...head);
    const isTiff = (head[0] === 0x49 && head[1] === 0x49 && head[2] === 42) || (head[0] === 0x4d && head[1] === 0x4d && head[3] === 42);
    const isHeic = /ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(ascii) || /\.(heic|heif)$/i.test(file.name);

    if (isHeic) {
      await loadScript('vendor/heic2any.min.js');
      const out = await heic2any({ blob: file, toType: 'image/png' });
      return Array.isArray(out) ? out[0] : out;
    }
    if (isTiff) {
      await loadScript('vendor/pako_inflate.min.js');
      await loadScript('vendor/UTIF.js');
      const buf = await file.arrayBuffer();
      const ifds = UTIF.decode(buf);
      // Usa la página más grande del TIFF (algunos traen miniaturas)
      let best = null;
      for (const ifd of ifds) {
        UTIF.decodeImage(buf, ifd);
        if (ifd.width && (!best || ifd.width * ifd.height > best.width * best.height)) best = ifd;
      }
      if (!best) throw new Error('TIFF sin imágenes');
      const rgba = UTIF.toRGBA8(best);
      const c = document.createElement('canvas');
      c.width = best.width; c.height = best.height;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, 0, best.width * best.height * 4), best.width, best.height), 0, 0);
      return await new Promise((res) => c.toBlob(res, 'image/png'));
    }
    throw new Error('formato no soportado por el navegador');
  }

  async function loadFile(file) {
    status('Cargando imagen…');
    $('dropText').textContent = file.name;
    $('drop').classList.add('has-file');
    let img;
    try {
      img = await loadImage(file);
    } catch {
      // El navegador no entiende el formato: se convierte aquí mismo (HEIC, TIFF)
      try {
        status('Convirtiendo formato…');
        img = await loadImage(await convertInBrowser(file));
      } catch (err) {
        status('No se pudo abrir la imagen: ' + err.message);
        return;
      }
    }
    const name = file.name.replace(/\.[^.]+$/, '') || 'imagen';
    state.fileName = name;
    const cur = selLayer();
    if (layersOn() || !cur || cur.kind === 'text') {
      // Capa nueva encima de todo
      const l = { id: nextLayerId++, name, img, src: null, natW: 0, natH: 0, rotation: 0, flipH: false, flipV: false, mode: 'contain', rect: null, thumb: '' };
      state.layers.push(l);
      state.selId = l.id;
    } else {
      // Sin capas: la imagen nueva reemplaza a la seleccionada
      Object.assign(cur, { name, img, rotation: 0, flipH: false, flipV: false, rect: null });
      if (cur.mode === 'free') cur.mode = 'contain';
    }
    buildSource();
    applyMode();
    refreshUI();
    status('');
    commit();
    markDirty();
  }

  // Imagen (o canvas de texto) ya girada y volteada
  function orient(img, rotation, flipH, flipV) {
    // Los SVG sin tamaño declarado reportan 0
    const nw = img.naturalWidth ?? img.width;
    const w = nw || 1000, h = (img.naturalHeight ?? img.height) || 1000;
    if (rotation === 0 && !flipH && !flipV && nw) return img;
    const rot = rotation % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = rot ? h : w; c.height = rot ? w : h;
    const g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2);
    g.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    g.rotate((rotation * Math.PI) / 180);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    return c;
  }

  function buildSource() {
    const src = orient(state.img, state.rotation, state.flipH, state.flipV);
    state.src = src;
    state.natW = src.naturalWidth || src.width;
    state.natH = src.naturalHeight || src.height;
    const l = selLayer();
    if (l) l.thumb = makeThumb(l.src, l.natW, l.natH);
    $('imgInfo').textContent = `${state.natW} × ${state.natH} px`;
  }

  // Miniatura para la lista de capas
  function makeThumb(src, w, h) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const k = Math.min(64 / w, 64 / h);
    g.drawImage(src, (64 - w * k) / 2, (64 - h * k) / 2, w * k, h * k);
    return c.toDataURL('image/png');
  }

  function rotate(delta) {
    if (!state.img) return;
    state.rotation = (state.rotation + delta + 360) % 360;
    buildSource();
    if (state.mode === 'free' && state.rect) {
      // Conserva el centro y el ancho aproximado al girar
      const R = state.rect, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      const w = R.h, h = w * state.natH / state.natW;
      state.rect = { x: cx - w / 2, y: cy - h / 2, w, h };
    } else {
      state.rect = null;
    }
    applyMode();
    renderLayerList();
  }
  $('rotL').onclick = () => rotate(-90);
  $('rotR').onclick = () => rotate(90);

  function flip(axis) {
    if (!state.img) return;
    state[axis] = !state[axis];
    buildSource(); // el tamaño no cambia, así que la posición se conserva
    renderLayerList();
    render();
  }
  $('flipH').onclick = () => flip('flipH');
  $('flipV').onclick = () => flip('flipV');

  // ---------- Girar hojas ----------
  $('rotSheets').onclick = () => {
    $('orient').value = $('orient').value === 'portrait' ? 'landscape' : 'portrait';
    $('orient').dispatchEvent(new Event('change')); // actualiza el desplegable
    applyMode();
  };
  $('swapGrid').onclick = () => {
    const c = $('cols').value;
    $('cols').value = $('rows').value;
    $('rows').value = c;
    applyMode();
  };

  // ---------- Controles ----------
  ['paper', 'orient', 'cols', 'rows', 'margin', 'glue', 'bounded'].forEach((id) => $(id).addEventListener('input', applyMode));
  $('showMargin').addEventListener('change', () => render());
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
    setMode(r.value);
    if (r.value !== 'free') state.rect = null;
    applyMode();
  }));

  function status(t) { $('status').textContent = t; }

  // ---------- PDF ----------
  // Geometría de una hoja dentro del póster (mm)
  function sheetGeom(L, r, c) {
    const px = c * L.stepX, py = r * L.stepY;
    // Las franjas de pegado (derecha/abajo) quedan tapadas por la hoja vecina: ahí no va imagen
    const glueR = c < L.cols - 1 ? L.overlap : 0, glueB = r < L.rows - 1 ? L.overlap : 0;
    // Zona con imagen = unión de lo que cada capa pone en la hoja
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { rect: R } of state.layers) {
      if (!R) continue;
      const a = Math.max(px, R.x), b = Math.max(py, R.y);
      const c2 = Math.min(px + L.printW - glueR, R.x + R.w), d = Math.min(py + L.printH - glueB, R.y + R.h);
      if (c2 - a > 0.01 && d - b > 0.01) { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c2); y1 = Math.max(y1, d); }
    }
    return { r, c, n: r * L.cols + c + 1, px, py, glueR, glueB, x0, y0, x1, y1, hasImage: x1 - x0 > 0.01 && y1 - y0 > 0.01 };
  }

  function allSheets(L) {
    const list = [];
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) list.push(sheetGeom(L, r, c));
    return list;
  }

  function newPdf(L) {
    const { jsPDF } = window.jspdf;
    return new jsPDF({
      orientation: L.pageW > L.pageH ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [L.pageW, L.pageH],
      compress: true,
    });
  }

  // Dibuja una hoja completa en la página actual del PDF
  function drawSheet(pdf, L, G, tmp) {
    const dpi = parseInt($('dpi').value, 10);
    const total = L.rows * L.cols;
    const { px, py, x0, y0, x1, y1 } = G;

    if (G.hasImage) {
      // Todas las capas de la hoja compuestas en una sola imagen
      const g = tmp.getContext('2d');
      const dwmm = x1 - x0, dhmm = y1 - y0;
      // px por mm: el dpi elegido, sin pasar de la resolución de la capa más detallada
      const srcs = new Map(state.layers.filter((l) => l.rect).map((l) => [l, printSource(l, dpi)]));
      const dens = Math.min(dpi / 25.4, Math.max(...[...srcs].map(([l, c]) => (c.naturalWidth || c.width) / l.rect.w)));
      tmp.width = Math.max(1, Math.round(dwmm * dens));
      tmp.height = Math.max(1, Math.round(dhmm * dens));
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, tmp.width, tmp.height);
      const kx = tmp.width / dwmm, ky = tmp.height / dhmm;
      g.setTransform(kx, 0, 0, ky, -x0 * kx, -y0 * ky);
      g.imageSmoothingQuality = 'high';
      for (const [l, c] of srcs) g.drawImage(c, l.rect.x, l.rect.y, l.rect.w, l.rect.h);
      g.setTransform(1, 0, 0, 1, 0, 0);
      pdf.addImage(tmp.toDataURL('image/jpeg', 0.92), 'JPEG',
        L.margin + x0 - px, L.margin + y0 - py, dwmm, dhmm, undefined, 'FAST');
    }

    const GR = glueRects(L, G);
    if (GR.r || GR.b) {
      const fs = Math.min(9, L.overlap * 2);
      pdf.setFontSize(fs);
      const tw = pdf.getTextWidth('PEGAR AQUÍ'), th = fs * 0.3528;
      pdf.setFillColor(225);
      pdf.setTextColor(120);
      // Solo a lo largo de la imagen: fuera de ella la franja se recorta
      if (GR.r) {
        const { x, y, w, h } = GR.r;
        pdf.rect(x, y, w, h, 'F');
        if (h > tw + 2) pdf.text('PEGAR AQUÍ', x + w / 2 + th / 3, y + h / 2 + tw / 2, { angle: 90 });
      }
      if (GR.b) {
        const { x, y, w, h } = GR.b;
        pdf.rect(x, y, w, h, 'F');
        if (w > tw + 2) pdf.text('PEGAR AQUÍ', x + (w - tw) / 2, y + h / 2 + th / 3);
      }
    }

    if ($('cutMarks').checked && L.margin > 0) {
      // Borde punteado unos milímetros por fuera de la imagen: por aquí se corta
      const B = cutBox(L, G), d = cutGap(L);
      pdf.setDrawColor(90);
      pdf.setLineWidth(0.35);
      pdf.setLineCap('round');
      pdf.setLineDashPattern([0, 1.4], 0);
      pdf.rect(B.x - d, B.y - d, B.w + 2 * d, B.h + 2 * d);
      pdf.setLineDashPattern([], 0);
      pdf.setLineCap('butt');
    }
    if ($('labels').checked && L.margin >= 3) {
      // Por encima de la línea de corte si cabe, para no pisarla
      const top = $('cutMarks').checked ? cutBox(L, G).y - cutGap(L) : L.margin;
      const ly = top - 1 >= 3 ? top - 1 : L.margin - 1;
      pdf.setFontSize(7);
      pdf.setTextColor(140);
      pdf.text(`Hoja ${G.n}/${total} · fila ${G.r + 1}, columna ${G.c + 1}`, L.margin, ly);
    }
  }

  const tick = () => new Promise((res) => setTimeout(res));

  // Todas las hojas indicadas en un solo PDF
  async function buildPdf(sheets) {
    const L = layout();
    if (!sheets) sheets = allSheets(L).filter((G) => G.hasImage || !$('skipEmpty').checked);
    const pdf = newPdf(L);
    const tmp = document.createElement('canvas');
    for (let i = 0; i < sheets.length; i++) {
      status(`Generando hoja ${i + 1} de ${sheets.length}…`);
      await tick();
      if (i > 0) pdf.addPage([L.pageW, L.pageH], L.pageW > L.pageH ? 'landscape' : 'portrait');
      drawSheet(pdf, L, sheets[i], tmp);
    }
    if (!sheets.length) pdf.text('Sin contenido', 10, 10);
    status('');
    return pdf;
  }

  // Cada hoja en su propio PDF, todas dentro de un .zip
  async function buildZip(sheets) {
    const L = layout();
    const zip = new JSZip();
    const tmp = document.createElement('canvas');
    for (let i = 0; i < sheets.length; i++) {
      const G = sheets[i];
      status(`Generando hoja ${i + 1} de ${sheets.length}…`);
      await tick();
      const pdf = newPdf(L);
      drawSheet(pdf, L, G, tmp);
      zip.file(`${state.fileName}-hoja-${String(G.n).padStart(2, '0')}-fila${G.r + 1}-col${G.c + 1}.pdf`, pdf.output('arraybuffer'));
    }
    status('Comprimiendo .zip…');
    const blob = await zip.generateAsync({ type: 'blob' });
    status('');
    return blob;
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

  // Separación (mm) entre el borde del bloque impreso y la línea de corte
  const cutGap = (L) => Math.min(3, L.margin / 2);

  // Rectángulo (mm de página) que hay que recortar: la imagen de la hoja más las
  // franjas de pegado a las que llega. Sin imagen, el bloque imprimible entero.
  function cutBox(L, G) {
    if (!G.hasImage) return { x: L.margin, y: L.margin, w: L.printW, h: L.printH };
    const eps = 0.01;
    const left = L.margin + G.x0 - G.px, top = L.margin + G.y0 - G.py;
    let right = L.margin + G.x1 - G.px, bottom = L.margin + G.y1 - G.py;
    if (G.glueR && G.x1 >= G.px + L.printW - G.glueR - eps) right = L.margin + L.printW;
    if (G.glueB && G.y1 >= G.py + L.printH - G.glueB - eps) bottom = L.margin + L.printH;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // Franjas de pegado (mm de página) limitadas al tramo que se recorta; null si no se usan
  function glueRects(L, G) {
    const B = cutBox(L, G), eps = 0.01;
    const gx = L.margin + L.printW - G.glueR, gy = L.margin + L.printH - G.glueB;
    const r = G.glueR && B.x + B.w >= L.margin + L.printW - eps ? { x: gx, y: B.y, w: G.glueR, h: B.h } : null;
    const b = G.glueB && B.y + B.h >= L.margin + L.printH - eps ? { x: B.x, y: gy, w: gx - B.x, h: G.glueB } : null;
    return { r, b };
  }

  $('makePdf').onclick = async () => {
    if (!state.rect) return;
    // La pestaña se abre de inmediato para que el navegador no la bloquee
    const win = window.open('', '_blank');
    if (win) win.document.write('<p style="font-family:sans-serif;padding:20px">Generando PDF…</p>');
    try {
      const pdf = await buildPdf();
      const url = URL.createObjectURL(pdf.output('blob'));
      if (win) win.location.href = url;
      else { status('El navegador bloqueó la pestaña; se descargará el PDF.'); pdf.save(state.fileName + '-hojas.pdf'); }
    } catch (err) {
      if (win) win.close();
      status('Error al generar el PDF: ' + err.message);
    }
  };

  // ---------- Diálogo de descarga ----------
  const dlg = $('dlDialog');
  let dlSheets = [];
  let dlSelected = new Set();

  // Miniatura de una hoja tal como saldrá impresa
  function drawThumb(cv, L, G) {
    const W = 160, k = W / L.pageW, H = Math.round(L.pageH * k);
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.aspectRatio = `${L.pageW} / ${L.pageH}`;
    const g = cv.getContext('2d');
    g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, L.pageW, L.pageH);
    const ox = L.margin - G.px, oy = L.margin - G.py; // póster -> hoja
    if (G.hasImage) {
      g.save();
      g.beginPath();
      g.rect(G.x0 + ox, G.y0 + oy, G.x1 - G.x0, G.y1 - G.y0);
      g.clip();
      for (const l of state.layers) if (l.rect) g.drawImage(l.src, l.rect.x + ox, l.rect.y + oy, l.rect.w, l.rect.h);
      g.restore();
    }
    g.fillStyle = '#e1e1e1';
    const GR = glueRects(L, G);
    for (const q of [GR.r, GR.b]) if (q) g.fillRect(q.x, q.y, q.w, q.h);
    if ($('cutMarks').checked && L.margin > 0) {
      g.strokeStyle = '#777';
      g.lineWidth = 0.8;
      g.setLineDash([1.5, 2.5]);
      const B = cutBox(L, G), d = cutGap(L);
      g.strokeRect(B.x - d, B.y - d, B.w + 2 * d, B.h + 2 * d);
    }
  }

  function updateDlSummary() {
    const n = dlSelected.size, total = dlSheets.length;
    $('dlCount').textContent = `${n} de ${total} ${total === 1 ? 'hoja seleccionada' : 'hojas seleccionadas'}`;
    $('dlAll').textContent = n === total ? 'Quitar todas' : 'Seleccionar todas';
    $('dlGo').disabled = n === 0;
    document.querySelectorAll('#dlGrid .slide').forEach((el) => {
      const on = dlSelected.has(+el.dataset.n);
      el.classList.toggle('selected', on);
      el.setAttribute('aria-checked', String(on));
    });
  }

  function openDownloadDialog() {
    const L = layout();
    dlSheets = allSheets(L);
    dlSelected = new Set(dlSheets.map((G) => G.n)); // por defecto: todas
    document.querySelector('input[name=dlFormat][value=pdf]').checked = true; // por defecto: un solo PDF
    const grid = $('dlGrid');
    grid.innerHTML = '';
    // Las miniaturas se acomodan como en el póster armado (si no son demasiadas columnas)
    grid.style.setProperty('--cols', Math.min(L.cols, 5));
    for (const G of dlSheets) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slide';
      el.dataset.n = G.n;
      el.setAttribute('role', 'checkbox');
      el.innerHTML = `<span class="slide-check"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
        <canvas></canvas>
        <span class="slide-label"><b>Hoja ${G.n}</b><span>Fila ${G.r + 1} · Col ${G.c + 1}${G.hasImage ? '' : ' · vacía'}</span></span>`;
      drawThumb(el.querySelector('canvas'), L, G);
      el.addEventListener('click', () => {
        dlSelected.has(G.n) ? dlSelected.delete(G.n) : dlSelected.add(G.n);
        updateDlSummary();
      });
      grid.appendChild(el);
    }
    updateDlSummary();
    dlg.showModal();
  }

  $('dlAll').onclick = () => {
    dlSelected = dlSelected.size === dlSheets.length ? new Set() : new Set(dlSheets.map((G) => G.n));
    updateDlSummary();
  };
  $('dlCancel').onclick = () => dlg.close();
  // Clic fuera del contenido cierra el diálogo
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  $('dlGo').onclick = async () => {
    const sheets = dlSheets.filter((G) => dlSelected.has(G.n));
    const asZip = document.querySelector('input[name=dlFormat]:checked').value === 'zip';
    const go = $('dlGo');
    go.disabled = true;
    go.classList.add('loading');
    try {
      if (asZip) saveBlob(await buildZip(sheets), `${state.fileName}-hojas.zip`);
      else (await buildPdf(sheets)).save(`${state.fileName}-hojas.pdf`);
      dlg.close();
    } catch (err) {
      status('Error al generar la descarga: ' + err.message);
    } finally {
      go.disabled = false;
      go.classList.remove('loading');
    }
  };

  $('downloadPdf').onclick = () => { if (state.rect) openDownloadDialog(); };

  // ---------- Papel personalizado ----------
  const paperSel = $('paper'), paperDlg = $('paperDialog');
  const fmtCm = (mm) => String(+(mm / 10).toFixed(1));

  function paperShape() {
    const w = parseFloat($('customW').value), h = parseFloat($('customH').value);
    const ok = w > 0 && h > 0;
    const k = ok ? 90 / Math.max(w, h) : 0;
    $('paperShape').style.width = ok ? w * k + 'px' : '0';
    $('paperShape').style.height = ok ? h * k + 'px' : '0';
    $('paperShape').dataset.label = ok ? `${w} × ${h} cm` : '';
  }
  $('customW').addEventListener('input', paperShape);
  $('customH').addEventListener('input', paperShape);

  function openPaperDialog() {
    const [w, h] = state.customPaper ? [state.customPaper.w, state.customPaper.h] : state.prevPaper.split('x').map(Number);
    // Respeta cómo se ve la hoja ahora (vertical u horizontal)
    const land = $('orient').value === 'landscape';
    $('customW').value = fmtCm(land ? Math.max(w, h) : Math.min(w, h));
    $('customH').value = fmtCm(land ? Math.min(w, h) : Math.max(w, h));
    $('paperError').textContent = '';
    paperShape();
    paperDlg.returnValue = '';
    paperDlg.showModal();
    $('customW').select();
  }

  paperSel.addEventListener('input', () => {
    if (paperSel.value === 'custom') openPaperDialog();
    else state.prevPaper = paperSel.value;
  });
  paperSel.addEventListener('reselect', () => { if (paperSel.value === 'custom') openPaperDialog(); });

  $('paperForm').addEventListener('submit', (e) => {
    const w = parseFloat($('customW').value), h = parseFloat($('customH').value);
    if (!(w >= 5 && w <= 200 && h >= 5 && h <= 200)) {
      e.preventDefault();
      $('paperError').textContent = 'El ancho y el alto deben estar entre 5 y 200 cm.';
      return;
    }
    state.customPaper = { w: w * 10, h: h * 10 };
    state.prevPaper = 'custom';
    paperSel.querySelector('option[value=custom]').textContent = `Personalizado (${fmtCm(w * 10)} × ${fmtCm(h * 10)} cm)`;
    $('orient').value = w > h ? 'landscape' : 'portrait';
    $('orient').dispatchEvent(new Event('change'));
    paperSel.dispatchEvent(new Event('change')); // actualiza el texto del desplegable
    paperDlg.returnValue = 'ok';
  });
  $('paperCancel').onclick = () => paperDlg.close();
  paperDlg.addEventListener('click', (e) => { if (e.target === paperDlg) paperDlg.close(); });
  paperDlg.addEventListener('close', () => {
    // Cancelado sin tener un tamaño personalizado previo: vuelve al papel anterior
    if (paperDlg.returnValue !== 'ok' && state.prevPaper !== 'custom') {
      paperSel.value = state.prevPaper;
      paperSel.dispatchEvent(new Event('change'));
    }
    applyMode();
  });

  // ---------- Capas ----------
  const layersOn = () => $('layersOn').checked;
  const layerList = $('layerList'), layerMenu = $('layerMenu');
  const initialDropText = $('dropText').textContent;

  function selectLayer(id) {
    state.selId = id;
    refreshUI();
  }

  // Deja la interfaz de acuerdo con las capas y la seleccionada
  function refreshUI() {
    const has = state.layers.length > 0;
    $('makePdf').disabled = $('downloadPdf').disabled = !has;
    $('drop').classList.toggle('has-file', has);
    if (!has) $('dropText').textContent = initialDropText;
    $('imgInfo').textContent = !has ? '' : selLayer()?.kind === 'text' ? '' : `${state.natW} × ${state.natH} px`;
    refreshTextBox();
    document.querySelector(`input[name=mode][value=${state.mode}]`).checked = true;
    $('freeOpts').classList.toggle('on', state.mode === 'free');
    $('layersBox').hidden = !layersOn();
    renderLayerList();
    render();
  }

  // Lista con la capa de arriba primero, como se ve en el póster
  function renderLayerList() {
    layerList.innerHTML = '';
    for (const l of [...state.layers].reverse()) {
      const li = document.createElement('li');
      li.className = 'layer' + (l.id === state.selId ? ' selected' : '');
      li.dataset.id = l.id;
      li.innerHTML = `<img alt="" draggable="false"><span class="layer-name"></span>
        <button type="button" class="layer-del" title="Eliminar capa (Supr)" aria-label="Eliminar capa"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`;
      li.querySelector('img').src = l.thumb;
      li.querySelector('.layer-name').textContent = l.name;
      layerList.appendChild(li);
    }
    $('layerEmpty').hidden = state.layers.length > 0;
  }

  // Cada cambio de capas es un paso de deshacer
  function layersChanged() {
    refreshUI();
    commit();
    markDirty();
  }

  function removeLayer(id) {
    const i = state.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    state.layers.splice(i, 1);
    if (state.selId === id) state.selId = (state.layers[i - 1] || state.layers[i])?.id ?? null;
    layersChanged();
  }

  // where: 'front' (todo adelante), 'forward', 'backward', 'back' (todo atrás)
  function moveLayer(id, where) {
    const L = state.layers, i = L.findIndex((l) => l.id === id), n = L.length;
    if (i < 0) return;
    const j = { front: n - 1, forward: Math.min(n - 1, i + 1), backward: Math.max(0, i - 1), back: 0 }[where];
    if (j === i) return;
    L.splice(j, 0, L.splice(i, 1)[0]);
    layersChanged();
  }

  $('layersOn').addEventListener('change', refreshUI);

  // Supr elimina la imagen seleccionada
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || state.selId == null) return;
    if (document.querySelector('dialog[open]') || e.target.closest('input, select, textarea')) return;
    e.preventDefault();
    closeLayerMenu();
    removeLayer(state.selId);
  });

  // ----- Reordenar arrastrando (eventos de puntero, ver docs 0020) -----
  const DRAG_THRESHOLD = 5; // px antes de decidir que no es un clic
  let suppressClickUntil = 0;

  layerList.addEventListener('click', (e) => {
    const li = e.target.closest('.layer');
    if (!li || performance.now() < suppressClickUntil) return;
    const id = +li.dataset.id;
    if (e.target.closest('.layer-del')) removeLayer(id);
    else if (id !== state.selId) selectLayer(id);
  });

  layerList.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.layer');
    // Ni botón derecho, ni el icono de eliminar, ni el dedo (con el dedo la lista se desplaza)
    if (!li || e.button !== 0 || e.pointerType === 'touch' || e.target.closest('.layer-del')) return;
    e.preventDefault();
    const id = +li.dataset.id, sx = e.clientX, sy = e.clientY;
    let lifted = false, float = null, gap = null, grabX = 0, grabY = 0;

    // Delante de la primera capa cuya mitad quede por debajo del puntero; si ninguna, al final.
    // La capa que viaja nunca cuenta como referencia.
    const placeGap = (y) => {
      const next = [...layerList.querySelectorAll('.layer')].find((x) => {
        if (x === li) return false;
        const r = x.getBoundingClientRect();
        return r.top + r.height / 2 > y;
      });
      layerList.insertBefore(gap, next || null);
    };

    const onMove = (ev) => {
      if (!lifted) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
        lifted = true;
        const r = li.getBoundingClientRect();
        grabX = sx - r.left; grabY = sy - r.top; // se conserva el punto de agarre
        float = li.cloneNode(true);
        float.classList.add('layer-float');
        float.style.width = r.width + 'px';
        float.style.height = r.height + 'px';
        document.body.appendChild(float);
        gap = document.createElement('li');
        gap.className = 'layer-gap';
        gap.style.height = r.height + 'px';
        layerList.insertBefore(gap, li);
        li.hidden = true; // está en la mano, no en la lista
        document.body.classList.add('dragging-layer');
      }
      float.style.left = ev.clientX - grabX + 'px';
      float.style.top = ev.clientY - grabY + 'px';
      placeGap(ev.clientY);
    };

    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      if (!lifted) return;
      suppressClickUntil = performance.now() + 300;
      float.remove();
      gap.remove();
      li.hidden = false;
      document.body.classList.remove('dragging-layer');
    };

    const onUp = (ev) => {
      if (!lifted) return stop(); // era un clic: lo atiende el evento click
      placeGap(ev.clientY); // el destino final sale del propio pointerup
      const ids = [...layerList.children].map((x) => (x === gap ? id : x === li ? null : +x.dataset.id)).filter((x) => x != null);
      stop();
      const order = ids.reverse(); // la lista va de arriba hacia abajo
      state.selId = id;
      // Soltarla donde ya estaba no es un cambio
      if (order.join() === state.layers.map((l) => l.id).join()) return refreshUI();
      state.layers = order.map((i) => state.layers.find((l) => l.id === i));
      layersChanged();
    };
    const onCancel = () => { stop(); renderLayerList(); };
    const onKey = (ev) => {
      if (ev.key !== 'Escape' || !lifted) return;
      ev.preventDefault();
      ev.stopPropagation();
      onCancel();
    };

    // En window y desde ya: un gesto rápido no debe perder el pointerup
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
  });

  // ----- Menú del clic derecho sobre una imagen -----
  let menuAt = null; // punto del póster (mm) donde se abrió el menú
  function openLayerMenu(id, x, y) {
    if (id != null) selectLayer(id);
    const l = id != null ? selLayer() : null;
    // Sin imagen debajo solo se ofrece añadir texto
    layerMenu.querySelectorAll('[data-act]:not([data-act=addtext]), hr:not(.menu-sep-text)').forEach((el) => { el.hidden = !l; });
    layerMenu.querySelector('[data-act=edittext]').hidden = !l || l.kind !== 'text';
    layerMenu.querySelector('.menu-sep-text').hidden = !l;
    layerMenu.hidden = false;
    layerMenu.style.left = Math.max(8, Math.min(x, innerWidth - layerMenu.offsetWidth - 8)) + 'px';
    layerMenu.style.top = Math.max(8, Math.min(y, innerHeight - layerMenu.offsetHeight - 8)) + 'px';
    layerMenu.querySelector('button:not(:disabled):not([hidden])')?.focus();
    if (!l) return;
    const i = state.layers.findIndex((q) => q.id === id), top = i === state.layers.length - 1;
    layerMenu.querySelector('[data-act=front]').disabled = top;
    layerMenu.querySelector('[data-act=forward]').disabled = top;
    layerMenu.querySelector('[data-act=backward]').disabled = i === 0;
    layerMenu.querySelector('[data-act=back]').disabled = i === 0;
  }
  function closeLayerMenu() { layerMenu.hidden = true; }

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (editing) finishInlineEdit();
    menuAt = toMM(e);
    const l = layerAt(menuAt);
    openLayerMenu(l ? l.id : null, e.clientX, e.clientY);
  });
  layerList.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('.layer');
    if (!li) return;
    e.preventDefault();
    openLayerMenu(+li.dataset.id, e.clientX, e.clientY);
  });
  layerMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    closeLayerMenu();
    if (b.dataset.act === 'addtext') addText(menuAt);
    else if (b.dataset.act === 'edittext') startInlineEdit();
    else if (b.dataset.act === 'delete') removeLayer(state.selId);
    else moveLayer(state.selId, b.dataset.act);
  });
  document.addEventListener('pointerdown', (e) => { if (!layerMenu.hidden && !layerMenu.contains(e.target)) closeLayerMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !layerMenu.hidden) closeLayerMenu(); });
  window.addEventListener('blur', closeLayerMenu);
  window.addEventListener('resize', closeLayerMenu);
  document.addEventListener('wheel', closeLayerMenu, { passive: true });

  // ---------- Capas de texto ----------
  const TEXT_PX = 400; // tamaño de la letra en la vista previa; el PDF se redibuja a su resolución
  const textBox = $('textBox');
  const textFonts = SplitFonts.fontList($('textFonts'), (font) => updateText({ font }));

  // El texto se dibuja en un canvas que hace de "imagen original" de la capa
  function renderText(l, size = TEXT_PX) {
    return SplitFonts.textCanvas({
      text: l.text, font: l.font, color: l.color, style: l.style, size,
      lineHeight: l.lineHeight || 1.15, tracking: size * (l.tracking || 0) / 100, // tracking en % del tamaño
    });
  }

  // at: punto del póster (mm) donde centrarlo; sin él, en el centro
  async function addText(at) {
    const l = {
      id: nextLayerId++, kind: 'text', name: 'Texto', text: 'Texto', font: SplitFonts.FONTS.find((f) => !f.custom).name,
      color: '#1b1f3b', style: 'fill', img: null, src: null, natW: 0, natH: 0,
      rotation: 0, flipH: false, flipV: false, mode: 'free', rect: null, thumb: '',
    };
    await SplitFonts.load(l.font);
    l.img = renderText(l);
    state.layers.push(l);
    state.selId = l.id;
    $('layersOn').checked = true; // el texto va encima de la imagen: se trabaja con capas
    buildSource();
    // Centrado, a lo ancho de más de la mitad del póster
    const L = layout();
    // Tamaño prudente: un octavo del lado corto del póster y como mucho la mitad del ancho,
    // siempre dentro del póster para que se vea entero
    let h = Math.min(L.posterH, L.posterW) * 0.12, w = h * l.natW / l.natH;
    if (w > L.posterW * 0.5) { w = L.posterW * 0.5; h = w * l.natH / l.natW; }
    const cx = at ? at.x : L.posterW / 2, cy = at ? at.y : L.posterH / 2;
    l.rect = {
      x: Math.min(Math.max(0, cx - w / 2), L.posterW - w),
      y: Math.min(Math.max(0, cy - h / 2), L.posterH - h), w, h,
    };
    layersChanged();
    openTextPop();
    startInlineEdit(true); // se escribe directamente en la hoja
  }
  $('addText').onclick = () => addText();

  // Cambia el texto de la capa seleccionada conservando su alto y su centro
  async function updateText(changes) {
    const l = selLayer();
    if (!l || l.kind !== 'text') return;
    Object.assign(l, changes);
    if (changes.font) await SplitFonts.load(l.font);
    const c = renderText(l);
    if (!c) { render(); return; } // solo espacios: se deja como estaba hasta que haya texto
    l.img = c;
    l.name = l.text.trim().split('\n')[0].slice(0, 30) || 'Texto';
    const R = l.rect, oldW = l.natW;
    buildSource();
    if (R) {
      // Mismo tamaño de letra: el recuadro crece o se achica con el texto, centrado y desde arriba
      const k = R.w / oldW, w = l.natW * k, h = l.natH * k;
      l.rect = boundRect({ x: R.x + R.w / 2 - w / 2, y: R.y, w, h });
    }
    refreshUI();
    scheduleCommit();
    markDirty();
  }

  $('textValue').addEventListener('input', (e) => updateText({ text: e.target.value }));
  $('textColor').addEventListener('input', (e) => updateText({ color: e.target.value }));
  document.querySelectorAll('input[name=textStyle]').forEach((r) => r.addEventListener('change', () => updateText({ style: r.value })));
  $('textLine').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (v >= 0.5 && v <= 4) updateText({ lineHeight: v });
  });
  $('textTrack').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (v >= -20 && v <= 200) updateText({ tracking: v });
  });

  let textPopOpen = false;
  function openTextPop() {
    if (selLayer()?.kind !== 'text') return;
    textPopOpen = true;
    refreshTextBox();
  }
  function closeTextPop() {
    if (!textPopOpen) return;
    textPopOpen = false;
    textBox.hidden = true;
  }
  $('textPopClose').onclick = closeTextPop;
  textBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeTextPop(); } });

  // Junto al texto: a la derecha si cabe, si no a la izquierda o debajo; siempre dentro de la vista
  function placeTextPop() {
    const l = selLayer();
    if (!l || !l.rect || textBox.hidden) return;
    const { s, ox, oy } = state.view, R = l.rect;
    const box = stage.getBoundingClientRect();
    const x0 = ox + R.x * s, x1 = ox + (R.x + R.w) * s, y0 = oy + R.y * s;
    const w = textBox.offsetWidth, h = textBox.offsetHeight, gap = 14;
    let left = x1 + gap;
    if (left + w > box.width - 8) left = x0 - gap - w;
    if (left < 8) left = Math.min(Math.max(8, x0), box.width - w - 8);
    const top = Math.min(Math.max(8, y0), Math.max(8, box.height - h - 8));
    textBox.style.left = left + 'px';
    textBox.style.top = top + 'px';
  }

  function refreshTextBox() {
    const l = selLayer();
    const on = !!l && l.kind === 'text' && textPopOpen;
    if (l?.kind !== 'text') textPopOpen = false;
    textBox.hidden = !on;
    if (!on) return;
    requestAnimationFrame(placeTextPop);
    if (document.activeElement !== $('textValue')) $('textValue').value = l.text;
    $('textColor').value = l.color;
    document.querySelector(`input[name=textStyle][value=${l.style}]`).checked = true;
    textFonts.select(l.font);
    if (document.activeElement !== $('textLine')) $('textLine').value = l.lineHeight || 1.15;
    if (document.activeElement !== $('textTrack')) $('textTrack').value = l.tracking || 0;
  }

  // Doble clic sobre un texto: se escribe directamente en la hoja
  const inline = $('inlineEdit');
  let editing = null;
  function placeInline() {
    const l = state.layers.find((q) => q.id === editing);
    if (!l || !l.rect) return;
    const { s, ox, oy } = state.view, R = l.rect;
    // Misma escala con la que se dibuja el texto en la hoja
    const k = R.h * s / l.img.height, fs = TEXT_PX * k;
    // La línea base del editor cae donde la del dibujo
    const m = SplitFonts.measure(l.text.split('\n')[0] || 'H', l.font, fs);
    const lh = l.lineHeight || 1.15;
    const baseInBox = (fs * lh - (m.fontAscent + m.fontDescent)) / 2 + m.fontAscent;
    const top = oy + R.y * s + l.img.baseline * k - baseInBox;
    Object.assign(inline.style, {
      left: ox + R.x * s + 'px', top: top + 'px', width: R.w * s + 'px',
      height: Math.max(fs * lh, oy + (R.y + R.h) * s - top) + 'px',
      lineHeight: lh, letterSpacing: (l.tracking || 0) / 100 + 'em',
      fontFamily: SplitFonts.css(l.font), fontWeight: SplitFonts.byName(l.font).weight,
      fontStyle: SplitFonts.byName(l.font).style, fontSize: fs + 'px', color: l.color,
    });
  }
  function startInlineEdit(selectAll) {
    const l = selLayer();
    if (!l || l.kind !== 'text') return;
    // Girado o volteado no se puede escribir encima: se usa la ventana
    if (l.rotation || l.flipH || l.flipV) { openTextPop(); $('textValue').focus(); return; }
    editing = l.id;
    inline.value = l.text;
    inline.hidden = false;
    placeInline();
    render();
    inline.focus();
    if (selectAll) inline.select();
  }
  function finishInlineEdit() {
    if (!editing) return;
    editing = null;
    inline.hidden = true;
    render();
    commit();
  }
  inline.addEventListener('input', async () => {
    await updateText({ text: inline.value });
    if (document.activeElement !== $('textValue')) $('textValue').value = inline.value;
    placeInline();
  });
  inline.addEventListener('blur', finishInlineEdit);
  inline.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); inline.blur(); }
    e.stopPropagation(); // Supr, Ctrl+Z… son del texto, no del póster
  });
  canvas.addEventListener('dblclick', (e) => {
    const l = layerAt(toMM(e));
    if (l && l.kind === 'text') { selectLayer(l.id); startInlineEdit(); }
  });

  // Imagen de cada capa para el PDF: los textos se redibujan nítidos a la resolución de impresión
  const printCache = new WeakMap();
  function printSource(l, dpi) {
    if (l.kind !== 'text' || !l.rect) return l.src;
    const hit = printCache.get(l.src);
    if (hit && hit.dpi === dpi) return hit.c;
    const want = (dpi / 25.4) * l.rect.w / l.natW; // cuánto más grande hace falta
    const side = Math.max(l.img.width, l.img.height) * want;
    const k = Math.min(want, want * 12000 / side); // sin pasar de 12000 px por lado
    let c = l.src;
    if (k > 1) {
      const t = renderText(l, TEXT_PX * k);
      if (t) c = orient(t, l.rotation, l.flipH, l.flipV);
    }
    printCache.set(l.src, { dpi, c });
    return c;
  }

  // ---------- Deshacer / rehacer ----------
  // Cada paso guarda la configuración completa (controles + imagen y su posición)
  const controls = [...document.querySelectorAll('.panel input, .panel select')].filter((el) => el.type !== 'file' && !el.closest('#textBox'));
  const ctlKey = (el) => el.id || `${el.name}=${el.value}`;
  const customOpt = paperSel.querySelector('option[value=custom]');
  const undoStack = [];
  let histPos = -1, histTimer = 0;

  function snapshot() {
    const ctl = {};
    for (const el of controls) ctl[ctlKey(el)] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
    const { fileName, customPaper, prevPaper } = state;
    const layers = state.layers.map((l) => ({ ...l, rect: l.rect && { ...l.rect } }));
    return {
      layers,
      selId: state.selId, // seleccionar otra capa no cuenta como paso de deshacer
      key: JSON.stringify({
        ctl, customLabel: customOpt.textContent, fileName, customPaper, prevPaper,
        layers: layers.map(({ id, name, rotation, flipH, flipV, mode, rect, text, font, color, style, lineHeight, tracking }) =>
          ({ id, name, rotation, flipH, flipV, mode, rect, text, font, color, style, lineHeight, tracking })),
      }),
      dropText: $('dropText').textContent,
    };
  }

  function commit() {
    clearTimeout(histTimer);
    if (state.drag || document.querySelector('dialog[open]')) return;
    const snap = snapshot(), cur = undoStack[histPos];
    if (cur && cur.key === snap.key && cur.layers.every((l, i) => l.img === snap.layers[i].img && l.src === snap.layers[i].src)) {
      cur.selId = snap.selId;
      return;
    }
    undoStack.splice(histPos + 1);
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
    histPos = undoStack.length - 1;
    updateHistButtons();
  }
  const scheduleCommit = (ms = 400) => { clearTimeout(histTimer); histTimer = setTimeout(commit, ms); };

  function restore(snap) {
    const d = JSON.parse(snap.key);
    for (const el of controls) {
      const v = d.ctl[ctlKey(el)];
      if (v === undefined) continue;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = v;
      else el.value = v;
    }
    customOpt.textContent = d.customLabel;
    // Refresca los desplegables personalizados
    document.querySelectorAll('.panel select').forEach((sel) => sel.dispatchEvent(new Event('change')));
    Object.assign(state, { fileName: d.fileName, customPaper: d.customPaper, prevPaper: d.prevPaper });
    state.layers = snap.layers.map((l) => ({ ...l, rect: l.rect && { ...l.rect } }));
    state.selId = state.layers.some((l) => l.id === snap.selId) ? snap.selId : state.layers.at(-1)?.id ?? null;
    $('dropText').textContent = snap.dropText;
    refreshUI();
  }

  function undo() {
    commit(); // guarda antes cualquier cambio pendiente
    if (histPos <= 0) return;
    restore(undoStack[--histPos]);
    updateHistButtons();
  }
  function redo() {
    commit();
    if (histPos >= undoStack.length - 1) return;
    restore(undoStack[++histPos]);
    updateHistButtons();
  }
  function updateHistButtons() {
    $('undo').disabled = histPos <= 0;
    $('redo').disabled = histPos >= undoStack.length - 1;
  }

  $('undo').onclick = undo;
  $('redo').onclick = redo;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });
  const panelEl = document.querySelector('.panel');
  panelEl.addEventListener('input', () => scheduleCommit());
  panelEl.addEventListener('change', () => scheduleCommit());
  panelEl.addEventListener('click', () => scheduleCommit(0));
  canvas.addEventListener('pointerup', () => scheduleCommit(0));
  canvas.addEventListener('pointercancel', () => scheduleCommit(0));
  canvas.addEventListener('wheel', () => scheduleCommit(), { passive: true });
  paperDlg.addEventListener('close', () => scheduleCommit(0));
  commit(); // estado inicial

  // ---------- Pegar imagen (Ctrl+V) ----------
  const pastedFile = (blob) => new File([blob], `imagen-pegada.${(blob.type.split('/')[1] || 'png').replace('+xml', '')}`, { type: blob.type });

  document.addEventListener('paste', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const item = [...(e.clipboardData?.items || [])].find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    const file = item && item.getAsFile();
    if (!file) return; // sin imagen: el pegado normal (p. ej. en un campo) sigue igual
    e.preventDefault();
    loadFile(file.name && file.name !== 'image.png' ? file : pastedFile(file));
  });

  // ---------- Aviso de cambios sin guardar ----------
  // Cualquier cambio (imagen, configuración o arrastre) marca la página como modificada
  let dirty = false;
  const markDirty = () => { dirty = true; };
  document.querySelector('.panel').addEventListener('input', markDirty);
  document.querySelector('.panel').addEventListener('change', markDirty);
  document.querySelector('.panel').addEventListener('click', (e) => { if (e.target.closest('.toolbar')) markDirty(); });
  canvas.addEventListener('pointerdown', () => { if (state.src) markDirty(); });
  canvas.addEventListener('wheel', () => { if (state.src) markDirty(); }, { passive: true });
  stage.addEventListener('drop', markDirty);
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    // El navegador muestra su propio mensaje de confirmación (no permite texto personalizado)
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- Minimizar panel ----------
  function setCollapsed(on) {
    document.body.classList.toggle('collapsed', on);
    $('togglePanel').setAttribute('aria-expanded', String(!on));
    $('togglePanel').title = on ? 'Mostrar configuración' : 'Ocultar configuración';
    try { localStorage.setItem('panelCollapsed', on ? '1' : '0'); } catch {}
  }
  $('togglePanel').onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));
  try { if (localStorage.getItem('panelCollapsed') === '1') setCollapsed(true); } catch {}

  // Redibuja cuando cambia el tamaño del área (ventana o panel minimizado)
  new ResizeObserver(resizeCanvas).observe(stage);
  resizeCanvas();
})();
