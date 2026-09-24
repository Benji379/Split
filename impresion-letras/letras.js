// Letras para imprimir: letras, números o frases, para colorear (contorno) o recortar (relleno).
// Todo se calcula en milímetros; las medidas del texto se toman a K px por mm.
(() => {
  const $ = (id) => document.getElementById(id);
  const F = window.SplitFonts;
  const STORE = 'lettersSettings2'; // v2: nuevos valores por defecto
  const K = 4;            // px por mm al medir
  const MAX_ITEMS = 1000;
  const DRAG_THRESHOLD = 5;

  const opts = { font: F.FONTS.find((f) => !f.custom).name, color: '#1b1f3b' };
  const radio = (name) => document.querySelector(`input[name=${name}]:checked`).value;
  const clamp = (v, min, max, def) => (isNaN(v) ? def : Math.min(max, Math.max(min, v)));
  const num = (id, min, max, def) => clamp(parseFloat($(id).value), min, max, def);
  const cm = (mm) => (mm / 10).toLocaleString('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const locked = () => $('abcLock').getAttribute('aria-pressed') === 'true';

  // ---------- Ajustes ----------
  function baseSettings() {
    const [a, b] = $('abcPaper').value.split('x').map(Number);
    const land = $('abcOrient').value === 'landscape';
    const pageW = land ? Math.max(a, b) : Math.min(a, b);
    const pageH = land ? Math.min(a, b) : Math.max(a, b);
    const margin = num('abcMargin', 0, Math.min(pageW, pageH) / 3, 1);
    const style = radio('abcStyle');
    return {
      ...opts,
      kind: radio('abcKind'), layout: radio('abcLayout'), align: radio('abcAlign'), style,
      pageW, pageH, margin, printW: pageW - 2 * margin, printH: pageH - 2 * margin,
      heightMm: num('abcHeight', 0.5, 1000, 2) * 10,
      strokeMm: style === 'outline' ? num('abcStroke', 0.1, 20, 1.2) : 0,
      gap: num('abcGap', 0, 200, 5),
      gapY: num('abcGapY', 0, 200, 5),
      track: num('letterSp', -20, 200, 0), // mm extra entre letras
      lineH: num('lineH', 0.5, 10, 1.2),
      wordSp: num('wordSp', 0, 20, 1),
      dpi: parseInt($('abcDpi').value, 10),
      showMargin: $('abcShowMargin').checked,
      sx: 1,
    };
  }

  // Con el candado abierto, el ancho elegido estira las letras en horizontal
  function settings() {
    const S = baseSettings();
    if (!locked()) {
      const w0 = refWidth(S);
      if (w0) S.sx = clamp(num('abcWidth', 0.2, 2000, 1) * 10 / w0, 0.05, 20, 1);
    }
    return S;
  }

  // Ancho natural (sin estirar) de la pieza más ancha, en mm: es lo que mide el campo "Ancho"
  function refWidth(S) {
    const s1 = { ...S, sx: 1 };
    const list = S.kind === 'words' ? $('wordsText').value.split(/\s+/).filter(Boolean) : items(S);
    let w = 0;
    for (const t of list.length ? list : ['H']) { const m = metrics(t, s1); w = Math.max(w, m.l + m.r - s1.strokeMm); }
    return w;
  }

  // Campos que se recuerdan en este navegador
  const SAVED = ['abcText', 'numFrom', 'numTo', 'numStep', 'wordsText', 'abcGap', 'abcGapY', 'letterSp', 'lineH', 'wordSp', 'abcStroke', 'abcHeight', 'abcWidth', 'abcMargin', 'abcPaper', 'abcOrient', 'abcDpi'];
  const RADIOS = ['abcKind', 'abcLayout', 'abcAlign', 'abcStyle'];
  // Todos los ajustes del panel (se guardan en el navegador y son cada paso de deshacer)
  function collect() {
    const d = { ...opts, numPad: $('numPad').checked, lock: locked(), showMargin: $('abcShowMargin').checked };
    for (const id of SAVED) d[id] = $(id).value;
    for (const r of RADIOS) d[r] = radio(r);
    return d;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(collect())); } catch {}
  }
  function restore() {
    let d;
    try { d = JSON.parse(localStorage.getItem(STORE)); } catch {}
    if (d) apply(d);
  }
  function setLock(on) {
    $('abcLock').setAttribute('aria-pressed', String(on));
    $('abcLock').title = on
      ? 'Mantener la proporción (quítalo para cambiar el alto y el ancho por separado)'
      : 'Alto y ancho por separado (actívalo para mantener la proporción)';
  }
  function apply(d) {
    if (F.FONTS.some((f) => f.name === d.font)) opts.font = d.font;
    if (/^#[0-9a-f]{6}$/i.test(d.color)) opts.color = d.color;
    $('numPad').checked = !!d.numPad;
    $('abcShowMargin').checked = d.showMargin !== false;
    setLock(d.lock !== false);
    for (const id of SAVED) {
      if (d[id] == null) continue;
      const el = $(id);
      if (el.tagName === 'SELECT') {
        if (![...el.options].some((o) => o.value === d[id])) continue;
        el.value = d[id];
        el.dispatchEvent(new Event('change')); // refresca el desplegable propio
      } else el.value = d[id];
    }
    for (const r of RADIOS) {
      const el = document.querySelector(`input[name=${r}][value="${d[r]}"]`);
      if (el) el.checked = true;
    }
  }

  // ---------- Qué se imprime ----------
  function items(S) {
    if (S.kind === 'letters') return [...$('abcText').value].filter((ch) => ch.trim()).slice(0, MAX_ITEMS);
    if (S.kind === 'numbers') {
      const a = Math.round(num('numFrom', -9999, 99999, 1)), b = Math.round(num('numTo', -9999, 99999, 10));
      const step = Math.max(1, Math.round(num('numStep', 1, 1000, 1))) * (a <= b ? 1 : -1);
      const out = [];
      for (let n = a; a <= b ? n <= b : n >= b; n += step) {
        out.push(n);
        if (out.length >= MAX_ITEMS) break;
      }
      const digits = Math.max(...out.map((n) => String(Math.abs(n)).length));
      return out.map((n) => ($('numPad').checked ? (n < 0 ? '-' : '') + String(Math.abs(n)).padStart(digits, '0') : String(n)));
    }
    return [];
  }

  // ---------- Medidas (mm) ----------
  const sizePx = (S, k) => S.heightMm * k / F.capRatio(S.font);
  const mCache = new Map();
  function metrics(t, S) {
    const key = [t, S.font, S.heightMm, S.strokeMm, S.sx, S.track].join('|');
    let m = mCache.get(key);
    if (!m) {
      const r = F.measure(t, S.font, sizePx(S, K), S.track * K / S.sx), s2 = S.strokeMm / 2, sx = S.sx;
      m = {
        adv: r.width / K * sx,
        l: r.left / K * sx + s2, r: r.right / K * sx + s2, a: r.ascent / K + s2, d: r.descent / K + s2,
        fa: r.fontAscent / K, fd: r.fontDescent / K,
      };
      if (mCache.size > 5000) mCache.clear();
      mCache.set(key, m);
    }
    return m;
  }

  // Cuánto hay que reducir una pieza para que quepa en el área imprimible
  const fitOf = (m, S) => Math.min(1, S.printW / (m.l + m.r), S.printH / (m.a + m.d));

  // ---------- Armado de hojas ----------
  // Hoja = { pieces: [{ t, x, y, f }], reduced }; (x, y) = origen del texto en su línea base, en mm
  function paginate(S) {
    if (S.kind === 'words') return paginateWords(S);
    const list = items(S);
    return S.layout === 'pack' ? paginatePack(list, S) : list.map((t) => single(t, S));
  }

  function single(t, S) {
    const m = metrics(t, S), f = fitOf(m, S);
    // Tinta centrada en la hoja
    const x = S.pageW / 2 - (m.r - m.l) * f / 2;
    const y = S.pageH / 2 + (m.a - m.d) * f / 2;
    return { pieces: [{ t, x, y, f }], reduced: f < 0.995 };
  }

  // Tantas piezas como quepan: filas de izquierda a derecha, alineadas por la línea base
  function paginatePack(list, S) {
    const rows = [];
    let row = null;
    for (const t of list) {
      const m = metrics(t, S), f = fitOf(m, S), w = (m.l + m.r) * f;
      if (!row || (row.items.length && row.w + S.gap + w > S.printW)) {
        row = { items: [], w: 0, a: 0, d: 0 };
        rows.push(row);
      }
      row.w += (row.items.length ? S.gap : 0) + w;
      row.items.push({ t, m, f, w });
      row.a = Math.max(row.a, m.a * f);
      row.d = Math.max(row.d, m.d * f);
    }
    const pages = [];
    let page = null;
    for (const r of rows) {
      const h = r.a + r.d;
      if (!page || page.h + S.gapY + h > S.printH) {
        page = { rows: [], h: -S.gapY };
        pages.push(page);
      }
      page.rows.push(r);
      page.h += S.gapY + h;
    }
    return pages.map((p) => {
      const pieces = [];
      let top = S.margin + (S.printH - p.h) / 2, reduced = false;
      for (const r of p.rows) {
        let x = S.margin + (S.printW - r.w) / 2;
        for (const it of r.items) {
          pieces.push({ t: it.t, x: x + it.m.l * it.f, y: top + r.a, f: it.f });
          if (it.f < 0.995) reduced = true;
          x += it.w + S.gap;
        }
        top += r.a + r.d + S.gapY;
      }
      return { pieces, reduced };
    });
  }

  // Frases: se parten en líneas que caben a lo ancho y las líneas en hojas
  function paginateWords(S) {
    const text = $('wordsText').value;
    if (!text.trim()) return [];
    const sp = metrics(' ', S);
    const space = sp.adv * S.wordSp;
    const pitch = sizePx(S, 1) * S.lineH; // interlineado × tamaño de la letra, en mm
    const lines = [];
    for (const para of text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      let cur = { words: [], w: 0 };
      const push = () => { lines.push(cur); cur = { words: [], w: 0 }; };
      const place = (t) => {
        const w = metrics(t, S).adv;
        if (cur.words.length && cur.w + space + w > S.printW) push();
        cur.words.push({ t, x: cur.words.length ? cur.w + space : 0 });
        cur.w = (cur.words.length > 1 ? cur.w + space : 0) + w;
      };
      for (const word of words) {
        if (metrics(word, S).adv <= S.printW) { place(word); continue; }
        // Palabra más ancha que la hoja: se corta por letras
        let chunk = '';
        for (const ch of word) {
          if (chunk && metrics(chunk + ch, S).adv > S.printW) { place(chunk); chunk = ''; }
          chunk += ch;
        }
        if (chunk) place(chunk);
      }
      push(); // también las líneas vacías cuentan (Enter doble)
    }
    const top = S.margin + sp.fa + S.strokeMm / 2;
    const perPage = Math.max(1, Math.floor((S.printH - sp.fa - sp.fd - S.strokeMm) / pitch) + 1);
    const pages = [];
    for (let i = 0; i < lines.length; i += perPage) {
      const pieces = [];
      lines.slice(i, i + perPage).forEach((ln, j) => {
        const free = S.printW - ln.w;
        const x0 = S.margin + (S.align === 'center' ? free / 2 : S.align === 'right' ? free : 0);
        for (const w of ln.words) pieces.push({ t: w.t, x: x0 + w.x, y: top + j * pitch, f: 1 });
      });
      pages.push({ pieces, reduced: false });
    }
    // Sin hojas finales vacías (líneas en blanco al final del texto)
    while (pages.length && !pages.at(-1).pieces.length) pages.pop();
    return pages;
  }

  // Caja de tinta de una pieza (mm)
  function pieceBox(p, S) {
    const m = metrics(p.t, S);
    return { x: p.x - m.l * p.f, y: p.y - m.a * p.f, w: (m.l + m.r) * p.f, h: (m.a + m.d) * p.f };
  }

  // ---------- Dibujo ----------
  function drawPieces(g, page, S, k, ox = 0, oy = 0) {
    for (const p of page.pieces) {
      const c = F.textCanvas({
        text: p.t, font: S.font, color: S.color, style: S.style,
        size: sizePx(S, k) * p.f, stroke: S.strokeMm * k, align: 'left', scaleX: S.sx, tracking: S.track * k * p.f / S.sx,
      });
      if (c) g.drawImage(c, (p.x - ox) * k - c.originX, (p.y - oy) * k - c.baseline);
    }
  }

  // Caja de tinta de la hoja (mm), para no guardar blanco de más en el PDF
  function inkBox(page, S) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of page.pieces) {
      const b = pieceBox(p, S);
      x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w);
      y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.h);
    }
    if (!isFinite(x0)) return null;
    const pad = 1;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(S.pageW, x1 + pad); y1 = Math.min(S.pageH, y1 + pad);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Hoja completa en un canvas del ancho CSS que tenga
  function paintSlide(cv, page, S, guide = true) {
    const dpr = window.devicePixelRatio || 1;
    const wCss = cv.clientWidth || 300;
    const k = wCss / S.pageW * dpr;
    cv.width = Math.round(S.pageW * k);
    cv.height = Math.round(S.pageH * k);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    if (guide && S.showMargin && S.margin > 0) {
      // Margen pintado, solo en pantalla (en el papel queda en blanco)
      g.fillStyle = 'rgba(79,70,229,.1)';
      g.beginPath();
      g.rect(0, 0, cv.width, cv.height);
      g.rect(S.margin * k, S.margin * k, S.printW * k, S.printH * k);
      g.fill('evenodd');
      g.strokeStyle = 'rgba(79,70,229,.35)';
      g.setLineDash([4 * dpr, 4 * dpr]);
      g.lineWidth = dpr;
      g.strokeRect(S.margin * k, S.margin * k, S.printW * k, S.printH * k);
      g.setLineDash([]);
    }
    drawPieces(g, page, S, k);
    cv.dataset.painted = '1';
  }

  // ---------- Vista previa: miniaturas a la izquierda + todas las hojas en una columna con scroll ----------
  const deck = $('deck'), list = $('slides'), thumbs = $('thumbs'), thumbList = $('thumbList');
  let pages = [], order = [], S = null, queued = false;

  const pageKey = (p) => p.pieces.map((x) => x.t).join('\u0001');
  // Claves únicas aunque se repita el contenido (dos hojas con "A")
  function keysOf(ps) {
    const seen = {};
    return ps.map((p) => { const k = pageKey(p); seen[k] = (seen[k] || 0) + 1; return k + '#' + seen[k]; });
  }

  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(async () => {
      queued = false;
      await F.load(opts.font);
      build();
    });
  }

  // Solo se dibujan las hojas que están a la vista
  const lazy = (root) => new IntersectionObserver((entries) => {
    for (const e of entries) {
      const cv = e.target;
      if (!e.isIntersecting || cv.dataset.painted) continue;
      const page = pages[+cv.closest('[data-i]').dataset.i];
      if (page) paintSlide(cv, page, S, cv.dataset.guide !== '0');
    }
  }, { root, rootMargin: '400px 0px' });
  const ioMain = lazy(deck), ioThumbs = lazy(thumbs);

  function build() {
    S = settings();
    syncControls();
    let ps = paginate(S);
    // Se mantiene el orden elegido a mano mientras las hojas sean las mismas
    const keys = keysOf(ps);
    if (order.length === keys.length && keys.every((k) => order.includes(k))) {
      const byKey = new Map(keys.map((k, i) => [k, ps[i]]));
      ps = order.map((k) => byKey.get(k));
    } else {
      order = keys;
    }
    pages = ps;

    ioMain.disconnect();
    ioThumbs.disconnect();
    list.innerHTML = '';
    thumbList.innerHTML = '';
    const ratio = `${S.pageW} / ${S.pageH}`;
    let reduced = 0;
    pages.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'deck-slide';
      li.dataset.i = i;
      li.dataset.key = order[i];
      const one = p.pieces.length === 1 ? pieceBox(p.pieces[0], S) : null;
      li.innerHTML = `<div class="deck-head">
          <svg class="deck-grip" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>
          <span class="deck-num">Hoja ${i + 1}</span>
          <span class="deck-meta">${one ? `alto ${cm(one.h - S.strokeMm)} · ancho ${cm(one.w - S.strokeMm)} cm` : `${p.pieces.length} ${S.kind === 'words' ? 'palabras' : 'piezas'}`}</span>
          <span class="deck-flag"${p.reduced ? '' : ' hidden'}>reducida para caber</span>
        </div>
        <canvas></canvas>`;
      li.querySelector('canvas').style.aspectRatio = ratio;
      if (p.reduced) reduced++;
      list.appendChild(li);

      const th = document.createElement('li');
      th.className = 'thumb';
      th.dataset.i = i;
      th.tabIndex = 0;
      th.setAttribute('aria-label', `Ir a la hoja ${i + 1}`);
      th.innerHTML = `<span class="thumb-num">${i + 1}</span><canvas data-guide="0"></canvas>`;
      th.querySelector('canvas').style.aspectRatio = ratio;
      thumbList.appendChild(th);
    });
    list.querySelectorAll('canvas').forEach((cv) => ioMain.observe(cv));
    thumbList.querySelectorAll('canvas').forEach((cv) => ioThumbs.observe(cv));

    const n = pages.length;
    $('empty').style.display = n ? 'none' : 'flex';
    $('abcOpen').disabled = $('abcDownload').disabled = !n;
    $('deckCount').textContent = n ? `${n} ${n === 1 ? 'hoja' : 'hojas'}` : '';
    $('status').textContent = n
      ? `${n} ${n === 1 ? 'hoja' : 'hojas'}` + (reduced ? ` · ${reduced} con piezas reducidas para caber` : '')
      : '';
    showSizes();
    markActive();
    if (!hist.length) commit(); // estado inicial
  }

  // Medidas reales de las letras, en la barra de arriba
  function showSizes() {
    let hMin = Infinity, hMax = 0, wMin = Infinity, wMax = 0;
    for (const p of pages) for (const q of p.pieces) {
      const b = pieceBox(q, S), sw = S.strokeMm;
      // Sin el grosor del contorno: es la medida de la letra
      hMin = Math.min(hMin, b.h - sw); hMax = Math.max(hMax, b.h - sw);
      wMin = Math.min(wMin, b.w - sw); wMax = Math.max(wMax, b.w - sw);
    }
    const range = (a, b) => (Math.abs(a - b) < 0.5 ? `${cm(a)} cm` : `${cm(a)} a ${cm(b)} cm`);
    const what = S.kind === 'words' ? 'Palabras' : S.kind === 'numbers' ? 'Números' : 'Letras';
    $('deckSize').innerHTML = isFinite(hMin)
      ? `${what}: <b>alto ${range(hMin, hMax)}</b> · <b>ancho ${range(wMin, wMax)}</b>`
      : '';
    // Con el candado cerrado el ancho sigue al alto
    if (locked() && document.activeElement !== $('abcWidth')) {
      $('abcWidth').value = (refWidth(S) / 10).toFixed(1);
    }
  }

  // Vuelve a dibujar (p. ej. cuando cambia el ancho)
  function repaint(container, io) {
    container.querySelectorAll('canvas').forEach((cv) => { delete cv.dataset.painted; io.unobserve(cv); io.observe(cv); });
  }
  let lastW = 0;
  new ResizeObserver(() => {
    const w = list.clientWidth;
    if (Math.abs(w - lastW) > 2) { lastW = w; repaint(list, ioMain); }
  }).observe(list);

  // Miniatura activa = la hoja que se ve arriba en la columna
  function markActive() {
    const top = deck.getBoundingClientRect().top + 60;
    let cur = 0;
    list.querySelectorAll('.deck-slide').forEach((li, i) => { if (li.getBoundingClientRect().top <= top) cur = i; });
    thumbList.querySelectorAll('.thumb').forEach((th, i) => {
      const on = i === cur;
      if (on && !th.classList.contains('active')) {
        th.classList.add('active');
        th.scrollIntoView({ block: 'nearest' });
      } else if (!on) th.classList.remove('active');
    });
  }
  deck.addEventListener('scroll', () => requestAnimationFrame(markActive), { passive: true });

  const goTo = (i) => list.children[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  thumbList.addEventListener('click', (e) => {
    const th = e.target.closest('.thumb');
    if (th && performance.now() > suppressClick) goTo(+th.dataset.i);
  });
  thumbList.addEventListener('keydown', (e) => {
    const th = e.target.closest('.thumb');
    if (!th) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(+th.dataset.i); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (e.key === 'ArrowDown' ? th.nextElementSibling : th.previousElementSibling)?.focus();
    }
  });

  // Tamaño de la letra bajo el puntero, en tiempo real
  const tip = $('pieceTip');
  list.addEventListener('pointermove', (e) => {
    const cv = e.target.closest('canvas');
    if (!cv || document.body.classList.contains('dragging-layer')) { tip.hidden = true; return; }
    const page = pages[+cv.closest('.deck-slide').dataset.i];
    const r = cv.getBoundingClientRect(), k = r.width / S.pageW;
    const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
    const p = page && page.pieces.find((q) => { const b = pieceBox(q, S); return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; });
    if (!p) { tip.hidden = true; return; }
    const b = pieceBox(p, S);
    tip.innerHTML = `<b></b> alto ${cm(b.h - S.strokeMm)} · ancho ${cm(b.w - S.strokeMm)} cm`;
    tip.querySelector('b').textContent = p.t;
    tip.hidden = false;
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
  });
  list.addEventListener('pointerleave', () => { tip.hidden = true; });

  // Muestra solo los controles que aplican
  function syncControls() {
    document.querySelectorAll('.kind').forEach((el) => { el.hidden = el.dataset.kind !== S.kind; });
    document.querySelectorAll('.dist').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(S.kind); });
    $('gapField').hidden = S.layout !== 'pack';
    $('layoutHint').textContent = S.layout === 'pack'
      ? 'Se acomodan en cada hoja todas las piezas que quepan según su tamaño.'
      : 'Una pieza por hoja, centrada.';
    $('strokeField').style.visibility = S.style === 'outline' ? 'visible' : 'hidden';
    $('abcFit').hidden = S.kind === 'words';
    $('trackField').hidden = S.kind === 'letters'; // cada pieza es una letra: entre piezas manda la separación horizontal
  }

  // ---------- Reordenar arrastrando (eventos de puntero, ver docs 0020) ----------
  // Sirve igual para la columna grande y para las miniaturas
  let suppressClick = 0;
  function sortable(container, scroller, itemSel, floatClass) {
    container.addEventListener('pointerdown', (e) => {
      const li = e.target.closest(itemSel);
      // Ni botón derecho ni el dedo: con el dedo la columna se desplaza
      if (!li || e.button !== 0 || e.pointerType === 'touch') return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      let lifted = false, float = null, gap = null, grabX = 0, grabY = 0, lastX = sx, lastY = sy, raf = 0;

      // Delante del primer elemento cuya mitad quede por debajo del puntero; si ninguno, al final.
      // El que viaja nunca cuenta como referencia.
      // En cuadrícula se lee como un texto: filas de arriba abajo y, en la fila, la mitad izquierda de cada hoja.
      const placeGap = (px, py) => {
        const grid = container.classList.contains('grid');
        const next = [...container.querySelectorAll(itemSel)].find((x) => {
          if (x === li) return false;
          const r = x.getBoundingClientRect();
          if (!grid) return r.top + r.height / 2 > py;
          return py < r.top || (py <= r.bottom && px < r.left + r.width / 2);
        });
        container.insertBefore(gap, next || null);
      };
      // Cerca de los bordes, la columna se desplaza sola
      const autoScroll = () => {
        const r = scroller.getBoundingClientRect(), edge = 60;
        const v = lastY < r.top + edge ? -(r.top + edge - lastY) : lastY > r.bottom - edge ? lastY - (r.bottom - edge) : 0;
        if (v) { scroller.scrollTop += v * 0.35; placeGap(lastX, lastY); }
        raf = requestAnimationFrame(autoScroll);
      };
      const onMove = (ev) => {
        lastX = ev.clientX; lastY = ev.clientY;
        if (!lifted) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
          lifted = true;
          tip.hidden = true;
          const r = li.getBoundingClientRect();
          grabX = sx - r.left; grabY = sy - r.top; // se conserva el punto de agarre
          float = li.cloneNode(true);
          float.classList.add(floatClass);
          float.style.width = r.width + 'px';
          const src = li.querySelector('canvas'), dst = float.querySelector('canvas');
          dst.width = src.width; dst.height = src.height;
          dst.getContext('2d').drawImage(src, 0, 0);
          document.body.appendChild(float);
          gap = document.createElement('li');
          gap.className = 'slide-gap';
          gap.style.height = r.height + 'px';
          if (container.classList.contains('grid')) {
            gap.style.width = r.width + 'px';
            float.classList.add('from-grid');
          }
          container.insertBefore(gap, li);
          li.hidden = true; // está en la mano, no en la columna
          document.body.classList.add('dragging-layer');
          raf = requestAnimationFrame(autoScroll);
        }
        float.style.left = ev.clientX - grabX + 'px';
        float.style.top = ev.clientY - grabY + 'px';
        placeGap(ev.clientX, ev.clientY);
      };
      const stop = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', stop);
        window.removeEventListener('keydown', onKey, true);
        if (!lifted) return;
        suppressClick = performance.now() + 300;
        cancelAnimationFrame(raf);
        float.remove();
        gap.remove();
        li.hidden = false;
        document.body.classList.remove('dragging-layer');
      };
      const onUp = (ev) => {
        if (!lifted) return stop(); // era un clic
        placeGap(ev.clientX, ev.clientY); // el destino final sale del propio pointerup
        const from = +li.dataset.i;
        const to = [...container.children].filter((x) => x !== li).indexOf(gap);
        stop();
        if (to === from) return; // soltarla donde estaba no es un cambio
        const [k] = order.splice(from, 1);
        order.splice(to, 0, k);
        build();
        commit(); // cambiar el orden es un paso de deshacer
      };
      const onKey = (ev) => {
        if (ev.key !== 'Escape' || !lifted) return;
        ev.preventDefault();
        ev.stopPropagation();
        stop();
      };
      // En window y desde ya: un gesto rápido no debe perder el pointerup
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', stop);
      window.addEventListener('keydown', onKey, true);
    });
  }
  sortable(list, deck, '.deck-slide', 'slide-float');
  sortable(thumbList, thumbs, '.thumb', 'thumb-float');

  // ---------- Vista: una columna o cuadrícula (todas las hojas, como el clasificador de PowerPoint) ----------
  function setView(v) {
    const grid = v === 'grid';
    list.classList.toggle('grid', grid);
    document.body.classList.toggle('deck-grid', grid);
    document.querySelectorAll('.deck-views button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    try { localStorage.setItem('lettersView', v); } catch {}
    lastW = list.clientWidth;
    repaint(list, ioMain); // cambia el tamaño de cada hoja
  }
  document.querySelectorAll('.deck-views button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  // Doble clic en la cuadrícula: abre esa hoja en la columna
  list.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.deck-slide');
    if (!li || !list.classList.contains('grid')) return;
    setView('column');
    requestAnimationFrame(() => list.children[+li.dataset.i]?.scrollIntoView({ block: 'start' }));
  });
  try { if (localStorage.getItem('lettersView') === 'grid') setView('grid'); } catch {}

  // ---------- Minimizar panel ----------
  function setCollapsed(on) {
    document.body.classList.toggle('collapsed', on);
    $('togglePanel').setAttribute('aria-expanded', String(!on));
    $('togglePanel').title = on ? 'Mostrar configuración' : 'Ocultar configuración';
    try { localStorage.setItem('lettersPanelCollapsed', on ? '1' : '0'); } catch {}
  }
  $('togglePanel').onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));
  try { if (localStorage.getItem('lettersPanelCollapsed') === '1') setCollapsed(true); } catch {}

  // ---------- Controles ----------
  const fonts = F.fontList($('abcFonts'), (font) => {
    opts.font = font;
    fonts.select(font);
    changed();
  });

  function changed() { save(); refresh(); scheduleCommit(); }

  // ---------- Deshacer / rehacer ----------
  // Cada paso guarda los ajustes y el orden de las hojas
  const hist = [];
  let hpos = -1, htimer = 0;
  const snapKey = () => JSON.stringify({ d: collect(), order });
  function commit() {
    clearTimeout(htimer);
    if (document.querySelector('.font-dialog[open]')) return;
    const k = snapKey();
    if (hist[hpos] === k) return;
    hist.splice(hpos + 1);
    hist.push(k);
    if (hist.length > 100) hist.shift();
    hpos = hist.length - 1;
    updateHistButtons();
  }
  // Tras armar las hojas (el orden depende de los ajustes)
  function scheduleCommit(ms = 450) { clearTimeout(htimer); htimer = setTimeout(commit, ms); }
  async function goHist(pos) {
    hpos = pos;
    const { d, order: o } = JSON.parse(hist[hpos]);
    apply(d);
    order = o;
    $('abcColor').value = opts.color;
    fonts.select(opts.font);
    save();
    await F.load(opts.font);
    build();
    updateHistButtons();
  }
  function undo() { commit(); if (hpos > 0) goHist(hpos - 1); }
  function redo() { commit(); if (hpos < hist.length - 1) goHist(hpos + 1); }
  function updateHistButtons() {
    $('undo').disabled = hpos <= 0;
    $('redo').disabled = hpos >= hist.length - 1;
  }
  $('undo').onclick = undo;
  $('redo').onclick = redo;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || document.querySelector('dialog[open]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  document.querySelector('.panel').addEventListener('input', (e) => {
    if (e.target.closest('.font-picker')) return; // el buscador de fuentes no cambia las hojas
    if (e.target.id === 'abcColor') opts.color = e.target.value;
    // Con el candado cerrado, cambiar el ancho cambia el alto en la misma proporción
    if (e.target.id === 'abcWidth' && locked()) {
      const w = parseFloat(e.target.value), w0 = refWidth(baseSettings());
      if (w > 0 && w0 > 0) $('abcHeight').value = (num('abcHeight', 0.5, 1000, 2) * w * 10 / w0).toFixed(2).replace(/\.?0+$/, '');
    }
    changed();
  });
  document.querySelector('.panel').addEventListener('change', (e) => {
    if (e.target.closest('.font-picker')) return;
    changed();
  });
  $('abcWidth').addEventListener('blur', () => showSizes());
  $('abcLock').onclick = () => {
    const on = !locked();
    setLock(on);
    if (on) $('abcWidth').value = (refWidth(baseSettings()) / 10).toFixed(1); // vuelve a la proporción natural
    changed();
  };
  document.querySelectorAll('.chip[data-set]').forEach((b) => b.addEventListener('click', () => {
    $('abcText').value = b.dataset.set;
    changed();
    if (!b.dataset.set) $('abcText').focus();
  }));

  // Alto más grande con el que cada pieza cabe sola en una hoja
  $('abcFit').onclick = async () => {
    await F.load(opts.font);
    const s = { ...settings(), heightMm: 100 };
    const its = items(s);
    let best = Infinity;
    for (const t of its.length ? its : ['H']) {
      const m = metrics(t, s);
      best = Math.min(best, 100 * Math.min(s.printW / (m.l + m.r), s.printH / (m.a + m.d)));
    }
    if (!isFinite(best)) return;
    const h = Math.max(0.5, Math.floor(best / 10 * 2) / 2);
    if (!locked()) $('abcWidth').value = (num('abcWidth', 0.2, 2000, 1) * h / num('abcHeight', 0.5, 1000, 2)).toFixed(1);
    $('abcHeight').value = h.toFixed(1); // cm, en medios
    changed();
  };

  // ---------- PDF ----------
  const tick = () => new Promise((r) => setTimeout(r));
  const orientationOf = (s) => (s.pageW > s.pageH ? 'landscape' : 'portrait');
  function newPdf(s) {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ orientation: orientationOf(s), unit: 'mm', format: [s.pageW, s.pageH], compress: true });
  }

  // Una hoja en la página actual del PDF
  function drawPage(pdf, page, s, cv) {
    const B = inkBox(page, s);
    if (!B) return;
    const k = s.dpi / 25.4;
    // Solo la zona con tinta, sobre blanco (el JPEG no guarda transparencia)
    cv.width = Math.max(1, Math.round(B.w * k));
    cv.height = Math.max(1, Math.round(B.h * k));
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cv.width, cv.height);
    drawPieces(g, page, s, k, B.x, B.y);
    pdf.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', B.x, B.y, B.w, B.h, undefined, 'FAST');
  }

  async function buildPdf(idx = pages.map((_, i) => i)) {
    await F.load(opts.font);
    const s = S, pdf = newPdf(s), cv = document.createElement('canvas');
    for (let n = 0; n < idx.length; n++) {
      $('status').textContent = `Generando hoja ${n + 1} de ${idx.length}…`;
      await tick();
      if (n > 0) pdf.addPage([s.pageW, s.pageH], orientationOf(s));
      drawPage(pdf, pages[idx[n]], s, cv);
    }
    build(); // devuelve el resumen al estado
    return pdf;
  }

  async function buildZip(idx) {
    await F.load(opts.font);
    const s = S, zip = new JSZip(), cv = document.createElement('canvas'), base = fileBase();
    for (let n = 0; n < idx.length; n++) {
      $('status').textContent = `Generando hoja ${n + 1} de ${idx.length}…`;
      await tick();
      const pdf = newPdf(s);
      drawPage(pdf, pages[idx[n]], s, cv);
      zip.file(`${base}-hoja-${String(idx[n] + 1).padStart(2, '0')}.pdf`, pdf.output('arraybuffer'));
    }
    $('status').textContent = 'Comprimiendo .zip…';
    const blob = await zip.generateAsync({ type: 'blob' });
    build();
    return blob;
  }

  const fileBase = () => {
    const src = S.kind === 'words' ? $('wordsText').value : pages.map(pageKey).join('');
    return 'letras-' + (src.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20) || 'hojas');
  };

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  $('abcOpen').onclick = async () => {
    if (!pages.length) return;
    const win = window.open('', '_blank'); // se abre ya para que el navegador no la bloquee
    if (win) win.document.write('<p style="font-family:sans-serif;padding:20px">Generando PDF…</p>');
    try {
      const pdf = await buildPdf();
      const url = URL.createObjectURL(pdf.output('blob'));
      if (win) win.location.href = url;
      else pdf.save(fileBase() + '.pdf');
    } catch (err) {
      if (win) win.close();
      $('status').textContent = 'Error al generar el PDF: ' + err.message;
    }
  };

  // ---------- Diálogo de descarga (igual que en el póster) ----------
  const dlg = $('dlDialog');
  let dlSelected = new Set();
  const ioDl = lazy($('dlGrid').parentElement);

  function updateDlSummary() {
    const n = dlSelected.size, total = pages.length;
    $('dlCount').textContent = `${n} de ${total} ${total === 1 ? 'hoja seleccionada' : 'hojas seleccionadas'}`;
    $('dlAll').textContent = n === total ? 'Quitar todas' : 'Seleccionar todas';
    $('dlGo').disabled = n === 0;
    document.querySelectorAll('#dlGrid .slide').forEach((el) => {
      const on = dlSelected.has(+el.dataset.i);
      el.classList.toggle('selected', on);
      el.setAttribute('aria-checked', String(on));
    });
  }

  $('abcDownload').onclick = () => {
    if (!pages.length) return;
    dlSelected = new Set(pages.map((_, i) => i)); // por defecto: todas
    document.querySelector('input[name=dlFormat][value=pdf]').checked = true;
    const grid = $('dlGrid');
    ioDl.disconnect();
    grid.innerHTML = '';
    grid.style.setProperty('--cols', 5);
    pages.forEach((p, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slide';
      el.dataset.i = i;
      el.setAttribute('role', 'checkbox');
      const what = p.pieces.length === 1 ? p.pieces[0].t : `${p.pieces.length} ${S.kind === 'words' ? 'palabras' : 'piezas'}`;
      el.innerHTML = `<span class="slide-check"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
        <canvas data-guide="0"></canvas>
        <span class="slide-label"><b>Hoja ${i + 1}</b><span></span></span>`;
      el.querySelector('.slide-label span').textContent = what;
      el.querySelector('canvas').style.aspectRatio = `${S.pageW} / ${S.pageH}`;
      el.addEventListener('click', () => {
        dlSelected.has(i) ? dlSelected.delete(i) : dlSelected.add(i);
        updateDlSummary();
      });
      grid.appendChild(el);
    });
    updateDlSummary();
    dlg.showModal();
    grid.querySelectorAll('canvas').forEach((cv) => ioDl.observe(cv));
  };
  $('dlAll').onclick = () => {
    dlSelected = dlSelected.size === pages.length ? new Set() : new Set(pages.map((_, i) => i));
    updateDlSummary();
  };
  $('dlCancel').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  $('dlGo').onclick = async () => {
    const idx = [...dlSelected].sort((a, b) => a - b);
    const asZip = document.querySelector('input[name=dlFormat]:checked').value === 'zip';
    const go = $('dlGo');
    go.disabled = true;
    go.classList.add('loading');
    try {
      if (asZip) saveBlob(await buildZip(idx), fileBase() + '.zip');
      else (await buildPdf(idx)).save(fileBase() + '.pdf');
      dlg.close();
    } catch (err) {
      $('status').textContent = 'Error al generar la descarga: ' + err.message;
    } finally {
      go.disabled = false;
      go.classList.remove('loading');
    }
  };

  // ---------- Inicio ----------
  restore();
  $('abcColor').value = opts.color;
  fonts.select(opts.font);
  refresh();
  // Las fuentes propias de otras visitas llegan después
  F.ready.then(() => {
    try {
      const d = JSON.parse(localStorage.getItem(STORE));
      if (d && d.font !== opts.font && F.FONTS.some((f) => f.name === d.font)) {
        opts.font = d.font;
        fonts.select(opts.font);
        refresh();
      }
    } catch {}
  });
})();
