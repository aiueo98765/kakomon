import { db, settings } from './store.js';
import { InkViewer, PEN_COLORS, printViewer, downloadBytes, loadPdf } from './viewer.js';
import * as AI from './ai.js';
import { autoMark, tally, estDev, calibOf, naishinAdj, judge, METHOD_NOTE } from './grade.js';
import { md, esc } from './md.js';

const app = document.getElementById('app');
const SUBJECTS = ['英語', '数学', '国語'];
let CAT = null;          // data/catalog.json
let ATTEMPTS = [];       // [attempt]
let USER_EXAMS = [];     // 取り込んだ過去問
let cleanup = null;      // 画面を離れるときの後片付け

// ---------------------------------------------------------------- 共通
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// 線のアイコン（24×24、線で描く）
const ICONS = {
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  pen: 'M4 20l4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20zM14.5 6.5l3 3',
  marker: 'M4 20h7M7.5 16.5l2.5 2.5 9-9-5-5-9 9zM9 13l3 3',
  eraser: 'M8 20h12M5.6 13.4l7-7a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L12 19H8.4l-2.8-2.8a2 2 0 0 1 0-2.8zM9.5 9.5l5 5',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  print: 'M7 9V3h10v6M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  external: 'M14 4h6v6M10 14L20 4M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
  back: 'M15 18l-6-6 6-6', next: 'M9 18l6-6-6-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM15 4v16',
  play: 'M8 5l11 7-11 7z', stop: 'M7 7h10v10H7z', check: 'M5 12.5l4.5 4.5L19 7',
  spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z', upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  volume: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
};
const icon = (n, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;
const devClass = d => d == null ? '' : d >= 75 ? 'd75' : d >= 70 ? 'd70' : d >= 65 ? 'd65' : '';
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
// 年は「入試を実施した年（2 月）」。令和2年度入試 = 2020年2月、平成31年度入試 = 2019年2月
const reiwa = y => y >= 2020 ? `令和${y - 2018}年度` : `平成${y - 1988}年度`;
const fmtDate = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function schoolById(id) { return CAT.schools.find(s => s.id === id); }
function testById(id) { return CAT.tests[id] || userTest(id); }
function userTest(id) {
  const m = id && id.match(/^own-(.+)$/);
  if (!m) return null;
  const s = schoolById(m[1]);
  return s ? { id, name: s.name + ' 独自問題', kind: 'own', pref: s.pref, school: s.id } : null;
}
// 取り込んだ過去問は、同じ id の収録済み試験があればそこにファイルを足し、なければ新しい試験として足す
let MERGED = null;
function allExams() {
  if (MERGED) return MERGED;
  const map = new Map(CAT.exams.map(e => [e.id, { ...e, files: { ...e.files } }]));
  for (const u of USER_EXAMS) {
    const e = map.get(u.id);
    if (e) { for (const [k, v] of Object.entries(u.files)) e.files[k] = (e.files[k] || []).concat(v); e.user = true; }
    else map.set(u.id, { ...u, files: { ...u.files } });
  }
  MERGED = [...map.values()];
  return MERGED;
}
function examById(id) { return allExams().find(e => e.id === id); }
function examsOfTest(tid) { return allExams().filter(e => e.test === tid); }
function examTitle(e) {
  const t = testById(e.test);
  return `${t ? t.name : e.test}　${e.year}年（${reiwa(e.year)}）${e.subject}`;
}
function schoolsOfTest(tid) { return CAT.schools.filter(s => s.tests.includes(tid)); }
function testsOfSchool(s) {
  const ts = [...s.tests];
  if (!ts.some(t => testById(t)?.kind !== 'common')) ts.push('own-' + s.id); // 取り込み先
  return ts;
}

async function resolveFiles(list = []) {
  const out = [];
  for (const f of list) {
    if (typeof f.src === 'string') out.push({ src: f.src, label: f.label, pages: f.pages });
    else if (f.file) {
      const rec = await db.get('files', f.file);
      if (rec) out.push({ src: { id: f.file, data: rec.data }, label: f.label || rec.name });
    }
  }
  return out;
}

async function getKey(exam) {
  const k = await db.get('keys', exam.id);
  if (k) return k;
  if (exam.keyJson) {
    try { const r = await fetch(exam.keyJson); if (r.ok) return await r.json(); } catch (e) {}
  }
  return null;
}

function bestOf(examId) {
  const as = ATTEMPTS.filter(a => a.examId === examId && a.score);
  if (!as.length) return null;
  return as.reduce((b, a) => (a.score.got / a.score.max > b.score.got / b.score.max ? a : b));
}

// ---------------------------------------------------------------- 推定偏差値
function attemptDev(a) {
  const e = examById(a.examId);
  if (!e || !a.score || !a.score.max || a.score.pending) return null;
  const t = testById(e.test);
  if (!t) return null;
  const school = t.school ? schoolById(t.school) : null;
  return estDev({ test: t, school, subject: e.subject, pct: a.score.got / a.score.max * 100, mean: e.mean });
}
// 教科ごとの最新の推定偏差値（testFilter を渡すとその試験だけ）
function myDevs(testFilter) {
  const out = {};
  const sorted = [...ATTEMPTS].sort((a, b) => b.finished - a.finished);
  for (const a of sorted) {
    const e = examById(a.examId);
    if (!e || out[e.subject] != null) continue;
    if (testFilter && e.test !== testFilter) continue;
    const d = attemptDev(a);
    if (d != null) out[e.subject] = { dev: d, a, e };
  }
  return out;
}
function avgDev(devs) {
  const v = Object.values(devs).map(x => x.dev);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null;
}
function judgeSchool(s) {
  if (s.dev == null) return null; // 偏差値が分からない学校は判定しない
  // その学校の試験を解いていればそれを使い、なければ全体の推定偏差値で
  const own = s.tests.find(t => testById(t)?.kind !== 'common');
  let devs = own ? myDevs(own) : {};
  let basis = '学校の問題';
  if (!Object.keys(devs).length) { devs = myDevs(); basis = '最近の結果'; }
  const est = avgDev(devs);
  if (est == null) return null;
  let adj = 0, ntext = '';
  if (s.kind === '公立') {
    const n = settings.get('naishin', null);
    const r = naishinAdj(s.pref, s.dev, n);
    const t = testById(s.tests[0]);
    adj = r.dp / (calibOf(t).slope || 2);
    ntext = r.text;
  }
  const v = Math.round((est + adj) * 10) / 10;
  return { est, adj, v, d: v - s.dev, ...judge(v - s.dev), basis, ntext, n: Object.keys(devs).length };
}

// ---------------------------------------------------------------- 画面切り替え
const routes = [
  [/^#?\/?$/, viewHome, 'home'],
  [/^#\/school\/([^/]+)$/, viewSchool, 'home'],
  [/^#\/exam\/([^/]+)$/, viewExam, ''],
  [/^#\/result\/([^/]+)$/, viewResult, 'history'],
  [/^#\/judge$/, viewJudge, 'judge'],
  [/^#\/history$/, viewHistory, 'history'],
  [/^#\/settings$/, viewSettings, 'settings'],
];
async function route() {
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  const h = location.hash || '#/';
  $('#nav').classList.remove('open');
  for (const [re, fn, nav] of routes) {
    const m = h.match(re);
    if (m) {
      $$('#nav a').forEach(a => a.classList.toggle('cur', a.dataset.nav === nav));
      app.innerHTML = '';
      window.scrollTo(0, 0);
      try { await fn(...m.slice(1).map(decodeURIComponent)); } catch (e) { console.error(e); app.innerHTML = `<div class="page"><div class="note warn">${esc(e.message || String(e))}</div></div>`; }
      return;
    }
  }
  location.hash = '#/';
}

// ---------------------------------------------------------------- 学校一覧
async function viewHome() {
  const f = settings.get('homeFilter', { pref: 'all', kind: 'all', have: false, q: '' });
  const nEx = allExams().length;
  const nDone = new Set(ATTEMPTS.map(a => a.examId)).size;
  const my = avgDev(myDevs());
  const prefs = [...new Set(CAT.schools.map(s => s.pref))];
  app.innerHTML = `<div class="page">
    <section class="hero">
      <div>
        <div class="kicker">High school entrance exams</div>
        <h1>高校入試の過去問を、<br>本番のように。</h1>
        <p class="lead">偏差値の高い順に。東京・神奈川・千葉は偏差値60以上の全校を英語・数学・国語で、ほかの道府県は集められた学校を主に数学で収録しています。</p>
      </div>
      <div class="stats">
        <div><b>${CAT.schools.length}</b><span>学校</span></div>
        <div><b>${nEx}</b><span>試験</span></div>
        <div><b>${nDone}</b><span>解いた試験</span></div>
        <div><b>${my ?? '—'}</b><span>推定偏差値</span></div>
      </div>
    </section>
    <div class="filters">
      <div class="seg grp" data-g="pref">${['all', '東京', '神奈川', '千葉', 'other'].map(p => `<button class="${f.pref === p ? 'on' : ''}" data-v="${p}">${p === 'all' ? 'すべて' : p === 'other' ? 'その他' : p}</button>`).join('')}</div>
      <select id="fPref" aria-label="都道府県"><option value="">都道府県</option>${prefs.map(p => `<option ${f.pref === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <div class="seg grp" data-g="kind">${['all', '公立', '私立', '国立'].map(p => `<button class="${f.kind === p ? 'on' : ''}" data-v="${p}">${p === 'all' ? '公私' : p}</button>`).join('')}</div>
      <span class="switch ${f.have ? 'on' : ''}" id="fHave" role="switch" aria-checked="${f.have}"><i></i>問題がある学校だけ</span>
      <label class="search">${icon('search')}<input type="text" id="fq" placeholder="学校名で検索" value="${esc(f.q)}"></label>
    </div>
    <div id="list"></div>
  </div>`;
  const draw = () => {
    const q = f.q.trim();
    const rows = CAT.schools.filter(s =>
      (f.pref === 'all' || s.pref === f.pref || (f.pref === 'other' && !['東京', '神奈川', '千葉'].includes(s.pref))) && (f.kind === 'all' || s.kind === f.kind) &&
      (!q || s.full.includes(q) || s.name.includes(q)) && (!f.have || examCount(s) > 0));
    const bands = [[75, 99], [70, 74], [65, 69], [60, 64], [50, 59], [0, 49], [null, null]];
    $('#list').innerHTML = bands.map(([lo, hi]) => {
      const rs = rows.filter(s => lo == null ? s.dev == null : s.dev != null && s.dev >= lo && s.dev <= hi);
      if (!rs.length) return '';
      const title = lo == null ? '—' : lo === 0 ? '〜49' : hi >= 99 ? `${lo}+` : `${lo}–${hi}`;
      return `<section class="band"><div class="band-head"><b>${title}</b><em>${lo == null ? '偏差値不明' : '偏差値'}</em><span class="sub">${rs.length}校</span></div>
        <ul class="list">${rs.map(schoolRow).join('')}</ul></section>`;
    }).join('') || '<p class="muted" style="margin-top:24px">該当する学校がありません</p>';
  };
  $$('.grp', app).forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    f[g.dataset.g] = b.dataset.v; settings.set('homeFilter', f);
    $$('button', g).forEach(x => x.classList.toggle('on', x === b));
    if (g.dataset.g === 'pref') $('#fPref').value = '';
    draw();
  }));
  $('#fPref').onchange = e => { f.pref = e.target.value || 'all'; settings.set('homeFilter', f); $$('[data-g="pref"] button').forEach(x => x.classList.toggle('on', x.dataset.v === f.pref)); draw(); };
  $('#fHave').onclick = e => { f.have = !f.have; const el = e.currentTarget; el.classList.toggle('on', f.have); el.setAttribute('aria-checked', f.have); settings.set('homeFilter', f); draw(); };
  $('#fq').oninput = e => { f.q = e.target.value; settings.set('homeFilter', f); draw(); };
  draw();
}
function examCount(s) { return s.tests.concat('own-' + s.id).reduce((n, t) => n + examsOfTest(t).length, 0); }
function testTag(s) {
  const t = testById(s.tests[0]);
  if (!t) return '';
  return `<span class="pill">${esc(t.short || t.name)}</span>`;
}
function schoolRow(s) {
  const n = examCount(s);
  const j = judgeSchool(s);
  return `<li><a class="row" href="#/school/${s.id}">
    <div class="dev ${devClass(s.dev)}">${s.dev ?? '—'}</div>
    <div><div class="sname">${esc(s.name)}</div>
      <div class="smeta">${s.pref}・${esc((s.area || '').replace(/^(東京都|北海道|(京都|大阪)府|.{2,3}県)/, ''))}・${s.kind}${s.gender && s.gender !== '共学' ? '・' + s.gender : ''}</div></div>
    <div class="tags">${s.note ? `<span class="pill warn">${esc(s.note)}</span>` : ''}${j ? `<span class="pill ${j.k <= 'B' ? 'ok' : j.k === 'C' ? 'warn' : 'ng'}">${j.k}判定</span>` : ''}${testTag(s)}${n ? `<span class="pill accent">${n}試験</span>` : '<span class="pill line">未収録</span>'}</div>
    ${icon('next')}
  </a></li>`;
}

// ---------------------------------------------------------------- 学校
async function viewSchool(id) {
  const s = schoolById(id);
  if (!s) throw new Error('学校が見つかりません');
  const j = judgeSchool(s);
  const tests = testsOfSchool(s);
  let html = `<div class="page">
    <div class="crumb"><a href="#/">学校一覧</a>${icon('next')}${s.pref}</div>
    <div class="s-head">
      <div class="s-dev"><b>${s.dev ?? '—'}</b><span>偏差値</span></div>
      <div><h1>${esc(s.full)}</h1>
        <div class="s-meta"><span class="pill">${s.pref}</span><span class="pill">${s.kind}</span>${s.gender ? `<span class="pill">${esc(s.gender)}</span>` : ''}${s.area ? `<span class="pill line">${esc(s.area)}</span>` : ''}</div></div>
    </div>
    ${s.courses?.length ? `<p class="sub" style="margin-top:12px">コース別：${s.courses.map(c => esc(c.name) + ' ' + c.dev).join('　')}</p>` : ''}
    ${s.note ? `<div class="note warn">${esc(s.noteLong || s.note)}</div>` : ''}
    <div class="card judge-card">${j ? `<span class="kbadge ${j.k}">${j.k}</span><div><b>合格判定 ${j.k}（${j.p}）</b><div class="sub">あなたの推定偏差値 ${j.v}（${j.basis}${j.ntext ? '・' + esc(j.ntext) : ''}）</div></div>`
      : `<span class="kbadge" style="background:var(--bg-2);color:var(--muted)">?</span><div><b>合格判定</b><div class="sub">問題を解くと、ここに判定が出ます。</div></div>`}</div>
    ${s.testNote ? `<p class="sub">${esc(s.testNote)}</p>` : ''}`;
  for (const tid of tests) {
    const t = testById(tid);
    if (!t) continue;
    const exs = examsOfTest(tid);
    const years = [...new Set(exs.map(e => e.year))].sort((a, b) => b - a);
    const srcs = [...new Set(exs.map(e => e.source).filter(Boolean))];
    html += `<section class="card test-card"><header><h2>${esc(t.name)}</h2>
      ${t.kind === 'common' ? `<p class="sub">この試験を使う高校：${schoolsOfTest(tid).map(x => esc(x.name)).slice(0, 24).join('、')}${schoolsOfTest(tid).length > 24 ? ' ほか' : ''}</p>` : ''}
      ${t.note ? `<p class="sub">${esc(t.note)}</p>` : ''}
      ${srcs.length ? `<p class="sub">出典：${srcs.map(esc).join('、')}</p>` : ''}</header>`;
    if (!years.length) {
      html += `<p class="sub" style="padding:16px 22px;margin:0">${t.kind === 'own' ? '公式サイトで公開されていないか、未収録です。お持ちの過去問集のPDFを下の「過去問を取り込む」から入れると、ほかの試験と同じように解けます。' : 'まだ収録されていません。'}</p>`;
    } else {
      html += `<div class="years"><div class="yh">年度</div>${SUBJECTS.map(x => `<div class="yh">${x}</div>`).join('')}` +
        years.map(y => `<div class="y"><b>${y}</b><span>${reiwa(y)}</span></div>${SUBJECTS.map(sub => {
          const e = exs.find(x => x.year === y && x.subject === sub);
          if (!e) return '<div><span class="empty-cell">—</span></div>';
          const b = bestOf(e.id);
          if (b) return `<div><a class="cell done" href="#/exam/${e.id}">${icon('check')}<b>${b.score.got}</b>/${b.score.max}</a></div>`;
          if (e.noProblem) return `<div><a class="cell nop" href="#/exam/${e.id}" title="問題は未公開（正答表だけ）">正答のみ</a></div>`;
          return `<div><a class="cell" href="#/exam/${e.id}">解く${e.user ? ' <span class="pill">取込</span>' : ''}</a></div>`;
        }).join('')}`).join('') + '</div>';
    }
    html += '</section>';
  }
  html += `<details class="card"><summary>${icon('upload')}過去問を取り込む</summary>
    <p class="sub">過去問集などのPDF（スキャンでも可）を、この端末のブラウザの中に保存して使います。外には送りません（AI を使うときだけ Anthropic に送ります）。</p>
    <div class="kv">
      <label>どの試験に</label><select id="imTest">${tests.filter(t => testById(t)).map(t => `<option value="${t}">${esc(testById(t).name)}</option>`).join('')}</select>
      <label>年度</label><select id="imYear">${Array.from({ length: 16 }, (_, i) => 2026 - i).map(y => `<option value="${y}">${y}年（${reiwa(y)}）</option>`).join('')}</select>
      <label>教科</label><select id="imSub">${SUBJECTS.map(x => `<option>${x}</option>`).join('')}</select>
      <label>種類</label><select id="imKind"><option value="problem">問題</option><option value="key">正答表・解答</option><option value="sheet">解答用紙</option><option value="audio">リスニング音声</option></select>
      <label>制限時間・満点</label><span><input type="number" id="imMin" value="50" min="10" max="120" style="width:84px"> 分　<input type="number" id="imMax" value="100" min="10" max="300" style="width:84px"> 点</span>
      <label>ファイル</label><input type="file" id="imFile" accept="application/pdf,audio/*" multiple>
    </div><div class="row-btns"><button class="primary" id="imGo">${icon('upload')}取り込む</button></div></details>`;
  html += '</div>';
  app.innerHTML = html;
  $('#imGo').onclick = async () => {
    const files = [...$('#imFile').files];
    if (!files.length) return toast('ファイルを選んでください');
    const year = +$('#imYear').value, subject = $('#imSub').value, kind = $('#imKind').value;
    const tid = $('#imTest').value;
    const id = `${tid}-${year}-${subject}`;
    let ex = USER_EXAMS.find(e => e.id === id);
    if (!ex) {
      ex = { id, test: tid, year, subject, minutes: +$('#imMin').value || 50, max: +$('#imMax').value || 100, user: true, files: {} };
      USER_EXAMS.push(ex);
    }
    ex.files[kind] = ex.files[kind] || [];
    for (const f of files) {
      const fid = 'f' + Date.now() + Math.random().toString(36).slice(2, 6);
      await db.put('files', fid, { name: f.name, type: f.type, data: await f.arrayBuffer() });
      ex.files[kind].push({ file: fid, label: f.name, type: f.type });
    }
    await db.put('kv', 'userExams', USER_EXAMS);
    MERGED = null;
    toast('取り込みました');
    route();
  };
}

// ---------------------------------------------------------------- 試験（解く画面）
async function viewExam(id) {
  const ex0 = examById(id);
  if (!ex0) throw new Error('試験が見つかりません');
  const split = await db.get('kv', 'split:' + id);
  const ex = split ? { ...ex0, mixedAnswers: false, files: { ...ex0.files,
    problem: [{ src: split.src, label: '問題', pages: [1, split.page - 1] }],
    key: [{ src: split.src, label: '解答', pages: [split.page, 9999] }], sheet: [] } } : ex0;
  const test = testById(ex.test);
  let key = await getKey(ex);
  const st = { mode: 'practice', tab: 'problem', answers: {}, free: [], started: 0, timer: null, left: ex.minutes * 60 };
  const draft = await db.get('kv', 'draft:' + ex.id);
  if (draft && draft.mode === 'live') {
    Object.assign(st, draft);
    st.left = Math.max(0, ex.minutes * 60 - (Date.now() - st.started) / 1000);
  }
  const has = k => (ex.files[k] || []).length > 0;
  const tabs = [['problem', '問題'], ['sheet', '解答用紙'], ['key', '正答表'], ['points', '採点のポイント'], ['script', 'リスニング台本'], ['whole', 'PDF全体']].filter(([k]) => has(k));
  const LOCKED = ['key', 'points', 'script', 'whole'];

  const tname = testById(ex.test)?.name || ex.test;
  app.innerHTML = `<div class="exam">
    <div class="exam-bar">
      <a href="#/school/${test?.school || (schoolsOfTest(ex.test)[0]?.id || '')}" class="btn icon ghost" title="戻る" aria-label="戻る">${icon('back')}</a>
      <div class="exam-title"><small>${esc(tname)}</small><b>${ex.year}年（${reiwa(ex.year)}）${ex.subject}</b></div>
      <div class="seg" id="tabs">${tabs.map(([k, n]) => `<button data-t="${k}">${n}</button>`).join('')}</div>
      <span class="timer" id="timer">${icon('clock')}<span id="timerT">${ex.minutes}:00</span></span>
      <button class="primary" id="btnLive">${icon('play')}本番スタート</button>
      <button id="btnEnd" class="hide">${icon('stop')}解答終了</button>
      <button class="panel-toggle icon" id="btnPanel" aria-label="解答欄">${icon('panel')}</button>
    </div>
    <div class="exam-body">
      <div class="stage">
        <div class="palette" id="tools">
          <button data-tool="hand" title="移動（スクロール）">${icon('move')}</button>
          <button data-tool="pen" title="ペン">${icon('pen')}</button>
          <button data-tool="marker" title="マーカー">${icon('marker')}</button>
          <button data-tool="eraser" title="消しゴム">${icon('eraser')}</button>
          <span class="sep"></span>
          ${PEN_COLORS.map(c => `<button data-color="${c}" title="色"><span class="dot" style="background:${c}"></span></button>`).join('')}
          <span class="sep"></span>
          <button id="tUndo" title="戻す">${icon('undo')}</button>
          <button id="tClear" title="書き込みを全部消す">${icon('trash')}</button>
        </div>
        <div class="docbar">
          <button id="tZoomOut" title="縮小">${icon('minus')}</button><span class="zoom" id="zoomV">100%</span><button id="tZoomIn" title="拡大">${icon('plus')}</button>
          <button id="tPrint" title="書き込みごと印刷">${icon('print')}<span class="lbl">印刷</span></button>
          <button id="tPdf" title="書き込みごとPDFで保存">${icon('download')}<span class="lbl">PDF</span></button>
          <button id="tOrig" title="元のPDFを開く">${icon('external')}<span class="lbl">元のPDF</span></button>
          ${ex0.files.whole ? `<button id="tSplit" title="今見ているページから後ろを「解答」として分けます">${icon('cut')}<span class="lbl">ここから解答</span></button>` : ''}
        </div>
        <div class="viewer" id="viewer"></div>
      </div>
      <aside class="panel" id="panel"></aside>
    </div>
  </div>`;

  const viewer = new InkViewer($('#viewer'));
  const showTab = async t => {
    if (st.mode === 'live' && LOCKED.includes(t)) return toast('本番中は見られません');
    st.tab = t;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    const files = await resolveFiles(ex.files[t]);
    const inkable = t === 'problem' || t === 'sheet';
    await viewer.open(files, inkable ? `${ex.id}|${t}` : null);
    $('#tools').classList.toggle('hide', !inkable);
    $('#zoomV').textContent = Math.round(viewer.zoom * 100) + '%';
  };
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.t); };

  // 道具
  const setToolBtns = () => {
    $$('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === viewer.tool));
    $$('#tools [data-color]').forEach(x => x.classList.toggle('on', x.dataset.color === viewer.color));
  };
  $('#tools').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) { viewer.setTool(b.dataset.tool); setToolBtns(); }
    if (b.dataset.color) { viewer.color = b.dataset.color; if (viewer.tool === 'hand' || viewer.tool === 'eraser') viewer.setTool('pen'); setToolBtns(); }
    $$('#tools [data-color]').forEach(x => x.classList.toggle('on', x.dataset.color === viewer.color));
  });
  // 指で操作する端末（スマホ）は最初「移動」にしておく（ペンのままだと画面を送れない）
  viewer.tool = settings.get('tool', matchMedia('(pointer: coarse)').matches ? 'hand' : 'pen'); setToolBtns();
  $('#tUndo').onclick = () => viewer.undoLast();
  const zoom = z => { viewer.setZoom(z); $('#zoomV').textContent = Math.round(viewer.zoom * 100) + '%'; };
  $('#tZoomIn').onclick = () => zoom(viewer.zoom * 1.2);
  $('#tZoomOut').onclick = () => zoom(viewer.zoom / 1.2);
  $('#tClear').onclick = () => { if (confirm('このPDFへの書き込みを全部消しますか？')) viewer.clearAll(); };
  $('#tPrint').onclick = async () => { toast('印刷用に準備しています…'); try { await printViewer(viewer, examTitle(ex)); } catch (e) { toast(e.message); } };
  $('#tPdf').onclick = async () => {
    toast('PDFを作っています…');
    try { downloadBytes(await viewer.inkedPdf(), `${examTitle(ex).replace(/[\s　（）]/g, '_')}_${st.tab}.pdf`); } catch (e) { toast('PDFを作れませんでした：' + e.message); }
  };
  $('#tOrig').onclick = async () => {
    const f = (ex.files[st.tab] || [])[0];
    if (!f) return;
    if (typeof f.src === 'string') window.open(f.src, '_blank');
    else { const r = await db.get('files', f.file); downloadBytes(r.data, r.name); }
  };
  $('#btnPanel').onclick = () => $('#panel').classList.toggle('open');
  const ts = $('#tSplit'); if (ts) ts.onclick = async () => {
    if (st.tab !== 'whole') { await showTab('whole'); return toast('PDF全体を開きました。解答が始まるページまで送ってから、もう一度押してください。', 5000); }
    const cur = viewer.currentPage();
    if (!cur || cur.p < 2) return toast('2ページ目以降を開いてから押してください');
    if (!confirm(`${cur.p} ページ目から後ろを「解答」にします。よろしいですか？`)) return;
    await db.put('kv', 'split:' + id, { src: ex0.files.whole[0].src, page: cur.p });
    toast(`${cur.p} ページ目からを解答にしました`);
    route();
  };

  // 解答欄
  const saveDraft = () => db.put('kv', 'draft:' + ex.id, { mode: st.mode, answers: st.answers, free: st.free, started: st.started });
  const drawPanel = () => {
    const p = $('#panel');
    let h = '';
    if (ex.source) h += `<p class="sub">出典：${esc(ex.source)}</p>`;
    if (ex.mixedAnswers) h += `<div class="note warn">このPDFは、問題のあとに解答用紙・解答が続いています（自動では区切れませんでした）。<b>PDF全体</b>タブで解答が始まるページを開き、<b>ここから解答</b>を押すと分けられます。分けるまでは、本番中に後ろのページを見ないでください。</div>`;
    if (split) h += `<p class="sub">解答は ${split.page} ページ目からに設定済み。<a href="#" id="unsplit">区切りを消す</a></p>`;
    h += st.mode === 'practice'
      ? `<div class="note"><b>練習モード</b>　正答表も見られます。<b>本番スタート</b>を押すと${ex.minutes}分を計り、終わるまで正答表を隠します。</div>`
      : `<div class="note" style="background:var(--ink);color:var(--bg)"><b>本番中</b>　正答表は終了まで見られません。</div>`;
    if (has('audio')) h += `<h3>リスニング音声</h3>${ex.files.audio.map((f, i) => `<audio controls preload="none" data-ai="${i}" style="width:100%"></audio>`).join('')}`;
    else if (has('script')) h += `<h3>リスニング</h3><p class="sub">音声は公開されていません。台本をブラウザの音声で読み上げます（英語の音声が入っているブラウザで）。</p><div class="row-btns"><button id="tts" class="sm">${icon('volume')}台本を読み上げる</button><button id="ttsStop" class="sm ghost">止める</button></div>`;
    if (key) {
      const done = key.items.filter(it => (st.answers[it.id] || '').trim()).length;
      h += `<div class="panel-head"><h3>解答欄</h3><span class="sub num" id="ansCount">${done} / ${key.items.length}</span></div>
      <div class="progress"><i id="ansBar" style="width:${key.items.length ? done / key.items.length * 100 : 0}%"></i></div>
      <div class="ans-list" style="margin-top:14px">${key.items.map(it => `<div class="ans-row"><label>${esc(it.label)}<br><span>${it.points}点</span></label>${
        it.kind === 'essay' ? `<textarea data-id="${esc(it.id)}" class="${(st.answers[it.id] || '').trim() ? 'filled' : ''}">${esc(st.answers[it.id] || '')}</textarea>` : `<input type="text" data-id="${esc(it.id)}" class="${(st.answers[it.id] || '').trim() ? 'filled' : ''}" value="${esc(st.answers[it.id] || '')}" autocomplete="off">`
      }</div>`).join('')}</div>
      <p class="sub" style="margin-top:10px">${key.source === 'ai' ? 'この解答欄は正答表から AI が作りました。' : ''}${key.pointsEstimated ? '配点は推定です。' : ''}</p>
      <p class="sub">手書きで解く場合は「解答用紙」タブに直接書き込めば、終了後に AI 読み取りか自己採点ができます。</p>`;
    } else {
      h += `<div class="panel-head"><h3>解答欄</h3></div><div class="note">この試験の解答欄はまだ作られていません。</div>`;
      if (has('key')) h += `<p><button id="mkKey" class="primary">${icon('spark')}正答表から解答欄を作る</button></p><p class="sub">1回だけ。作った解答欄はこの端末に保存されます（目安 5〜15円）。</p>`;
      h += `<p class="sub">または、下に自由に書いておき、終了後に正答表を見ながら自己採点できます。</p>
        <div class="ans-list" id="free">${st.free.map((r, i) => `<div class="ans-free"><input type="text" data-f="${i}" data-k="q" value="${esc(r.q)}" placeholder="番号"><input type="text" data-f="${i}" data-k="a" value="${esc(r.a)}" placeholder="答え"><button data-del="${i}">×</button></div>`).join('')}</div>
        <p><button id="addFree" class="sm">${icon('plus')}行を足す</button></p>`;
    }
    p.innerHTML = h;
    $$('#panel [data-id]').forEach(el => el.oninput = () => {
      st.answers[el.dataset.id] = el.value; saveDraft();
      el.classList.toggle('filled', !!el.value.trim());
      if (key) { const d = key.items.filter(it => (st.answers[it.id] || '').trim()).length; $('#ansCount').textContent = `${d} / ${key.items.length}`; $('#ansBar').style.width = (d / key.items.length * 100) + '%'; }
    });
    $$('#panel [data-f]').forEach(el => el.oninput = () => { st.free[+el.dataset.f][el.dataset.k] = el.value; saveDraft(); });
    $$('#panel [data-del]').forEach(el => el.onclick = () => { st.free.splice(+el.dataset.del, 1); saveDraft(); drawPanel(); });
    const add = $('#addFree'); if (add) add.onclick = () => { st.free.push({ q: String(st.free.length + 1), a: '' }); drawPanel(); };
    $$('#panel audio').forEach(async a => { const fs = await resolveFiles([ex.files.audio[+a.dataset.ai]]); const f = fs[0]; a.src = typeof f.src === 'string' ? f.src : URL.createObjectURL(new Blob([f.src.data])); });
    const uns = $('#unsplit'); if (uns) uns.onclick = async e => { e.preventDefault(); await db.del('kv', 'split:' + id); route(); };
    const tts = $('#tts'); if (tts) tts.onclick = () => readScript(ex);
    const ttsStop = $('#ttsStop'); if (ttsStop) ttsStop.onclick = () => speechSynthesis.cancel();
    const mk = $('#mkKey'); if (mk) mk.onclick = async () => {
      mk.disabled = true; mk.textContent = 'AI が正答表を読んでいます…';
      try {
        const { key: k, usage } = await AI.buildKey({ title: examTitle(ex), keyDocs: await resolveFiles(ex.files.key), sheetDocs: await resolveFiles(ex.files.sheet), maxPoints: ex.max, onStatus: n => (mk.textContent = `作成中…（${n}字）`) });
        await db.put('keys', ex.id, k); key = k;
        toast(`解答欄を作りました（${k.items.length}問・約${AI.costYen(usage).toFixed(0)}円）`);
        drawPanel();
      } catch (e) { toast(AI.friendlyError(e), 6000); mk.disabled = false; mk.textContent = '正答表から解答欄を作る（AI）'; }
    };
  };

  // 本番
  const tick = () => {
    const left = Math.max(0, ex.minutes * 60 - (Date.now() - st.started) / 1000);
    $('#timerT').textContent = fmtTime(left);
    $('#timer').classList.toggle('low', left < 300);
    if (left <= 0) { finish(true); }
  };
  const setLive = on => {
    st.mode = on ? 'live' : 'practice';
    $('#btnLive').classList.toggle('hide', on);
    $('#btnEnd').classList.toggle('hide', !on);
    $('#timer').classList.toggle('live', on);
    $$('#tabs button').forEach(b => b.disabled = on && LOCKED.includes(b.dataset.t));
    clearInterval(st.timer);
    if (on) { st.timer = setInterval(tick, 500); tick(); }
    drawPanel();
  };
  $('#btnLive').onclick = async () => {
    const hadInk = (await db.keys('ink')).some(k => String(k).startsWith(ex.id + '|'));
    if (hadInk && confirm('前回の書き込みを消してから始めますか？（キャンセルで残したまま始めます）')) {
      for (const k of await db.keys('ink')) if (String(k).startsWith(ex.id + '|')) await db.del('ink', k);
    }
    st.answers = {}; st.free = []; st.started = Date.now();
    await saveDraft();
    if (st.tab !== 'problem' && st.tab !== 'sheet') st.tab = 'problem';
    setLive(true);
    await showTab(st.tab);
    toast(`本番開始：${ex.minutes}分`);
  };
  const finish = async (timeUp) => {
    if (st.finishing) return;
    if (!timeUp && !confirm('解答を終了して採点に進みますか？')) return;
    st.finishing = true;
    clearInterval(st.timer);
    if (timeUp) toast('時間です。');
    // 手書きの解答用紙を画像にして残す（AI 読み取り・自己採点用）
    let sheetImgs = [];
    try {
      if (has('sheet')) {
        const sv = new InkViewer(document.createElement('div'));
        await sv.open(await resolveFiles(ex.files.sheet), `${ex.id}|sheet`);
        if (sv.hasInk()) sheetImgs = (await sv.pageImages({ maxSide: 1800 })).map(x => x.url);
        sv.destroy();
      }
    } catch (e) { console.warn(e); }
    let problemInk = false;
    try { problemInk = (await db.keys('ink')).some(k => String(k).startsWith(ex.id + '|problem')); } catch (e) {}
    const a = {
      id: 'a' + Date.now(), examId: ex.id, mode: 'live', started: st.started, finished: Date.now(),
      used: Math.min(ex.minutes * 60, (Date.now() - st.started) / 1000), answers: st.answers, free: st.free,
      sheetImgs, problemInk, marks: {}, items: key ? key.items : null, cost: 0,
    };
    if (key) {
      for (const it of key.items) { const m = autoMark(it, a.answers[it.id]); if (m && (a.answers[it.id] || '').trim()) a.marks[it.id] = m; }
      // 何も入力せず手書きした場合は、空欄 0 点を付けない（読み取り・自己採点に回す）
      if (!Object.values(a.answers).some(v => (v || '').trim())) a.marks = {};
      a.score = tally(key.items, a.marks);
    }
    await db.put('attempts', a.id, a);
    ATTEMPTS.push(a);
    await db.del('kv', 'draft:' + ex.id);
    location.hash = '#/result/' + a.id;
  };
  $('#btnEnd').onclick = () => finish(false);

  cleanup = () => { clearInterval(st.timer); viewer.destroy(); speechSynthesis.cancel(); settings.set('tool', viewer.tool); };
  setLive(st.mode === 'live');
  await showTab(tabs.find(t => t[0] === 'problem') ? 'problem' : (tabs[0]?.[0] || 'problem'));
  if (!tabs.length) $('#viewer').textContent = 'この試験にはPDFがありません';
}

async function readScript(ex) {
  const files = await resolveFiles(ex.files.script);
  let text = '';
  for (const f of files) {
    const { doc } = await loadPdf(f.src);
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      let line = '', lastY = null;
      for (const it of tc.items) {
        const y = it.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 3) { text += line + '\n'; line = ''; }
        line += it.str; lastY = y;
      }
      text += line + '\n';
    }
  }
  // 英語の行だけ読む（日本語の指示は読まない）
  const en = text.split('\n').map(s => s.trim()).filter(s => s && (s.match(/[A-Za-z]/g) || []).length > s.length * 0.5);
  speechSynthesis.cancel();
  const voice = speechSynthesis.getVoices().find(v => /^en(-|_)/i.test(v.lang));
  if (!voice) toast('このブラウザには英語の音声がありません（Chrome や Edge で開いてください）', 5000);
  for (const s of en) {
    const u = new SpeechSynthesisUtterance(s.replace(/^(A|B|Question|質問)\s*[:：]\s*/i, ''));
    u.lang = 'en-US'; u.rate = 0.9; if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  }
}

// ---------------------------------------------------------------- 結果
async function viewResult(aid) {
  const a = ATTEMPTS.find(x => x.id === aid);
  if (!a) throw new Error('記録が見つかりません');
  const ex = examById(a.examId);
  if (!ex) throw new Error('試験が見つかりません');
  const test = testById(ex.test);
  let key = a.items ? { items: a.items } : await getKey(ex);
  if (key && !a.items) { a.items = key.items; }
  const save = async () => { if (a.items) a.score = tally(a.items, a.marks); await db.put('attempts', a.id, a); };
  let chat = (await db.get('chats', a.id)) || [];

  const draw = () => {
    const items = a.items;
    const sc = items ? tally(items, a.marks) : (a.manual ? { got: a.manual.got, max: a.manual.max, pending: 0 } : null);
    if (sc) a.score = sc;
    const dev = attemptDev(a);
    const school = test?.school ? schoolById(test.school) : null;
    const related = (test?.kind === 'common' ? schoolsOfTest(ex.test) : school ? [school] : []).slice(0, 40);
    const pct = sc && sc.max ? sc.got / sc.max * 100 : 0;
    app.innerHTML = `<div class="page">
      <div class="crumb"><a href="#/history">記録</a>${icon('next')}${fmtDate(a.finished)}</div>
      <h1>${ex.year}年（${reiwa(ex.year)}）${ex.subject}</h1>
      <p class="sub" style="margin-top:-4px">${esc(testById(ex.test)?.name || '')}</p>
      <section class="card score-card">
        <div class="score-main">
          <div class="lbl">得点${sc && sc.pending ? `　<span class="pill warn">未採点 ${sc.pending}問</span>` : ''}</div>
          <div class="score-big">${sc ? sc.got : '—'}<small> / ${sc ? sc.max : ex.max}</small></div>
          <div class="progress"><i style="width:${pct}%"></i></div>
        </div>
        <div class="score-side">
          <div><span class="lbl">推定偏差値</span><b>${dev ?? '—'}</b><span class="sub">この教科</span></div>
          <div><span class="lbl">受検者平均</span><b>${ex.mean != null ? ex.mean : '—'}</b><span class="sub">${ex.mean != null ? '点' : '公表なし'}</span></div>
          <div><span class="lbl">かかった時間</span><b>${fmtTime(a.used)}</b><span class="sub">/ ${ex.minutes}分</span></div>
        </div>
      </section>
      <div class="row-btns">
        ${items && pendingTyped().length ? `<button id="aiTyped" class="primary">${icon('spark')}残りを AI で採点</button>` : ''}
        ${a.sheetImgs?.length ? `<button id="aiHand">${icon('spark')}手書きを AI で読み取って採点</button>` : ''}
        ${!items && ex.files.key?.length ? `<button id="mkKey2">${icon('spark')}正答表から解答欄を作る</button>` : ''}
        <button id="selfView">${icon('check')}正答表を見て自己採点</button>
        <a class="btn ghost" href="#/exam/${ex.id}">${icon('pen')}もう一度解く</a>
        <button id="delA" class="ghost danger" style="margin-left:auto">${icon('trash')}記録を消す</button>
      </div>
      <div id="selfArea" class="hide"></div>
      ${items ? `<div class="res-wrap">${resultTable(items)}</div>` : manualScore(sc)}
      ${sc && !sc.pending && related.length ? `<h2>合格判定（この結果から）</h2>${judgeTable(related, dev, test)}` : ''}
      <h2>${icon('spark')} AI に解説してもらう</h2>
      <div class="quick" id="quick">
        <button data-q="講評" class="sm">講評してもらう</button>
        <button data-q="全部" class="sm">間違えた問題を順に解説</button>
        ${items ? `<select id="qSel" style="height:32px;font-size:13px"><option value="">問題を選んで解説…</option>${items.map(it => `<option value="${esc(it.id)}">${esc(it.label)}${a.marks[it.id]?.verdict === 'ok' ? '' : ' ×'}</option>`).join('')}</select>` : ''}
      </div>
      <div class="chat"><div class="chat-log" id="log">${chat.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('') || '<p class="muted" style="margin:0">わからない所をそのまま質問できます。問題・正答表・あなたの答えを AI が読んだうえで答えます。</p>'}</div>
        <div class="chat-in"><textarea id="ask" placeholder="例：大問3の(2)、なぜ相似を使うと思いつくの？（Ctrl+Enterで送信）"></textarea><button class="primary icon" id="send" aria-label="送る">${icon('send')}</button></div></div>
      <p class="sub" style="margin-top:14px">AI 利用の目安：この記録で約${(a.cost || 0).toFixed(0)}円　·　<a href="#" id="method">推定偏差値の計算のしかた</a></p>
      <div id="methodBox" class="note hide" style="white-space:pre-wrap">${esc(METHOD_NOTE)}</div>
    </div>`;
    bindResult();
  };

  const pendingTyped = () => (a.items || []).filter(it => !a.marks[it.id] && (a.answers[it.id] || '').trim());

  function resultTable(items) {
    return `<table class="res-table"><tr><th>問題</th><th>あなたの答え</th><th>正答</th><th>点</th></tr>${items.map(it => {
      const m = a.marks[it.id] || {};
      const mine = a.answers[it.id] || m.read || '';
      return `<tr class="${m.verdict || ''}"><td>${esc(it.label)}<br><span class="sub">${it.points}点</span></td>
        <td class="mine">${esc(mine) || '<span class="sub">（空欄）</span>'}${m.comment ? `<div class="ai-note">${esc(m.comment)}</div>` : ''}</td>
        <td class="cor">${esc(it.answer)}${it.alts?.length ? `<div class="ai-note">別解：${esc(it.alts.join('、'))}</div>` : ''}</td>
        <td><div class="mark" data-id="${esc(it.id)}">
          <button class="ok ${m.verdict === 'ok' ? 'on' : ''}" data-v="ok">○</button>
          <button class="part ${m.verdict === 'part' ? 'on' : ''}" data-v="part">△</button>
          <button class="ng ${m.verdict === 'ng' ? 'on' : ''}" data-v="ng">×</button>
          <input type="number" step="0.5" min="0" max="${it.points}" value="${m.points ?? ''}" title="点">
        </div><div class="ai-note">${m.by === 'ai' ? 'AI採点' : m.by === 'self' ? '自己採点' : m.by === 'auto' ? '自動' : ''}</div></td></tr>`;
    }).join('')}</table>`;
  }
  function manualScore(sc) {
    return `<div class="card"><p>この試験には解答欄（設問ごとの正答）がまだありません。正答表を見ながら自己採点して、合計点を入れてください。</p>
      ${a.free?.length ? `<p class="sub">あなたのメモした答え：${a.free.map(r => esc(r.q) + ' ' + esc(r.a)).join('　')}</p>` : ''}
      <div class="kv"><label>得点</label><span><input type="number" id="mGot" value="${sc ? sc.got : ''}" style="width:90px"> / <input type="number" id="mMax" value="${sc ? sc.max : ex.max}" style="width:90px"> 点 <button id="mSave">保存</button></span></div></div>`;
  }
  function judgeTable(list, dev, t) {
    const cal = calibOf(t);
    return `<p class="sub">${t.kind === 'common' ? 'この試験を使う高校' : 'この学校'}について、この教科の結果だけで出した目安です。3教科そろうと「合格判定」ページでまとめて出ます。</p>
    <div class="res-wrap"><table class="judge-table"><tr><th>判定</th><th>高校</th><th>偏差値</th><th>合格の目安</th></tr>${list.map(s => {
      let v = dev, note = '';
      if (s.kind === '公立') { const r = naishinAdj(s.pref, s.dev, settings.get('naishin', null)); v = dev + r.dp / (cal.slope || 2); note = r.text; }
      const j = judge(v - s.dev);
      const need = cal.p60 != null ? cal.p60 + (s.dev - 60) * cal.slope : cal.pass;
      return `<tr><td><span class="kbadge ${j.k}">${j.k}</span></td><td><a href="#/school/${s.id}">${esc(s.name)}</a>${note ? `<div class="ai-note">${esc(note)}</div>` : ''}</td><td class="num">${s.dev}</td><td>得点率 <span class="num">${Math.round(need)}</span>%前後</td></tr>`;
    }).join('')}</table></div>`;
  }

  async function aiRun(btn, label, fn) {
    btn.disabled = true; const t0 = btn.textContent; btn.textContent = label;
    try { await fn(n => (btn.textContent = `${label}（${n}字）`)); }
    catch (e) { toast(AI.friendlyError(e), 6000); }
    btn.disabled = false; btn.textContent = t0;
  }
  async function refDocs() {
    const out = [];
    for (const k of ['key', 'points']) for (const f of await resolveFiles(ex.files[k])) out.push({ ...f, label: k === 'key' ? '正答表' : '採点のポイント' });
    return out;
  }
  function applyResults(results, by) {
    for (const r of results) {
      const it = a.items.find(x => x.id === r.id); if (!it) continue;
      a.marks[it.id] = { points: Math.max(0, Math.min(it.points, r.points)), verdict: r.verdict, by, comment: r.comment, read: r.read };
    }
  }

  function bindResult() {
    $('#method').onclick = e => { e.preventDefault(); $('#methodBox').classList.toggle('hide'); };
    $('#delA').onclick = async () => {
      if (!confirm('この記録を消しますか？（元に戻せません）')) return;
      await db.del('attempts', a.id); await db.del('chats', a.id);
      ATTEMPTS = ATTEMPTS.filter(x => x !== a); location.hash = '#/history';
    };
    $$('.res-table .mark').forEach(box => {
      const it = a.items.find(x => x.id === box.dataset.id);
      box.addEventListener('click', async e => {
        const b = e.target.closest('button'); if (!b) return;
        const v = b.dataset.v;
        const pts = v === 'ok' ? it.points : v === 'ng' ? 0 : (a.marks[it.id]?.points ?? Math.round(it.points / 2));
        a.marks[it.id] = { ...(a.marks[it.id] || {}), points: pts, verdict: v, by: 'self' };
        await save(); draw();
      });
      $('input', box).onchange = async e => {
        const p = Math.max(0, Math.min(it.points, +e.target.value || 0));
        a.marks[it.id] = { ...(a.marks[it.id] || {}), points: p, verdict: p >= it.points ? 'ok' : p > 0 ? 'part' : 'ng', by: 'self' };
        await save(); draw();
      };
    });
    const ms = $('#mSave'); if (ms) ms.onclick = async () => { a.manual = { got: +$('#mGot').value || 0, max: +$('#mMax').value || ex.max }; a.score = { ...a.manual, pending: 0 }; await db.put('attempts', a.id, a); draw(); };
    const at = $('#aiTyped'); if (at) at.onclick = () => aiRun(at, 'AI が採点中…', async st => {
      const items = pendingTyped();
      const { data, usage } = await AI.gradeTyped({ title: examTitle(ex), items, answers: a.answers, refDocs: await refDocs(), onStatus: st });
      applyResults(data.results, 'ai'); a.cost = (a.cost || 0) + AI.costYen(usage); await save(); draw();
    });
    const ah = $('#aiHand'); if (ah) ah.onclick = () => aiRun(ah, 'AI が手書きを読んでいます…', async st => {
      if (!a.items) throw new Error('先に「正答表から解答欄を作る」を押してください。');
      const { data, usage } = await AI.gradeHandwritten({ title: examTitle(ex), items: a.items, images: a.sheetImgs, refDocs: await refDocs(), onStatus: st });
      // 画面で入力した答えがある問題は、その採点を優先する
      applyResults(data.results.filter(r => !(a.answers[r.id] || '').trim()), 'ai');
      a.cost = (a.cost || 0) + AI.costYen(usage); await save(); draw();
    });
    const mk = $('#mkKey2'); if (mk) mk.onclick = () => aiRun(mk, 'AI が正答表を読んでいます…', async st => {
      const { key: k, usage } = await AI.buildKey({ title: examTitle(ex), keyDocs: await resolveFiles(ex.files.key), sheetDocs: await resolveFiles(ex.files.sheet), maxPoints: ex.max, onStatus: st });
      await db.put('keys', ex.id, k); a.items = k.items; a.cost = (a.cost || 0) + AI.costYen(usage); await save(); draw();
    });
    $('#selfView').onclick = async () => {
      const box = $('#selfArea');
      if (!box.classList.toggle('hide')) {
        box.innerHTML = `<div class="card"><h3>正答表</h3><div class="viewer" id="keyV" style="height:70vh;border-radius:10px"></div>
          ${a.sheetImgs?.length ? `<h3>あなたの解答用紙</h3>${a.sheetImgs.map(u => `<img src="${u}" style="width:100%;border:1px solid var(--line)">`).join('')}` : ''}
          ${a.problemInk ? '<p class="sub">問題用紙への書き込みは「もう一度解く・問題を見る」で見られます。</p>' : ''}
          <p class="sub">下の表の ○ △ × を押すか、点数を直接入れて自己採点してください。</p></div>`;
        const kv = new InkViewer($('#keyV'));
        await kv.open(await resolveFiles(ex.files.key), null);
      }
    };
    // チャット
    const log = $('#log');
    const send = async (q) => {
      if (!q.trim()) return;
      if (!AI.hasKey()) return toast('設定画面で API キーを入れてください', 4000);
      chat.push({ role: 'user', content: q });
      if (!chat.length || chat.length === 1) log.innerHTML = '';
      log.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(q)}</div><div class="msg ai" id="cur"><span class="thinking">考えています</span></div>`);
      log.scrollTop = log.scrollHeight;
      const cur = $('#cur'); cur.removeAttribute('id');
      $('#send').disabled = true;
      try {
        const ctx = await chatContext();
        await AI.streamChat({
          context: ctx, history: chat.map(m => ({ role: m.role, content: m.content })),
          onText: t => { cur.innerHTML = md(t); log.scrollTop = log.scrollHeight; },
          onDone: async (t, usage) => { chat.push({ role: 'assistant', content: t }); a.cost = (a.cost || 0) + AI.costYen(usage); await db.put('chats', a.id, chat); await db.put('attempts', a.id, a); },
        });
      } catch (e) {
        chat.pop();
        cur.innerHTML = `<span class="thinking">${esc(AI.friendlyError(e))}</span>`;
      }
      $('#send').disabled = false;
    };
    $('#send').onclick = () => { const q = $('#ask').value; $('#ask').value = ''; send(q); };
    $('#ask').onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#send').click(); };
    $('#quick').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.q === '講評') send('この答案を講評してください。よくできた所、弱点（単元・考え方）、この学校・偏差値帯を目指すうえで次に何をやればいいかを具体的に。');
      if (b.dataset.q === '全部') send('間違えた（または部分点の）問題を、問題の順に1問ずつ解説してください。それぞれ「正しい答え」「どこで間違えたか」「解き方」を短く。');
    });
    const qs = $('#qSel'); if (qs) qs.onchange = () => { const it = a.items.find(x => x.id === qs.value); if (it) send(`${it.label} を解説してください。`); qs.value = ''; };
  }

  async function chatContext() {
    const content = [];
    const probs = await resolveFiles(ex.files.problem);
    for (const f of probs) content.push(await AI.pdfBlock(f.src, '問題'));
    for (const f of await resolveFiles(ex.files.script)) content.push(await AI.pdfBlock(f.src, 'リスニング台本'));
    for (const f of await refDocs()) content.push(await AI.pdfBlock(f.src, f.label));
    if (content.length) content[content.length - 1].cache_control = { type: 'ephemeral' };
    for (const u of (a.sheetImgs || []).slice(0, 4)) content.push(AI.imageBlock(u));
    const rows = (a.items || []).map(it => {
      const m = a.marks[it.id] || {};
      return `${it.label}（${it.points}点）正答「${it.answer}」／生徒「${a.answers[it.id] || m.read || '空欄'}」／${m.points ?? '未採点'}点`;
    });
    content.push({ type: 'text', text:
`これは「${examTitle(ex)}」（制限時間${ex.minutes}分）を生徒が解いた結果です。${test?.school ? '' : ''}
得点：${a.score ? `${a.score.got}/${a.score.max}点` : '未採点'}　${attemptDev(a) != null ? `推定偏差値 ${attemptDev(a)}` : ''}${ex.mean != null ? `　受検者平均 ${ex.mean}点` : ''}
${rows.length ? '設問ごとの結果：\n' + rows.join('\n') : (a.free?.length ? '生徒のメモした答え：' + a.free.map(r => r.q + ' ' + r.a).join(' / ') : '')}
${a.sheetImgs?.length ? '（画像は生徒が手書きした解答用紙です）' : ''}` });
    return content;
  }

  draw();
}

// ---------------------------------------------------------------- 合格判定
async function viewJudge() {
  const devs = myDevs();
  const all = avgDev(devs);
  const n = settings.get('naishin', { main: '', skill: '' }) || { main: '', skill: '' };
  const f = settings.get('judgeFilter', 'all');
  app.innerHTML = `<div class="page">
    <div class="kicker">Judgement</div>
    <h1>合格判定</h1>
    <p class="lead muted">解いた試験の結果から教科ごとの推定偏差値を出し、収録している全校を判定します。公立は内申を入れると精度が上がります。</p>
    <div class="card" style="padding:0"><div class="big-stats" style="margin:0">${SUBJECTS.map(s => `<div><span>${s}</span><b>${devs[s]?.dev ?? '—'}</b><span title="${devs[s] ? esc(examTitle(devs[s].e)) : ''}">${devs[s] ? esc(devs[s].e.year + '年 ' + (testById(devs[s].e.test)?.short || '')) : '未受験'}</span></div>`).join('')}
      <div class="main"><span>3教科</span><b>${all ?? '—'}</b><span>推定偏差値</span></div></div></div>
    <div class="card"><h3>内申（中3の5段階評定）</h3><div class="kv">
      <label>主要5教科の合計</label><span><input type="number" id="nMain" min="5" max="25" value="${esc(String(n.main ?? ''))}" style="width:84px"> / 25</span>
      <label>実技4教科の合計</label><span><input type="number" id="nSkill" min="4" max="20" value="${esc(String(n.skill ?? ''))}" style="width:84px"> / 20</span>
    </div><p class="sub" style="margin:12px 0 0">都立は換算内申（5教科＋実技×2）、神奈川・千葉は9教科合計×3で近似して使います。</p></div>
    ${all == null ? '<div class="note">まだ採点済みの試験がありません。学校一覧から問題を解いてください。</div>' : ''}
    <div class="filters"><div class="seg" id="jf">${['all', '東京', '神奈川', '千葉'].map(p => `<button class="${f === p ? 'on' : ''}" data-v="${p}">${p === 'all' ? 'すべて' : p}</button>`).join('')}</div></div>
    <div id="jt"></div>
    <p class="sub" style="margin-top:14px"><a href="#" id="method">推定偏差値の計算のしかた</a></p>
    <div id="methodBox" class="note hide" style="white-space:pre-wrap">${esc(METHOD_NOTE)}</div>
  </div>`;
  const draw = () => {
    if (all == null) { $('#jt').innerHTML = ''; return; }
    const pf = settings.get('judgeFilter', 'all');
    const rows = CAT.schools.filter(s => pf === 'all' || s.pref === pf).map(s => ({ s, j: judgeSchool(s) })).filter(x => x.j);
    $('#jt').innerHTML = `<div class="res-wrap"><table class="judge-table"><tr><th>判定</th><th>高校</th><th>偏差値</th><th>あなた</th><th>根拠</th></tr>${rows.map(({ s, j }) =>
      `<tr><td><span class="kbadge ${j.k}">${j.k}</span> <span class="sub">${j.p}</span></td><td><a href="#/school/${s.id}">${esc(s.name)}</a><div class="ai-note">${s.pref}・${s.kind}</div></td><td class="num">${s.dev}</td><td class="num">${j.v}${j.adj ? `<div class="ai-note">内申で ${j.adj > 0 ? '+' : ''}${j.adj.toFixed(1)}</div>` : ''}</td><td class="sub">${j.basis}${j.ntext ? '・' + esc(j.ntext) : ''}</td></tr>`).join('')}</table></div>`;
  };
  const saveN = () => { settings.set('naishin', { main: $('#nMain').value === '' ? null : +$('#nMain').value, skill: $('#nSkill').value === '' ? null : +$('#nSkill').value }); draw(); };
  $('#nMain').onchange = saveN; $('#nSkill').onchange = saveN;
  $('#jf').onclick = e => { const b = e.target.closest('button'); if (!b) return; settings.set('judgeFilter', b.dataset.v); $$('#jf button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#method').onclick = e => { e.preventDefault(); $('#methodBox').classList.toggle('hide'); };
  draw();
}

// ---------------------------------------------------------------- 記録
async function viewHistory() {
  const list = [...ATTEMPTS].sort((a, b) => b.finished - a.finished);
  app.innerHTML = `<div class="page"><div class="kicker">History</div><h1>記録</h1>
    ${list.length ? `<ul class="list hist" style="margin-top:20px">${list.map(a => {
      const e = examById(a.examId);
      const dv = attemptDev(a);
      return `<li><a class="row" href="#/result/${a.id}">
        <div class="dev ${devClass(dv)}">${dv != null ? Math.round(dv) : '—'}</div>
        <div><div class="sname">${e ? `${esc(testById(e.test)?.name || '')}　${e.year}年 ${e.subject}` : esc(a.examId)}</div><div class="when">${fmtDate(a.finished)}</div></div>
        <div class="tags">${a.score ? `<span class="score-pill">${a.score.got}<span class="sub"> / ${a.score.max}</span></span>${a.score.pending ? `<span class="pill warn">未採点${a.score.pending}</span>` : ''}` : '<span class="pill">未採点</span>'}</div>
        ${icon('next')}</a></li>`;
    }).join('')}</ul>` : '<p class="muted" style="margin-top:20px">まだ記録がありません。学校一覧から問題を解くと、ここに残ります。</p>'}
  </div>`;
}

// ---------------------------------------------------------------- 設定
async function viewSettings() {
  const key = settings.get('apiKey', '');
  app.innerHTML = `<div class="page"><div class="kicker">Settings</div><h1>設定</h1>
    <div class="card"><h3>AI（Anthropic API キー）</h3>
      <div class="kv">
        <label>API キー</label><span><input type="password" id="sKey" value="${esc(key)}" placeholder="sk-ant-..." style="width:100%;max-width:420px" autocomplete="off"> <button id="sShow">表示</button></span>
        <label>モデル</label><select id="sModel">${AI.MODELS.map(m => `<option value="${m.id}" ${settings.get('model', 'claude-opus-5-5') === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
      </div>
      <p class="sub">キーはこの端末のブラウザの中（localStorage）にだけ保存され、AI を使うときにブラウザから直接 Anthropic に送られます。料金はキーの持ち主の Anthropic アカウントに請求されます。目安：解答欄づくり 5〜15円、AI 採点 1回 5〜30円、解説 1回 5〜20円（Opus の場合）。</p>
      <p class="sub">AI が安全上の理由で回答を断った場合は、サーバー側で別のモデルが自動で引き継ぐ設定にしています（Haiku を除く）。</p>
      <div class="row-btns"><button class="primary" id="sSave">保存</button><button id="sTest">接続テスト</button></div></div>
    <div class="card"><h3>書き込み</h3>
      <span class="switch ${settings.get('penOnly', false) ? 'on' : ''}" id="sPen" role="switch"><i></i>ペンだけで書く（指はスクロール）— iPad と Apple Pencil などで便利</span></div>
    <div class="card"><h3>表示</h3>
      <div class="seg" id="sTheme">${[['', '端末に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div></div>
    <div class="card"><h3>データ</h3>
      <p class="sub">記録・書き込み・取り込んだ過去問・AI が作った解答欄は、すべてこのブラウザの中にあります。ブラウザのデータを消すと消えます。</p>
      <div class="row-btns"><button id="sExport">記録を書き出す（JSON）</button><label class="btn">記録を読み込む<input type="file" id="sImport" accept="application/json" hidden></label></div></div>
  </div>`;
  const curTheme = (() => { try { return localStorage.getItem('kakomon.theme') || ''; } catch (e) { return ''; } })();
  $$('#sTheme button').forEach(b => b.classList.toggle('on', b.dataset.v === curTheme));
  $('#sTheme').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = b.dataset.v;
    try { v ? localStorage.setItem('kakomon.theme', v) : localStorage.removeItem('kakomon.theme'); } catch (_) {}
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
    $$('#sTheme button').forEach(x => x.classList.toggle('on', x === b));
  };
  $('#sShow').onclick = () => { const i = $('#sKey'); i.type = i.type === 'password' ? 'text' : 'password'; };
  $('#sSave').onclick = () => { settings.set('apiKey', $('#sKey').value.trim()); settings.set('model', $('#sModel').value); toast('保存しました'); };
  $('#sModel').onchange = () => settings.set('model', $('#sModel').value);
  $('#sPen').onclick = e => { const on = !settings.get('penOnly', false); settings.set('penOnly', on); e.currentTarget.classList.toggle('on', on); };
  $('#sTest').onclick = async () => {
    settings.set('apiKey', $('#sKey').value.trim()); settings.set('model', $('#sModel').value);
    const b = $('#sTest'); b.disabled = true; b.textContent = '確認中…';
    try {
      let out = '';
      await AI.streamChat({ context: [{ type: 'text', text: '接続テストです。' }], history: [{ role: 'user', content: '「接続OK」とだけ返してください。' }], effort: 'low', onText: t => (out = t) });
      toast('つながりました：' + out.slice(0, 30));
    } catch (e) { toast(AI.friendlyError(e), 6000); }
    b.disabled = false; b.textContent = '接続テスト';
  };
  $('#sExport').onclick = async () => {
    const data = { v: 1, attempts: await db.all('attempts'), chats: await db.all('chats'), keys: await db.all('keys'), ink: await db.all('ink') };
    downloadBytes(new TextEncoder().encode(JSON.stringify(data)), `kakomon-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  };
  $('#sImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const data = JSON.parse(await f.text());
    for (const st of ['attempts', 'chats', 'keys', 'ink']) for (const [k, v] of data[st] || []) await db.put(st, k, v);
    ATTEMPTS = (await db.all('attempts')).map(x => x[1]);
    toast('読み込みました');
  };
}

// ---------------------------------------------------------------- 起動
(async () => {
  $('#burger').onclick = () => $('#nav').classList.toggle('open');
  try {
    CAT = await (await fetch('data/catalog.json', { cache: 'no-store' })).json();
  } catch (e) {
    app.innerHTML = '<div class="page"><div class="note warn">data/catalog.json が読めません。scripts/build.py を実行してください。</div></div>';
    return;
  }
  ATTEMPTS = (await db.all('attempts')).map(x => x[1]);
  USER_EXAMS = (await db.get('kv', 'userExams')) || [];
  window.addEventListener('hashchange', route);
  route();
})();
