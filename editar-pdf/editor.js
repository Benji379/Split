// Editor de PDF: muestra las páginas con pdf.js, vuelve editable cada línea de texto
// (o la reconoce con OCR usando tesseract.js), permite insertar texto, imágenes, líneas,
// formas y enlaces, y guarda los cambios con pdf-lib. El texto cambiado se tapa con el
// color del fondo y se escribe el nuevo encima; el resto del PDF queda igual.
(() => {
  const $ = (id) => document.getElementById(id);
  const F = window.SplitFonts;
  const selfSrc = document.currentScript ? document.currentScript.src : location.href;
  const V = (p) => new URL('../vendor/' + p, selfSrc).href;
  const stage = $('stage'), scroller = $('scroller'), list = $('pages');
  const status = (t) => { $('status').textContent = t; };

  const S = {
    bytes: null,     // PDF original (para pdf-lib)
    doc: null,       // documento de pdf.js
    task: null,      // tarea de carga de pdf.js (para liberarla al abrir otro)
    name: 'documento',
    pages: [],       // { num, page, view, el, canvas, layer, scale, renderedAt, items, extracted }
    images: {},      // id → { bytes, type: 'png' | 'jpg', url, w, h }
    zoom: 1,
    sel: null,       // objeto seleccionado
    tool: null,      // herramienta activa: text | line | rect | ellipse | link
  };
  let nextId = 1;

  // ---------- Librerías (se cargan solo al usarlas) ----------
  let pdfjs = null;
  async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    try {
      pdfjs = await import(V('pdfjs/pdf.min.js'));
    } catch {
      throw new Error(location.protocol === 'file:'
        ? 'el editor de PDF necesita abrirse desde el sitio web o un servidor local (no con doble clic)'
        : 'no se pudo cargar el lector de PDF');
    }
    pdfjs.GlobalWorkerOptions.workerSrc = V('pdfjs/pdf.worker.min.js');
    return pdfjs;
  }
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

  // ---------- Abrir ----------
  async function openFile(file) {
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { status('Ese archivo no es un PDF.'); return; }
    status('Abriendo PDF…');
    $('dropText').textContent = file.name;
    $('drop').classList.add('has-file');
    try {
      const lib = await loadPdfjs();
      const bytes = new Uint8Array(await file.arrayBuffer());
      // pdf.js se queda con su copia; la original se guarda para escribir los cambios
      const task = lib.getDocument({
        data: bytes.slice(),
        cMapUrl: V('pdfjs/cmaps/'), cMapPacked: true,
        standardFontDataUrl: V('pdfjs/standard_fonts/'),
        wasmUrl: V('pdfjs/wasm/'),
        isEvalSupported: false,
      });
      const doc = await task.promise;
      if (S.task) S.task.destroy();
      S.task = task;
      S.bytes = bytes;
      S.doc = doc;
      S.name = file.name.replace(/\.pdf$/i, '') || 'documento';
      S.sel = null;
      S.images = {};
      hist.length = 0; hpos = -1;
      await buildPages();
      commit(); // estado inicial del historial
      $('pdfInfo').textContent = `${doc.numPages} ${doc.numPages === 1 ? 'hoja' : 'hojas'}`;
      status('');
    } catch (err) {
      status(err && err.name === 'PasswordException' ? 'El PDF tiene contraseña: quítasela antes de editarlo.' : 'No se pudo abrir el PDF: ' + err.message);
    }
    showSel();
    refresh();
  }

  async function buildPages() {
    io.disconnect();
    list.innerHTML = '';
    S.pages = [];
    for (let n = 1; n <= S.doc.numPages; n++) {
      const page = await S.doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const li = document.createElement('li');
      li.className = 'pdf-sheet';
      li.dataset.n = n;
      li.innerHTML = '<canvas></canvas><div class="tlayer"></div><span class="pdf-num"></span>';
      li.querySelector('.pdf-num').textContent = `${n} / ${S.doc.numPages}`;
      list.appendChild(li);
      const pg = { num: n, page, view, el: li, canvas: li.querySelector('canvas'), layer: li.querySelector('.tlayer'), scale: 1, renderedAt: 0, items: [], extracted: false };
      pg.layer.addEventListener('pointerdown', (e) => onLayerDown(e, pg));
      S.pages.push(pg);
    }
    layoutPages();
    S.pages.forEach((pg) => io.observe(pg.el));
    scroller.scrollTop = 0;
  }

  // Ancho de cada hoja en pantalla según el zoom
  function layoutPages() {
    const avail = Math.max(240, Math.min(scroller.clientWidth - 64, 980));
    for (const pg of S.pages) {
      pg.scale = (avail / pg.view.width) * S.zoom;
      pg.el.style.width = pg.view.width * pg.scale + 'px';
      pg.el.style.height = pg.view.height * pg.scale + 'px';
      pg.items.forEach(style);
      if (pg.renderedAt && pg.renderedAt !== pg.scale && isVisible(pg)) renderPage(pg);
    }
    $('zoomVal').textContent = Math.round(S.zoom * 100) + '%';
  }
  const isVisible = (pg) => {
    const r = pg.el.getBoundingClientRect(), R = scroller.getBoundingClientRect();
    return r.bottom > R.top - 600 && r.top < R.bottom + 600;
  };

  // Solo se dibujan las hojas que están cerca de la pantalla
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const pg = S.pages[+e.target.dataset.n - 1];
      if (pg && pg.renderedAt !== pg.scale) renderPage(pg);
    }
  }, { root: scroller, rootMargin: '600px 0px' });

  async function renderPage(pg) {
    if (pg.rendering) { pg.again = true; return; }
    pg.rendering = true;
    const scale = pg.scale, dpr = window.devicePixelRatio || 1;
    const vp = pg.page.getViewport({ scale: scale * dpr });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    try {
      await pg.page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
      // Se cambia de golpe para que no parpadee al hacer zoom
      pg.el.replaceChild(c, pg.canvas);
      pg.canvas = c;
      pg.renderedAt = scale;
      if (!pg.extracted) await extract(pg);
    } catch (err) {
      if (err && err.name !== 'RenderingCancelledException') status('No se pudo dibujar la hoja ' + pg.num + ': ' + err.message);
    }
    pg.rendering = false;
    if (pg.again || pg.renderedAt !== pg.scale) { pg.again = false; if (isVisible(pg)) renderPage(pg); }
  }

  // ---------- Texto del PDF → líneas editables ----------
  function fontInfo(pg, fontName, style) {
    let name = '', bold = false, italic = false;
    try {
      if (pg.page.commonObjs.has(fontName)) {
        const f = pg.page.commonObjs.get(fontName);
        name = f.name || '';
        bold = !!(f.bold || f.black);
        italic = !!f.italic;
      }
    } catch {}
    bold = bold || /bold|black|heavy|semibold|demi/i.test(name);
    italic = italic || /italic|oblique/i.test(name);
    const fam = (style && style.fontFamily) || '';
    const family = /courier|mono/i.test(name) || fam === 'monospace' ? 'mono'
      : (/times|georgia|garamond|roman|serif|minion|cambria|book/i.test(name) && !/sans/i.test(name)) || fam === 'serif' ? 'serif' : 'sans';
    return { family, bold, italic };
  }

  async function extract(pg) {
    pg.extracted = true;
    const tc = await pg.page.getTextContent();
    const vt = pg.view.transform;
    let cur = null;
    const lines = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      if (!it.str.trim() && !cur) { if (it.hasEOL) cur = null; continue; }
      const tx = pdfjs.Util.transform(vt, it.transform);
      const size = Math.hypot(tx[2], tx[3]);
      // Solo el texto horizontal se puede editar
      if (size < 1 || Math.abs(Math.atan2(tx[1], tx[0])) > 0.02) { cur = null; continue; }
      const st = tc.styles[it.fontName] || {};
      const x = tx[4], base = tx[5], w = it.width;
      const gap = cur ? x - (cur.x + cur.w) : 0;
      if (cur && cur.fontName === it.fontName && Math.abs(cur.base - base) < size * 0.3 && Math.abs(cur.size - size) < size * 0.15 && gap < size * 1.2 && gap > -size * 0.5) {
        if (gap > size * 0.12 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        cur.text += it.str;
        cur.w = Math.max(cur.w, x + w - cur.x);
      } else if (it.str.trim()) {
        const asc = st.ascent || 0.8, desc = st.descent || -0.2;
        cur = { fontName: it.fontName, x, base, w, size, asc, desc, text: it.str, style: st };
        lines.push(cur);
      }
      if (it.hasEOL) cur = null;
    }
    const added = [];
    for (const l of lines) {
      const text = l.text.replace(/\s+$/, '');
      if (!text.trim()) continue;
      added.push(addItem(pg, textItem({
        source: 'pdf', x: l.x, top: l.base - l.size * l.asc, base: l.base, w: l.w, h: l.size * (l.asc - l.desc),
        size: l.size, text, orig: text, ...fontInfo(pg, l.fontName, l.style),
      }), 0));
    }
    // El texto original existe en todos los pasos del historial: se añade a cada uno
    const data = added.map(toData);
    for (const h of hist) {
      const cur2 = h.pages[pg.num] || [];
      h.pages[pg.num] = [...data.map((d) => ({ ...d, origStyle: { ...d.origStyle } })), ...cur2.filter((d) => !data.some((x) => x.id === d.id))];
    }
    refresh();
  }

  // ---------- Objetos ----------
  // Tipos: text, image, line, rect, ellipse, link. Todos en unidades del PDF (pt), origen arriba a la izquierda.
  function textItem(o) {
    const it = { type: 'text', color: null, bg: null, deleted: false, isNew: false, font: null, link: '', ...o };
    it.ox = it.x; it.otop = it.top; it.obase = it.base; // dónde estaba (para taparlo aunque se mueva)
    it.origStyle = { size: it.size, family: it.family, bold: it.bold, italic: it.italic, color: it.color, bg: it.bg, font: null };
    return it;
  }

  function addItem(pg, it, at = pg.items.length) {
    it.id = it.id || nextId++;
    it.page = pg.num;
    nextId = Math.max(nextId, it.id + 1);
    it.el = makeEl(it);
    at = Math.min(at, pg.items.length);
    pg.items.splice(at, 0, it);
    // El orden en pantalla sigue al de la lista (lo último, encima)
    const after = pg.items[at + 1];
    pg.layer.insertBefore(it.el, after ? after.el : null);
    style(it);
    return it;
  }

  function makeEl(it) {
    const el = document.createElement('div');
    el.dataset.id = it.id;
    if (it.type === 'text') {
      el.className = 'tbox';
      el.spellcheck = false;
      el.textContent = it.text;
      el.addEventListener('input', () => {
        it.text = el.innerText.replace(/\n$/, '');
        if (it.deleted && it.text) it.deleted = false;
        style(it);
        commitSoon();
        refresh();
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); select(null); } });
    } else {
      el.className = 'obj obj-' + it.type;
      if (it.type === 'image') {
        const img = document.createElement('img');
        img.src = S.images[it.img].url;
        img.alt = '';
        img.draggable = false;
        el.appendChild(img);
      } else if (it.type === 'line') {
        el.innerHTML = '<svg><line class="hit"/><line class="vis"/></svg><span class="hd hd-a"></span><span class="hd hd-b"></span>';
      }
      if (it.type !== 'line') el.insertAdjacentHTML('beforeend', '<span class="hd hd-br"></span>');
    }
    el.addEventListener('pointerdown', (e) => onObjDown(e, it));
    return el;
  }

  // Manija para mover el texto seleccionado (no puede ir dentro del texto editable)
  const grip = document.createElement('button');
  grip.type = 'button';
  grip.className = 'tgrip';
  grip.title = 'Arrastra para mover el texto';
  grip.setAttribute('aria-label', 'Mover texto');
  grip.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3m3-3 3 3M12 21l-3-3m3 3 3-3M3 12l3-3m-3 3 3 3M21 12l-3-3m3 3-3 3"/></svg>';
  grip.addEventListener('pointerdown', (e) => { if (S.sel && S.sel.type === 'text') { e.stopPropagation(); onObjDown(e, S.sel, true); } });
  function placeGrip() {
    const it = S.sel;
    if (!it || it.type !== 'text') { grip.remove(); return; }
    const pg = S.pages[it.page - 1];
    if (grip.parentNode !== pg.layer) pg.layer.appendChild(grip);
    grip.style.left = it.el.style.left;
    grip.style.top = it.el.style.top;
  }

  const FAMILY = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
  function place(it) {
    const pg = S.pages[it.page - 1], s = pg.scale, el = it.el;
    if (it.type === 'text') {
      // El alto de línea sigue al tamaño: al cambiarlo, la base del texto se mantiene
      const k = it.size / it.origStyle.size, lh = it.h * k;
      el.style.left = it.x * s + 'px';
      el.style.top = (it.base - (it.base - it.top) * k) * s + 'px';
      el.style.minWidth = Math.max(4, it.w) * s + 'px';
      el.style.minHeight = lh * s + 'px';
      el.style.lineHeight = lh * s + 'px';
      el.style.fontSize = it.size * s + 'px';
      if (S.sel === it) placeGrip();
      return;
    }
    if (it.type === 'line') {
      const pad = Math.max(6, it.width * s);
      const x0 = Math.min(it.x1, it.x2) * s - pad, y0 = Math.min(it.y1, it.y2) * s - pad;
      const w = Math.abs(it.x2 - it.x1) * s + 2 * pad, h = Math.abs(it.y2 - it.y1) * s + 2 * pad;
      Object.assign(el.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
      const svg = el.querySelector('svg');
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      const ax = it.x1 * s - x0, ay = it.y1 * s - y0, bx = it.x2 * s - x0, by = it.y2 * s - y0;
      // Dos líneas iguales: la visible y una ancha invisible para poder tocarla
      el.querySelectorAll('line').forEach((ln) => Object.entries({ x1: ax, y1: ay, x2: bx, y2: by }).forEach(([k, v]) => ln.setAttribute(k, v)));
      el.querySelector('.hd-a').style.cssText = `left:${ax}px;top:${ay}px`;
      el.querySelector('.hd-b').style.cssText = `left:${bx}px;top:${by}px`;
      return;
    }
    Object.assign(el.style, { left: it.x * s + 'px', top: it.top * s + 'px', width: it.w * s + 'px', height: it.h * s + 'px' });
  }

  const changed = (it) => it.type !== 'text' || it.isNew || it.deleted || it.text !== it.orig || it.font !== it.origStyle.font ||
    it.x !== it.ox || it.base !== it.obase ||
    ['size', 'family', 'bold', 'italic', 'color'].some((k) => it[k] !== it.origStyle[k]) || it.bg !== it.origStyle.bg;

  function style(it) {
    const el = it.el, pg = S.pages[it.page - 1];
    el.classList.toggle('sel', S.sel === it);
    el.classList.toggle('has-link', !!it.link);
    if (it.type === 'text') {
      const on = changed(it) || S.sel === it;
      el.classList.toggle('on', on);
      el.classList.toggle('deleted', it.deleted);
      el.classList.toggle('new', it.isNew);
      if (it.font) {
        const f = F.byName(it.font);
        el.style.fontFamily = F.css(it.font);
        el.style.fontWeight = f.weight;
        el.style.fontStyle = f.style;
        F.load(it.font);
      } else {
        el.style.fontFamily = FAMILY[it.family];
        el.style.fontWeight = it.bold ? '700' : '400';
        el.style.fontStyle = it.italic ? 'italic' : 'normal';
      }
      el.style.color = on ? it.color || '#000' : 'transparent';
      // Si se movió, el fondo ya no va detrás del texto (el original se tapa en su sitio)
      const moved = it.x !== it.ox || it.base !== it.obase;
      el.style.background = on && !it.isNew && !moved ? it.bg || '#fff' : 'transparent';
      renderCover(it, pg, on && !it.isNew && moved);
      place(it);
      return;
    }
    const s = pg.scale, w = Math.max(0, it.width || 0) * s;
    if (it.type === 'line') {
      const ln = el.querySelector('line.vis');
      ln.setAttribute('stroke', it.stroke);
      ln.setAttribute('stroke-width', Math.max(1, w));
      ln.setAttribute('stroke-linecap', 'round');
      ln.setAttribute('stroke-dasharray', it.dash ? `${w * 3} ${w * 2}` : '');
    } else if (it.type === 'rect' || it.type === 'ellipse') {
      el.style.border = w ? `${w}px ${it.dash ? 'dashed' : 'solid'} ${it.stroke}` : '0';
      el.style.background = it.fill || 'transparent';
      el.style.borderRadius = it.type === 'ellipse' ? '50%' : '0';
    }
    place(it);
  }
  // Parche que tapa el lugar original de un texto movido
  function renderCover(it, pg, on) {
    if (!on) { if (it.cover) { it.cover.remove(); it.cover = null; } return; }
    if (!it.cover) {
      it.cover = document.createElement('div');
      it.cover.className = 'tcover';
      pg.layer.insertBefore(it.cover, pg.layer.firstChild);
    }
    const s = pg.scale;
    Object.assign(it.cover.style, { left: it.ox * s + 'px', top: it.otop * s + 'px', width: it.w * s + 'px', height: it.h * s + 'px', background: it.bg || '#fff' });
  }

  // Color del fondo y del texto a partir de la hoja dibujada
  function sample(it, canvas, k) {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const x0 = Math.max(0, Math.floor(it.ox * k) - 2), y0 = Math.max(0, Math.floor(it.otop * k) - 2);
    const x1 = Math.min(canvas.width, Math.ceil((it.ox + it.w) * k) + 2), y1 = Math.min(canvas.height, Math.ceil((it.otop + it.h) * k) + 2);
    if (x1 - x0 < 3 || y1 - y0 < 3) return;
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data, W = x1 - x0, H = y1 - y0;
    const border = [];
    for (let x = 0; x < W; x++) border.push(x * 4, ((H - 1) * W + x) * 4);
    for (let y = 0; y < H; y++) border.push(y * W * 4, (y * W + W - 1) * 4);
    const med = (arr) => arr.sort((a, b) => a - b)[arr.length >> 1];
    const bg = [0, 1, 2].map((c) => med(border.map((i) => d[i + c])));
    // Texto: los píxeles más distintos del fondo
    const px = [];
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      if (dist > 90) px.push([dist, i]);
    }
    let fg = [0, 0, 0];
    if (px.length) {
      px.sort((a, b) => b[0] - a[0]);
      const top = px.slice(0, Math.max(1, Math.ceil(px.length * 0.3)));
      fg = [0, 1, 2].map((c) => Math.round(top.reduce((s, [, i]) => s + d[i + c], 0) / top.length));
    }
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    if (it.bg == null) it.origStyle.bg = it.bg = hex(bg);
    if (it.color == null) it.origStyle.color = it.color = hex(fg);
  }
  function ensureColors(it) {
    if (it.type !== 'text' || (it.bg != null && it.color != null)) return;
    const pg = S.pages[it.page - 1];
    if (!pg.renderedAt) { it.origStyle.bg = it.bg = it.bg || '#ffffff'; it.origStyle.color = it.color = it.color || '#000000'; return; }
    sample(it, pg.canvas, pg.canvas.width / pg.view.width);
  }

  // ---------- Historial (Ctrl+Z / Ctrl+Y) ----------
  // Cada paso guarda los objetos de todas las hojas ya leídas
  const hist = [];
  let hpos = -1, commitTimer = 0;
  const DATA_KEYS = ['id', 'type', 'source', 'x', 'top', 'base', 'ox', 'otop', 'obase', 'w', 'h', 'size', 'text', 'orig', 'family', 'bold', 'italic',
    'color', 'bg', 'deleted', 'isNew', 'font', 'link', 'img', 'x1', 'y1', 'x2', 'y2', 'stroke', 'width', 'dash', 'fill'];
  function toData(it) {
    const d = {};
    for (const k of DATA_KEYS) if (it[k] !== undefined) d[k] = it[k];
    if (it.origStyle) d.origStyle = { ...it.origStyle };
    return d;
  }
  function snapshot() {
    const pages = {};
    for (const pg of S.pages) if (pg.extracted || pg.items.length) pages[pg.num] = pg.items.map(toData);
    return { pages, sel: S.sel ? S.sel.id : null };
  }
  function commit() {
    clearTimeout(commitTimer);
    commitTimer = 0;
    const snap = snapshot(), last = hist[hpos];
    if (last && JSON.stringify(last.pages) === JSON.stringify(snap.pages)) { updateHist(); return; }
    hist.splice(hpos + 1);
    hist.push(snap);
    if (hist.length > 150) hist.shift();
    hpos = hist.length - 1;
    updateHist();
  }
  // Al escribir o arrastrar un control, un paso por pausa (no uno por letra)
  function commitSoon() { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 500); updateHist(); }
  function restore(snap) {
    for (const pg of S.pages) {
      const data = snap.pages[pg.num];
      if (!data) continue;
      pg.items.forEach((it) => { it.el.remove(); if (it.cover) it.cover.remove(); });
      pg.items = [];
      data.forEach((d) => addItem(pg, { ...d, origStyle: d.origStyle ? { ...d.origStyle } : undefined }));
    }
    S.sel = null;
    const sel = snap.sel && allItems().find((it) => it.id === snap.sel);
    if (sel) select(sel, false); else { showSel(); placeGrip(); }
    refresh();
  }
  function undo() {
    if (commitTimer) commit();
    if (hpos <= 0) return;
    hpos--;
    restore(hist[hpos]);
    updateHist();
  }
  function redo() {
    if (hpos >= hist.length - 1) return;
    hpos++;
    restore(hist[hpos]);
    updateHist();
  }
  function updateHist() {
    $('undo').disabled = hpos <= 0 && !commitTimer;
    $('redo').disabled = hpos >= hist.length - 1;
  }
  $('undo').onclick = undo;
  $('redo').onclick = redo;

  // ---------- Selección ----------
  const allItems = () => S.pages.flatMap((pg) => pg.items);
  function select(it, focus = true) {
    const prev = S.sel;
    if (prev === it) return;
    S.sel = it;
    if (prev) {
      if (prev.type === 'text') prev.el.contentEditable = 'false';
      // Un texto nuevo que quedó vacío se quita
      if (prev.type === 'text' && prev.isNew && !prev.text.trim() && prev.el.isConnected) { removeItem(prev); commit(); }
      else if (prev.el.isConnected) style(prev);
    }
    if (it) {
      ensureColors(it);
      if (it.type === 'text') {
        try { it.el.contentEditable = 'plaintext-only'; } catch {}
        if (it.el.contentEditable !== 'plaintext-only') it.el.contentEditable = 'true';
        if (focus) requestAnimationFrame(() => it.el.focus());
      } else if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
      style(it);
    }
    placeGrip();
    showSel();
  }
  function removeItem(it) {
    const pg = S.pages[it.page - 1];
    pg.items = pg.items.filter((x) => x !== it);
    it.el.remove();
    if (it.cover) it.cover.remove();
    if (S.sel === it) { S.sel = null; showSel(); }
    placeGrip();
  }

  const hexOk = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
  const TITLES = { text: 'Texto', image: 'Imagen', line: 'Línea', rect: 'Rectángulo', ellipse: 'Elipse', link: 'Zona con enlace' };
  function showSel() {
    const it = S.sel;
    $('selBox').hidden = !it;
    if (!it) return;
    const t = it.type;
    $('selTitle').textContent = TITLES[t];
    $('selInfo').textContent = t === 'text' ? (it.isNew ? 'Nuevo' : it.source === 'ocr' ? `OCR · hoja ${it.page}` : `Hoja ${it.page}`) : `Hoja ${it.page}`;
    document.querySelectorAll('.sel-part').forEach((p) => {
      p.hidden = !(p.dataset.for === 'text' ? t === 'text' : ['line', 'rect', 'ellipse'].includes(t));
    });
    if (t === 'text') {
      $('selSize').value = Math.round(it.size * 2) / 2;
      $('selColor').value = hexOk(it.color, '#000000');
      $('selBg').value = hexOk(it.bg, '#ffffff');
      $('selBgField').hidden = it.isNew;
      $('selBold').checked = it.bold;
      $('selItalic').checked = it.italic;
      $('selBold').disabled = $('selItalic').disabled = !!it.font;
      document.querySelectorAll('input[name=selStd]').forEach((r) => { r.checked = !it.font && r.value === it.family; });
      fontPicker.select(it.font);
      $('curFont').textContent = it.font ? '· ' + it.font : '';
    } else if (t !== 'image' && t !== 'link') {
      $('shStroke').value = hexOk(it.stroke, '#1b1f3b');
      $('shWidth').value = it.width;
      $('shDash').checked = !!it.dash;
      $('shFillRow').hidden = t === 'line';
      $('shFillOn').checked = !!it.fill;
      $('shFill').value = hexOk(it.fill, '#fde68a');
    }
    $('selLink').value = it.link || '';
    $('selReset').hidden = t !== 'text' || it.isNew;
    $('selDelete').querySelector('span').textContent = t === 'text' && !it.isNew ? 'Borrar texto' : 'Quitar';
  }

  function editSel(fn, soon = false) {
    const it = S.sel;
    if (!it) return;
    fn(it);
    style(it);
    soon ? commitSoon() : commit();
    refresh();
  }
  $('selSize').addEventListener('input', () => editSel((it) => { const v = parseFloat($('selSize').value); if (v >= 3 && v <= 300) it.size = v; }, true));
  $('selColor').addEventListener('input', () => editSel((it) => { it.color = $('selColor').value; }, true));
  $('selBg').addEventListener('input', () => editSel((it) => { it.bg = $('selBg').value; }, true));
  $('selBold').addEventListener('change', () => editSel((it) => { it.bold = $('selBold').checked; }));
  $('selItalic').addEventListener('change', () => editSel((it) => { it.italic = $('selItalic').checked; }));
  document.querySelectorAll('input[name=selStd]').forEach((r) => r.addEventListener('change', () => editSel((it) => {
    it.family = r.value;
    it.font = null;
    showSel();
  })));
  const fontPicker = F.fontList($('selFonts'), (name) => editSel((it) => {
    if (it.type !== 'text') return;
    it.font = name;
    showSel();
  }));
  $('shStroke').addEventListener('input', () => editSel((it) => { it.stroke = $('shStroke').value; }, true));
  $('shWidth').addEventListener('input', () => editSel((it) => { const v = parseFloat($('shWidth').value); if (v >= 0 && v <= 40) it.width = v; }, true));
  $('shDash').addEventListener('change', () => editSel((it) => { it.dash = $('shDash').checked; }));
  $('shFillOn').addEventListener('change', () => editSel((it) => { it.fill = $('shFillOn').checked ? $('shFill').value : null; }));
  $('shFill').addEventListener('input', () => editSel((it) => { $('shFillOn').checked = true; it.fill = $('shFill').value; }, true));
  $('selLink').addEventListener('input', () => editSel((it) => { it.link = $('selLink').value.trim(); }, true));

  $('selDelete').onclick = deleteSel;
  function deleteSel() {
    const it = S.sel;
    if (!it) return;
    if (it.type === 'text' && !it.isNew) {
      // Texto del PDF: se tapa (se puede restaurar)
      it.deleted = true;
      it.text = '';
      it.el.textContent = '';
      style(it);
    } else {
      removeItem(it);
    }
    commit();
    refresh();
  }
  $('selReset').onclick = () => {
    const it = S.sel;
    if (!it || it.type !== 'text' || it.isNew) return;
    Object.assign(it, it.origStyle, { text: it.orig, deleted: false, x: it.ox, top: it.otop, base: it.obase });
    it.el.textContent = it.orig;
    style(it);
    showSel();
    commit();
    refresh();
  };

  // ---------- Herramientas ----------
  function setTool(t) {
    S.tool = t && S.tool !== t ? t : null;
    document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)));
    document.body.classList.toggle('tool-on', !!S.tool);
    const tips = { text: 'Haz clic en la hoja donde quieras el texto.', line: 'Arrastra sobre la hoja para dibujar la línea (Mayús = recta).', rect: 'Arrastra sobre la hoja para dibujar el rectángulo.', ellipse: 'Arrastra sobre la hoja para dibujar la elipse.', link: 'Arrastra sobre lo que quieras convertir en enlace.' };
    status(S.tool ? tips[S.tool] : '');
  }
  document.querySelectorAll('.tool-btn[data-tool]').forEach((b) => b.addEventListener('click', () => { if (S.doc) setTool(b.dataset.tool); }));

  const pagePoint = (e, pg) => {
    const r = pg.layer.getBoundingClientRect();
    return { x: (e.clientX - r.left) / pg.scale, y: (e.clientY - r.top) / pg.scale };
  };
  const clampTo = (pg, p) => ({ x: Math.min(pg.view.width, Math.max(0, p.x)), y: Math.min(pg.view.height, Math.max(0, p.y)) });

  // Clic en la hoja: usa la herramienta activa o quita la selección
  function onLayerDown(e, pg) {
    if (e.button !== 0) return;
    if (!S.tool) { select(null); return; }
    e.preventDefault();
    const p0 = pagePoint(e, pg), tool = S.tool;
    if (tool === 'text') {
      const size = 14;
      const it = addItem(pg, textItem({
        source: 'new', isNew: true, x: p0.x, top: p0.y - size * 0.6, base: p0.y + size * 0.2, w: 40, h: size * 1.15, size,
        text: '', orig: '', family: 'sans', bold: false, italic: false, color: '#000000', bg: null,
      }));
      setTool(null);
      select(it);
      return;
    }
    const it = tool === 'line'
      ? { type: 'line', x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y, stroke: '#1b1f3b', width: 1.5, dash: false, link: '' }
      : { type: tool, x: p0.x, top: p0.y, w: 0, h: 0, stroke: '#1b1f3b', width: tool === 'link' ? 0 : 1.5, dash: false, fill: null, link: '' };
    addItem(pg, it);
    dragOn((ev) => {
      const p = clampTo(pg, pagePoint(ev, pg));
      if (tool === 'line') {
        let { x, y } = p;
        // Mayús: horizontal, vertical o a 45°
        if (ev.shiftKey) {
          const dx = x - p0.x, dy = y - p0.y, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
          x = p0.x + Math.cos(a) * len; y = p0.y + Math.sin(a) * len;
        }
        it.x2 = x; it.y2 = y;
      } else {
        it.x = Math.min(p0.x, p.x); it.top = Math.min(p0.y, p.y);
        it.w = Math.abs(p.x - p0.x); it.h = Math.abs(p.y - p0.y);
        if (ev.shiftKey && tool !== 'link') { const m = Math.max(it.w, it.h); it.w = it.h = m; }
      }
      place(it);
    }, () => {
      const tiny = tool === 'line' ? Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 3 : it.w < 3 || it.h < 3;
      if (tiny) {
        // Un clic sin arrastrar: tamaño por defecto
        if (tool === 'line') { it.x2 = it.x1 + 120; it.y2 = it.y1; } else { it.w = tool === 'link' ? 120 : 100; it.h = tool === 'link' ? 20 : 70; }
        place(it);
      }
      setTool(null);
      select(it);
      commit();
      if (tool === 'link') requestAnimationFrame(() => $('selLink').focus());
      refresh();
    });
  }

  // Arrastre con el puntero (se sigue en toda la ventana)
  function dragOn(move, end) {
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      end(ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // Mover / cambiar tamaño de un objeto
  function onObjDown(e, it, fromGrip = false) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (S.tool) setTool(null);
    const pg = S.pages[it.page - 1];
    select(it, !fromGrip);
    // El texto se edita con clic; se mueve con su manija (o arrastrándolo con Alt)
    if (it.type === 'text' && !e.altKey && !fromGrip) return;
    e.preventDefault();
    const h = e.target.closest('.hd');
    const p0 = pagePoint(e, pg), start = toData(it);
    let moved = false;
    dragOn((ev) => {
      const p = pagePoint(ev, pg), dx = p.x - p0.x, dy = p.y - p0.y;
      if (!moved && Math.hypot(dx, dy) * pg.scale < 3) return;
      moved = true;
      if (h && h.classList.contains('hd-a')) { it.x1 = start.x1 + dx; it.y1 = start.y1 + dy; }
      else if (h && h.classList.contains('hd-b')) { it.x2 = start.x2 + dx; it.y2 = start.y2 + dy; }
      else if (h && h.classList.contains('hd-br')) {
        it.w = Math.max(4, start.w + dx);
        it.h = Math.max(4, start.h + dy);
        // Las imágenes mantienen su proporción (Mayús para deformar)
        if (it.type === 'image' && !ev.shiftKey) it.h = it.w * start.h / start.w;
      } else if (it.type === 'line') {
        it.x1 = start.x1 + dx; it.y1 = start.y1 + dy; it.x2 = start.x2 + dx; it.y2 = start.y2 + dy;
      } else if (it.type === 'text') {
        it.x = start.x + dx; it.top = start.top + dy; it.base = start.base + dy;
      } else {
        it.x = start.x + dx; it.top = start.top + dy;
      }
      style(it);
    }, () => { if (moved) { commit(); refresh(); } });
  }

  // ---------- Imágenes ----------
  $('addImage').onclick = () => { if (S.doc) $('imageFile').click(); };
  $('imageFile').addEventListener('change', (e) => { addImageFile(e.target.files[0]); e.target.value = ''; });
  async function addImageFile(file, pg = null) {
    if (!file || !S.doc) return;
    status('Añadiendo imagen…');
    try {
      let bytes = new Uint8Array(await file.arrayBuffer());
      let type = /png/i.test(file.type) ? 'png' : /jpe?g/i.test(file.type) ? 'jpg' : null;
      const bmp = await createImageBitmap(file);
      const iw = bmp.width, ih = bmp.height;
      if (!type) {
        // Formatos que el PDF no admite (WebP, GIF, BMP…) → PNG
        const c = document.createElement('canvas');
        c.width = iw; c.height = ih;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        bytes = new Uint8Array(await blob.arrayBuffer());
        type = 'png';
      }
      const id = 'img' + nextId++;
      S.images[id] = { bytes, type, url: URL.createObjectURL(new Blob([bytes], { type: type === 'png' ? 'image/png' : 'image/jpeg' })), w: iw, h: ih };
      pg = pg || (S.sel ? S.pages[S.sel.page - 1] : currentPage());
      // Centrada en la parte visible de la hoja, a lo más la mitad del ancho
      const w = Math.min(pg.view.width * 0.5, iw * 0.75), h = w * ih / iw;
      const R = scroller.getBoundingClientRect(), r = pg.el.getBoundingClientRect();
      const cy = Math.min(pg.view.height - h / 2, Math.max(h / 2, ((R.top + R.bottom) / 2 - r.top) / pg.scale));
      const it = addItem(pg, { type: 'image', img: id, x: (pg.view.width - w) / 2, top: cy - h / 2, w, h, link: '' });
      select(it);
      commit();
      status('');
    } catch (err) {
      status('No se pudo añadir la imagen: ' + err.message);
    }
    refresh();
  }
  document.addEventListener('paste', (e) => {
    if (!S.doc || (e.target.closest && e.target.closest('input, textarea, [contenteditable=true], [contenteditable=plaintext-only]'))) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); addImageFile(item.getAsFile()); }
  });

  // ---------- Copiar todo el texto ----------
  $('copyText').onclick = async () => {
    if (!S.doc) return;
    status('Reuniendo el texto…');
    for (const pg of S.pages) if (!pg.extracted) await extract(pg);
    const text = S.pages.map((pg) => {
      const its = pg.items.filter((it) => it.type === 'text' && !it.deleted && it.text.trim())
        .sort((a, b) => (Math.abs(a.base - b.base) < 2 ? a.x - b.x : a.base - b.base));
      let out = '', lastBase = null;
      for (const it of its) {
        if (lastBase !== null) out += Math.abs(it.base - lastBase) < 2 ? ' ' : '\n';
        out += it.text;
        lastBase = it.base;
      }
      return out;
    }).join('\n\n');
    try { await navigator.clipboard.writeText(text); status(text.trim() ? 'Texto copiado.' : 'Este PDF no tiene texto: prueba con el OCR.'); } catch { status('No se pudo copiar al portapapeles.'); }
  };

  // ---------- OCR ----------
  let ocrWorker = null, ocrLang = '';
  let ocrBase = 0, ocrSpan = 1;
  const setBar = (v) => { $('ocrBar').style.width = Math.round(v * 100) + '%'; };
  async function getOcr(lang) {
    if (ocrWorker && ocrLang === lang) return ocrWorker;
    if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
    await loadScript(V('tesseract/tesseract.min.js'));
    ocrWorker = await Tesseract.createWorker(lang.split('+'), 1, {
      workerPath: V('tesseract/worker.min.js'),
      corePath: V('tesseract/core'),
      langPath: V('tesseract/lang'),
      logger: (m) => {
        if (m.status === 'recognizing text') setBar(ocrBase + m.progress * ocrSpan);
        else if (/load|initializ/i.test(m.status)) $('ocrInfo').textContent = 'Preparando el reconocimiento…';
      },
    });
    ocrLang = lang;
    return ocrWorker;
  }

  async function ocr(pages) {
    if (!S.doc || !pages.length) return;
    ['ocrPage', 'ocrAll'].forEach((id) => { $(id).disabled = true; });
    $('ocrProgress').hidden = false;
    setBar(0);
    let found = 0;
    try {
      const w = await getOcr($('ocrLang').value);
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        ocrBase = i / pages.length; ocrSpan = 1 / pages.length;
        $('ocrInfo').textContent = `Reconociendo la hoja ${pg.num}${pages.length > 1 ? ` (${i + 1} de ${pages.length})` : ''}…`;
        if (!pg.extracted) await extract(pg);
        // Unos 200 ppp: suficiente para el OCR sin gastar demasiada memoria
        const k = Math.min(3, 4000 / Math.max(pg.view.width, pg.view.height));
        const vp = pg.page.getViewport({ scale: k });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await pg.page.render({ canvasContext: g, viewport: vp, canvas: c }).promise;
        const { data } = await w.recognize(c, {}, { blocks: true });
        // Se reemplaza lo que se haya reconocido antes en esta hoja (si no se editó)
        pg.items.filter((it) => it.source === 'ocr' && !changed(it)).forEach(removeItem);
        const known = pg.items.filter((it) => it.type === 'text');
        for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const ln of p.lines || []) {
          const text = (ln.text || '').trim();
          if (!text || (ln.confidence != null && ln.confidence < 35)) continue;
          const bb = ln.bbox, x = bb.x0 / k, top = bb.y0 / k, w2 = (bb.x1 - bb.x0) / k, h = (bb.y1 - bb.y0) / k;
          // Si el PDF ya trae ese texto, no se duplica
          if (known.some((it) => overlap(it, { x, top, w: w2, h }) > 0.5)) continue;
          const bl = ln.baseline && ln.baseline.has_baseline !== false ? ln.baseline : null;
          const base = bl ? bl.y0 / k : top + h * 0.8;
          const size = Math.max(4, (base - top) / 0.74);
          const it = addItem(pg, textItem({
            source: 'ocr', x, top: base - size * 0.8, base, w: w2, h: size * 1.05, size, text, orig: text,
            family: 'sans', bold: false, italic: false,
          }));
          sample(it, c, k);
          style(it);
          found++;
        }
      }
      setBar(1);
      commit();
      $('ocrInfo').textContent = found
        ? `Listo: ${found} ${found === 1 ? 'línea reconocida' : 'líneas reconocidas'}. Haz clic en una para editarla.`
        : 'No se encontró texto nuevo en ' + (pages.length === 1 ? 'esta hoja.' : 'estas hojas.');
    } catch (err) {
      $('ocrInfo').textContent = 'No se pudo hacer el OCR: ' + (err && err.message || err);
    }
    $('ocrProgress').hidden = true;
    refresh();
  }
  function overlap(a, b) {
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.top + a.h, b.top + b.h) - Math.max(a.top, b.top));
    return (ix * iy) / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  }
  // Hoja que más se ve en pantalla
  function currentPage() {
    const R = scroller.getBoundingClientRect();
    let best = S.pages[0], bv = -Infinity;
    for (const pg of S.pages) {
      const r = pg.el.getBoundingClientRect();
      const v = Math.min(r.bottom, R.bottom) - Math.max(r.top, R.top);
      if (v > bv) { bv = v; best = pg; }
    }
    return best;
  }
  $('ocrPage').onclick = () => { const pg = S.sel ? S.pages[S.sel.page - 1] : currentPage(); if (pg) ocr([pg]); };
  $('ocrAll').onclick = () => ocr(S.pages.slice());

  // ---------- Guardar ----------
  const STD = {
    sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  };
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  function linkUrl(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (/^[^\s@/:]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'mailto:' + v;
    if (/^(https?|mailto|tel):/i.test(v)) return v;
    return 'https://' + v;
  }
  // Caja visible de un texto (crece con lo escrito)
  function textBox(it) {
    const s = S.pages[it.page - 1].scale;
    return { x: it.x, top: parseFloat(it.el.style.top) / s, w: Math.max(it.w, it.el.offsetWidth / s), h: it.el.offsetHeight / s };
  }

  async function buildPdf() {
    if (commitTimer) commit();
    await loadScript(V('pdf-lib.min.js'));
    const { PDFDocument, StandardFonts, rgb, degrees, PDFString } = PDFLib;
    const doc = await PDFDocument.load(S.bytes, { ignoreEncryption: true });
    const fonts = {}, warn = new Set();
    async function fontFor(it) {
      let key = it.font;
      if (key && !fonts[key] && !warn.has(key)) {
        let f = null;
        try {
          const buf = await F.bytes(key);
          if (buf) {
            await loadScript(V('fontkit.umd.min.js'));
            doc.registerFontkit(window.fontkit);
            f = await doc.embedFont(buf, { subset: true });
          }
        } catch {}
        if (f) fonts[key] = { f, chars: new Set(f.getCharacterSet()) };
        else warn.add(key);
      }
      if (!key || !fonts[key]) {
        key = STD[it.family || 'sans'][(it.bold ? 1 : 0) + (it.italic ? 2 : 0)];
        if (!fonts[key]) {
          const sf = await doc.embedFont(StandardFonts[key]);
          fonts[key] = { f: sf, chars: new Set(sf.getCharacterSet()) };
        }
      }
      return fonts[key];
    }

    for (const pg of S.pages) {
      const its = pg.items.filter((it) => changed(it) || it.link);
      if (!its.length) continue;
      const page = doc.getPage(pg.num - 1), vp = pg.view;
      const P = (x, y) => vp.convertToPdfPoint(x, y);
      // Ángulo del eje x de la vista dentro del PDF (hojas giradas)
      const [ox, oy] = P(0, 0), [dx, dy] = P(10, 0);
      const ang = degrees(Math.atan2(dy - oy, dx - ox) * 180 / Math.PI);
      const rect = (x, top, w, h) => { const [ax, ay] = P(x, top), [bx, by] = P(x + w, top + h); return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]; };
      const col = (hex) => { const [r, g, b] = rgbOf(hex); return rgb(r, g, b); };
      const dashOf = (it) => (it.dash && it.width ? [it.width * 3, it.width * 2] : undefined);

      // 1) Tapa el texto original que se reescribe (donde se leyó, aunque se haya movido)
      for (const it of its) {
        if (it.type !== 'text' || it.isNew || !changed(it)) continue;
        ensureColors(it);
        const pad = Math.max(0.6, it.origStyle.size * 0.06);
        const [a0, b0, a1, b1] = rect(it.ox - pad, it.otop - pad, it.w + 2 * pad, it.h + 2 * pad);
        page.drawRectangle({ x: a0, y: b0, width: a1 - a0, height: b1 - b0, color: col(it.bg || '#ffffff') });
      }
      // 2) Objetos en su orden (lo último, encima)
      for (const it of its) {
        if (it.type === 'text') {
          if (!changed(it) || it.deleted || !it.text.trim()) continue;
          const { f, chars } = await fontFor(it);
          it.text.split('\n').forEach((line, i) => {
            // Caracteres que la fuente no tiene → ?
            const safe = [...line].map((ch) => (chars.has(ch.codePointAt(0)) ? ch : '?')).join('');
            const [x, y] = P(it.x, it.base + i * it.size * 1.2);
            page.drawText(safe, { x, y, size: it.size, font: f, color: col(it.color || '#000000'), rotate: ang });
          });
        } else if (it.type === 'image') {
          const im = S.images[it.img];
          const emb = im.type === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
          const [x, y] = P(it.x, it.top + it.h);
          page.drawImage(emb, { x, y, width: it.w, height: it.h, rotate: ang });
        } else if (it.type === 'line') {
          if (!it.width) continue;
          const [x1, y1] = P(it.x1, it.y1), [x2, y2] = P(it.x2, it.y2);
          page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: it.width, color: col(it.stroke), lineCap: 1, dashArray: dashOf(it) });
        } else if (it.type === 'rect') {
          if (!it.fill && !it.width) continue;
          const [x, y] = P(it.x, it.top + it.h);
          page.drawRectangle({
            x, y, width: it.w, height: it.h, rotate: ang,
            color: it.fill ? col(it.fill) : undefined,
            borderColor: it.width ? col(it.stroke) : undefined, borderWidth: it.width || 0, borderDashArray: dashOf(it),
          });
        } else if (it.type === 'ellipse') {
          if (!it.fill && !it.width) continue;
          const [cx, cy] = P(it.x + it.w / 2, it.top + it.h / 2);
          page.drawEllipse({
            x: cx, y: cy, xScale: it.w / 2, yScale: it.h / 2, rotate: ang,
            color: it.fill ? col(it.fill) : undefined,
            borderColor: it.width ? col(it.stroke) : undefined, borderWidth: it.width || 0, borderDashArray: dashOf(it),
          });
        }
      }
      // 3) Enlaces: una anotación sobre la caja de cada objeto que tenga uno
      for (const it of its) {
        const url = linkUrl(it.link);
        if (!url) continue;
        const b = it.type === 'line'
          ? { x: Math.min(it.x1, it.x2) - 3, top: Math.min(it.y1, it.y2) - 3, w: Math.abs(it.x2 - it.x1) + 6, h: Math.abs(it.y2 - it.y1) + 6 }
          : it.type === 'text' ? textBox(it) : it;
        const annot = doc.context.obj({
          Type: 'Annot', Subtype: 'Link', Rect: rect(b.x, b.top, b.w, b.h), Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
        });
        page.node.addAnnot(doc.context.register(annot));
      }
    }
    if (warn.size) status(`Estas fuentes no se pueden incrustar en el PDF y se usó Helvetica: ${[...warn].join(', ')}.`);
    return doc.save();
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
  $('downloadPdf').onclick = async () => {
    if (!S.doc) return;
    const b = $('downloadPdf');
    b.classList.add('loading');
    status('Guardando cambios…');
    try {
      const bytes = await buildPdf();
      saveBlob(new Blob([bytes], { type: 'application/pdf' }), S.name + '-editado.pdf');
      if ($('status').textContent === 'Guardando cambios…') status('');
    } catch (err) { status('No se pudo guardar el PDF: ' + err.message); }
    b.classList.remove('loading');
  };
  $('openPdf').onclick = async () => {
    if (!S.doc) return;
    const win = window.open('', '_blank');
    if (win) win.document.write('<p style="font-family:sans-serif;padding:20px">Generando PDF…</p>');
    try {
      const blob = new Blob([await buildPdf()], { type: 'application/pdf' });
      if (win) win.location.href = URL.createObjectURL(blob); else saveBlob(blob, S.name + '-editado.pdf');
    } catch (err) { if (win) win.close(); status('No se pudo generar el PDF: ' + err.message); }
  };

  // ---------- Estado de los botones ----------
  function refresh() {
    const has = !!S.doc;
    $('empty').hidden = has;
    $('zoomBar').hidden = $('histBar').hidden = !has;
    ['openPdf', 'downloadPdf', 'ocrPage', 'ocrAll'].forEach((id) => { $(id).disabled = !has; });
    const edits = allItems().filter((it) => changed(it) || it.link).length;
    $('downloadPdf').querySelector('span').textContent = edits ? `Descargar PDF (${edits})` : 'Descargar PDF';
    updateHist();
  }

  // ---------- Teclado ----------
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    const inField = e.target.closest && e.target.closest('input, textarea, select');
    if (mod && !inField && (k === 'z' || k === 'y')) {
      // También dentro del texto que se edita: un solo historial para todo
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    const editing = document.activeElement && document.activeElement.isContentEditable;
    if (inField || editing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); deleteSel(); }
    if (e.key === 'Escape') { if (S.tool) setTool(null); else select(null); }
    // Flechas: mueve el objeto seleccionado (Mayús = más)
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && S.sel && S.sel.type !== 'text') {
      e.preventDefault();
      const [dx, dy] = arrows[e.key].map((v) => v * (e.shiftKey ? 10 : 1));
      const it = S.sel;
      if (it.type === 'line') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; } else { it.x += dx; it.top += dy; }
      place(it);
      commitSoon();
    }
  });

  // ---------- Carga, zoom y panel ----------
  $('file').addEventListener('change', (e) => { openFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); openFile(e.dataTransfer.files[0]); });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (!f) return;
    // Una imagen soltada sobre una hoja se inserta ahí; un PDF se abre
    if (/^image\//.test(f.type) && S.doc) {
      const li = e.target.closest && e.target.closest('.pdf-sheet');
      addImageFile(f, li ? S.pages[+li.dataset.n - 1] : null);
    } else openFile(f);
  });

  const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];
  function setZoom(z) {
    const mid = scroller.scrollTop + scroller.clientHeight / 2, ratio = mid / Math.max(1, scroller.scrollHeight);
    S.zoom = z;
    layoutPages();
    scroller.scrollTop = ratio * scroller.scrollHeight - scroller.clientHeight / 2;
  }
  $('zoomIn').onclick = () => setZoom(ZOOMS.find((z) => z > S.zoom + 0.01) || S.zoom);
  $('zoomOut').onclick = () => setZoom([...ZOOMS].reverse().find((z) => z < S.zoom - 0.01) || S.zoom);
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !S.doc) return;
    e.preventDefault();
    (e.deltaY < 0 ? $('zoomIn') : $('zoomOut')).click();
  }, { passive: false });

  let lastW = 0;
  new ResizeObserver(() => {
    if (Math.abs(scroller.clientWidth - lastW) < 2) return;
    lastW = scroller.clientWidth;
    if (S.pages.length) layoutPages();
  }).observe(scroller);

  function setCollapsed(on) {
    document.body.classList.toggle('collapsed', on);
    $('togglePanel').setAttribute('aria-expanded', String(!on));
    $('togglePanel').title = on ? 'Mostrar configuración' : 'Ocultar configuración';
    try { localStorage.setItem('pdfPanelCollapsed', on ? '1' : '0'); } catch {}
  }
  $('togglePanel').onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));
  try { if (localStorage.getItem('pdfPanelCollapsed') === '1') setCollapsed(true); } catch {}
  $('showBoxes').addEventListener('change', () => document.body.classList.toggle('hide-boxes', !$('showBoxes').checked));

  window.addEventListener('beforeunload', (e) => {
    if (hpos > 0) { e.preventDefault(); e.returnValue = ''; }
  });
  refresh();
})();
