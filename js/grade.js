// 採点（自動照合）と、推定偏差値・合格判定の計算。
// 数字はすべてここで決まった式で出す（AI には推測させない）。式の前提は画面の「計算のしかた」に出す。

export function norm(s) {
  if (s == null) return '';
  let t = String(s).normalize('NFKC').toLowerCase();
  t = t.replace(/ルート|root|sqrt/g, '√').replace(/[−‐‑–—ー―]/g, '-').replace(/[×✕]/g, '*').replace(/[÷]/g, '/');
  t = t.replace(/[\s　,，、。．.・()（）「」『』\[\]【】]/g, '');
  t = t.replace(/^(答え?|a)[:：=]?/, '');
  return t;
}

const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ';
function choiceSet(s) {
  const t = String(s || '').normalize('NFKC');
  const kana = [...t].filter(ch => KANA.includes(ch));
  if (kana.length) return kana;
  const lat = t.toUpperCase().match(/\b[A-H]\b/g);
  if (lat) return lat;
  const num = t.match(/[①-⑳]|\d+/g);
  return num || [];
}

// 1 問の自動照合。決められないものは null（AI か自己採点に回す）
export function autoMark(item, ans) {
  const a = (ans ?? '').trim();
  if (!a) return { points: 0, verdict: 'ng', by: 'auto', comment: '空欄' };
  const cands = [item.answer, ...(item.alts || [])].filter(Boolean);
  if (item.kind === 'choice') {
    const want = choiceSet(item.answer);
    const got = choiceSet(a);
    if (want.length && got.length) {
      const anyOrder = /順不同/.test(item.answer + item.criteria);
      const same = anyOrder || want.length > 1 && got.length > 1
        ? want.length === got.length && [...want].sort().join() === [...got].sort().join()
        : want.join() === got.join();
      if (same) return { points: item.points, verdict: 'ok', by: 'auto' };
      if (cands.some(c => norm(c) === norm(a))) return { points: item.points, verdict: 'ok', by: 'auto' };
      return { points: 0, verdict: 'ng', by: 'auto' };
    }
  }
  if (cands.some(c => norm(c) === norm(a))) return { points: item.points, verdict: 'ok', by: 'auto' };
  if (item.kind === 'essay') return null;
  // 数値は値として比べる（0.5 と 1/2 など）
  const va = numVal(a), vc = cands.map(numVal).filter(v => v != null);
  if (va != null && vc.length) {
    if (vc.some(v => Math.abs(v - va) < 1e-9)) return { points: item.points, verdict: 'ok', by: 'auto' };
  }
  return null; // 短答でも表記の違いがありうるので、AI か自分で判定
}

function numVal(s) {
  const t = norm(s).replace(/^[a-z]=/, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const f = t.match(/^(-?\d+)\/(\d+)$/);
  if (f) return +f[1] / +f[2];
  return null;
}

export function tally(items, marks) {
  let got = 0, max = 0, pending = 0;
  for (const it of items) {
    max += it.points;
    const m = marks[it.id];
    if (!m || m.points == null) pending++;
    else got += m.points;
  }
  return { got: Math.round(got * 10) / 10, max, pending };
}

// ---------------------------------------------------------------- 推定偏差値
// 偏差値の物差しは「みんなの高校情報」の高校偏差値。
// 共通問題：その偏差値の高校に受かる目安の得点率 p(H) = p60 + (H − 60) × slope を置き、逆に解く。
// 学校独自問題：その学校の合格ライン（得点率 pass）を学校の偏差値に対応させ、1 点 = 1/slope 偏差値で上下させる。
export const CALIB = {
  'tokyo-common': { p60: 74, slope: 1.6, base: { 国語: 72, 数学: 60, 英語: 62 } },
  'kanagawa-common': { p60: 62, slope: 2.0, base: { 国語: 62, 数学: 52, 英語: 56 } },
  'chiba-common': { p60: 62, slope: 1.8, base: { 国語: 60, 数学: 55, 英語: 56 } },
  jiko: { pass: 65, slope: 2.4 },
  own: { pass: 62, slope: 2.5 },
};

export function calibOf(test) {
  if (!test) return CALIB.own; // 試験が未収録の学校（取り込み前）
  if (CALIB[test.id]) return CALIB[test.id];
  if (test.kind === 'jiko') return { ...CALIB.jiko, ...(test.calib || {}) };
  return { ...CALIB.own, ...(test.calib || {}) };
}

// 1 教科の得点率 → 推定偏差値
export function estDev({ test, school, subject, pct, mean }) {
  const c = calibOf(test);
  let p = pct;
  if (c.base && mean != null && c.base[subject] != null) p += (c.base[subject] - mean) * 0.5; // 難しい年は上乗せ
  if (c.p60 != null) return clampDev(60 + (p - c.p60) / c.slope);
  const H = school?.dev ?? test.devRef ?? 65;
  return clampDev(H + (p - c.pass) / c.slope);
}
function clampDev(x) { return Math.max(30, Math.min(80, Math.round(x * 10) / 10)); }

// ---------------------------------------------------------------- 内申
// 入力は中3の 5段階評定：主要5教科の合計（/25）と実技4教科の合計（/20）
export function naishinAdj(pref, H, n) {
  if (!n || n.main == null || n.skill == null) return { dp: 0, text: '' };
  const main = +n.main, skill = +n.skill;
  if (pref === '東京') {
    const kan = main + skill * 2; // 換算内申（65満点）
    const typ = 52 + (H - 60) * 0.75;
    return { dp: (kan - typ) * 0.66, text: `換算内申 ${kan}/65（この偏差値帯の目安 ${typ.toFixed(0)}）` };
  }
  const nine = main + skill; // 9教科合計（45満点）
  if (pref === '神奈川') {
    const v = nine * 3; // 中2＋中3×2 を中3の値で近似（135満点）
    const typ = 105 + (H - 60) * 1.7;
    return { dp: (v - typ) * 0.4, text: `内申 ${v}/135（目安 ${typ.toFixed(0)}）` };
  }
  if (pref === '千葉') {
    const v = nine * 3; // 中1〜中3を中3の値で近似（135満点）
    const typ = 110 + (H - 60) * 1.5;
    return { dp: (v - typ) * 0.15, text: `調査書 ${v}/135（目安 ${typ.toFixed(0)}）` };
  }
  return { dp: 0, text: '' };
}

// 偏差値の差 → 判定
export function judge(d) {
  if (d >= 3) return { k: 'A', p: '80%以上' };
  if (d >= 1) return { k: 'B', p: '65%' };
  if (d >= -1) return { k: 'C', p: '50%' };
  if (d >= -3) return { k: 'D', p: '35%' };
  return { k: 'E', p: '20%以下' };
}

export const METHOD_NOTE = `推定偏差値は目安です。本物の模試のような受験者全体の分布はないので、次のように見積もっています。
・都立・神奈川・千葉の共通問題：その高校に受かるのに必要な得点率を偏差値から決める式（例：都立共通は偏差値60で74%、1上がるごとに +1.6%）を置き、あなたの得点率から逆算します。教育委員会が出している教科別平均点が基準より低い年（難しい年）は、その分を上乗せします。
・自校作成・私立・国立の独自問題：その学校の合格ラインを得点率65%（自校作成）／62%（私立・国立）と仮定し、それより2.4〜2.5%高いごとに偏差値を1上げます。
・公立の判定には内申を足します（設定で入力した評定から、偏差値帯ごとの内申の目安との差を得点に換算）。
・高校の偏差値は「みんなの高校情報」の値です。`;
