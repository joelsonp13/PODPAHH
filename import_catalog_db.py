import re
import json
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
DB_FILE = ROOT / 'data' / 'podpahh_db.json'

PCARD_RE = re.compile(r'<div class="pcard" id="pcard-(\d+)">(.*?)(?=<div class="pcard" id=|</ol>|</ul>|$)', re.S)
NAME_RE = re.compile(r'class="pcard-name"[^>]*>([^<]+)<')
PRICE_RE = re.compile(r'class="pcard-price(?:\s[^"]*)?">([^<]+)<')
IMG_RE = re.compile(r'data-src="([^"]+)"')
LINK_RE = re.compile(r'href="([^"]*produto/[^"]*)"')
BRAND_RE = re.compile(r'class="pcard-brand"[^>]*>([^<]+)<')

CATS = {
    'descartaveis': 'descartaveis',
    'e-liquids': 'e-liquids',
    'resistencias': 'resistencias',
    'aparelhos': 'aparelhos',
    'acessorios': 'acessorios',
    'outlet': 'outlet',
}

def parse_price(s):
    s = (s or '').replace('R$', '').replace('.', '').replace(',', '.').strip()
    try: return float(s)
    except: return 0

def detect_category(html_path):
    # categoria pelo nome da pasta pai, se estiver em pages/categoria-produto/<cat>.html
    if html_path.parent.name == 'categoria-produto':
        stem = html_path.stem
        if stem in CATS: return CATS[stem]
    return None  # deixado para subcats ou default

def main():
    catalog = {}

    for html_path in ROOT.rglob('*.html'):
        rel = str(html_path.relative_to(ROOT)).replace('\\', '/')
        if rel.startswith('produto/') or 'admin' in rel: continue

        html = html_path.read_text(encoding='utf-8', errors='replace')
        category = detect_category(html_path) or 'descartaveis'

        for m in PCARD_RE.finditer(html):
            pid, body = m.group(1), m.group(2)
            name_m = NAME_RE.search(body)
            if not name_m: continue
            price_m = PRICE_RE.search(body)
            img_m = IMG_RE.search(body)
            link_m = LINK_RE.search(body)
            brand_m = BRAND_RE.search(body)
            catalog[pid] = {
                'name': name_m.group(1).strip(),
                'price': parse_price(price_m.group(1)) if price_m else 0,
                'old_price': 0,
                'img': img_m.group(1) if img_m else '',
                'url': link_m.group(1) if link_m else '',
                'brand': brand_m.group(1).strip() if brand_m else '',
                'category': category,
                'source_file': rel
            }

        # subcat-cards
        SUBCAT_RE = re.compile(r'<div class="subcat-card"[^>]*data-price="([\d.,]+)"[^>]*>(.*?)(?=<div class="subcat-card"|</section>|$)', re.S)
        SUBCAT_LINK_RE = re.compile(r'href="([^"]+)"\s+class="subcat-card-slider-link"')
        SUBCAT_IMG_RE = re.compile(r'<img[^>]*data-src="([^"]+)"')
        SUBCAT_NAME_RE = re.compile(r'class="pcard-name"[^>]*>([^<]+)<')

        for m in SUBCAT_RE.finditer(html):
            price, body = m.group(1), m.group(2)
            name_m = SUBCAT_NAME_RE.search(body)
            if not name_m: continue
            link_m = SUBCAT_LINK_RE.search(body)
            img_m = SUBCAT_IMG_RE.search(body)
            slug = (link_m.group(1) if link_m else name_m.group(1)).strip().rstrip('/')
            slug = re.sub(r'[^a-z0-9-]', '-', slug.lower())
            pid = re.sub(r'^.*?/([^/]+)/?$', r'\1', slug) or slug
            catalog[pid] = {
                'name': name_m.group(1).strip(),
                'price': parse_price(price),
                'old_price': 0,
                'img': img_m.group(1) if img_m else '',
                'url': (link_m.group(1) if link_m else '#'),
                'brand': '',
                'category': category,
                'source_file': rel
            }

    DB_FILE.parent.mkdir(exist_ok=True)
    db = json.loads(DB_FILE.read_text(encoding='utf-8')) if DB_FILE.exists() else {}
    db.setdefault('customers', []); db.setdefault('orders', []); db.setdefault('products', []); db.setdefault('logs', [])

    added, updated = 0, 0
    for pid, prod in catalog.items():
        existing = next((p for p in db['products'] if p.get('source_id') == pid), None)
        if existing:
            if existing.get('category') != prod['category']:
                existing['category'] = prod['category']
                updated += 1
            if not existing.get('price') and prod['price']:
                existing['price'] = prod['price']
            if prod['img'] and 'placeholder' in (existing.get('image') or '') and 'placeholder' not in prod['img']:
                existing['image'] = prod['img']
            continue
        safe_pid = re.sub(r'[^a-z0-9_-]', '', pid)[:40] or pid[:40]
        db['products'].append({
            'id': 'prod_' + safe_pid,
            'source_id': pid,
            'name': prod['name'],
            'price': prod['price'],
            'old_price': prod['old_price'],
            'category': prod['category'],
            'image': prod['img'],
            'url': prod['url'],
            'stock': 50,
            'description': ('Marca: ' + prod['brand']) if prod['brand'] else '',
            'created_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()
        })
        added += 1

    DB_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')

    from collections import Counter
    cats = Counter(p['category'] for p in db['products'])
    print(f'Catalogo extraido: {len(catalog)} produtos unicos')
    print(f'Novos importados: {added} | Atualizados: {updated}')
    print(f'Total no banco: {len(db["products"])}')
    for c, n in cats.most_common():
        print(f'  - {c}: {n}')

if __name__ == '__main__':
    main()
