"""
私立高校の公式サイトで公開されている過去問（英数国）を集める。
出どころは本人が渡したリンク集（rpubs.com/jaked0626/koukou_kakomon）を、2026-11-11 時点の公式ページに直したもの。

  python scripts/crawl_private.py    → pdfs/private/<学校>/ と data/crawl-private.json

学校ごとに、対象ページと「含める／除く」の正規表現を決めておく（中学入試・推薦・帰国生・小論文は除く）。
"""
import json, os, re, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import crawl as C

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

WASEDA = 'https://www.waseda.jp/inst/admission/others/attached/past-test/'
SOURCES = [
    {'key': 'aogaku', 'school': '青山学院高等部', 'pages': ['https://www.agh.aoyama.ed.jp/admission/examination/index.html']},
    {'key': 'chuo', 'school': '中央大学附属高等学校', 'pages': ['https://www.hs.chuo-u.ac.jp/senior/se-exam/se-past-q/'],
     'include': r'_hs_general_', 'exclude': r'帰国|recom|essay'},
    {'key': 'chusugi', 'school': '中央大学杉並高等学校', 'pages': ['https://chusugi.jp/exam/data/'],
     'include': r'\d{4}C_|policy', 'exclude': r'\d{4}A_|推薦'},
    {'key': 'seikei', 'school': '成蹊高等学校', 'pages': ['https://www.seikei.ac.jp/jsh/entranceguide/past_exam.html'],
     'include': r'/h_\d{4}'},
    {'key': 'teikyo', 'school': '帝京大学高等学校', 'pages': ['https://www.teikyo.ed.jp/exam_s/download_s/'],
     'include': r'kou_(eigo|kokugo|sugaku)'},
    {'key': 'wasedasaga', 'school': '早稲田佐賀高等学校', 'pages': ['https://www.wasedasaga.jp/admission/past_questions/'],
     'include': r'高校', 'merged': True},
    # 早稲田の附属・系属：年度ごとの小ページ。並び順は 高等学院 → 中学部 → 本庄
    {'key': 'waseda-gakuin', 'school': '早稲田大学高等学院', 'waseda_group': 0},
    {'key': 'waseda-honjo', 'school': '早稲田大学本庄高等学院', 'waseda_group': 2},
]
SUBJ = r'(国語|数学|英語|kokugo|sugaku|math|eigo|english|jpn|mat|eng|Japanese)'


def pages_of(src):
    if 'waseda_group' in src:
        ls = [l for l in C.links_of(WASEDA) if '入試問題' in l['label'] and re.search(r'20\d\d年度', l['label'])]
        g = src['waseda_group']
        return [(l['url'], int(re.search(r'(20\d\d)年度', l['label']).group(1))) for l in ls[g * 3:g * 3 + 3]]
    return [(p, None) for p in src['pages']]


def main():
    rec = []
    for src in SOURCES:
        n = 0
        for page, year in pages_of(src):
            try:
                ls = C.links_of(page)
            except Exception as e:
                print('!!', src['key'], page, e, flush=True)
                continue
            for l in ls:
                u = l['url']
                if not re.search(r'\.pdf($|\?)', u, re.I):
                    continue
                hay = u + ' ' + l['label'] + ' ' + l['before'][-60:]
                if src.get('include') and not re.search(src['include'], hay):
                    continue
                if src.get('exclude') and re.search(src['exclude'], u + ' ' + l['label']):
                    continue
                if re.search(r'小論文|shouronbun|作文|面接|パンフ|案内|個人情報|いじめ|ハラスメント|合格実績|goukaku', l['label'] + u):
                    continue
                if not src.get('merged') and not re.search(SUBJ, hay, re.I):
                    continue
                try:
                    rel = C.download(u, 'private/' + src['key'])
                except Exception as e:
                    print('  !', u, e, flush=True)
                    continue
                rec.append({'src': 'private', 'key': src['key'], 'school': src['school'], 'year': year, 'merged': bool(src.get('merged')),
                            'label': l['label'], 'ctx': l['before'][-300:], 'url': u, 'file': rel})
                n += 1
        print(src['key'], n, flush=True)
    json.dump(rec, open(os.path.join(ROOT, 'data', 'crawl-private.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('total', len(rec))


if __name__ == '__main__':
    main()
