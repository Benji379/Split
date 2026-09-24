// Fuentes para textos y letras. Las incluidas se sirven desde fonts/ (sin CDN) y se cargan solo al usarlas.
// También se pueden añadir fuentes propias: un enlace de Google Fonts o un archivo .ttf/.otf/.woff/.woff2.
// Lo comparten el póster (capas de texto) y /impresion-letras.
(() => {
  const script = document.currentScript;
  const base = new URL('fonts/', script ? script.src : location.href).href;
  const STORE_LINKS = 'splitFontLinks';

  // Cada fuente es una variante concreta: { name (clave única y texto visible), family, weight, style, file?, source }
  const FONTS = [
    ['Luckiest Guy', 'LuckiestGuy-Regular.ttf'],
    ['Bubblegum Sans', 'BubblegumSans-Regular.ttf'],
    ['Modak', 'Modak-Regular.ttf'],
    ['Sniglet', 'Sniglet-ExtraBold.ttf'],
    ['Baltimore Typewriter', 'BaltimoreTypewriter-Beveled.ttf'],
    ['Titan One', 'TitanOne-Regular.ttf'],
    ['Chewy', 'Chewy-Regular.ttf'],
    ['Bowlby One', 'BowlbyOne-Regular.ttf'],
    ['Londrina Solid', 'LondrinaSolid-Black.ttf'],
    ['Poppins Black', 'Poppins-Black.ttf'],
    ['Anton', 'Anton-Regular.ttf'],
    ['Bebas Neue', 'BebasNeue-Regular.ttf'],
    ['Bungee', 'Bungee-Regular.ttf'],
    ['Rubik Mono One', 'RubikMonoOne-Regular.ttf'],
    ['Righteous', 'Righteous-Regular.ttf'],
    ['Abril Fatface', 'AbrilFatface-Regular.ttf'],
    ['Shrikhand', 'Shrikhand-Regular.ttf'],
    ['Lobster', 'Lobster-Regular.ttf'],
    ['Pacifico', 'Pacifico-Regular.ttf'],
    ['Great Vibes', 'GreatVibes-Regular.ttf'],
    ['Permanent Marker', 'PermanentMarker-Regular.ttf'],
    ['Amatic SC', 'AmaticSC-Bold.ttf'],
    ['Special Elite', 'SpecialElite-Regular.ttf'],
    ['Arial Black', null],
    ['Impact', null],
    ['Georgia', null],
    ['Comic Sans MS', null],
  ].map(([name, file]) => ({ name, file, family: file ? `Split ${name}` : name, weight: 400, style: 'normal', source: file ? 'file' : 'system' }));

  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());

  const byName = (name) => FONTS.find((f) => f.name === name) || FONTS.find((f) => !f.custom);
  const css = (name) => `"${byName(name).family}", sans-serif`;
  // Cadena para canvas: estilo, peso, tamaño y familia
  const fontString = (name, size) => {
    const f = byName(name);
    return `${f.style === 'italic' ? 'italic ' : ''}${f.weight} ${size}px ${css(name)}`;
  };

  // ---------- Carga ----------
  function load(name) {
    const f = byName(name);
    if (f.source === 'system') return Promise.resolve();
    if (!f.ready) {
      let p;
      if (f.source === 'file') {
        p = new FontFace(f.family, `url("${base}${f.file}")`).load().then((ff) => document.fonts.add(ff));
      } else if (f.source === 'google') {
        p = googleSheet(f.url).then(() => document.fonts.load(fontString(f.name, 40)));
      } else {
        p = Promise.resolve(); // archivo subido: ya se cargó al añadirlo
      }
      f.ready = p.then(() => { f.loaded = true; }).catch(() => { f.ready = null; });
    }
    return f.ready;
  }
  const loadAll = () => Promise.all(FONTS.map((f) => load(f.name)));

  // Hoja de estilos de Google Fonts, una sola vez por enlace
  const sheets = {};
  function googleSheet(url) {
    return sheets[url] || (sheets[url] = new Promise((resolve, reject) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = url;
      l.onload = resolve;
      l.onerror = () => { delete sheets[url]; l.remove(); reject(new Error('No se pudo cargar el enlace de Google Fonts.')); };
      document.head.appendChild(l);
    }));
  }

  // Alto de las mayúsculas respecto al tamaño de la fuente (para medir letras en cm)
  const capCache = {};
  function capRatio(name) {
    if (capCache[name]) return capCache[name];
    const g = document.createElement('canvas').getContext('2d');
    g.font = fontString(name, 200);
    const r = g.measureText('H').actualBoundingBoxAscent / 200 || 0.7;
    if (byName(name).loaded || byName(name).source === 'system') capCache[name] = r;
    return r;
  }

  // ---------- Dibujo ----------
  // Texto dibujado en un canvas recortado a la tinta.
  // Coloca una línea: sin espacio entre letras va de una vez (conserva el kerning de la fuente);
  // con espacio, letra por letra. Devuelve los trozos, su caja de tinta y el ancho de avance.
  function lineLayout(g, t, tracking, align) {
    const runs = tracking ? [...t] : [t];
    const glyphs = [];
    let x = 0, left = Infinity, right = -Infinity, ascent = 0, descent = 0;
    runs.forEach((ch, i) => {
      const m = g.measureText(ch);
      glyphs.push({ ch, x });
      if (ch.trim()) {
        left = Math.min(left, x - m.actualBoundingBoxLeft);
        right = Math.max(right, x + m.actualBoundingBoxRight);
        ascent = Math.max(ascent, m.actualBoundingBoxAscent);
        descent = Math.max(descent, m.actualBoundingBoxDescent);
      }
      x += m.width + (i < runs.length - 1 ? tracking : 0);
    });
    const shift = align === 'center' ? -x / 2 : 0;
    glyphs.forEach((q) => { q.x += shift; });
    return { glyphs, width: x, left: left + shift, right: right + shift, ascent, descent };
  }

  // o: { text, font, color, style: 'fill' | 'outline', size (px), stroke (px), align: 'center' | 'left', scaleX,
  //      lineHeight (× tamaño, 1.15 por defecto), tracking (px de espacio extra entre letras) }
  // El canvas trae originX / baseline: dónde cae el punto de anclaje de la primera línea.
  function textCanvas(o) {
    const c = document.createElement('canvas');
    let g = c.getContext('2d');
    const font = fontString(o.font, o.size);
    const align = o.align || 'center';
    const sx = o.scaleX || 1; // estiramiento horizontal (ancho independiente del alto)
    const lh = o.size * (o.lineHeight || 1.15);
    g.font = font;
    g.textAlign = 'left';
    const lines = String(o.text).split('\n').map((t) => (t.trim() ? lineLayout(g, t, o.tracking || 0, align) : null));
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    lines.forEach((L, i) => {
      if (!L) return;
      const y = i * lh;
      top = Math.min(top, y - L.ascent);
      bottom = Math.max(bottom, y + L.descent);
      left = Math.min(left, L.left * sx);
      right = Math.max(right, L.right * sx);
    });
    if (!isFinite(top)) return null; // solo espacios
    const stroke = o.style === 'outline' ? o.stroke || o.size * 0.03 : 0;
    const pad = Math.ceil(stroke / 2 + 2);
    c.width = Math.max(1, Math.ceil(right - left + 2 * pad));
    c.height = Math.max(1, Math.ceil(bottom - top + 2 * pad));
    g = c.getContext('2d'); // al cambiar el tamaño se reinicia el estado
    g.font = font;
    g.textAlign = 'left';
    c.originX = pad - left;
    c.baseline = pad - top;
    g.translate(c.originX, c.baseline);
    g.scale(sx, 1);
    g.lineJoin = 'round';
    g.lineWidth = stroke;
    g.strokeStyle = g.fillStyle = o.color || '#000';
    lines.forEach((L, i) => {
      if (!L) return;
      for (const q of L.glyphs) {
        if (!q.ch.trim()) continue;
        if (stroke) g.strokeText(q.ch, q.x, i * lh);
        else g.fillText(q.ch, q.x, i * lh);
      }
    });
    return c;
  }

  // Medidas del texto (px) a un tamaño dado, sin dibujarlo; tracking = espacio extra entre letras (px)
  const measureCtx = document.createElement('canvas').getContext('2d');
  function measure(text, name, size, tracking = 0) {
    measureCtx.font = fontString(name, size);
    measureCtx.textAlign = 'left';
    const m = measureCtx.measureText(text);
    const L = tracking ? lineLayout(measureCtx, text, tracking, 'left') : null;
    return {
      width: L ? L.width : m.width,
      left: L && isFinite(L.left) ? -L.left : m.actualBoundingBoxLeft,
      right: L && isFinite(L.right) ? L.right : m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent,
      fontAscent: m.fontBoundingBoxAscent ?? size * 0.9, fontDescent: m.fontBoundingBoxDescent ?? size * 0.25,
    };
  }

  // ---------- Fuentes propias ----------
  const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const variantName = (family, weight, style) =>
    `${family}${weight === 400 && style === 'italic' ? '' : ' ' + (WEIGHT_NAMES[weight] || weight)}${style === 'italic' ? ' Italic' : ''}`;

  // Lee un <link> o una URL de Google Fonts y devuelve las familias con sus variantes
  function parseGoogle(input) {
    const text = String(input).trim();
    let url = (text.match(/https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s>]+/) || [])[0];
    if (!url) {
      // Página de la fuente: fonts.google.com/specimen/Nombre+Fuente
      const sp = text.match(/fonts\.google\.com\/specimen\/([^/?#\s"']+)/);
      if (!sp) return null;
      url = `https://fonts.googleapis.com/css2?family=${sp[1]}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
    }
    url = url.replace(/&amp;/g, '&');
    let u;
    try { u = new URL(url); } catch { return null; }
    const families = [];
    const v2 = u.pathname.endsWith('css2');
    for (const raw of v2 ? u.searchParams.getAll('family') : (u.searchParams.get('family') || '').split('|')) {
      if (!raw) continue;
      const [fam, spec = ''] = raw.split(':');
      const family = fam.replace(/\+/g, ' ').trim();
      const variants = [];
      const add = (w, st) => { if (w && !variants.some((v) => v.weight === w && v.style === st)) variants.push({ weight: w, style: st }); };
      const weights = (w) => {
        // "100..900" es un rango de fuente variable: se ofrecen los pesos de 100 en 100
        const [a, b] = w.split('..').map(Number);
        if (!b) return [a];
        const out = [];
        for (let x = Math.ceil(a / 100) * 100; x <= b; x += 100) out.push(x);
        return out;
      };
      if (v2 && spec.includes('@')) {
        const [axes, tuples] = spec.split('@');
        const names = axes.split(',');
        for (const t of tuples.split(';')) {
          const vals = t.split(',');
          const ital = names.includes('ital') ? vals[names.indexOf('ital')] === '1' : false;
          const w = names.includes('wght') ? vals[names.indexOf('wght')] : '400';
          for (const x of weights(w)) add(x, ital ? 'italic' : 'normal');
        }
      } else if (!v2 && spec) {
        // API antigua: Roboto:400,700italic
        for (const t of spec.split(',')) {
          const m = t.match(/^(\d+)?(i|italic)?$/);
          if (m) add(Number(m[1] || 400), m[2] ? 'italic' : 'normal');
          else if (/^(regular|italic|bold)/.test(t)) add(t.startsWith('bold') ? 700 : 400, t.includes('italic') ? 'italic' : 'normal');
        }
      }
      if (!variants.length) add(400, 'normal');
      variants.sort((a, b) => a.weight - b.weight || (a.style === 'italic') - (b.style === 'italic'));
      families.push({ family, variants });
    }
    if (!families.length) return null;
    if (!u.searchParams.has('display')) u.searchParams.set('display', 'swap');
    return { url: u.toString(), families };
  }

  // Añade los estilos elegidos (pick = nombres; null = todos) y recuerda el enlace
  function addGoogle(parsed, save = true, pick = null) {
    const fresh = [];
    for (const { family, variants } of parsed.families) {
      for (const v of variants) {
        const name = variantName(family, v.weight, v.style);
        if ((pick && !pick.includes(name)) || FONTS.some((f) => f.name === name)) continue;
        fresh.push({ name, family, weight: v.weight, style: v.style, source: 'google', url: parsed.url, custom: true });
      }
    }
    FONTS.unshift(...fresh); // al principio de la lista, en el orden del enlace
    if (save && fresh.length) {
      try {
        const links = savedLinks();
        const prev = links.find((l) => l.url === parsed.url);
        if (prev) prev.pick = prev.pick && pick ? [...new Set([...prev.pick, ...pick])] : null;
        else links.push({ url: parsed.url, pick });
        localStorage.setItem(STORE_LINKS, JSON.stringify(links));
      } catch {}
    }
    changed();
    return fresh;
  }
  function savedLinks() {
    try {
      // Antes se guardaba solo la URL
      return JSON.parse(localStorage.getItem(STORE_LINKS) || '[]').map((l) => (typeof l === 'string' ? { url: l, pick: null } : l));
    } catch { return []; }
  }

  // Nombre visible de una fuente subida (sin extensión ni guiones)
  function cleanName(s) {
    return String(s).replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Mi fuente';
  }

  // Archivo de fuente del usuario. Se guarda en este navegador (IndexedDB) para la próxima vez.
  let customN = 0;
  async function addFile(name, buf, save = true) {
    const clean = cleanName(name);
    const known = FONTS.find((f) => f.name === clean);
    if (known) return known;
    const family = `Split Custom ${++customN}`;
    const ff = await new FontFace(family, buf).load(); // falla si el archivo no es una fuente
    document.fonts.add(ff);
    const f = { name: clean, family, weight: 400, style: 'normal', source: 'upload', custom: true, loaded: true, ready: Promise.resolve() };
    FONTS.unshift(f);
    if (save) idb('readwrite', (st) => st.put({ name: clean, buf })).catch(() => {});
    changed();
    return f;
  }

  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('split-fonts', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'name' });
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('files', mode);
        const r = fn(tx.objectStore('files'));
        tx.oncomplete = () => resolve(r && r.result);
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  // Recupera las fuentes propias de visitas anteriores
  const ready = (async () => {
    try {
      for (const { url, pick } of savedLinks()) {
        const p = parseGoogle(url);
        if (p) addGoogle(p, false, pick);
      }
    } catch {}
    try {
      const files = await idb('readonly', (st) => st.getAll());
      for (const { name, buf } of files || []) await addFile(name, buf, false).catch(() => {});
    } catch {}
  })();

  // ---------- Lista de fuentes con buscador ----------
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function fontList(ul, onPick) {
    const box = document.createElement('div');
    box.className = 'font-picker';
    ul.parentNode.insertBefore(box, ul);
    const search = document.createElement('div');
    search.className = 'font-search';
    search.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
      '<input type="search" placeholder="Buscar fuente…" aria-label="Buscar fuente" autocomplete="off" spellcheck="false">';
    const empty = document.createElement('div');
    empty.className = 'font-empty';
    empty.hidden = true;
    empty.innerHTML = '<span></span><button type="button" class="btn btn-soft">Añadir fuente personalizada</button>';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'font-add';
    addBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Fuente personalizada</span><small>Google Fonts o archivo</small>';
    box.append(search, ul, empty, addBtn);
    ul.setAttribute('role', 'listbox');
    const q = search.querySelector('input');
    let selected = null;

    const openAdd = () => openDialog((f) => { if (f) { q.value = ''; filter(); onPick(f.name); } });
    addBtn.onclick = openAdd;
    empty.querySelector('button').onclick = openAdd;

    function build() {
      ul.innerHTML = '';
      let group = null;
      const hasCustom = FONTS.some((x) => x.custom);
      for (const f of FONTS) {
        const g = f.custom ? 'Tus fuentes' : 'Incluidas';
        if (hasCustom && g !== group) {
          group = g;
          const h = document.createElement('li');
          h.className = 'font-group';
          h.setAttribute('role', 'presentation');
          h.textContent = g;
          ul.appendChild(h);
        }
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.font = f.name;
        li.tabIndex = -1;
        li.innerHTML = '<span class="font-sample">Aa</span><span class="font-name"></span>';
        li.querySelector('.font-name').textContent = f.name;
        li.style.setProperty('--ff', css(f.name));
        li.style.setProperty('--fw', f.weight);
        li.style.setProperty('--fst', f.style);
        li.addEventListener('click', () => onPick(f.name));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(f.name); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            let n = li;
            do n = e.key === 'ArrowDown' ? n.nextElementSibling : n.previousElementSibling;
            while (n && (n.hidden || !n.dataset.font));
            if (n) n.focus();
            else if (e.key === 'ArrowUp') q.focus();
          }
        });
        ul.appendChild(li);
      }
      loadAll();
      filter();
      api.select(selected);
    }

    function filter() {
      const t = norm(q.value.trim());
      let shown = 0;
      for (const li of ul.children) {
        if (!li.dataset.font) { li.hidden = !!t; continue; } // sin títulos de grupo al buscar
        li.hidden = !!t && !norm(li.dataset.font).includes(t);
        if (!li.hidden) shown++;
      }
      ul.hidden = !shown;
      empty.hidden = !!shown;
      empty.querySelector('span').textContent = `No hay ninguna fuente llamada “${q.value.trim()}”.`;
    }
    q.addEventListener('input', filter);
    q.addEventListener('keydown', (e) => {
      const first = () => [...ul.children].find((li) => !li.hidden && li.dataset.font);
      if (e.key === 'ArrowDown') { e.preventDefault(); first()?.focus(); }
      if (e.key === 'Enter') { e.preventDefault(); const li = first(); if (li) onPick(li.dataset.font); }
    });

    const api = {
      select(name) {
        selected = name;
        for (const li of ul.children) {
          if (!li.dataset.font) continue;
          const on = li.dataset.font === name;
          li.setAttribute('aria-selected', String(on));
          li.tabIndex = on ? 0 : -1;
        }
      },
    };
    listeners.add(build);
    build();
    return api;
  }

  // ---------- Diálogo "Fuente personalizada" ----------
  // Se crea una vez y conserva lo pegado o subido hasta que se recarga la página.
  let dlg = null, dlgDone = null;
  function openDialog(done) {
    dlgDone = done;
    if (!dlg) dlg = makeDialog();
    dlg.refresh(); // marca como "añadida" lo que ya está en la lista
    dlg.showModal();
    dlg.focusMode();
  }

  // Estilos que la fuente trae de verdad: los que no, el navegador los imitaría y se verían repetidos
  function realVariants(family, variants) {
    const faces = [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === family);
    if (!faces.length) return variants;
    const num = (x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x));
    return variants.filter((v) => faces.some((f) => {
      const st = f.style === 'normal' ? 'normal' : 'italic';
      const [a, b = a] = String(f.weight).split(' ').map(num);
      return st === v.style && v.weight >= a && v.weight <= b;
    }));
  }

  // Nombre que trae la propia fuente (tabla "name" de TTF/OTF); null si no se puede leer
  function fontNameOf(buf) {
    try {
      const v = new DataView(buf);
      const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      const n = v.getUint16(4);
      let off = -1;
      for (let i = 0; i < n; i++) if (tag(12 + i * 16) === 'name') off = v.getUint32(12 + i * 16 + 8);
      if (off < 0) return null;
      const count = v.getUint16(off + 2), strings = off + v.getUint16(off + 4);
      const found = {};
      for (let i = 0; i < count; i++) {
        const r = off + 6 + i * 12;
        const platform = v.getUint16(r), id = v.getUint16(r + 6), len = v.getUint16(r + 8), o = strings + v.getUint16(r + 10);
        if (![1, 4, 16].includes(id) || found[id]) continue;
        let s = '';
        if (platform === 3 || platform === 0) for (let j = 0; j < len; j += 2) s += String.fromCharCode(v.getUint16(o + j));
        else if (platform === 1) for (let j = 0; j < len; j++) s += String.fromCharCode(v.getUint8(o + j));
        if (s.trim()) found[id] = s.trim();
      }
      return found[4] || found[16] || found[1] || null;
    } catch { return null; }
  }

  const STYLE_ES = (v) => `${WEIGHT_NAMES[v.weight] || v.weight}${v.style === 'italic' ? ' Italic' : ''}`;
  const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
  let previewN = 0;

  function makeDialog() {
    const d = document.createElement('dialog');
    d.className = 'dialog dialog-sm font-dialog';
    d.setAttribute('aria-label', 'Añadir fuente personalizada');
    d.innerHTML = `
      <div class="dialog-box">
        <div class="fd-head">
          <b>Añadir fuente personalizada</b>
          <button type="button" class="fd-x" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="fd-body">
          <div class="fd-modes" role="tablist">
            <button type="button" role="tab" data-mode="google" aria-selected="true">
              <svg viewBox="0 0 24 24"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>
              <span><b>Enlace de Google Fonts</b><small>Pega el &lt;link&gt; o la URL</small></span>
            </button>
            <button type="button" role="tab" data-mode="file" aria-selected="false">
              <svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 17l3-8 3 8M10 14h4"/></svg>
              <span><b>Archivo de fuente</b><small>.ttf, .otf, .woff, .woff2 o .zip</small></span>
            </button>
          </div>

          <div class="fd-pane" data-pane="google">
            <label class="field">Enlace de Google Fonts
              <textarea rows="3" spellcheck="false" placeholder="Pega aquí el &lt;link&gt; de Google Fonts, la URL fonts.googleapis.com/css2?family=… o la de fonts.google.com/specimen/…"></textarea>
            </label>
          </div>
          <div class="fd-pane" data-pane="file" hidden>
            <label class="drop fd-drop">
              <input type="file" accept=".ttf,.otf,.woff,.woff2,.zip" multiple>
              <svg class="drop-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
              <span class="drop-title">Elige o arrastra archivos de fuente</span>
              <span class="drop-sub">.ttf, .otf, .woff, .woff2 o un .zip (como los de DaFont) · se guardan solo en este navegador</span>
            </label>
            <p class="fd-note" hidden></p>
          </div>

          <div class="fd-preview" hidden>
            <div class="fd-tools">
              <label class="field fd-test">Texto de prueba
                <input type="text" value="Aa Bb Cc 123 — Hola mundo" spellcheck="false">
              </label>
              <div class="fd-sizes" role="radiogroup" aria-label="Tamaño de la muestra">
                <button type="button" data-size="18">A</button>
                <button type="button" data-size="26" aria-pressed="true">A</button>
                <button type="button" data-size="38">A</button>
              </div>
            </div>
            <div class="fd-found"></div>
          </div>
          <p class="fd-msg" aria-live="polite"></p>
        </div>
        <div class="fd-foot">
          <span class="fd-count"></span>
          <button type="button" class="btn fd-all" hidden>Añadir todas</button>
          <button type="button" class="btn btn-primary fd-add" disabled>Añadir seleccionadas</button>
        </div>
      </div>`;
    document.body.appendChild(d);
    const $q = (s) => d.querySelector(s);
    const ta = $q('textarea'), found = $q('.fd-found'), msg = $q('.fd-msg'), add = $q('.fd-add'), all = $q('.fd-all');
    const preview = $q('.fd-preview'), test = $q('.fd-test input'), note = $q('.fd-note');

    // Estado de cada modo (se conserva al cerrar y reabrir)
    let mode = 'google';
    const G = { parsed: null, shown: [], picked: new Set(), msg: '', seq: 0 };
    const Fl = { shown: [], picked: new Set(), msg: '', note: '' };
    const cur = () => (mode === 'google' ? G : Fl);
    let timer = 0;

    const finish = (f) => { d.close(); const cb = dlgDone; dlgDone = null; cb && cb(f); };
    $q('.fd-x').onclick = () => finish(null);
    d.addEventListener('click', (e) => { if (e.target === d) finish(null); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });

    const isAdded = (v) => FONTS.some((f) => f.name === v.name);
    const pickable = () => cur().shown.filter((v) => !isAdded(v));

    function setMode(m) {
      mode = m;
      d.querySelectorAll('.fd-modes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
      d.querySelectorAll('.fd-pane').forEach((p) => { p.hidden = p.dataset.pane !== m; });
      render();
    }
    d.querySelectorAll('.fd-modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

    function updateFoot() {
      const st = cur(), free = pickable().length;
      for (const v of [...st.picked]) if (!st.shown.some((x) => x.name === v && !isAdded(x))) st.picked.delete(v);
      add.disabled = !st.picked.size;
      add.textContent = st.picked.size ? `Añadir ${st.picked.size} ${st.picked.size === 1 ? 'seleccionada' : 'seleccionadas'}` : 'Añadir seleccionadas';
      all.hidden = free < 2;
      all.textContent = `Añadir todas (${free})`;
      $q('.fd-count').textContent = st.shown.length ? `${st.shown.length} ${st.shown.length === 1 ? 'estilo' : 'estilos'}` : '';
      found.querySelectorAll('.fd-family').forEach((fam) => {
        const boxes = [...fam.querySelectorAll('.fd-row:not(.added) input')];
        const t = fam.querySelector('.fd-toggle');
        t.hidden = boxes.length < 2;
        t.textContent = boxes.length && boxes.every((b) => b.checked) ? 'Quitar todas' : 'Elegir todas';
      });
    }

    // Filas de muestra agrupadas por familia; con varias familias, un desplegable elige cuál ver
    function render() {
      const st = cur();
      msg.textContent = st.msg;
      note.hidden = !(mode === 'file' && Fl.note);
      note.textContent = Fl.note;
      found.innerHTML = '';
      preview.hidden = !st.shown.length;
      const fams = [...new Set(st.shown.map((v) => v.group))];
      let visible = st.lastGroup && fams.includes(st.lastGroup) ? st.lastGroup : fams[0];
      if (fams.length > 1) {
        const wrap = document.createElement('label');
        wrap.className = 'field fd-famsel';
        wrap.textContent = mode === 'google' ? 'Familia' : 'Fuente';
        const sel = document.createElement('select');
        sel.id = 'fdGroup' + ++previewN;
        for (const g of fams) {
          const n = st.shown.filter((v) => v.group === g).length;
          const o = document.createElement('option');
          o.value = g;
          o.textContent = mode === 'google' ? `${g} · ${n} ${n === 1 ? 'estilo' : 'estilos'}` : g;
          sel.appendChild(o);
        }
        sel.value = visible;
        wrap.appendChild(sel);
        found.appendChild(wrap);
        sel.addEventListener('change', () => {
          st.lastGroup = sel.value;
          found.querySelectorAll('.fd-family').forEach((b) => { b.hidden = b.dataset.group !== sel.value; });
        });
        if (window.SplitUI) window.SplitUI.enhanceSelect(sel);
      }
      for (const g of fams) {
        const vars = st.shown.filter((v) => v.group === g);
        const box = document.createElement('div');
        box.className = 'fd-family';
        box.dataset.group = g;
        box.hidden = g !== visible;
        box.innerHTML = `<div class="fd-fam-head"><b></b><span></span><button type="button" class="link-btn fd-toggle"></button></div><div class="fd-rows"></div>`;
        box.querySelector('b').textContent = g;
        box.querySelector('.fd-fam-head span').textContent = `${vars.length} ${vars.length === 1 ? 'estilo' : 'estilos'}`;
        const rows = box.querySelector('.fd-rows');
        for (const v of vars) {
          const added = isAdded(v);
          const row = document.createElement('label');
          row.className = 'fd-row' + (added ? ' added' : '');
          row.innerHTML = `<input type="checkbox"${added ? ' checked disabled' : ''}><span class="fd-check"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>
            <span class="fd-sample"></span><span class="fd-style"></span>`;
          const sample = row.querySelector('.fd-sample');
          sample.textContent = test.value || ' ';
          sample.style.fontFamily = `"${v.family}", sans-serif`;
          sample.style.fontWeight = v.weight;
          sample.style.fontStyle = v.style;
          row.querySelector('.fd-style').textContent = (v.label || STYLE_ES(v)) + (added ? ' · añadida' : '');
          const cb = row.querySelector('input');
          if (!added) {
            cb.checked = st.picked.has(v.name);
            cb.addEventListener('change', () => { cb.checked ? st.picked.add(v.name) : st.picked.delete(v.name); updateFoot(); });
          }
          rows.appendChild(row);
        }
        box.querySelector('.fd-toggle').onclick = () => {
          const boxes = [...box.querySelectorAll('.fd-row:not(.added) input')];
          const on = !boxes.every((b) => b.checked);
          boxes.forEach((b) => { b.checked = on; b.dispatchEvent(new Event('change')); });
        };
        found.appendChild(box);
      }
      updateFoot();
    }

    // ----- Google Fonts: al pegar el enlace se carga la hoja y se muestran los estilos reales -----
    async function detect() {
      const my = ++G.seq;
      G.parsed = ta.value.trim() ? parseGoogle(ta.value) : null;
      G.shown = []; G.picked = new Set(); G.lastGroup = null;
      G.msg = ta.value.trim() && !G.parsed ? 'No encontré un enlace de Google Fonts en el texto.' : G.parsed ? 'Cargando la vista previa…' : '';
      render();
      if (!G.parsed) return;
      try {
        await googleSheet(G.parsed.url);
      } catch (err) {
        if (my === G.seq) { G.msg = err.message; render(); }
        return;
      }
      if (my !== G.seq) return;
      G.msg = '';
      for (const fam of G.parsed.families) {
        for (const v of realVariants(fam.family, fam.variants)) {
          G.shown.push({ group: fam.family, family: fam.family, weight: v.weight, style: v.style, name: variantName(fam.family, v.weight, v.style) });
        }
      }
      render();
    }
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(detect, 350); });
    ta.addEventListener('paste', () => { clearTimeout(timer); timer = setTimeout(detect, 0); });

    // ----- Archivos: fuentes sueltas o dentro de un .zip -----
    async function readFiles(fileList) {
      const entries = [], errors = [];
      Fl.note = '';
      Fl.msg = 'Leyendo archivos…';
      render();
      for (const file of fileList) {
        if (/\.zip$/i.test(file.name)) {
          if (!window.JSZip) { errors.push('No se pudo abrir el .zip en esta página.'); continue; }
          try {
            const zip = await JSZip.loadAsync(file);
            const inside = Object.values(zip.files).filter((z) => !z.dir && FONT_EXT.test(z.name) && !/(^|\/)__MACOSX\//.test(z.name));
            for (const z of inside) entries.push({ file: z.name.split('/').pop(), buf: await z.async('arraybuffer') });
            // Muchos .zip traen la licencia: se avisa para que se lea
            const lic = Object.values(zip.files).find((z) => !z.dir && /\.(txt|md)$/i.test(z.name) && /(read|lee|licen|info)/i.test(z.name));
            if (lic) Fl.note = `El .zip incluye «${lic.name.split('/').pop()}»: revisa la licencia antes de usar la fuente.`;
            if (!inside.length) errors.push(`No encontré fuentes dentro de ${file.name}.`);
          } catch {
            errors.push(`${file.name} no es un .zip válido.`);
          }
        } else if (FONT_EXT.test(file.name)) {
          entries.push({ file: file.name, buf: await file.arrayBuffer() });
        } else {
          errors.push(`${file.name} no es una fuente (.ttf, .otf, .woff, .woff2 o .zip).`);
        }
      }
      const ok = [];
      for (const e of entries) {
        try {
          const family = `Split Preview ${++previewN}`;
          document.fonts.add(await new FontFace(family, e.buf.slice(0)).load());
          const name = cleanName(fontNameOf(e.buf) || e.file);
          if (ok.some((x) => x.name === name) || Fl.shown.some((x) => x.name === name)) continue;
          ok.push({ group: name, family, weight: 400, style: 'normal', name, label: e.file, buf: e.buf });
        } catch {
          errors.push(`${e.file} no es una fuente válida.`);
        }
      }
      Fl.shown = [...ok, ...Fl.shown];
      ok.forEach((v) => Fl.picked.add(v.name)); // lo que se acaba de subir queda marcado
      if (ok.length) Fl.lastGroup = ok[0].group;
      Fl.msg = errors.join(' ');
      render();
    }
    const fileIn = $q('.fd-drop input'), drop = $q('.fd-drop');
    fileIn.addEventListener('change', () => { readFiles([...fileIn.files]); fileIn.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => readFiles([...e.dataTransfer.files]));

    // ----- Muestra -----
    test.addEventListener('input', () => {
      found.querySelectorAll('.fd-sample').forEach((s) => { s.textContent = test.value || ' '; });
    });
    d.querySelectorAll('.fd-sizes button').forEach((b) => b.addEventListener('click', () => {
      d.querySelectorAll('.fd-sizes button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      found.style.setProperty('--fd-size', b.dataset.size + 'px');
    }));

    // ----- Añadir -----
    async function addNames(names) {
      if (!names.length) return;
      add.disabled = all.disabled = true;
      let added = [];
      try {
        if (mode === 'google') {
          added = addGoogle(G.parsed, true, names);
        } else {
          for (const v of Fl.shown.filter((x) => names.includes(x.name))) added.push(await addFile(v.name, v.buf.slice(0)));
        }
      } catch (err) {
        cur().msg = 'No se pudo añadir: ' + err.message;
      }
      cur().picked = new Set();
      all.disabled = false;
      const first = added.find((f) => f.weight === 400 && f.style === 'normal') || added[0] || null;
      if (first) await load(first.name);
      render();
      if (first) finish(first);
    }
    add.onclick = () => addNames([...cur().picked]);
    all.onclick = () => addNames(pickable().map((v) => v.name));

    d.refresh = render;
    d.focusMode = () => (mode === 'google' ? ta : drop).focus();
    return d;
  }

  window.SplitFonts = {
    FONTS, byName, css, fontString, load, loadAll, capRatio, textCanvas, measure, fontList, parseGoogle, ready,
    onChange: (fn) => listeners.add(fn),
  };
})();
