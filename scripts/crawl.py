"""
公式サイトから英数国の入試PDF（問題・正答表・解答用紙・採点のポイント・リスニング）を集める。

  python scripts/crawl.py            # 全部
  python scripts/crawl.py tokyo      # 都立共通だけ
  python scripts/crawl.py jiko       # 自校作成10校＋国際
  python scripts/crawl.py kanagawa   # 神奈川

集めたファイルは pdfs/ に置き、一覧を data/crawl.json に書く（分類前の生データ）。
分類（どの年度・教科・種類か）は scripts/classify.py が行う。
pdfs/ は自分専用。配布しないこと。
"""
import html, json, os, re, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PDFS = os.path.join(ROOT, 'pdfs')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 kakomon-personal'}


def get(url, binary=False):
    # 日本語や空白を含む URL はそのままだと送れないので、%エンコードする（既に % のものは触らない）
    url = urllib.parse.quote(url, safe=":/?&=%#~+@,;!$'()*[]")
    req = urllib.request.Request(url, headers=UA)
    for i in range(3):
        try:
            b = urllib.request.urlopen(req, timeout=60).read()
            return b if binary else b.decode('utf-8', errors='replace')
        except Exception as e:
            if i == 2:
                raise
            time.sleep(2)


class LinkCtx(HTMLParser):
    """リンクごとに、リンク文字列と、その直前に出てきた文字列（見出し・表のセル）を記録する。"""

    def __init__(self):
        super().__init__()
        self.links, self.text, self.cur, self.in_a = [], [], None, False
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
        if tag == 'a':
            href = dict(attrs).get('href')
            if href:
                self.cur = {'href': href, 'label': '', 'before': ' '.join(self.text)[-300:]}
                self.in_a = True
        if tag in ('tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'li', 'p', 'br', 'td', 'th'):
            self.text.append('|')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1
        if tag == 'a' and self.cur:
            self.cur['label'] = self.cur['label'].strip()
            self.links.append(self.cur)
            self.text.append(self.cur['label'])
            self.cur, self.in_a = None, False

    def handle_data(self, data):
        if self.skip:
            return
        d = re.sub(r'\s+', ' ', data).strip()
        if not d:
            return
        if self.in_a and self.cur is not None:
            self.cur['label'] += d
        else:
            self.text.append(d)


def links_of(url):
    """<a href>…</a> を正規表現で拾う（HTMLParser は壊れたページで途中から読めなくなることがあるため）。
    before には、そのリンクより前の本文（タグを除いた文字）の末尾 300 字を入れる。"""
    src = get(url)
    src = re.sub(r'<!--.*?-->', ' ', src, flags=re.S)
    src = re.sub(r'<(script|style)\b.*?</\1>', ' ', src, flags=re.S | re.I)
    out = []
    for m in re.finditer(r'''<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>''', src, re.S | re.I):
        before = re.sub(r'<(tr|td|th|li|p|br|h\d)\b[^>]*>', ' | ', src[max(0, m.start() - 3000):m.start()], flags=re.I)
        before = html.unescape(re.sub(r'<[^>]+>', ' ', before))
        before = re.sub(r'\s+', ' ', before)[-300:]
        label = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', m.group(2)))).strip()
        out.append({'href': m.group(1), 'label': label, 'before': before,
                    'url': urllib.parse.urljoin(url, html.unescape(m.group(1)))})
    return out


def safe_name(url):
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path)
    base = path.rstrip('/').split('/')[-1]
    base = re.sub(r'[\\/:*?"<>|\s　]+', '_', base)
    return base


def download(url, sub, name=None):
    d = os.path.join(PDFS, sub)
    os.makedirs(d, exist_ok=True)
    name = name or safe_name(url)
    path = os.path.join(d, name)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        b = get(url, binary=True)
        with open(path, 'wb') as f:
            f.write(b)
        time.sleep(0.4)
    return os.path.relpath(path, ROOT).replace('\\', '/')


SUBJ_SKIP = re.compile(r'社会|理科|小論文|作文|集団討論|実技|面接|推薦|得点分布|説明会|めざす|案内|募集|調査書|定時制|二次|分割後期')


# ---------------------------------------------------------------- 都立共通
TOKYO_BASE = 'https://www.kyoiku.metro.tokyo.lg.jp/ja/admission/high_school/ability_test/problem_and_answer/'
TOKYO_PAGES = {2020: 'release20200221_01', 2021: 'release20210221_01', 2022: 'release20220221_05',
               2023: 'release20230221_09', 2024: 'release20240221_09', 2025: 'release20250221_n01',
               2026: 'release20260221_n01'}


def crawl_tokyo(rec):
    for year, page in TOKYO_PAGES.items():
        url = TOKYO_BASE + page
        cur_subj = None
        for l in links_of(url):
            ctx = l['before'] + ' ' + l['label']
            m = re.findall(r'(国語|数学|英語|社会|理科)', l['before'][-80:] + ' ' + l['label'])
            if m:
                cur_subj = m[-1]
            if '/documents/' not in l['url']:
                continue
            if cur_subj not in ('国語', '数学', '英語'):
                continue
            label = l['label']
            if '基本方針' in label:
                continue
            # 都のファイルは拡張子が無い。名前をつけて保存する
            name = f'{year}_{cur_subj}_{re.sub(r"[^0-9A-Za-z_]", "", l["url"].split("/")[-1])}.pdf'
            try:
                rel = download(l['url'], f'tokyo/{year}', name)
            except Exception as e:
                print('  ! ', l['url'], e)
                continue
            rec.append({'src': 'tokyo', 'year': year, 'subject': cur_subj, 'label': label,
                        'ctx': ctx[-200:], 'url': l['url'], 'file': rel})
            print(year, cur_subj, label, rel, flush=True)


# ---------------------------------------------------------------- 自校作成
JIKO = ['hibiya-h', 'nishi-h', 'kunitachi-h', 'toyama-h', 'aoyama-h', 'tachikawa-h', 'shinjuku-h',
        'hachiojihigashi-h', 'kokubunji-h', 'sumidagawa-h', 'kokusai-h']


def crawl_jiko(rec):
    for s in JIKO:
        url = f'https://www.metro.ed.jp/{s}/guide/test.html'
        try:
            ls = links_of(url)
        except Exception as e:
            print('!!', s, e)
            continue
        n = 0
        for l in ls:
            if not re.search(r'\.pdf($|\?)', l['url'], re.I):
                continue
            ctx = (l['before'] + ' ' + l['label'])
            if SUBJ_SKIP.search(l['label']) or SUBJ_SKIP.search(urllib.parse.unquote(l['url'].split('/')[-1])):
                continue
            try:
                rel = download(l['url'], f'jiko/{s}')
            except Exception as e:
                print('  ! ', l['url'], e)
                continue
            rec.append({'src': 'jiko', 'school': s, 'label': l['label'], 'ctx': ctx[-300:], 'url': l['url'], 'file': rel})
            n += 1
        print(s, n, flush=True)


# ---------------------------------------------------------------- 神奈川
KANAGAWA_YEARS = {2024: 'r6', 2025: 'r7', 2026: 'r8'}


def crawl_kanagawa(rec):
    for year, r in KANAGAWA_YEARS.items():
        url = f'https://www.pref.kanagawa.jp/docs/dc4/nyusen/nyusen/gakuryokukensa/{r}.html'
        for l in links_of(url):
            u = l['url']
            if not re.search(r'\.(pdf|mp3)$', u, re.I):
                continue
            fn = u.split('/')[-1]
            # 全日制・本検査の英数国だけ（ファイル名 1_ 英語 / 2_ 国語 / 3_ 数学、_zen_、追検査 _tui は除く）
            # ファイル名の教科名で見分ける（r6 は先頭の番号がない）。定時制 _tei・追検査 _tui は除く
            m = re.search(r'(eigo|kokugo|suugaku)', fn)
            if not m or '_tei' in fn or '_tui' in fn:
                continue
            subj = {'eigo': '英語', 'kokugo': '国語', 'suugaku': '数学'}[m.group(1)]
            try:
                rel = download(u, f'kanagawa/{year}')
            except Exception as e:
                print('  ! ', u, e)
                continue
            rec.append({'src': 'kanagawa', 'year': year, 'subject': subj, 'label': l['label'], 'ctx': l['before'][-120:],
                        'url': u, 'file': rel})
            print(year, subj, l['label'], rel, flush=True)


if __name__ == '__main__':
    which = sys.argv[1:] or ['tokyo', 'jiko', 'kanagawa']
    out_path = os.path.join(ROOT, 'data', 'crawl.json')
    rec = json.load(open(out_path, encoding='utf-8')) if os.path.exists(out_path) else []
    rec = [r for r in rec if r['src'] not in which]
    for w in which:
        {'tokyo': crawl_tokyo, 'jiko': crawl_jiko, 'kanagawa': crawl_kanagawa}[w](rec)
        json.dump(rec, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('total', len(rec))
