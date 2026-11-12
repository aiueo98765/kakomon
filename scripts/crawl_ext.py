"""
「数学得意な中学生応援します」（cf756954.cloudfree.jp）の「全問PDF」（数学）を集める。
本人の依頼（2026-11-11）で、自分専用として取り込む。配布しないこと。

  python scripts/crawl_ext.py        # 一覧を読んでダウンロード → pdfs/ext/ と data/crawl-ext.json

相手は無料サーバーなので、1 ファイルごとに 1 秒以上あけ、取得済みは取り直さない。
"""
import json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BASE = 'http://cf756954.cloudfree.jp/'
PAGES = ['H30PDF.html', 'index.html']  # index.html には最新（R8）の欄がある
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 kakomon-personal'}


def get(url, binary=False):
    url = urllib.parse.quote(url, safe=":/?&=%#~+@,;!$'()*[]")
    for i in range(3):
        try:
            b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()
            return b if binary else b.decode('cp932', errors='replace')
        except Exception as e:
            if i == 2:
                raise
            time.sleep(5)


def year_of(path):
    m = re.search(r'/(R|H)(\d+)(?:PDF)?/', path)
    if not m:
        return None
    return 2018 + int(m.group(2)) if m.group(1) == 'R' else 1988 + int(m.group(2))


def items():
    out, seen = [], set()
    for page in PAGES:
        src = get(BASE + page)
        src = re.sub(r'<!--.*?-->', ' ', src, flags=re.S)
        for m in re.finditer(r'''<a\b[^>]*?href\s*=\s*["']([^"']+\.pdf)["'][^>]*>(.*?)</a>''', src, re.S | re.I):
            href = m.group(1)
            url = urllib.parse.urljoin(BASE + page, href)
            if url in seen:
                continue
            seen.add(url)
            label = re.sub(r'(&nbsp;|\s|<[^>]+>)+', ' ', m.group(2)).strip()
            after = re.sub(r'<[^>]+>', ' ', src[m.end():m.end() + 80])
            no_ans = bool(re.match(r'\s*(&nbsp;|\s)*[＊*]', after)) or '答なし' in after[:30]
            y = year_of(url)
            if not y:
                continue
            out.append({'url': url, 'label': label, 'year': y, 'noAnswer': no_ans})
    return out


if __name__ == '__main__':
    lst = items()
    print('links', len(lst), flush=True)
    out_path = os.path.join(ROOT, 'data', 'crawl-ext.json')
    rec = []
    for i, it in enumerate(lst):
        name = urllib.parse.unquote(it['url'].split('/')[-1])
        d = os.path.join(ROOT, 'pdfs', 'ext', str(it['year']))
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, name)
        if not os.path.exists(path) or os.path.getsize(path) < 1000:
            try:
                b = get(it['url'], binary=True)
                if not b.startswith(b'%PDF'):
                    print('  ! not pdf', it['url'], flush=True)
                    continue
                open(path, 'wb').write(b)
                time.sleep(1.2)
            except Exception as e:
                print('  !', it['url'], e, flush=True)
                continue
        it['file'] = os.path.relpath(path, ROOT).replace('\\', '/')
        rec.append(it)
        if i % 25 == 0:
            print(i, it['year'], it['label'], flush=True)
            json.dump(rec, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(rec, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('done', len(rec))
