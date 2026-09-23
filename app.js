(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('preview');
  const ctx = canvas.getContext('2d');
  const stage = $('stage');

  const state = {
    img: null,        // HTMLImageElement original
    src: null,        // imagen o canvas ya rotado que se usa para dibujar
    natW: 0, natH: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    customPaper: null,   // {w, h} en mm cuando se elige "Personalizado"
    prevPaper: '210x297', // último tamaño aplicado, para volver si se cancela
    fileName: 'poster',
    mode: 'contain',
    rect: null,       // posición de la imagen en mm dentro del póster {x, y, w, h}
    view: { s: 1, ox: 0, oy: 0 },
    drag: null,
  };

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

  function fitRect(mode, L) {
    const { posterW: W, posterH: H } = L;
    if (mode === 'stretch') return { x: 0, y: 0, w: W, h: H };
    const ar = state.natW / state.natH;
    let w, h;
    const containWide = W / H < ar;
    if ((mode === 'contain') === containWide) { w = W; h = W / ar; } else { h = H; w = H * ar; }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  function applyMode() {
    if (!state.src) return render();
    const L = layout();
    if (state.mode !== 'free' || !state.rect) state.rect = fitRect(state.mode === 'free' ? 'contain' : state.mode, L);
    else state.rect = boundRect(state.rect);
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

    if (state.src && state.rect) {
      const R = state.rect;
      // Parte fuera del póster, tenue
      ctx.globalAlpha = 0.25;
      ctx.drawImage(state.src, X(R.x), Y(R.y), R.w * s, R.h * s);
      ctx.globalAlpha = 1;
      // Parte imprimible
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(0), Y(0), L.posterW * s, L.posterH * s);
      ctx.clip();
      ctx.drawImage(state.src, X(R.x), Y(R.y), R.w * s, R.h * s);
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
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('✂', X(L.posterW) - 22, Y(0) + 5);
    ctx.fillStyle = 'rgba(31,111,235,.9)';
    ctx.font = '600 12px system-ui, sans-serif';
    for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
      ctx.fillText(String(r * L.cols + c + 1), X(c * L.stepX) + 6, Y(r * L.stepY) + 16);
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

  function setMode(mode) {
    state.mode = mode;
    document.querySelector(`input[name=mode][value=${mode}]`).checked = true;
    $('freeOpts').classList.toggle('on', mode === 'free');
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!state.rect) return;
    const p = toMM(e);
    const h = state.mode === 'free' ? hitHandle(p) : -1;
    if (h < 0 && !inRect(p, state.rect)) return;
    if (state.mode !== 'free') setMode('free');
    canvas.setPointerCapture(e.pointerId);
    state.drag = { type: h >= 0 ? 'resize' : 'move', corner: h, start: p, rect: { ...state.rect } };
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toMM(e);
    const b = canvas.getBoundingClientRect();
    state.mouse = { x: e.clientX - b.left, y: e.clientY - b.top };
    if (!state.drag) {
      if (!state.rect) return render();
      const h = state.mode === 'free' ? hitHandle(p) : -1;
      canvas.style.cursor = h === 0 || h === 2 ? 'nwse-resize' : h === 1 || h === 3 ? 'nesw-resize'
        : inRect(p, state.rect) ? 'move' : 'default';
      return render();
    }
    const d = state.drag, R0 = d.rect;
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

  const endDrag = () => { state.drag = null; };
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

  // Carga una librería de vendor/ solo cuando hace falta
  const scripts = {};
  function loadScript(src) {
    return scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
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
    state.img = img;
    state.fileName = file.name.replace(/\.[^.]+$/, '') || 'poster';
    state.rotation = 0;
    state.flipH = state.flipV = false;
    buildSource();
    state.rect = null;
    if (state.mode === 'free') setMode('contain');
    applyMode();
    $('makePdf').disabled = $('downloadPdf').disabled = false;
    status('');
  }

  function buildSource() {
    const img = state.img;
    // Los SVG sin tamaño declarado reportan 0
    const w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
    if (state.rotation === 0 && !state.flipH && !state.flipV && img.naturalWidth) {
      state.src = img; state.natW = w; state.natH = h;
    } else {
      const rot = state.rotation % 180 !== 0;
      const c = document.createElement('canvas');
      c.width = rot ? h : w; c.height = rot ? w : h;
      const g = c.getContext('2d');
      g.translate(c.width / 2, c.height / 2);
      g.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
      g.rotate((state.rotation * Math.PI) / 180);
      g.drawImage(img, -w / 2, -h / 2, w, h);
      state.src = c; state.natW = c.width; state.natH = c.height;
    }
    $('imgInfo').textContent = `${state.natW} × ${state.natH} px`;
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
  }
  $('rotL').onclick = () => rotate(-90);
  $('rotR').onclick = () => rotate(90);

  function flip(axis) {
    if (!state.img) return;
    state[axis] = !state[axis];
    buildSource(); // el tamaño no cambia, así que la posición se conserva
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
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
    setMode(r.value);
    if (r.value !== 'free') state.rect = null;
    applyMode();
  }));

  function status(t) { $('status').textContent = t; }

  // ---------- PDF ----------
  // Geometría de una hoja dentro del póster (mm)
  function sheetGeom(L, r, c) {
    const R = state.rect;
    const px = c * L.stepX, py = r * L.stepY;
    // Las franjas de pegado (derecha/abajo) quedan tapadas por la hoja vecina: ahí no va imagen
    const glueR = c < L.cols - 1 ? L.overlap : 0, glueB = r < L.rows - 1 ? L.overlap : 0;
    const x0 = Math.max(px, R.x), y0 = Math.max(py, R.y);
    const x1 = Math.min(px + L.printW - glueR, R.x + R.w), y1 = Math.min(py + L.printH - glueB, R.y + R.h);
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
    const R = state.rect;
    const dpi = parseInt($('dpi').value, 10);
    const total = L.rows * L.cols;
    const { px, py, glueR, glueB, x0, y0, x1, y1 } = G;

    if (G.hasImage) {
      // Porción de la imagen original que cae en esta hoja
      const g = tmp.getContext('2d');
      const sx = (x0 - R.x) / R.w * state.natW, sy = (y0 - R.y) / R.h * state.natH;
      const sw = (x1 - x0) / R.w * state.natW, sh = (y1 - y0) / R.h * state.natH;
      const dwmm = x1 - x0, dhmm = y1 - y0;
      // No se escala por encima del dpi elegido ni por encima de la resolución original
      tmp.width = Math.max(1, Math.round(Math.min(dwmm / 25.4 * dpi, Math.ceil(sw))));
      tmp.height = Math.max(1, Math.round(Math.min(dhmm / 25.4 * dpi, Math.ceil(sh))));
      g.fillStyle = '#fff';
      g.fillRect(0, 0, tmp.width, tmp.height);
      g.imageSmoothingQuality = 'high';
      g.drawImage(state.src, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
      pdf.addImage(tmp.toDataURL('image/jpeg', 0.92), 'JPEG',
        L.margin + x0 - px, L.margin + y0 - py, dwmm, dhmm, undefined, 'FAST');
    }

    if (glueR || glueB) {
      const fs = Math.min(9, L.overlap * 2);
      pdf.setFontSize(fs);
      const tw = pdf.getTextWidth('PEGAR AQUÍ'), th = fs * 0.3528;
      if (glueR) {
        const gx = L.margin + L.printW - glueR;
        pdf.setFillColor(225);
        pdf.setTextColor(120);
        pdf.rect(gx, L.margin, glueR, L.printH, 'F');
        pdf.text('PEGAR AQUÍ', gx + glueR / 2 + th / 3, L.margin + L.printH / 2 + tw / 2, { angle: 90 });
      }
      if (glueB) {
        const gy = L.margin + L.printH - glueB;
        pdf.setFillColor(225);
        pdf.setTextColor(120);
        pdf.rect(L.margin, gy, L.printW - glueR, glueB, 'F');
        pdf.text('PEGAR AQUÍ', L.margin + (L.printW - glueR - tw) / 2, gy + glueB / 2 + th / 3);
      }
    }

    if ($('cutMarks').checked && L.margin > 0) {
      // Borde punteado alrededor del bloque: por aquí se corta con la tijera
      pdf.setDrawColor(90);
      pdf.setLineWidth(0.35);
      pdf.setLineCap('round');
      pdf.setLineDashPattern([0, 1.4], 0);
      pdf.rect(L.margin, L.margin, L.printW, L.printH);
      pdf.setLineDashPattern([], 0);
      pdf.setLineCap('butt');
      drawScissors(pdf, L.margin + L.printW - 14, L.margin, 5, false);
      drawScissors(pdf, L.margin, L.margin + L.printH - 14, 5, true);
    }
    if ($('labels').checked && L.margin >= 3) {
      pdf.setFontSize(7);
      pdf.setTextColor(140);
      pdf.text(`Hoja ${G.n}/${total} · fila ${G.r + 1}, columna ${G.c + 1}`, L.margin, L.margin - 1);
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

  // Tijera vectorial sobre la línea de corte (las fuentes estándar del PDF no traen ✂)
  function drawScissors(pdf, cx, cy, size, vertical) {
    const P = (u, v) => (vertical ? [cx + v, cy + u] : [cx + u, cy + v]);
    const k = size / 5;
    pdf.setFillColor(255);
    const [bx, by] = P(-0.5 * k, -1.8 * k);
    pdf.rect(bx, by, vertical ? 3.6 * k : 6 * k, vertical ? 6 * k : 3.6 * k, 'F');
    pdf.setDrawColor(60);
    pdf.setLineWidth(0.3 * k);
    const [h1x, h1y] = P(0.6 * k, -0.9 * k), [h2x, h2y] = P(0.6 * k, 0.9 * k);
    pdf.circle(h1x, h1y, 0.6 * k, 'S');
    pdf.circle(h2x, h2y, 0.6 * k, 'S');
    pdf.line(...P(1.1 * k, -0.6 * k), ...P(5 * k, 0.5 * k));
    pdf.line(...P(1.1 * k, 0.6 * k), ...P(5 * k, -0.5 * k));
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
    const R = state.rect;
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
      g.drawImage(state.src, R.x + ox, R.y + oy, R.w, R.h);
      g.restore();
    }
    g.fillStyle = '#e1e1e1';
    if (G.glueR) g.fillRect(L.margin + L.printW - G.glueR, L.margin, G.glueR, L.printH);
    if (G.glueB) g.fillRect(L.margin, L.margin + L.printH - G.glueB, L.printW - G.glueR, G.glueB);
    if ($('cutMarks').checked && L.margin > 0) {
      g.strokeStyle = '#777';
      g.lineWidth = 0.8;
      g.setLineDash([1.5, 2.5]);
      g.strokeRect(L.margin, L.margin, L.printW, L.printH);
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
