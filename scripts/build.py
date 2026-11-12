"""
data/hensachi-raw.json（学校と偏差値）と data/crawl.json（集めたPDF）から data/catalog.json を作る。

  python scripts/build.py

自校作成校の PDF は名前がばらばらなので、リンク文字・前後の文字・PDF の 1 ページ目の文字から
年度・教科・種類（問題/正答表/解答用紙）を決める。決められなかったものは data/unclassified.txt に出す。
手で直すときは data/overrides.json に {"ファイルのパス": {"year":2025,"subject":"数学","kind":"key"}} と書く
（"skip": true で除外）。
"""
import json, os, re, sys, unicodedata
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
D = lambda *p: os.path.join(ROOT, *p)

try:
    import pymupdf
except ImportError:
    import fitz as pymupdf

SUBJ = ['英語', '数学', '国語']

# ---------------------------------------------------------------- 学校
JIKO = {  # 名前 → 自校作成の slug
    '日比谷高等学校': 'hibiya-h', '都立西高等学校': 'nishi-h', '国立高等学校': 'kunitachi-h', '戸山高等学校': 'toyama-h',
    '青山高等学校': 'aoyama-h', '立川高等学校': 'tachikawa-h', '新宿高等学校': 'shinjuku-h', '八王子東高等学校': 'hachiojihigashi-h',
    '国分寺高等学校': 'kokubunji-h', '墨田川高等学校': 'sumidagawa-h', '都立国際高等学校': 'kokusai-h',
}
JIKO_NAME = {v: k.replace('都立', '').replace('高等学校', '') for k, v in JIKO.items()}
NOTES = {  # 高校募集の有無など（確かでないものは「要確認」）
    '千葉市立稲毛国際中等教育学校': ('高校募集なし', '中等教育学校のため、高校からの入学試験はありません。'),
    '巣鴨高等学校': ('高校募集要確認', '高校からの募集を停止したとされています。学校の募集要項で確認してください。'),
    '城北高等学校': ('高校募集要確認', '高校からの募集を停止したとされています。学校の募集要項で確認してください。'),
    '桐朋高等学校': ('高校募集要確認', '高校からの募集を停止したとされています。学校の募集要項で確認してください。'),
    '東京都市大学等々力高等学校': ('高校募集要確認', '高校からの募集を停止したとされています。学校の募集要項で確認してください。'),
    '東京芸術大学音楽学部附属音楽高等学校': ('実技中心', '音楽の実技試験が中心の学校です。'),
}


def short_name(n):
    n = re.sub(r'^(都立|東京都立|神奈川県立|千葉県立)', '', n)
    n = n.replace('高等学校', '').replace('中等教育学校', '').replace('高等専門学校', '高専')
    return n


def build_schools():
    raw = json.load(open(D('data', 'hensachi-raw.json'), encoding='utf-8'))
    by = {}
    for x in raw:
        s = by.get(x['mk'])
        if not s:
            s = by[x['mk']] = {'id': 's%d' % x['mk'], 'mk': x['mk'], 'full': x['name'], 'name': short_name(x['name']),
                               'pref': x['pref'], 'kind': x['type'], 'gender': x['gender'], 'area': x['area'],
                               'station': x['station'], 'dev': x['dev'], 'courses': [], 'tests': []}
        s['dev'] = max(s['dev'], x['dev'])
        if x['course']:
            s['courses'].append({'name': x['course'], 'dev': x['dev']})
    out = []
    for s in by.values():
        full = s['full']
        if full in NOTES:
            s['note'], s['noteLong'] = NOTES[full]
        if '高等専門学校' in full:
            s['note'] = '高専'
            s['noteLong'] = '高専の学力検査（国立高専は全国共通問題）です。'
        if s['pref'] == '東京' and s['kind'] == '公立' and '高等専門学校' not in full:
            if full in JIKO:
                slug = JIKO[full]
                if slug == 'kokusai-h':
                    s['tests'] = ['tokyo-common', 'jiko-kokusai-h']
                    s['testNote'] = '英語は自校作成問題、国語・数学は都立共通問題です。'
                else:
                    s['tests'] = ['jiko-' + slug]
                    s['testNote'] = '英語・数学・国語は自校作成問題（社会・理科は共通問題）です。'
            else:
                s['tests'] = ['tokyo-common']
                s['testNote'] = '都立共通問題で受験します。同じ問題を、偏差値の違うたくさんの都立高校が使います。'
        elif s['pref'] == '神奈川' and s['kind'] == '公立':
            s['tests'] = ['kanagawa-common']
            s['testNote'] = '神奈川県公立高校の共通選抜（学力検査は全校共通）。上位校は別に特色検査があります。'
        elif s['pref'] == '千葉' and s['kind'] == '公立' and '高等専門学校' not in full:
            s['tests'] = ['chiba-common']
            s['testNote'] = '千葉県公立高校の一般入学者選抜（学力検査は全校共通）。問題冊子は県のサイトでは公開されていないため、過去問集のPDFを取り込んで使います。'
        out.append(s)
    out.sort(key=lambda s: (-s['dev'], s['pref'], s['full']))
    return out


# ---------------------------------------------------------------- 年度・教科・種類の判定
ZEN = str.maketrans('０１２３４５６７８９', '0123456789')


def nfkc(s):
    return unicodedata.normalize('NFKC', s or '').translate(ZEN)


def year_from(s):
    s = nfkc(s)
    m = re.findall(r'令和\s*(元|\d{1,2})\s*年', s)
    if m:
        v = m[-1]
        return 2019 if v == '元' else 2018 + int(v)
    m = re.findall(r'(?<![0-9A-Za-z])R\s*0?(\d{1,2})(?!\d)', s)
    if m:
        return 2018 + int(m[-1])
    m = re.findall(r'(20[12]\d)\s*年度', s)
    if m:
        return int(m[-1])
    m = re.findall(r'(?:平成\s*|(?<![0-9A-Za-z])H\s*)(\d{2})(?!\d)', s)
    if m:
        return 1988 + int(m[-1])
    return None


def year_from_filename(fn):
    fn = nfkc(fn)
    for pat in [r'^0?(\d{1,2})(?:Japanese|Math|Eng|Writing|English)', r'^(\d{1,2})-', r'^0?(\d)(?:suu|ei|koku)', r'^R0?(\d{1,2})', r'令和\s*(\d{1,2})']:
        m = re.search(pat, fn, re.I)
        if m:
            n = int(m.group(1))
            return 2018 + n if n <= 12 else 1988 + n  # 13 以上は平成
    return None


def subj_from(s, last=True):
    s = nfkc(s)
    hits = [(m.start(), m.group(1)) for m in re.finditer(r'(国語|数学|英語)', s)]
    return (hits[-1][1] if last else hits[0][1]) if hits else None


def subj_from_filename(fn):
    fn = nfkc(fn)
    if re.search(r'Japanese|-J-|koku', fn, re.I): return '国語'
    if re.search(r'Math|-M-|suu', fn, re.I): return '数学'
    if re.search(r'Eng|-E-|(^|\d)ei', fn, re.I): return '英語'
    return subj_from(fn)


def kind_from(label, fn=''):
    # リンク文字を優先し、決まらなければファイル名で
    if re.search(r'出題の方針|ねらい|解説', nfkc(label)): return 'points'
    if re.search(r'問題と解答用紙|問題・解答用紙', nfkc(label)): return 'problem'
    for t in (nfkc(label), nfkc(fn)):
        if re.search(r'解答用紙|AnswerSheet|Sheet|_kai|解答欄|kaitouyoushi', t, re.I): return 'sheet'
        if re.search(r'正答|解答例|模範解答|回答例|解答(?!用紙)|Answer|_sei|-解|kai$|seitou', t, re.I): return 'key'
        if re.search(r'問題|Test|_mon|-問|mondai|mon$', t, re.I): return 'problem'
    # 「R06英語(1MB)」「R5数学PDF」のように教科名だけのリンクは問題
    if re.search(r'(国語|数学|英語)', nfkc(label)):
        return 'problem'
    return None


_text_cache = {}


def pdf_head(path):
    if path in _text_cache:
        return _text_cache[path]
    t = ''
    try:
        with pymupdf.open(D(path)) as doc:
            for i in range(min(2, doc.page_count)):
                t += doc[i].get_text()
    except Exception as e:
        t = ''
    _text_cache[path] = nfkc(t)
    return _text_cache[path]


def classify_jiko(r, ov):
    if r['file'] in ov:
        o = ov[r['file']]
        if o.get('skip'):
            return None
        return o.get('year'), o.get('subject'), o.get('kind')
    fn = os.path.basename(r['file'])
    label, ctx = r['label'], r['ctx']
    if re.search(r'Writing|GroupDiscussion|School_?profile|小論文|作文|集団討論|推薦', fn + label, re.I):
        return None
    kind = kind_from(label, fn)
    head = pdf_head(r['file'])
    # 年度：PDF の文字 → ファイル名 → 前後の文字
    y_pdf = year_from(head[:600])
    y_fn = year_from_filename(fn)
    y_label = year_from(label)
    y_ctx = year_from(ctx)
    year = y_pdf or y_fn or y_label or y_ctx
    s_fn = subj_from_filename(fn)
    s_pdf = subj_from(head[:400], last=False)
    s_ctx = subj_from(ctx)
    subject = s_fn or s_pdf or s_ctx
    if kind is None:
        kind = kind_from(head[:300])
    # 種類の確認：ページの少ない「問題」の 1 ページ目に正答表の見出しがあれば正答表
    if kind == 'problem' and pages(r['file']) <= 3 and re.search(r'正答表|解答例|模範解答|正答', head[:200]):
        kind = 'key'
    return year, subject, kind


def pages(path):
    try:
        with pymupdf.open(D(path)) as doc:
            return doc.page_count
    except Exception:
        return 0


def build_exams():
    rec = json.load(open(D('data', 'crawl.json'), encoding='utf-8'))
    ov_path = D('data', 'overrides.json')
    ov = json.load(open(ov_path, encoding='utf-8')) if os.path.exists(ov_path) else {}
    groups = defaultdict(lambda: defaultdict(list))
    unclassified = []
    for r in rec:
        if not os.path.exists(D(r['file'])) or os.path.getsize(D(r['file'])) < 1000:
            continue
        if r['file'] in ov and ov[r['file']].get('skip'):
            continue
        if r['src'] == 'tokyo':
            l = r['label']
            kind = 'problem' if '検査問題' in l else 'key' if '正答表' in l else 'sheet' if '解答用紙' in l else 'points' if '採点のポイント' in l else 'script' if 'リスニング' in l else None
            if not kind:
                continue
            groups[('tokyo-common', r['year'], r['subject'])][kind].append({'src': r['file'], 'label': l})
        elif r['src'] == 'kanagawa':
            fn = os.path.basename(r['file'])
            kind = 'audio' if fn.endswith('.mp3') else 'script' if 'daihon' in fn else 'key' if '_sei' in fn else 'sheet' if '_kai' in fn else 'problem' if '_mon' in fn else None
            if not kind:
                continue
            groups[('kanagawa-common', r['year'], r['subject'])][kind].append({'src': r['file'], 'label': r['label']})
        elif r['src'] == 'jiko':
            c = classify_jiko(r, ov)
            if not c:
                continue
            year, subject, kind = c
            if subject not in SUBJ or not year or not kind or year < 2015 or year > 2027:
                unclassified.append(f"{r['file']}\t{year}\t{subject}\t{kind}\t{r['label']}\t{r['ctx'][-80:]}")
                continue
            if r['school'] == 'kokusai-h' and subject != '英語':
                continue
            groups[('jiko-' + r['school'], year, subject)][kind].append({'src': r['file'], 'label': r['label']})
    exams = []
    means = json.load(open(D('data', 'means.json'), encoding='utf-8')) if os.path.exists(D('data', 'means.json')) else {}
    for (test, year, subject), files in sorted(groups.items()):
        if not files.get('problem'):
            unclassified.append(f'(問題なし) {test} {year} {subject} {dict((k, len(v)) for k, v in files.items())}')
        for k in files:  # 同じファイルの重複を除き、前半・後半などは名前順
            seen, uniq = set(), []
            for f in files[k]:
                if f['src'] not in seen:
                    seen.add(f['src']); uniq.append(f)
            files[k] = sorted(uniq, key=lambda f: (('後半' in f['label']), f['src']))
        e = {'id': f'{test}-{year}-{subject}', 'test': test, 'year': year, 'subject': subject,
             'minutes': 50, 'max': 100, 'files': dict(files),
             'source': '東京都教育委員会' if test == 'tokyo-common' else '神奈川県教育委員会' if test == 'kanagawa-common' else '学校の公式サイト'}
        if not files.get('problem'):
            e['noProblem'] = True
        m = means.get(test, {}).get(str(year), {}).get(subject)
        if m is not None:
            e['mean'] = m
        kp = D('data', 'keys', e['id'] + '.json')
        if os.path.exists(kp):
            e['keyJson'] = 'data/keys/' + e['id'] + '.json'
        exams.append(e)
    with open(D('data', 'unclassified.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(unclassified))
    return exams


def build_tests(schools):
    tests = {
        'tokyo-common': {'id': 'tokyo-common', 'name': '都立共通問題', 'short': '都立共通', 'kind': 'common', 'pref': '東京'},
        'kanagawa-common': {'id': 'kanagawa-common', 'name': '神奈川県公立 共通選抜', 'short': '神奈川共通', 'kind': 'common', 'pref': '神奈川'},
        'chiba-common': {'id': 'chiba-common', 'name': '千葉県公立 学力検査', 'short': '千葉共通', 'kind': 'common', 'pref': '千葉'},
    }
    for full, slug in JIKO.items():
        s = next((x for x in schools if x['full'] == full), None)
        tests['jiko-' + slug] = {'id': 'jiko-' + slug, 'name': f'{JIKO_NAME[slug]} 自校作成問題', 'short': '自校作成', 'kind': 'jiko',
                                 'pref': '東京', 'school': s['id'] if s else None}
    return tests


if __name__ == '__main__':
    schools = build_schools()
    tests = build_tests(schools)
    exams = build_exams()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_ext
    build_ext.integrate(schools, tests, exams, None)
    schools.sort(key=lambda s: (s['dev'] is None, -(s['dev'] or 0), s['pref'], s['full']))
    cat = {'built': __import__('time').strftime('%Y-%m-%d'), 'schools': schools, 'tests': tests, 'exams': exams}
    json.dump(cat, open(D('data', 'catalog.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    by = defaultdict(int)
    for e in exams:
        by[e['test']] += 1
    print('schools', len(schools), 'exams', len(exams))
    for k, v in sorted(by.items()):
        print(' ', k, v)
    print('unclassified ->', D('data', 'unclassified.txt'))
