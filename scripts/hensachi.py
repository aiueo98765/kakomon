"""みんなの高校情報の偏差値ランキングから、偏差値60以上の高校を集めて data/hensachi-raw.json に書く。"""
import re, json, time, urllib.request
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'}
PREFS = {'tokyo': '東京', 'kanagawa': '神奈川', 'chiba': '千葉'}
out = []
for pref, pname in PREFS.items():
    page = 1
    while True:
        url = f'https://www.minkou.jp/hischool/ranking/deviation/pref={pref}/' + (f'page={page}' if page > 1 else '')
        b = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()
        s = b.decode('utf-8', errors='replace')
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
            if dev < 60:
                low = True
                continue
            parts = info.split('/')
            out.append({'mk': int(sid), 'name': name.strip(), 'course': course.strip(), 'pref': pname, 'area': parts[0],
                        'station': parts[1] if len(parts) > 1 else '', 'type': parts[2] if len(parts) > 2 else '',
                        'gender': parts[3] if len(parts) > 3 else '', 'dev': dev})
        print(pref, page, len(blocks), out[-1]['dev'] if out else '-', flush=True)
        if low:
            break
        page += 1
        time.sleep(1.0)
json.dump(out, open('data/hensachi-raw.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out))
