// PDF を縦に並べて表示し、各ページの上に書き込み用のキャンバスを重ねる。
// 書き込みはページ幅を 1 とした座標で保存するので、拡大・縮小しても崩れない。
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { db, settings } from './store.js';

const base = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
const DOC_OPTS = {
  cMapUrl: base + 'cmaps/', cMapPacked: true,
  standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/',
};

const docCache = new Map();
export async function loadPdf(src) {
  // src: URL 文字列 か {data: ArrayBuffer, id}
  const key = typeof src === 'string' ? src : src.id;
  if (docCache.has(key)) return docCache.get(key);
  const p = (async () => {
    let data;
    if (typeof src === 'string') {
      const r = await fetch(src);
      if (!r.ok) throw new Error('PDFを読めません: ' + src);
      data = new Uint8Array(await r.arrayBuffer());
    } else data = new Uint8Array(src.data);
    const bytes = data.slice(0); // pdf.js はバッファを手放すので、書き出し用に写しを残す
    const doc = await pdfjsLib.getDocument({ data, ...DOC_OPTS }).promise;
    return { doc, bytes };
  })();
  docCache.set(key, p);
  p.catch(() => docCache.delete(key));
  return p;
}

export const PEN_COLORS = ['#111111', '#d0312d', '#1f5bd8', '#1a8a4a'];

export class InkViewer {
  constructor(el, { onInk } = {}) {
    this.el = el;
    this.onInk = onInk;
    this.pages = [];
    this.zoom = settings.get('zoom', 1);
    this.tool = 'pen';
    this.color = PEN_COLORS[0];
    this.width = 0.0022; // ページ幅に対する太さ
    this.undo = [];
    this.saveTimers = new Map();
    this.io = new IntersectionObserver(es => {
      for (const e of es) if (e.isIntersecting) this.render(e.target._pg);
    }, { root: el, rootMargin: '600px 0px' });
    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(el);
    this.lastW = 0;
  }

  destroy() { this.io.disconnect(); this.ro.disconnect(); this.el.innerHTML = ''; }

  // sources: [{src, label}] 。inkPrefix が null なら書き込み不可（正答表など）
  async open(sources, inkPrefix) {
    this.el.innerHTML = '';
    this.el.classList.remove('empty');
    this.pages = [];
    this.undo = [];
    this.sources = sources;
    this.inkPrefix = inkPrefix;
    const token = (this.token = Symbol());
    for (let i = 0; i < sources.length; i++) {
      let pdf;
      try { pdf = await loadPdf(sources[i].src); } catch (e) {
        const d = document.createElement('div'); d.className = 'note warn'; d.style.margin = '12px';
        d.textContent = e.message; this.el.append(d); continue;
      }
      if (token !== this.token) return;
      // pages: [最初, 最後]（1 始まり）。1 本の PDF に問題と解答が入っているときに一部だけ出す
      const [p0, p1] = sources[i].pages || [1, pdf.doc.numPages];
      for (let p = Math.max(1, p0); p <= Math.min(p1, pdf.doc.numPages); p++) {
        const page = await pdf.doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const wrap = document.createElement('div');
        wrap.className = 'pg';
        const cv = document.createElement('canvas');
        const ink = document.createElement('canvas');
        ink.className = 'ink';
        const no = document.createElement('div'); no.className = 'pno'; no.textContent = `${p}`;
        wrap.append(cv, ink, no);
        const pg = { i, p, page, w1: vp.width, h1: vp.height, wrap, cv, ink, strokes: [], rendered: 0,
          key: inkPrefix ? `${inkPrefix}|${i}|${p}` : null };
        wrap._pg = pg;
        if (pg.key) pg.strokes = (await db.get('ink', pg.key)) || [];
        this.bindInk(pg);
        this.pages.push(pg);
        this.el.append(wrap);
      }
    }
    if (!this.pages.length && !this.el.children.length) {
      this.el.classList.add('empty');
      this.el.textContent = 'PDFがありません';
    }
    this.relayout(true);
    this.setTool(this.tool);
  }

  dispW(pg) {
    const cs = getComputedStyle(this.el);
    const avail = Math.max(200, this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    return Math.round(Math.min(avail * this.zoom, pg.w1 * 4));
  }

  relayout(force) {
    const w = this.el.clientWidth;
    if (!force && Math.abs(w - this.lastW) < 2) return;
    this.lastW = w;
    for (const pg of this.pages) {
      const dw = this.dispW(pg), dh = Math.round(dw * pg.h1 / pg.w1);
      pg.wrap.style.width = dw + 'px'; pg.wrap.style.height = dh + 'px';
      pg.dw = dw; pg.dh = dh; pg.rendered = 0;
      this.io.unobserve(pg.wrap); this.io.observe(pg.wrap);
    }
  }

  setZoom(z) {
    const sc = this.el.scrollTop / Math.max(1, this.el.scrollHeight);
    this.zoom = Math.max(0.5, Math.min(3, z));
    settings.set('zoom', this.zoom);
    this.relayout(true);
    this.el.scrollTop = sc * this.el.scrollHeight;
  }

  async render(pg) {
    if (pg.rendered === pg.dw) return;
    pg.rendered = pg.dw;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const scale = pg.dw / pg.w1 * dpr;
    const vp = pg.page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    cv.style.width = pg.dw + 'px'; cv.style.height = pg.dh + 'px';
    try {
      if (pg.task) pg.task.cancel();
      pg.task = pg.page.render({ canvasContext: cv.getContext('2d'), canvas: cv, viewport: vp });
      await pg.task.promise;
    } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn(e); return; }
    pg.wrap.replaceChild(cv, pg.cv); pg.cv = cv;
    pg.ink.width = cv.width; pg.ink.height = cv.height;
    pg.ink.style.width = pg.dw + 'px'; pg.ink.style.height = pg.dh + 'px';
    this.drawInk(pg);
  }

  setTool(t) {
    this.tool = t;
    for (const pg of this.pages) pg.ink.classList.toggle('pass', !pg.key || t === 'hand');
  }

  drawInk(pg, ctx = pg.ink.getContext('2d'), W = pg.ink.width, H = pg.ink.height) {
    ctx.clearRect(0, 0, W, H);
    for (const s of pg.strokes) drawStroke(ctx, s, W, H);
  }

  bindInk(pg) {
    const ink = pg.ink;
    let cur = null, panY = null;
    const pos = e => {
      const r = ink.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pressure || 0.5];
    };
    ink.addEventListener('pointerdown', e => {
      if (!pg.key || this.tool === 'hand') return;
      if (e.pointerType === 'touch' && settings.get('penOnly', false)) { panY = [e.clientX, e.clientY, this.el.scrollLeft, this.el.scrollTop]; ink.setPointerCapture(e.pointerId); return; }
      e.preventDefault();
      ink.setPointerCapture(e.pointerId);
      if (this.tool === 'eraser') { this.eraseAt(pg, pos(e)); cur = { erase: true }; return; }
      cur = { t: this.tool, c: this.color, w: this.tool === 'marker' ? this.width * 6 : this.width, pts: [pos(e)] };
    });
    ink.addEventListener('pointermove', e => {
      if (panY) { this.el.scrollLeft = panY[2] - (e.clientX - panY[0]); this.el.scrollTop = panY[3] - (e.clientY - panY[1]); return; }
      if (!cur) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (cur.erase) { for (const ev of evs) this.eraseAt(pg, pos(ev)); return; }
      for (const ev of evs) cur.pts.push(pos(ev));
      const ctx = ink.getContext('2d');
      this.drawInk(pg);
      drawStroke(ctx, cur, ink.width, ink.height);
    });
    const end = () => {
      if (panY) { panY = null; return; }
      if (!cur) return;
      if (!cur.erase && cur.pts.length) {
        cur.pts = cur.pts.map(([x, y, p]) => [+x.toFixed(5), +y.toFixed(5), +p.toFixed(2)]);
        pg.strokes.push(cur);
        this.undo.push({ pg, add: cur });
        this.save(pg);
      }
      cur = null;
    };
    ink.addEventListener('pointerup', end);
    ink.addEventListener('pointercancel', end);
  }

  eraseAt(pg, [x, y]) {
    const r = 0.012;
    const ar = pg.h1 / pg.w1;
    const keep = [];
    let removed = [];
    for (const s of pg.strokes) {
      const hit = s.pts.some(([px, py]) => Math.hypot(px - x, (py - y) * ar) < r + s.w);
      (hit ? removed : keep).push(s);
    }
    if (removed.length) {
      pg.strokes = keep;
      this.undo.push({ pg, del: removed });
      this.drawInk(pg);
      this.save(pg);
    }
  }

  undoLast() {
    const op = this.undo.pop();
    if (!op) return;
    const pg = op.pg;
    if (op.add) pg.strokes = pg.strokes.filter(s => s !== op.add);
    if (op.del) pg.strokes.push(...op.del);
    if (op.clear) pg.strokes = op.clear;
    this.drawInk(pg);
    this.save(pg);
  }

  clearAll() {
    for (const pg of this.pages) if (pg.key && pg.strokes.length) {
      this.undo.push({ pg, clear: pg.strokes });
      pg.strokes = [];
      this.drawInk(pg);
      this.save(pg);
    }
  }

  save(pg) {
    if (!pg.key) return;
    clearTimeout(this.saveTimers.get(pg.key));
    this.saveTimers.set(pg.key, setTimeout(() => {
      db.put('ink', pg.key, pg.strokes);
      this.onInk && this.onInk();
    }, 300));
  }

  hasInk() { return this.pages.some(p => p.strokes.length); }

  // 画面のまん中あたりに見えているページ
  currentPage() {
    const r = this.el.getBoundingClientRect();
    const mid = r.top + r.height * 0.4;
    let best = null, bd = Infinity;
    for (const pg of this.pages) {
      const b = pg.wrap.getBoundingClientRect();
      const d = mid < b.top ? b.top - mid : mid > b.bottom ? mid - b.bottom : 0;
      if (d < bd) { bd = d; best = pg; }
    }
    return best && { i: best.i, p: best.p };
  }

  // 書き込み込みのページ画像（印刷・AI 読み取り用）
  async pageImages({ maxSide = 1600, type = 'image/jpeg', quality = 0.85, onlyInked = false } = {}) {
    const out = [];
    for (const pg of this.pages) {
      if (onlyInked && !pg.strokes.length) continue;
      const scale = maxSide / Math.max(pg.w1, pg.h1);
      const vp = pg.page.getViewport({ scale });
      const cv = document.createElement('canvas');
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await pg.page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
      for (const s of pg.strokes) drawStroke(ctx, s, cv.width, cv.height);
      out.push({ i: pg.i, p: pg.p, url: cv.toDataURL(type, quality), w: cv.width, h: cv.height });
    }
    return out;
  }

  // 元の PDF に書き込みを重ねた PDF を作る（pdf-lib）
  async inkedPdf() {
    const PDFLib = await loadPdfLib();
    const outDoc = await PDFLib.PDFDocument.create();
    for (let i = 0; i < this.sources.length; i++) {
      const { bytes } = await loadPdf(this.sources[i].src);
      const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const [p0, p1] = this.sources[i].pages || [1, src.getPageCount()];
      const idxs = src.getPageIndices().filter(k => k + 1 >= p0 && k + 1 <= p1);
      const copied = await outDoc.copyPages(src, idxs);
      copied.forEach((page, n) => {
        outDoc.addPage(page);
        const pg = this.pages.find(x => x.i === i && x.p === idxs[n] + 1);
        if (pg && pg.strokes.length) page._inkPg = pg;
      });
    }
    for (const page of outDoc.getPages()) {
      const pg = page._inkPg;
      if (!pg) continue;
      const { width, height } = page.getSize();
      const cv = document.createElement('canvas');
      const k = 3;
      cv.width = Math.round(width * k); cv.height = Math.round(height * k);
      const ctx = cv.getContext('2d');
      for (const s of pg.strokes) drawStroke(ctx, s, cv.width, cv.height);
      const png = await outDoc.embedPng(cv.toDataURL('image/png'));
      const rot = page.getRotation().angle % 360;
      if (rot === 0) page.drawImage(png, { x: 0, y: 0, width, height });
      else {
        // 回転したページは、見た目の向きに合わせて重ねる
        const W = rot % 180 ? height : width, H = rot % 180 ? width : height;
        page.drawImage(png, { x: 0, y: 0, width: W, height: H });
      }
    }
    return outDoc.save();
  }
}

function drawStroke(ctx, s, W, H) {
  const pts = s.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
  ctx.globalAlpha = s.t === 'marker' ? 0.32 : 1;
  const lw = Math.max(1, s.w * W);
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0][0] * W, pts[0][1] * H, lw / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k][0] + pts[k + 1][0]) / 2 * W, my = (pts[k][1] + pts[k + 1][1]) / 2 * H;
      ctx.quadraticCurveTo(pts[k][0] * W, pts[k][1] * H, mx, my);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l[0] * W, l[1] * H);
    ctx.stroke();
  }
  ctx.restore();
}

let pdfLibP = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibP) pdfLibP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib.min.js', import.meta.url).href;
    s.onload = () => res(window.PDFLib); s.onerror = rej;
    document.head.append(s);
  });
  return pdfLibP;
}

// 印刷：書き込み込みのページ画像を新しい窓に並べて印刷する
export async function printViewer(viewer, title) {
  const imgs = await viewer.pageImages({ maxSide: 2400, type: 'image/png' });
  const w = window.open('', '_blank');
  if (!w) throw new Error('ポップアップがブロックされました');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>@page{margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always;break-after:page}</style></head><body>
${imgs.map(x => `<img src="${x.url}">`).join('')}
<script>window.onload=()=>{setTimeout(()=>{window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

export function downloadBytes(bytes, name, type = 'application/pdf') {
  const blob = new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
