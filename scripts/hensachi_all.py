"""全国（数学サイトに出てくる道府県）の高校偏差値を集める → data/hensachi-all.json（偏差値40以上）"""
import json, os, re, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'}
PREFS = {'hokkaido': '北海道', 'aomori': '青森', 'miyagi': '宮城', 'ibaraki': '茨城', 'tochigi': '栃木', 'gunma': '群馬',
         'saitama': '埼玉', 'tokyo': '東京', 'kanagawa': '神奈川', 'chiba': '千葉', 'aichi': '愛知', 'shiga': '滋賀', 'kyoto': '京都',
         'osaka': '大阪', 'hyogo': '兵庫', 'nara': '奈良', 'wakayama': '和歌山', 'okayama': '岡山', 'hiroshima': '広島',
         'shimane': '島根', 'tokushima': '徳島', 'kochi': '高知', 'fukuoka': '福岡', 'saga': '佐賀', 'nagasaki': '長崎',
         'kagoshima': '鹿児島', 'okinawa': '沖縄'}
out = []
for pref, pname in PREFS.items():
    page = 1
    while page < 40:
        url = f'https://www.minkou.jp/hischool/ranking/deviation/pref={pref}/' + (f'page={page}' if page > 1 else '')
        try:
            s = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read().decode('utf-8', 'replace')
        except Exception as e:
            print('!', url, e, flush=True); break
        blocks = s.split('<li class="mod-listRanking-list">')[1:]
        if not blocks:
            break
        low = False
        for b in blocks:
            m = re.search(r'mod-listRanking-name">\s*<a href="/hischool/school/(\d+)/">([^<]+)</a>([^<]*)<span>([^<]*)</span>', b)
            d = re.search(r'info-main">\s*<a[^>]*>(\d+)</a>', b)
            if not m or not d:
                continue
            sid, name, course, info = m.groups()
            dev = int(d.group(1))
            if dev < 40:
                low = True
                continue
            parts = info.split('/')
            out.append({'mk': int(sid), 'name': name.strip(), 'course': course.strip(), 'pref': pname, 'area': parts[0],
                        'station': parts[1] if len(parts) > 1 else '', 'type': parts[2] if len(parts) > 2 else '',
                        'gender': parts[3] if len(parts) > 3 else '', 'dev': dev})
        if low:
            break
        page += 1
        time.sleep(1.0)
    print(pref, page, len(out), flush=True)
json.dump(out, open(os.path.join(ROOT, 'data', 'hensachi-all.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('done', len(out))
