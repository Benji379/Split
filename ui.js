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

  document.querySelectorAll('select').forEach(enhanceSelect);
  document.querySelectorAll('input[type=number]').forEach(enhanceNumber);

  // El recuadro de carga muestra que ya hay archivo
  const file = document.getElementById('file');
  file.addEventListener('change', () => document.getElementById('drop').classList.toggle('has-file', !!file.files.length));
  document.getElementById('drop').addEventListener('drop', () => document.getElementById('drop').classList.add('has-file'));
})();
