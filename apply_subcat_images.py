# -*- coding: utf-8 -*-
"""Reusa imagens locais (assets/images) para os 37 cards de subcategoria.

1. Atualiza o banco data/podpahh_db.json (afeta loja via /api/public/products e admin).
2. Atualiza o PRIMEIRO slide de cada subcat-card nas paginas estaticas
   (o que aparece sem interacao), trocando placeholder.svg pela imagem escolhida.
"""
import json
import re
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
DB_FILE = ROOT / 'data' / 'podpahh_db.json'

# slug da subcategoria -> arquivo local existente em assets/images
# (escolhido pelo sabor/marca original; fallback = banner da categoria)
MAPPING = {
    'black-sheep-25k':              'straw-ice-600x600.jpg',            # Morango Kiwi
    'black-sheep-55k':              'melancia-maca-600x600.jpg',        # Melancia Ice
    'black-sheep-dual-tank-40k':    'straw-ice-600x600.jpg',            # Morango Kiwi Coca
    'black-sheep-kit-e-refil':      'MENTHOL-1-600x600.jpg',            # Miami Mint
    'dinner-lady-50k-dual-flavor':  'DESCARTAVEIS.png',
    'dinner-lady-galax-60k':        'DESCARTAVEIS.png',                 # California Cherry
    'dinner-lady-luma-20k':         'DESCARTAVEIS.png',                 # Banana Ice
    'elfbar-duke-35k':              'BAJA-SPLASH-2-600x600.jpg',        # Blue Razz
    'elfbar-eb-create-40k':         'MENTHOL-1-600x600.jpg',            # Winter Mint
    'elfbar-ew-9k-e-16k':           'fussion-passion-grape-600x600.jpg',# BlueRazz Grape
    'elfbar-gh23k':                 'fusion-kiwi-pom-600x600.jpg',      # Kiwi Pitaia
    'elfworld-10k-refil':           'melancia-maca-600x600.jpg',        # Pessego Melancia Manga
    'f-base-juice-de-vape':         'E-LIQUIDOS.png',
    'geekbar-35k':                  'BAJA-SPLASH-2-600x600.jpg',        # Blue Razz Ice
    'icity-ice-fury-40k':           'MENTHOL-1-600x600.jpg',
    'ignite-p100':                  'DESCARTAVEIS.png',                 # bateria prata
    'ignite-shisha-40k':            'DESCARTAVEIS.png',                 # blueberry lemonade
    'ignite-v-frozen':              'fussion-passion-grape-600x600.jpg',# Uva
    'ignite-v-nano':                'fussion-passion-grape-600x600.jpg',# Acai Uva
    'ignite-v155':                  'DESCARTAVEIS.png',                 # Orange Abacaxi
    'ignite-v250':                  '15401973498-menta-ice-9-300x300.jpg', # Menta
    'ignite-v400-ice-ultra-slim':   'fussion-passion-grape-600x600.jpg',# Uva Ice
    'ignite-v400-mix':              'fusion-kiwi-pom-600x600.jpg',      # Maracuja Kiwi
    'ignite-v500':                  'straw-ice-600x600.jpg',            # Morango Ice
    'ignite-v55-ultra-thin':        'DESCARTAVEIS.png',                 # Melao
    'ignite-v80-ne':                'DESCARTAVEIS.png',                 # Blueberry Limao
    'ignite-v80-ultra-slim':        'MENTHOL-1-600x600.jpg',
    'life-pod-eco-3':               'DESCARTAVEIS.png',                 # kit bateria
    'lifepod-8k-pro':               'straw-ice-600x600.jpg',            # Morango Banana
    'lifepod-eco2-10k':             'DESCARTAVEIS.png',
    'lifepod-the-one-40k':          'MONSTER-2-1-600x600.jpg',          # linha THE ONE
    'nick-salt-juice-de-pod':       '15401973498-menta-ice-9-300x300.jpg', # Menta Cereja
    'oxbar-50k-invisible-vapor':    'DESCARTAVEIS.png',                 # Abacaxi Ice
    'pods':                         'VAPORIZADORES.png',
    'resistencia-de-pod-coil':      'RESISTENCIAS.png',
    'resistencia-de-vape':          'RESISTENCIAS.png',
    'vapes':                        'VAPORIZADORES.png',
}

IMG_DIR = ROOT / 'assets' / 'images'
avail = {f.name for f in IMG_DIR.glob('*') if f.is_file()}
bad = {s: f for s, f in MAPPING.items() if f not in avail}
if bad:
    raise SystemExit(f'MAPEAMENTO COM ARQUIVO INEXISTENTE: {bad}')

# ---------------- 1) BANCO ----------------
db = json.loads(DB_FILE.read_text(encoding='utf-8'))
fixed_db = 0
for p in db['products']:
    url = p.get('url') or ''
    m = re.search(r'categoria-produto/[^/"]+/([^/"]+)/?', url)
    if not m:
        continue
    slug = m.group(1)
    if slug in MAPPING:
        p['image'] = 'assets/images/' + MAPPING[slug]
        fixed_db += 1
DB_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'[DB] imagens preenchidas: {fixed_db}')

# ---------------- 2) HTMLS (primeiro slide de cada subcat-card) ----------------
CARD_RE = re.compile(
    r'(href="(?:\.\./)*categoria-produto/[^/"]+/([^/"]+)/"[^>]*class="subcat-card-slider-link">.{0,3000}?'
    r'data-src=")((?:\.\./)*)assets/images/placeholder\.svg(")',
    re.S)

total_html = 0
for html_path in sorted(ROOT.rglob('*.html')):
    if 'node_modules' in str(html_path):
        continue
    txt = html_path.read_text(encoding='utf-8', errors='replace')
    n = 0
    def repl(m):
        global n
        slug, prefix = m.group(2), m.group(3)
        if slug not in MAPPING:
            return m.group(0)
        n += 1
        return f'{m.group(1)}{prefix}assets/images/{MAPPING[slug]}{m.group(4)}'
    new = CARD_RE.sub(repl, txt)
    if n:
        html_path.write_text(new, encoding='utf-8')
        print(f'[HTML] {html_path.relative_to(ROOT)}: {n} slide(s) corrigido(s)')
        total_html += n
print(f'[HTML] total de slides corrigidos: {total_html}')

# ---------------- 3) VERIFICACAO ----------------
db = json.loads(DB_FILE.read_text(encoding='utf-8'))
sem = [p for p in db['products'] if not p.get('image')]
inv = [p for p in db['products']
       if p.get('image') and p['image'].replace('\\', '/').split('/')[-1] not in avail]
print(f'[VERIFICACAO] produtos: {len(db["products"])} | sem imagem: {len(sem)} | caminho invalido: {len(inv)}')
for p in sem:
    print('   SEM:', p['name'][:60])
