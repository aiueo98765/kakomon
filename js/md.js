// AI の返答（Markdown）を安全な HTML にする小さな変換器
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  return s;
}

export function md(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let out = '', list = null, para = [];
  const flushP = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  const flushL = () => { if (list) { out += `</${list}>`; list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flushP(); flushL();
      const buf = [];
      while (++i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i]);
      out += '<pre>' + esc(buf.join('\n')) + '</pre>';
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      flushP(); flushL();
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      out += '<table><tr>' + row(l).map(c => `<th>${inline(c)}</th>`).join('') + '</tr>';
      i++;
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) out += '<tr>' + row(lines[++i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      out += '</table>';
      continue;
    }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); const n = Math.min(4, m[1].length + 2); out += `<h${n}>${inline(m[2])}</h${n}>`; continue; }
    if ((m = l.match(/^\s*[-*・]\s+(.*)/))) { flushP(); if (list !== 'ul') { flushL(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== 'ol') { flushL(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if (/^\s*>\s?/.test(l)) { flushP(); flushL(); out += `<blockquote>${inline(l.replace(/^\s*>\s?/, ''))}</blockquote>`; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { flushP(); flushL(); out += '<hr>'; continue; }
    if (!l.trim()) { flushP(); flushL(); continue; }
    flushL();
    para.push(l);
  }
  flushP(); flushL();
  return out;
}

export { esc };
