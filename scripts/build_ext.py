"""
数学サイト（cf756954.cloudfree.jp）と私立の公式公開分を、catalog に組み込む。build.py から呼ぶ。

- リンクの表示名（「中大附属」「中央大付属高校」など略し方がばらばら）を、正式な学校名と都道府県に直す（LABELS）。
- 学校の偏差値は data/hensachi-all.json（全国）から名前で引く。
- 数学サイトの PDF は「問題 → 解答用紙 → 解答」が 1 本に入っているので、ページごとに種類を決めて分ける。
"""
import json, os, re, statistics, unicodedata
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
D = lambda *p: os.path.join(ROOT, *p)
try:
    import pymupdf
except ImportError:
    import fitz as pymupdf

EXT_SOURCE = '数学得意な中学生応援します（cf756954.cloudfree.jp）'

# 表示名 → (学校名の手がかり, 都道府県) ／ 共通問題なら ('@テストid', None) ／ 除外は None
# 上から順に照合する（「立命館慶祥」を「立命館」より先に、など）
LABELS = [
    (r'都立中高一貫', None),  # 中学受検の適性検査なので除外
    (r'国公立高専|国立高専', ('@kosen', None)),
    (r'都立産技|産業技術高専', ('産業技術高等専門学校', '東京')),
    (r'都立\s*日比谷', ('@jiko-hibiya-h', None)), (r'都立\s*西', ('@jiko-nishi-h', None)),
    (r'都立\s*国立', ('@jiko-kunitachi-h', None)), (r'都立\s*戸山', ('@jiko-toyama-h', None)),
    (r'都立\s*青山', ('@jiko-aoyama-h', None)), (r'都立\s*立川', ('@jiko-tachikawa-h', None)),
    (r'都立\s*新宿', ('@jiko-shinjuku-h', None)), (r'都立\s*八王子東', ('@jiko-hachiojihigashi-h', None)),
    (r'都立\s*国分寺', ('@jiko-kokubunji-h', None)), (r'都立\s*墨田川', ('@jiko-sumidagawa-h', None)),
    (r'大阪府', ('@osaka-c', None)),
    (r'埼玉', ('@saitama-sentaku', None)),
    (r'北海道', ('@hokkaido-sairyo', None)),
    (r'千葉\s*[(（]\s*思考力', ('@chiba-shiko', None)),
    (r'東学大附', ('東京学芸大学附属', '東京')),
    (r'筑波大駒場', ('筑波大学附属駒場', '東京')),
    (r'筑波?大?(附属)?坂[戸手]|筑大坂戸', ('筑波大学附属坂戸', '埼玉')),
    (r'市立堀川', ('堀川', '京都')), (r'市立西京', ('西京', '京都')), (r'府立嵯峨野', ('嵯峨野', '京都')),
    (r'市立福山', ('福山', '広島')), (r'岡山朝日', ('岡山朝日', '岡山')), (r'膳所', ('膳所', '滋賀')),
    (r'青山学院', ('青山学院高等部', '東京')),
    (r'かえつ有明', ('かえつ有明', '東京')), (r'徳島文理', ('徳島文理', '徳島')),
    (r'智辯和歌山', ('智辯学園和歌山', '和歌山')), (r'石見智翠館', ('石見智翠館', '島根')),
    (r'中大杉並|中央大杉並', ('中央大学杉並', '東京')), (r'中大横浜|中央大横浜', ('中央大学附属横浜', '神奈川')),
    (r'中大附|中央大付|中央大附', ('中央大学附属高等学校', '東京')),
    (r'大阪産', ('大阪産業大学附属', '大阪')), (r'同志社国際', ('同志社国際', '京都')), (r'同志社', ('同志社高等学校', '京都')),
    (r'盈進', ('盈進', '広島')), (r'福知山成美', ('福知山成美', '京都')),
    (r'明大八王子|明大中野八王子|明治大中野八王子', ('明治大学付属八王子', '東京')),
    (r'函館', ('函館ラ・サール', '北海道')), (r'岡山白陵', ('岡山白陵', '岡山')), (r'白陵', ('白陵', '兵庫')),
    (r'初芝橋本', ('初芝橋本', '和歌山')), (r'龍谷大平安', ('平安', '京都')), (r'雲雀', ('雲雀丘学園', '兵庫')),
    (r'明学東村山|明治学院東村山', ('明治学院東村山', '東京')), (r'明治学院', ('明治学院高等学校', '東京')),
    (r'早大本庄|本庄', ('早稲田大学本庄高等学院', '埼玉')), (r'法政', ('法政大学高等学校', '東京')),
    (r'池田', ('池田', '?')), (r'郁文館', ('郁文館', '東京')),
    (r'帝塚山学院泉|帝塚山泉', ('帝塚山学院泉ヶ丘', '大阪')), (r'帝塚山', ('帝塚山高等学校', '奈良')),
    (r'大阪女学院', ('大阪女学院', '大阪')), (r'城北', ('城北高等学校', '東京')), (r'純心女子', ('純心女子', '?')),
    (r'開智.*埼玉', ('開智高等学校', '埼玉')), (r'開智.*和歌山', ('開智高等学校', '和歌山')),
    (r'開星', ('開星', '島根')), (r'開成', ('開成高等学校', '東京')),
    (r'鎌倉学園', ('鎌倉学園', '神奈川')), (r'関西学院', ('関西学院高等部', '兵庫')), (r'関西大倉', ('関西大倉', '大阪')),
    (r'鹿屋中央', ('鹿屋中央', '鹿児島')), (r'芝浦工大柏', ('芝浦工業大学柏', '千葉')), (r'川越東', ('川越東', '埼玉')),
    (r'東洋大京北', ('東洋大学京北', '東京')), (r'慶應女子', ('慶應義塾女子', '東京')), (r'京華', ('京華高等学校', '東京')),
    (r'立命館慶祥', ('立命館慶祥', '北海道')), (r'立命館守山', ('立命館守山', '滋賀')), (r'立命館', ('立命館高等学校', '京都')),
    (r'錦城', ('錦城高等学校', '東京')), (r'近大豊岡', ('近畿大学附属豊岡', '兵庫')), (r'近大和歌山', ('近畿大学附属和歌山', '和歌山')),
    (r'弘学館', ('弘学館', '佐賀')), (r'甲南', ('甲南高等学校', '兵庫')), (r'興南', ('興南', '沖縄')),
    (r'國學院|国学院', ('國學院大學久我山', '東京')), (r'国立音大', ('国立音楽大学附属', '東京')),
    (r'久留米', ('久留米大学附設', '福岡')), (r'京都共栄', ('京都共栄学園', '京都')), (r'京都女子', ('京都女子', '京都')),
    (r'共立', ('共立女子第二', '東京')), (r'京都成章', ('京都成章', '京都')), (r'九州国際', ('九州国際大学付属', '福岡')),
    (r'前橋育英', ('前橋育英', '群馬')), (r'明大付明治', ('明治大学付属明治', '東京')), (r'日大明誠', ('日本大学明誠', '山梨')),
    (r'桃山学院', ('桃山学院', '大阪')), (r'灘', ('灘高等学校', '兵庫')), (r'清風南海', ('清風南海', '大阪')), (r'清風', ('清風高等学校', '大阪')),
    (r'奈良大', ('奈良大学附属', '奈良')), (r'日大習志野', ('日本大学習志野', '千葉')), (r'日本大第二', ('日本大学第二', '東京')),
    (r'立教新座', ('立教新座', '埼玉')), (r'西大和', ('西大和学園', '奈良')),
    (r'東京農大', ('東京農業大学第一', '東京')), (r'桜美林', ('桜美林', '東京')),
    (r'^岡山(高校)?$', ('岡山高等学校', '岡山')), (r'大阪学院', ('大阪学院大学', '大阪')), (r'追手門', ('追手門学院大手前', '大阪')),
    (r'札幌日大', ('札幌日本大学', '北海道')), (r'札幌第一', ('札幌第一', '北海道')),
    (r'洛南', ('洛南', '京都')), (r'^ラサール', ('ラ・サール', '鹿児島')),
    (r'早稲田佐賀', ('早稲田佐賀', '佐賀')), (r'作新', ('作新学院', '栃木')), (r'作陽', ('作陽', '岡山')),
    (r'聖愛', ('弘前学院聖愛', '青森')), (r'成城学園', ('成城学園', '東京')), (r'成蹊', ('成蹊高等学校', '東京')),
    (r'大阪星光', ('大阪星光学院', '大阪')), (r'清教学園', ('清教学園', '大阪')), (r'西南学院', ('西南学院', '福岡')),
    (r'青雲', ('青雲', '長崎')), (r'専修大', ('専修大学附属', '東京')), (r'芝工大附|芝浦工大附', ('芝浦工業大学附属', '東京')),
    (r'志學館|志学館', ('志學館', '鹿児島')), (r'慶応志木|慶應義塾志木|慶應志木', ('慶應義塾志木', '埼玉')),
    (r'和歌山信愛', ('和歌山信愛', '和歌山')), (r'広島新庄', ('広島新庄', '広島')), (r'四天王寺', ('四天王寺高等学校', '大阪')),
    (r'就実', ('就実', '岡山')), (r'夙川', ('夙川', '兵庫')), (r'早大学院|早大高等学院|早稲田大高等学院', ('早稲田大学高等学院', '東京')),
    (r'巣鴨', ('巣鴨高等学校', '東京')), (r'須磨学園', ('須磨学園', '兵庫')), (r'尚絅', ('尚絅学院', '宮城')),
    (r'聖徳学園', ('聖徳学園', '東京')), (r'秀英', ('昭和学院秀英', '千葉')), (r'上宮太子', ('上宮太子', '大阪')), (r'上宮', ('上宮高等学校', '大阪')),
    (r'^滝', ('滝高等学校', '愛知')), (r'^帝京', ('帝京高等学校', '東京')), (r'筑陽', ('筑陽学園', '福岡')), (r'東大寺', ('東大寺学園', '奈良')),
    (r'東北学院', ('東北学院', '宮城')), (r'^東北', ('東北高等学校', '宮城')), (r'桐蔭', ('桐蔭学園', '神奈川')),
    (r'東海', ('東海高等学校', '愛知')), (r'常盤', ('常磐', '?')), (r'桐光', ('桐光学園', '神奈川')), (r'土佐塾', ('土佐塾', '高知')),
    (r'豊島岡', ('豊島岡女子学園', '東京')), (r'土浦日大', ('土浦日本大学', '茨城')), (r'宇都宮短', ('宇都宮短期大学附属', '栃木')),
]

# 共通問題（学校をまたぐ試験）
COMMON = {
    'kosen': {'name': '国立高専 学力検査', 'short': '高専共通', 'pref': '全国',
              'note': '全国の国立高専で共通の学力検査（数学）。'},
    'osaka-c': {'name': '大阪府公立 C問題', 'short': '大阪C問題', 'pref': '大阪',
                'note': '大阪府公立高校の学力検査のうち、文理学科などの上位校が使う発展的な問題（C問題）。',
                'schools': ['北野', '天王寺', '茨木', '大手前', '高津', '豊中', '四條畷', '三国丘', '岸和田', '生野']},
    'saitama-sentaku': {'name': '埼玉県公立 学校選択問題', 'short': '埼玉 学校選択', 'pref': '埼玉',
                        'note': '埼玉県公立高校のうち、上位校が数学・英語で使う学校選択問題。',
                        'schools': ['浦和高等学校', '大宮高等学校', '浦和第一女子', '川越高等学校', '川越女子', '春日部高等学校',
                                    '市立浦和', '浦和西', '所沢北', '越谷北', '熊谷高等学校', '不動岡', '川口市立', '蕨', '和光国際']},
    'hokkaido-sairyo': {'name': '北海道公立 学校裁量問題', 'short': '北海道 裁量問題', 'pref': '北海道',
                        'note': '北海道公立高校の上位校が使っていた学校裁量問題（令和3年度まで）。',
                        'schools': ['札幌南', '札幌北', '札幌西', '札幌東', '札幌旭丘', '札幌月寒', '旭川東', '函館中部', '帯広柏葉', '釧路湖陵']},
    'chiba-shiko': {'name': '県立千葉 思考力を問う問題', 'short': '千葉 思考力', 'pref': '千葉',
                    'note': '県立千葉高校が学校設定検査として課す「思考力を問う問題」。', 'schools': ['千葉高等学校']},
}

ZEN = str.maketrans('０１２３４５６７８９ＡＢＣ', '0123456789ABC')


def nk(s):
    s = unicodedata.normalize('NFKC', s or '').translate(ZEN)
    return re.sub(r'[\s・･]', '', s)


def map_label(label):
    t = nk(label).replace('(答なし)', '').replace('答なし', '')
    for pat, target in LABELS:
        if re.search(pat, t):
            return target
    return ('?', '?')


# ---------------------------------------------------------------- 学校名 → 偏差値表
def load_all_schools():
    raw = json.load(open(D('data', 'hensachi-all.json'), encoding='utf-8')) if os.path.exists(D('data', 'hensachi-all.json')) else []
    by = {}
    for x in raw:
        s = by.get(x['mk'])
        if not s:
            s = by[x['mk']] = {'id': 's%d' % x['mk'], 'mk': x['mk'], 'full': x['name'], 'pref': x['pref'], 'kind': x['type'],
                               'gender': x['gender'], 'area': x['area'], 'station': x['station'], 'dev': x['dev'], 'courses': [], 'tests': []}
        s['dev'] = max(s['dev'], x['dev'])
        if x['course']:
            s['courses'].append({'name': x['course'], 'dev': x['dev']})
    return list(by.values())


def find_school(allsch, key, pref):
    k = nk(key)
    cands = [s for s in allsch if (pref in (None, '?') or s['pref'] == pref) and k in nk(s['full'])]
    if not cands and not k.endswith('高等学校'):
        cands = [s for s in allsch if (pref in (None, '?') or s['pref'] == pref) and k + '高等学校' in nk(s['full'])]
    if not cands:
        return None
    # いちばん名前の短い（＝余計な語が少ない）ものを選ぶ
    return sorted(cands, key=lambda s: (len(s['full']) - len(k), -s['dev']))[0]


# ---------------------------------------------------------------- ページの種類
def page_kinds(path):
    """各ページを problem / sheet / key に分ける。文字の無い PDF は None を返す。
    見出し（ページ上部 15% の文字）で判断する。表紙の注意書きにある「解答用紙」に引っかからないように。
    1 ページ目は必ず問題。最初に解答用紙か解答が出たページから後ろは、問題ではない。"""
    try:
        doc = pymupdf.open(D(path))
    except Exception:
        return None
    raw = []
    for p in doc:
        full = nk(p.get_text())
        if len(full) < 15:
            raw.append(None)
            continue
        H = p.rect.height
        top = nk(''.join(b[4] for b in sorted(p.get_text('blocks'), key=lambda b: b[1]) if b[1] < H * 0.15))
        if (re.search(r'解答用紙|解答欄', top) and not re.search(r'解答例|解説|正答', top))                 or (re.search(r'解答用紙', full) and len(full) < 700 and not re.search(r'解答例|解説|正答', full)):
            raw.append('sheet')
        elif re.search(r'解答(?!用紙)|正答|解説|模範', top) or re.search(r'正答表|解答例|【解答】|解説', full[:200])                 or (re.search(r'配点', top) and re.search(r'番号', top)):
            raw.append('key')
        elif re.search(r'受[験検]番号', full) and re.search(r'得点|点数|合計', full) and len(full) < 900:
            raw.append('sheet')
        else:
            raw.append('problem')
    doc.close()
    if all(k is None for k in raw):
        return None
    raw[0] = 'problem'
    first = next((i for i, k in enumerate(raw) if k in ('sheet', 'key')), None)
    out = []
    for i, k in enumerate(raw):
        if first is None or i < first:
            out.append('problem')
        else:
            out.append('sheet' if k == 'sheet' else 'key')
    return out


def ranges(kinds, want):
    idx = [i + 1 for i, k in enumerate(kinds) if k == want]
    if not idx:
        return []
    out, a, b = [], idx[0], idx[0]
    for i in idx[1:]:
        if i == b + 1:
            b = i
        else:
            out.append([a, b]); a = b = i
    out.append([a, b])
    return out


# ---------------------------------------------------------------- 組み込み
def integrate(schools, tests, exams, jiko_by_slug):
    allsch = load_all_schools()
    by_id = {s['id']: s for s in schools}
    ex_by_id = {e['id']: e for e in exams}
    report, unknown = [], []

    def ensure_school(key, pref):
        s0 = find_school(allsch, key, pref) if pref != '?' else None  # 県が分からない学校は、別の学校と取り違えないよう照合しない
        if s0 and s0['id'] in by_id:
            return by_id[s0['id']]
        if s0:
            s = dict(s0)
            from build import short_name
            s['name'] = short_name(s['full'])
            s['tests'] = []
            schools.append(s)
            by_id[s['id']] = s
            return s
        # 偏差値表に無い学校も、名前だけで載せる
        sid = 'x' + re.sub(r'[^0-9A-Za-z]', '', str(abs(hash(key + str(pref))) % 10**8))
        if sid not in by_id:
            s = {'id': sid, 'full': key if key.endswith(('学校', '高等部', '学院')) else key + '高等学校', 'name': key,
                 'pref': pref if pref not in (None, '?') else '不明', 'kind': '私立', 'gender': '', 'area': '', 'dev': None,
                 'courses': [], 'tests': []}
            schools.append(s)
            by_id[sid] = s
        return by_id[sid]

    def own_test(s):
        tid = 'own-' + s['id']
        if tid not in tests:
            tests[tid] = {'id': tid, 'name': s['name'] + ' 独自問題', 'short': '独自', 'kind': 'own', 'pref': s['pref'], 'school': s['id']}
        if tid not in s['tests']:
            s['tests'].append(tid)
        return tid

    def common_test(cid):
        tid = cid
        if tid.startswith('jiko-'):
            return tid if tid in tests else None
        c = COMMON[cid]
        if tid not in tests:
            tests[tid] = {'id': tid, 'name': c['name'], 'short': c['short'], 'kind': 'common', 'pref': c['pref'], 'note': c['note']}
            members = []
            if cid == 'kosen':
                members = [s for s in allsch if '高等専門学校' in s['full'] and s['kind'] == '国立']
            for key in c.get('schools', []):
                m = find_school(allsch, key, c['pref'])
                if m:
                    members.append(m)
            for m in members:
                s = by_id.get(m['id']) or ensure_school(m['full'], m['pref'])
                if tid not in s['tests']:
                    s['tests'].append(tid)
            devs = [s['dev'] for s in schools if tid in s['tests'] and s['dev']]
            tests[tid]['devRef'] = statistics.median(devs) if devs else 65
        return tid

    def add_exam(tid, year, subject, files, source, extra=None):
        eid = f'{tid}-{year}-{subject}'
        e = ex_by_id.get(eid)
        if e is None:
            e = {'id': eid, 'test': tid, 'year': year, 'subject': subject, 'minutes': 50, 'max': 100, 'files': {}, 'source': source}
            if extra:
                e.update(extra)
            exams.append(e)
            ex_by_id[eid] = e
            for k, v in files.items():
                if v:
                    e['files'][k] = list(v)
            return 'new'
        # 既にある（公式の問題がある）ときは、足りない種類だけ補う
        added = []
        for k, v in files.items():
            if v and not e['files'].get(k):
                e['files'][k] = list(v)
                added.append(k)
        if added and source not in (e.get('source') or ''):
            names = {'problem': '問題', 'sheet': '解答用紙', 'key': '解答', 'whole': 'PDF全体', 'script': '台本', 'points': '採点のポイント'}
            what = '・'.join(names.get(k, k) for k in added if k != 'whole') or 'PDF全体'
            e['source'] = (e.get('source') + '・' if e.get('source') else '') + source + '（' + what + '）'
            e.pop('noProblem', None) if 'problem' in added else None
        return 'merge:' + ','.join(added) if added else 'dup'

    # --- 私立の公式公開分
    if os.path.exists(D('data', 'crawl-private.json')):
        from build import classify_jiko, kind_from, pdf_head, year_from, subj_from
        for r in json.load(open(D('data', 'crawl-private.json'), encoding='utf-8')):
            if re.search(r'policy|出題方針', r['url'] + r['label']):
                continue  # 来年度の出題方針は試験ではない
            if not r['label'].strip():
                r['label'] = r['ctx'][-12:].strip(' |')  # アイコンだけのリンクは、直前の文字（「国語 問題」など）を名前にする
            s = ensure_school(r['school'], None)
            tid = own_test(s)
            if r.get('merged'):
                y = year_from(r['label'])
                if not y:
                    continue
                for subj, rg in split_subjects(r['file']).items():
                    add_exam(tid, y, subj, {'problem': [{'src': r['file'], 'label': r['label'], 'pages': rg}]}, '学校の公式サイト')
                continue
            c = classify_jiko(r, {})
            if not c:
                continue
            year, subject, kind = c
            fn = r['url'].split('/')[-1]
            # 年度：小ページの年度 → ファイル名の西暦 → 判定結果
            m = re.search(r'(20[12]\d)', fn)
            year = r.get('year') or (int(m.group(1)) if m else None) or year
            # 教科：リンク文字 → ファイル名の英字 → 判定結果
            subject = subj_from(r['label']) or next((v for k, v in [(r'jap|jpn|kokugo|japanese', '国語'), (r'math|mat|sugaku|suugaku', '数学'),
                                                                     (r'eng|eigo|english|listening', '英語')] if re.search(k, fn, re.I)), None) or subject
            if re.search(r'_Q\.|問題', fn + r['label']):
                kind = 'problem'
            if re.search(r'_A\.|_k\.|解答用紙|\d1\.pdf$', fn + ' ' + r['label']):
                kind = 'sheet'
            if re.search(r'スクリプト|script|放送', r['label'] + r['url'], re.I):
                kind = 'script'
            if re.search(r'policy|出題方針', r['label'] + r['url'], re.I):
                kind = 'points'
            if re.search(r'listening', r['url'], re.I):
                kind = 'problem'
            if re.search(r'問題・解答|問題と解答', r['label'] + r['ctx'][-30:]):
                kind = 'problem'  # 帝京：問題と解答が 1 本
            if subject not in ('英語', '数学', '国語') or not year or not kind:
                report.append(f"private ? {r['file']} {year} {subject} {kind} {r['label']}")
                continue
            files = {kind: [{'src': r['file'], 'label': r['label']}]}
            if kind == 'problem':
                kinds = page_kinds(r['file'])  # 問題と解答が 1 本のとき（帝京など）は分ける
                if kinds and ('key' in kinds or 'sheet' in kinds):
                    files = {k: [{'src': r['file'], 'label': {'problem': '問題', 'sheet': '解答用紙', 'key': '解答'}[k], 'pages': rg}
                                 for rg in ranges(kinds, k)] for k in ('problem', 'sheet', 'key')}
                    files['whole'] = [{'src': r['file'], 'label': 'PDF全体（問題＋解答）'}]
            res = add_exam(tid, year, subject, files, '学校の公式サイト')
            # 同じ年度・教科の 2 本目以降（英語リスニングなど）は足していく
            if res == 'dup' or res.startswith('merge'):
                e = ex_by_id[f'{tid}-{year}-{subject}']
                if not any(f['src'] == r['file'] for f in e['files'].get(kind, [])):
                    e['files'].setdefault(kind, []).append({'src': r['file'], 'label': r['label']})

    # --- 数学サイト
    if os.path.exists(D('data', 'crawl-ext.json')):
        for r in json.load(open(D('data', 'crawl-ext.json'), encoding='utf-8')):
            target = map_label(r['label'])
            if target is None:
                continue
            key, pref = target
            if key == '?':
                unknown.append(f"{r['year']} {r['label']} {r['file']}")
                continue
            if key.startswith('@'):
                tid = common_test(key[1:])
                if not tid:
                    continue
            else:
                s = ensure_school(key, pref)
                tid = own_test(s)
            kinds = page_kinds(r['file'])
            if kinds is None:
                files = {'problem': [{'src': r['file'], 'label': '問題（解答も同じPDFの後ろにあります）'}]}
                note = {'mixedAnswers': True}
            else:
                files = {k: [{'src': r['file'], 'label': {'problem': '問題', 'sheet': '解答用紙', 'key': '解答'}[k], 'pages': rg}
                             for rg in ranges(kinds, k)] for k in ('problem', 'sheet', 'key')}
                note = None
                if not files['key'] or r.get('noAnswer'):
                    files['key'] = []
            files['whole'] = [{'src': r['file'], 'label': 'PDF全体（問題＋解答）'}]
            if kinds is not None and not files.get('key') and not files.get('sheet'):
                note = {'mixedAnswers': True}  # 区切りが見つからなかった
            res = add_exam(tid, r['year'], '数学', files, EXT_SOURCE, note)
            report.append(f"ext {res} {tid} {r['year']} {r['label']} kinds={''.join((k or '-')[0] for k in (kinds or []))}")
    with open(D('data', 'ext-report.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(['## 不明'] + unknown + ['', '## 取り込み'] + report))


def split_subjects(path):
    """1 本に 3 教科が入った PDF（早稲田佐賀）を、各ページの見出しから教科ごとのページ範囲に分ける。"""
    out = {}
    try:
        doc = pymupdf.open(D(path))
    except Exception:
        return out
    cur = None
    for i, p in enumerate(doc):
        t = nk(p.get_text())[:200]
        m = re.search(r'(国語|数学|英語)', t)
        if m:
            cur = m.group(1)
        if cur:
            a = out.setdefault(cur, [i + 1, i + 1])
            a[1] = i + 1
    doc.close()
    return out
