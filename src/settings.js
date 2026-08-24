// 设置页：按形象分组，组内再分普通/打扰性动作，支持单项和分组开关
let settings = {};

// 动作频率档位：值越大她越闲不住
const FREQ_STOPS = [
  { v: 0.4, label: '高冷' },
  { v: 0.7, label: '安静' },
  { v: 1, label: '正常' },
  { v: 1.6, label: '活泼' },
  { v: 2.5, label: '多动症' },
];

function freqIndex() {
  const f = settings._freq || 1;
  let best = 0;
  FREQ_STOPS.forEach((s, i) => { if (Math.abs(s.v - f) < Math.abs(FREQ_STOPS[best].v - f)) best = i; });
  return best;
}

function renderFreq() {
  const sec = document.createElement('div');
  sec.className = 'section';
  const idx = freqIndex();
  sec.innerHTML = `<div class="section-title">动作频率 · <span id="freqLabel">${FREQ_STOPS[idx].label}</span></div>
    <div class="tip" style="margin:2px 0 8px">动一次是概率问题，可动可不动，全看小东西心情。</div>
    <input id="freqRange" type="range" min="0" max="4" step="1" value="${idx}" style="width:100%">`;
  sec.querySelector('#freqRange').addEventListener('input', (e) => {
    const s = FREQ_STOPS[+e.target.value];
    sec.querySelector('#freqLabel').textContent = s.label;
    // 拖动中不整页重渲染，只更新值并同步
    settings._freq = s.v;
    window.pet.setActions({ _freq: s.v });
  });
  return sec;
}

function isOn(id) { return settings[id] !== false; }

function applyPatch(patch) {
  Object.assign(settings, patch);
  window.pet.setActions(patch);
  render();
}

function switchEl(checked, onChange) {
  const label = document.createElement('label');
  label.className = 'sw';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(document.createElement('i'));
  return label;
}

// 渲染一个子分组（普通 / 打扰性），返回元素；无动作时返回 null
function renderSubgroup(ids, title, warn) {
  if (!ids.length) return null;
  const wrap = document.createElement('div');

  // 分组统一开关：组内全开才算开
  const allOn = ids.every(isOn);
  const head = document.createElement('div');
  head.className = 'subgroup';
  const nameEl = document.createElement('span');
  nameEl.textContent = title;
  if (warn) {
    const w = document.createElement('span');
    w.className = 'warn';
    w.textContent = '会跑到屏幕中间';
    nameEl.appendChild(w);
  }
  head.appendChild(nameEl);
  head.appendChild(switchEl(allOn, (v) => {
    const patch = {};
    ids.forEach((id) => { patch[id] = v; });
    applyPatch(patch);
  }));
  wrap.appendChild(head);

  for (const id of ids) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = ACTIONS[id].name;
    row.appendChild(label);
    row.appendChild(switchEl(isOn(id), (v) => applyPatch({ [id]: v })));
    wrap.appendChild(row);
  }
  return wrap;
}

function render() {
  const list = document.getElementById('list');
  list.innerHTML = '';
  list.appendChild(renderFreq());
  // 通用开关
  const misc = document.createElement('div');
  misc.className = 'section';
  const miscTitle = document.createElement('div');
  miscTitle.className = 'section-title';
  miscTitle.textContent = '通用设置';
  misc.appendChild(miscTitle);
  const ctRow = document.createElement('div');
  ctRow.className = 'row';
  const ctLabel = document.createElement('span');
  ctLabel.innerHTML = '点击穿透<div class="tip" style="margin:0">开启后只有点在角色身上才响应，其余位置点击穿透到下层窗口</div>';
  ctRow.appendChild(ctLabel);
  ctRow.appendChild(switchEl(isOn('_clickThrough'), (v) => applyPatch({ _clickThrough: v })));
  misc.appendChild(ctRow);
  list.appendChild(misc);
  for (const g of FORM_GROUPS) {
    const inForm = Object.keys(ACTIONS).filter((id) => actionFormGroup(ACTIONS[id]) === g.key);
    const normal = inForm.filter((id) => !ACTIONS[id].intrusive);
    const intrusive = inForm.filter((id) => ACTIONS[id].intrusive);
    if (!inForm.length) continue;
    const sec = document.createElement('div');
    sec.className = 'section';
    const t = document.createElement('div');
    t.className = 'section-title';
    t.textContent = g.label;
    sec.appendChild(t);
    const n = renderSubgroup(normal, '普通动作', false);
    if (n) sec.appendChild(n);
    const i = renderSubgroup(intrusive, '打扰性动作', true);
    if (i) sec.appendChild(i);
    list.appendChild(sec);
  }
}

window.pet.getSettings().then((s) => {
  settings = s || {};
  render();
});
