// Componentes de interfaz: desplegables propios y botones −/+ para campos numéricos.
// Los <select> e <input> originales se conservan (ocultos o envueltos) y siguen siendo
// la fuente del valor, así que app.js funciona igual que con los controles nativos.
(() => {
  let openSelect = null;

  function enhanceSelect(select) {
    const wrap = document.createElement('div');
    wrap.className = 'cselect';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const listId = select.id + '-list';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cselect-btn';
    button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', listId);
    button.innerHTML = '<span class="cselect-value"></span>' +
      '<svg class="cselect-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

    const list = document.createElement('ul');
    list.className = 'cselect-list';
    list.id = listId;
    list.setAttribute('role', 'listbox');

    wrap.append(button, list);
    let active = select.selectedIndex;

    function build() {
      list.innerHTML = '';
      [...select.options].forEach((opt, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `${select.id}-opt-${i}`;
        li.innerHTML = '<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';
        li.firstChild.textContent = opt.textContent;
        li.addEventListener('pointerdown', (e) => e.preventDefault());
        li.addEventListener('click', () => { choose(i); close(); button.focus(); });
        li.addEventListener('pointermove', () => highlight(i));
        list.appendChild(li);
      });
    }

    function sync() {
      button.querySelector('.cselect-value').textContent = select.options[select.selectedIndex]?.textContent || '';
      [...list.children].forEach((li, i) => {
        li.setAttribute('aria-selected', String(i === select.selectedIndex));
        li.firstChild.textContent = select.options[i].textContent; // por si el texto cambió (p. ej. "Personalizado")
      });
    }

    function highlight(i) {
      active = Math.max(0, Math.min(select.options.length - 1, i));
      [...list.children].forEach((li, j) => li.classList.toggle('active', j === active));
      button.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    }

    function choose(i) {
      // Elegir de nuevo la misma opción avisa con "reselect" (sirve para reabrir "Personalizado…")
      if (i === select.selectedIndex) { select.dispatchEvent(new Event('reselect')); return; }
      select.selectedIndex = i;
      sync();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function open() {
      if (openSelect && openSelect !== api) openSelect.close();
      wrap.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      // Abre hacia arriba si no hay espacio abajo
      const r = button.getBoundingClientRect();
      wrap.classList.toggle('up', window.innerHeight - r.bottom < Math.min(260, list.scrollHeight + 16) && r.top > window.innerHeight - r.bottom);
      highlight(select.selectedIndex);
      openSelect = api;
    }

    function close() {
      wrap.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      button.removeAttribute('aria-activedescendant');
      if (openSelect === api) openSelect = null;
    }

    const api = { close, wrap };

    button.addEventListener('click', () => (wrap.classList.contains('open') ? close() : open()));
    button.addEventListener('keydown', (e) => {
      const isOpen = wrap.classList.contains('open');
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          e.preventDefault();
          const d = e.key === 'ArrowDown' ? 1 : -1;
          if (!isOpen) open(); else highlight(active + d);
          break;
        }
        case 'Home': if (isOpen) { e.preventDefault(); highlight(0); } break;
        case 'End': if (isOpen) { e.preventDefault(); highlight(select.options.length - 1); } break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (isOpen) { choose(active); close(); } else open();
          break;
        case 'Escape': if (isOpen) { e.preventDefault(); close(); } break;
        case 'Tab': if (isOpen) { choose(active); close(); } break;
      }
    });

    // Si app.js cambia el valor por código (p. ej. "Girar hojas"), se refleja aquí
    select.addEventListener('change', sync);
    build();
    sync();
    return api;
  }

  document.addEventListener('pointerdown', (e) => {
    if (openSelect && !openSelect.wrap.contains(e.target)) openSelect.close();
  });

  function enhanceNumber(input) {
    const wrap = document.createElement('div');
    wrap.className = 'stepper';
    input.parentNode.insertBefore(wrap, input);
    const mk = (label, dir) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'step';
      b.tabIndex = -1;
      b.setAttribute('aria-label', label);
      b.innerHTML = dir < 0
        ? '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>';
      b.addEventListener('click', () => {
        dir < 0 ? input.stepDown() : input.stepUp();
        // Evita decimales flotantes como 1.2000000000000002
        const step = parseFloat(input.step) || 1;
        const dec = (String(step).split('.')[1] || '').length;
        input.value = parseFloat(input.value).toFixed(dec);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return b;
    };
    wrap.append(mk('Disminuir', -1), input, mk('Aumentar', 1));
  }

  // ---------- Selector de color ----------
  const SWATCHES = ['#1b1f3b', '#000000', '#6b7090', '#ffffff', '#e11d48', '#f97316', '#f59e0b', '#facc15',
    '#22c55e', '#0d9488', '#06b6d4', '#3b82f6', '#4f46e5', '#8b5cf6', '#d946ef', '#ec4899'];
  const valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  let openColor = null;

  const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
  }
  function hsv2rgb(h, s, v) {
    const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }

  function enhanceColor(input) {
    const wrap = document.createElement('div');
    wrap.className = 'cpick';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cpick-btn';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="cpick-swatch"></span><span class="cpick-hex"></span>' +
      '<svg class="cselect-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const pop = document.createElement('div');
    pop.className = 'cpick-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Elegir color');
    pop.innerHTML =
      '<div class="cpick-sv" tabindex="0" aria-label="Saturación y brillo"><span class="cpick-dot"></span></div>' +
      '<div class="cpick-hue" tabindex="0" aria-label="Tono"><span class="cpick-dot"></span></div>' +
      '<div class="cpick-row"><span class="cpick-prev"></span><input class="cpick-input" maxlength="7" spellcheck="false" aria-label="Código de color"></div>' +
      '<div class="cpick-swatches">' +
      SWATCHES.map((c) => `<button type="button" style="--c:${c}" data-c="${c}" title="${c}" aria-label="${c}"></button>`).join('') +
      '</div>';
    wrap.append(button, pop);

    const sv = pop.querySelector('.cpick-sv'), hue = pop.querySelector('.cpick-hue'), hexIn = pop.querySelector('.cpick-input');
    let h = 0, sat = 0, val = 0, startValue = '';

    function paint() {
      const hex = valueProp.get.call(input);
      button.querySelector('.cpick-swatch').style.background = hex;
      button.querySelector('.cpick-hex').textContent = hex.toUpperCase();
      sv.style.setProperty('--hue', `hsl(${h} 100% 50%)`);
      sv.firstChild.style.left = sat * 100 + '%';
      sv.firstChild.style.top = (1 - val) * 100 + '%';
      hue.firstChild.style.left = h / 360 * 100 + '%';
      pop.querySelector('.cpick-prev').style.background = hex;
      if (document.activeElement !== hexIn) hexIn.value = hex.toUpperCase();
      pop.querySelectorAll('.cpick-swatches button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === hex)));
    }
    function fromHex(hex) {
      const [r, g, b] = hex2rgb(hex);
      const [hh, ss, vv] = rgb2hsv(r, g, b);
      if (ss > 0 && vv > 0) h = hh; // en grises se conserva el tono elegido
      sat = ss; val = vv;
    }
    function emit(hex) {
      valueProp.set.call(input, hex);
      paint();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const fromHsv = () => emit(rgb2hex(...hsv2rgb(h, sat, val)));

    // Si el código cambia el valor (p. ej. al seleccionar otra capa), se refleja aquí
    Object.defineProperty(input, 'value', {
      get() { return valueProp.get.call(this); },
      set(v) { valueProp.set.call(this, v); fromHex(valueProp.get.call(this)); paint(); },
    });

    function drag(el, onPos) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.focus();
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = el.getBoundingClientRect();
          onPos(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
        };
        move(e);
        el.onpointermove = move;
        el.onpointerup = el.onpointercancel = () => { el.onpointermove = el.onpointerup = null; };
      });
    }
    drag(sv, (x, y) => { sat = x; val = 1 - y; fromHsv(); });
    drag(hue, (x) => { h = x * 359.9; fromHsv(); });
    sv.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 0.1 : 0.02;
      const k = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
      if (!k) return;
      e.preventDefault();
      sat = Math.min(1, Math.max(0, sat + k[0])); val = Math.min(1, Math.max(0, val + k[1]));
      fromHsv();
    });
    hue.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5 }[e.key];
      if (!d) return;
      e.preventDefault();
      h = (h + d * (e.shiftKey ? 4 : 1) + 360) % 360;
      fromHsv();
    });
    hexIn.addEventListener('input', () => {
      let v = hexIn.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
      if (/^#[0-9a-f]{6}$/i.test(v)) { fromHex(v.toLowerCase()); emit(v.toLowerCase()); }
    });
    hexIn.addEventListener('blur', paint);
    pop.querySelector('.cpick-swatches').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-c]');
      if (!b) return;
      fromHex(b.dataset.c);
      emit(b.dataset.c);
    });

    function place() {
      const r = button.getBoundingClientRect();
      const w = pop.offsetWidth, ph = pop.offsetHeight;
      let top = r.bottom + 6;
      if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6); // si no cabe abajo, arriba
      pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
      pop.style.top = top + 'px';
    }
    function open() {
      if (openColor && openColor !== api) openColor.close();
      startValue = input.value;
      fromHex(startValue);
      pop.hidden = false;
      paint();
      place();
      button.setAttribute('aria-expanded', 'true');
      openColor = api;
    }
    function close(focus) {
      if (pop.hidden) return;
      pop.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (openColor === api) openColor = null;
      if (input.value !== startValue) input.dispatchEvent(new Event('change', { bubbles: true }));
      if (focus) button.focus();
    }
    const api = { wrap, close };
    button.addEventListener('click', () => (pop.hidden ? open() : close()));
    // El campo suele ir dentro de un <label>: ningún clic debe abrir el selector nativo
    input.addEventListener('click', (e) => { e.preventDefault(); if (pop.hidden) open(); });
    pop.addEventListener('click', (e) => { if (!e.target.closest('.cpick-input')) e.preventDefault(); });
    pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } });
    fromHex(input.value);
    paint();
  }

  document.addEventListener('pointerdown', (e) => {
    if (openColor && !openColor.wrap.contains(e.target)) openColor.close();
  });
  // El selector va fijo en pantalla: se cierra si lo de debajo se desplaza
  document.addEventListener('scroll', (e) => { if (openColor && !openColor.wrap.contains(e.target)) openColor.close(); }, true);
  window.addEventListener('resize', () => openColor && openColor.close());

  // Para controles creados después (p. ej. el diálogo de fuentes)
  window.SplitUI = { enhanceSelect, enhanceColor, enhanceNumber };

  document.querySelectorAll('select').forEach(enhanceSelect);
  document.querySelectorAll('input[type=color]').forEach(enhanceColor);
  document.querySelectorAll('input[type=number]').forEach(enhanceNumber);

  // El recuadro de carga muestra que ya hay archivo
  const file = document.getElementById('file'), drop = document.getElementById('drop');
  if (file && drop) { // solo en la página del póster
    file.addEventListener('change', () => drop.classList.toggle('has-file', !!file.files.length));
    drop.addEventListener('drop', () => drop.classList.add('has-file'));
  }
})();
