'use strict';

/* ===== Storage ===== */
const KEY = 'project-notes:v1';
const TYPES = {
  text: { label: 'текст', glyph: 'Aa', width: 320 },
  check: { label: 'галочка', glyph: '✓', width: 96 },
  percent: { label: 'процент', glyph: '%', width: 140 },
};
const DEL_COL_WIDTH = 48;
/* Default column width; the text column is narrower on phones. */
const colWidth = c => c.width || (c.type === 'text' && window.innerWidth < 600 ? 200 : TYPES[c.type].width);

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clampPct = v => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const emptyValue = type => (type === 'check' ? false : type === 'percent' ? 0 : '');

/* A table with a task column, three checkbox steps and an auto % column. */
function newBlock(title, tasks) {
  const task = { id: uid(), name: 'Задача', type: 'text' };
  const steps = ['Шаг 1', 'Шаг 2', 'Шаг 3'].map(name => ({ id: uid(), name, type: 'check' }));
  const pct = { id: uid(), name: 'Выполнено', type: 'percent' };
  const b = { id: uid(), title, columns: [task, ...steps, pct], rows: [], notes: '', size: null, notesHeight: null };
  b.rows = tasks.map(([text, done]) => {
    const r = { id: uid(), cells: { [task.id]: text } };
    steps.forEach((c, i) => { r.cells[c.id] = i < done; });
    r.cells[pct.id] = 0;
    return r;
  });
  b.rows.forEach(r => recalcRow(b, r));
  return b;
}

function sampleState() {
  return {
    version: 1,
    title: 'Мой проект',
    blocks: [newBlock('Задачи', [['Собрать требования', 3], ['Сделать макет', 1], ['Запустить сайт', 0]])],
  };
}

/* Turns any parsed JSON into a valid state, or throws. */
function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.blocks)) throw new Error('В файле нет списка таблиц (blocks).');
  const px = v => (typeof v === 'string' && /^\d+(\.\d+)?px$/.test(v) ? v : null);
  return {
    version: 1,
    title: String(data.title ?? 'Мой проект').slice(0, 80),
    blocks: data.blocks.filter(b => b && typeof b === 'object').map(b => {
      const columns = (Array.isArray(b.columns) ? b.columns : [])
        .filter(c => c && TYPES[c.type])
        .map(c => ({
          id: String(c.id || uid()),
          name: String(c.name ?? ''),
          type: c.type,
          width: Number(c.width) >= 48 ? Math.round(Number(c.width)) : undefined,
        }));
      const rows = (Array.isArray(b.rows) ? b.rows : []).filter(r => r && typeof r === 'object').map(r => {
        const src = r.cells && typeof r.cells === 'object' ? r.cells : {};
        const cells = {};
        for (const c of columns) {
          const v = src[c.id];
          cells[c.id] = c.type === 'check' ? Boolean(v) : c.type === 'percent' ? clampPct(v) : String(v ?? '');
        }
        return { id: String(r.id || uid()), cells };
      });
      return {
        id: String(b.id || uid()),
        title: String(b.title ?? ''),
        columns,
        rows,
        notes: String(b.notes ?? ''),
        size: b.size && (px(b.size.w) || px(b.size.h)) ? { w: px(b.size.w), h: px(b.size.h) } : null,
        notesHeight: px(b.notesHeight),
      };
    }),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('Не удалось прочитать сохранённые данные', e);
  }
  return sampleState();
}

let state = load();
let saveTimer = null;

function setStatus(text, cls = '') {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = cls;
}

function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    setStatus(`сохранено в этом браузере · ${t}`);
  } catch (e) {
    setStatus('не удалось сохранить: ' + e.message, 'error');
  }
}

function save() {
  setStatus('сохраняю…', 'busy');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });

/* ===== DOM helper ===== */
const PROPS = new Set(['value', 'checked', 'textContent', 'placeholder', 'type', 'rows', 'spellcheck']);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const board = document.getElementById('board');
const findBlockEl = id => board.querySelector(`.block[data-id="${CSS.escape(id)}"]`);

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}
const autosizeIn = root => root.querySelectorAll('.cell-text').forEach(autosize);

/* ===== Progress ===== */
/* Row progress = share of ticked checkboxes in the row.
   With no checkbox columns, the % column is filled in by hand. */
function checkCols(b) { return b.columns.filter(c => c.type === 'check'); }
function isAutoPct(b) { return checkCols(b).length > 0; }

function rowProgress(b, r) {
  const checks = checkCols(b);
  if (checks.length) return Math.round(checks.filter(c => r.cells[c.id]).length / checks.length * 100);
  const pct = b.columns.find(c => c.type === 'percent');
  return pct ? r.cells[pct.id] : null;
}

/* Store the computed value in every % column of the row (so export has it too). */
function recalcRow(b, r) {
  if (!isAutoPct(b)) return;
  const v = rowProgress(b, r);
  for (const c of b.columns) if (c.type === 'percent') r.cells[c.id] = v;
}

function blockProgress(b) {
  const vals = b.rows.map(r => rowProgress(b, r)).filter(v => v != null);
  return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : null;
}

function updateProgress(b) {
  const el = findBlockEl(b.id);
  if (el) {
    const p = blockProgress(b);
    const wrap = el.querySelector('.progress-wrap');
    wrap.hidden = p == null;
    if (p != null) {
      el.querySelector('.progress-fill').style.width = p + '%';
      el.querySelector('.progress').classList.toggle('done', p === 100);
      el.querySelector('.progress').setAttribute('aria-valuenow', p);
      el.querySelector('.pct-text').textContent = p + '%';
    }
  }
  updateSummary();
}

function updateSummary() {
  const vals = state.blocks.flatMap(b => b.rows.map(r => rowProgress(b, r))).filter(v => v != null);
  const rows = state.blocks.reduce((a, b) => a + b.rows.length, 0);
  const n = state.blocks.length;
  const parts = [`${n} ${plural(n, 'таблица', 'таблицы', 'таблиц')}`, `${rows} ${plural(rows, 'строка', 'строки', 'строк')}`];
  if (vals.length) parts.push(`всего ${Math.round(vals.reduce((a, v) => a + v, 0) / vals.length)}%`);
  document.getElementById('summary').textContent = parts.join(' · ');
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/* Refresh the % cells of one row after a checkbox changed. */
function refreshRowPct(b, r, tr) {
  recalcRow(b, r);
  for (const c of b.columns) {
    if (c.type !== 'percent') continue;
    const cell = tr.querySelector(`.pct-cell[data-col="${CSS.escape(c.id)}"]`);
    if (!cell) continue;
    cell.querySelector('.pct-value').textContent = r.cells[c.id];
    paintPct(cell, r.cells[c.id]);
  }
}

function paintPct(cell, v) {
  if (!cell) return;
  cell.style.setProperty('--p', v);
  cell.classList.toggle('done', v === 100);
}

/* ===== Rendering ===== */
function renderAll() {
  document.getElementById('title').value = state.title;
  if (!state.blocks.length) {
    board.replaceChildren(h('p', { class: 'empty' }, 'Пока пусто. Нажми «+ таблица», чтобы добавить первую таблицу задач.'));
  } else {
    board.replaceChildren(...state.blocks.map(renderBlock));
  }
  state.blocks.forEach(updateProgress);
  updateSummary();
  requestAnimationFrame(() => autosizeIn(board));
}

function rerenderBlock(b) {
  const old = findBlockEl(b.id);
  const el = renderBlock(b);
  el.style.animation = 'none';
  old.replaceWith(el);
  updateProgress(b);
  autosizeIn(el);
  return el;
}

function tableWidth(b) {
  return b.columns.reduce((a, c) => a + colWidth(c), DEL_COL_WIDTH) + 'px';
}

function renderBlock(b) {
  const sec = h('section', { class: 'block', dataset: { id: b.id }, 'aria-label': b.title || 'Таблица' });
  if (b.size) {
    if (b.size.w) sec.style.width = b.size.w;
    if (b.size.h) sec.style.height = b.size.h;
  }
  const idx = state.blocks.indexOf(b);

  const head = h('div', { class: 'block-head' },
    h('input', {
      class: 'block-title', value: b.title, placeholder: 'Название таблицы', 'aria-label': 'Название таблицы', maxlength: 120,
      oninput: e => { b.title = e.target.value; save(); },
    }),
    h('div', { class: 'progress-wrap' },
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Выполнение', 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('div', { class: 'progress-fill' })),
      h('span', { class: 'pct-text' })),
    h('div', { class: 'block-tools' },
      h('button', { class: 'icon-btn', type: 'button', title: 'Выше', 'aria-label': 'Переместить выше', disabled: idx === 0, onclick: () => moveBlock(b, -1) }, '↑'),
      h('button', { class: 'icon-btn', type: 'button', title: 'Ниже', 'aria-label': 'Переместить ниже', disabled: idx === state.blocks.length - 1, onclick: () => moveBlock(b, 1) }, '↓'),
      b.size && h('button', { class: 'icon-btn', type: 'button', title: 'Вернуть обычный размер окна', 'aria-label': 'Вернуть обычный размер окна', onclick: () => { b.size = null; save(); rerenderBlock(b); } }, '⤢'),
      h('button', { class: 'icon-btn danger', type: 'button', title: 'Удалить таблицу', 'aria-label': 'Удалить таблицу', onclick: () => deleteBlock(b) }, '✕')));

  const table = h('table', { style: { width: tableWidth(b) } },
    h('colgroup', {},
      b.columns.map(c => h('col', { style: { width: colWidth(c) + 'px' } })),
      h('col', { style: { width: DEL_COL_WIDTH + 'px' } })),
    h('thead', {}, h('tr', {}, b.columns.map((c, i) => renderTh(b, c, i)), h('th', { 'aria-label': 'Действия' }))),
    h('tbody', {}, b.rows.map(r => renderRow(b, r))));

  const addMenu = h('details', { class: 'menu' },
    h('summary', { class: 'btn' }, '+ колонка'),
    h('div', { class: 'menu-list' }, Object.entries(TYPES).map(([type, t]) =>
      h('button', { type: 'button', onclick: () => addColumn(b, type) }, h('span', { class: 'th-type' }, t.glyph), t.label))));

  const notes = h('textarea', {
    class: 'notes', id: 'notes-' + b.id, value: b.notes, placeholder: 'Пометки, решения, ссылки…',
    oninput: e => { b.notes = e.target.value; save(); },
  });
  if (b.notesHeight) notes.style.height = b.notesHeight;

  sec.append(head,
    b.columns.length ? h('div', { class: 'table-wrap' }, table) : h('p', { class: 'muted' }, 'Нет колонок — добавь первую.'),
    h('div', { class: 'block-foot' },
      b.columns.length ? h('button', { class: 'btn', type: 'button', onclick: () => addRow(b, b.columns.find(c => c.type === 'text')?.id) }, '+ строка') : null,
      addMenu),
    h('label', { class: 'notes-label', for: notes.id }, 'Пометки'),
    notes);
  return sec;
}

function renderTh(b, c, i) {
  const th = h('th', {},
    h('div', { class: 'th-inner' },
      h('span', { class: 'th-type', title: TYPES[c.type].label, 'aria-hidden': 'true' }, TYPES[c.type].glyph),
      h('input', {
        class: 'th-name', value: c.name, placeholder: 'колонка', 'aria-label': `Название колонки ${i + 1}`,
        oninput: e => { c.name = e.target.value; save(); },
      }),
      h('button', { class: 'icon-btn danger', type: 'button', title: 'Удалить колонку', 'aria-label': `Удалить колонку ${c.name}`, onclick: () => deleteColumn(b, c) }, '✕')));
  const grip = h('div', { class: 'col-resizer', title: 'Потяни, чтобы изменить ширину' });
  grip.addEventListener('pointerdown', e => startColResize(e, b, c, i, grip));
  th.append(grip);
  return th;
}

function renderRow(b, r) {
  recalcRow(b, r);
  const tr = h('tr', { dataset: { id: r.id } });
  for (const c of b.columns) tr.append(h('td', {}, renderCell(b, r, c, tr)));
  tr.append(h('td', { class: 'cell-del' },
    h('button', { class: 'icon-btn danger', type: 'button', title: 'Удалить строку', 'aria-label': 'Удалить строку', onclick: () => deleteRow(b, r, tr) }, '✕')));
  return tr;
}

function renderCell(b, r, c, tr) {
  const v = r.cells[c.id];
  if (c.type === 'check') {
    return h('label', { class: 'check', title: c.name },
      h('input', {
        type: 'checkbox', checked: v, dataset: { col: c.id }, 'aria-label': c.name || 'Готово',
        onchange: e => { r.cells[c.id] = e.target.checked; refreshRowPct(b, r, tr); updateProgress(b); save(); },
      }),
      h('span', { class: 'box', 'aria-hidden': 'true' }, '✓'));
  }
  if (c.type === 'percent') {
    const auto = isAutoPct(b);
    const cell = h('div', { class: 'pct-cell' + (auto ? ' auto' : ''), dataset: { col: c.id }, title: auto ? 'Считается по галочкам строки' : null },
      auto
        ? h('output', { class: 'pct-value', 'aria-label': (c.name || 'Процент') + ', %' }, String(v))
        : h('input', {
          type: 'number', value: String(v), min: 0, max: 100, step: 5, inputmode: 'numeric', dataset: { col: c.id }, 'aria-label': (c.name || 'Процент') + ', %',
          oninput: e => { r.cells[c.id] = clampPct(e.target.value); paintPct(cell, r.cells[c.id]); updateProgress(b); save(); },
          onblur: e => { e.target.value = r.cells[c.id]; },
        }),
      h('span', { 'aria-hidden': 'true' }, '%'),
      h('div', { class: 'pct-bar', 'aria-hidden': 'true' }, h('i')));
    paintPct(cell, v);
    return cell;
  }
  return h('textarea', {
    class: 'cell-text', rows: 1, value: v, dataset: { col: c.id }, 'aria-label': c.name || 'Текст',
    oninput: e => { r.cells[c.id] = e.target.value; autosize(e.target); save(); },
    onkeydown: e => {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      e.preventDefault(); // Enter = next row, Shift+Enter = new line
      const i = b.rows.indexOf(r);
      if (i === b.rows.length - 1) addRow(b, c.id);
      else focusCell(b, b.rows[i + 1], c.id);
    },
  });
}

function focusCell(b, r, colId) {
  const el = findBlockEl(b.id)?.querySelector(`tr[data-id="${CSS.escape(r.id)}"] [data-col="${CSS.escape(colId)}"]`);
  if (el) el.focus();
}

/* ===== Actions ===== */
function addBlock() {
  const b = newBlock('Новая таблица', [['', 0]]);
  state.blocks.push(b);
  save();
  renderAll();
  const el = findBlockEl(b.id);
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const title = el.querySelector('.block-title');
  title.focus({ preventScroll: true });
  title.select();
}

function deleteBlock(b) {
  const filled = b.rows.length || b.notes.trim();
  if (filled && !confirm(`Удалить таблицу «${b.title || 'без названия'}» со всеми строками и пометками?`)) return;
  state.blocks.splice(state.blocks.indexOf(b), 1);
  save();
  renderAll();
}

function moveBlock(b, dir) {
  const i = state.blocks.indexOf(b), j = i + dir;
  if (j < 0 || j >= state.blocks.length) return;
  [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]];
  save();
  renderAll();
  findBlockEl(b.id).querySelectorAll('.block-tools .icon-btn')[dir < 0 ? 0 : 1]?.focus();
}

function addRow(b, focusColId) {
  const r = { id: uid(), cells: Object.fromEntries(b.columns.map(c => [c.id, emptyValue(c.type)])) };
  b.rows.push(r);
  save();
  const tbody = findBlockEl(b.id).querySelector('tbody');
  const tr = renderRow(b, r);
  tbody.append(tr);
  autosizeIn(tr);
  updateProgress(b);
  if (focusColId) focusCell(b, r, focusColId);
}

function deleteRow(b, r, tr) {
  const hasText = b.columns.some(c => c.type === 'text' && r.cells[c.id].trim());
  if (hasText && !confirm('Удалить строку?')) return;
  b.rows.splice(b.rows.indexOf(r), 1);
  tr.remove();
  updateProgress(b);
  save();
}

function addColumn(b, type) {
  const c = { id: uid(), name: TYPES[type].label, type };
  b.columns.push(c);
  b.rows.forEach(r => { r.cells[c.id] = emptyValue(type); });
  if (!b.rows.length) b.rows.push({ id: uid(), cells: Object.fromEntries(b.columns.map(k => [k.id, emptyValue(k.type)])) });
  save();
  const el = rerenderBlock(b);
  const inputs = el.querySelectorAll('.th-name');
  const input = inputs[inputs.length - 1];
  input.focus();
  input.select();
}

function deleteColumn(b, c) {
  const used = b.rows.some(r => (c.type === 'text' ? r.cells[c.id].trim() : r.cells[c.id]));
  if (used && !confirm(`Удалить колонку «${c.name || 'без названия'}» вместе с данными?`)) return;
  b.columns.splice(b.columns.indexOf(c), 1);
  b.rows.forEach(r => { delete r.cells[c.id]; });
  save();
  rerenderBlock(b);
}

/* Drag the edge of a column header to change its width. */
function startColResize(e, b, c, i, grip) {
  e.preventDefault();
  const table = grip.closest('table');
  const col = table.querySelectorAll('col')[i];
  const startX = e.clientX;
  const startW = colWidth(c);
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('active');
  const move = ev => {
    c.width = Math.max(64, Math.round(startW + ev.clientX - startX));
    col.style.width = c.width + 'px';
    table.style.width = tableWidth(b);
  };
  const up = () => {
    grip.classList.remove('active');
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    autosizeIn(table);
    save();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}

/* After the user drags a window's or a notes field's corner, remember its size. */
window.addEventListener('pointerup', () => {
  let changed = false;
  for (const b of state.blocks) {
    const el = findBlockEl(b.id);
    if (!el) continue;
    const w = el.style.width || null, hgt = el.style.height || null;
    if ((w || hgt) && (w !== (b.size?.w ?? null) || hgt !== (b.size?.h ?? null))) {
      const hadSize = Boolean(b.size);
      b.size = { w, h: hgt };
      changed = true;
      if (!hadSize) el.querySelector('.block-tools').replaceWith(renderBlock(b).querySelector('.block-tools'));
    }
    const nh = el.querySelector('.notes')?.style.height || null;
    if (nh && nh !== b.notesHeight) { b.notesHeight = nh; changed = true; }
  }
  if (changed) { save(); requestAnimationFrame(() => autosizeIn(board)); }
});

/* ===== Import / export ===== */
function exportData() {
  saveNow();
  const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const slug = (state.title || 'project').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
  const a = h('a', { href: URL.createObjectURL(blob), download: `${slug}-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus('файл экспорта скачан');
}

async function importFile(file) {
  let next;
  try {
    next = normalize(JSON.parse(await file.text()));
  } catch (e) {
    alert('Не получилось прочитать файл: ' + e.message);
    return;
  }
  const n = next.blocks.length;
  if (!confirm(`Заменить текущие данные содержимым файла «${file.name}» (${n} ${plural(n, 'таблица', 'таблицы', 'таблиц')})?\nТекущие данные пропадут — при необходимости сначала сделай экспорт.`)) return;
  state = next;
  saveNow();
  renderAll();
  setStatus('данные импортированы');
}

/* ===== Wiring ===== */
document.getElementById('title').addEventListener('input', e => { state.title = e.target.value; document.title = (e.target.value || 'Проект') + ' · заметки и задачи'; save(); });
document.getElementById('add-table').addEventListener('click', addBlock);
document.getElementById('export').addEventListener('click', exportData);
const fileInput = document.getElementById('import-file');
document.getElementById('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { if (fileInput.files[0]) importFile(fileInput.files[0]); fileInput.value = ''; });

/* Close the "+ колонка" menu when clicking elsewhere or pressing Esc. */
document.addEventListener('click', e => {
  board.querySelectorAll('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') board.querySelectorAll('details.menu[open]').forEach(d => { d.open = false; d.querySelector('summary').focus(); });
});

/* Light / dark theme (the initial one is set in index.html before paint). */
const THEME_KEY = 'project-notes:theme';
const themeBtn = document.getElementById('theme');
function showTheme(t) {
  document.documentElement.dataset.theme = t;
  const label = t === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
}
showTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
themeBtn.addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  showTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode: theme just won't persist */ }
});

/* Another tab of the same site changed the data. */
window.addEventListener('storage', e => {
  if (e.key === KEY) { state = load(); renderAll(); }
  if (e.key === THEME_KEY && (e.newValue === 'dark' || e.newValue === 'light')) showTheme(e.newValue);
});

let lastWidth = window.innerWidth;
window.addEventListener('resize', () => { if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; autosizeIn(board); } });

document.title = (state.title || 'Проект') + ' · заметки и задачи';
renderAll();
