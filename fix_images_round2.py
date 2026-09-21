# -*- coding: utf-8 -*-
"""Preenche imagens faltantes em duas etapas:
1. Produtos com source_id numerico: le o pcard correspondente em index.html/loja.html
   (que tem imagens reais) e extrai a data-src.
2. Produtos de subcategoria (sem pagina individual no disco): verifica se a pasta
   produto/<slug-parecido> existe e usa a imagem dela. Senao, mantem placeholder
   (as paginas de subcategoria apontam para placeholder.svg no proprio site original).
"""
import json
import re
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
DB_FILE = ROOT / 'data' / 'podpahh_db.json'
IMG_DIR = ROOT / 'assets' / 'images'

available = {f.name for f in IMG_DIR.glob('*') if f.is_file()}
db = json.loads(DB_FILE.read_text(encoding='utf-8'))

IMG_RE = re.compile(r'data-src="([^"]+)"')

# Monta mapa pcard-id -> imagem a partir de todas as paginas com pcards numerados
pcard_img = {}
for html_path in [ROOT / 'index.html', ROOT / 'pages' / 'loja.html'] + list((ROOT / 'pages' / 'categoria-produto').glob('*.html')):
    if not html_path.exists(): continue
    html = html_path.read_text(encoding='utf-8', errors='replace')
    for m in re.finditer(r'id="pcard-(\d+)"(.*?)(?=id="pcard-\d+"|$)', html, re.S):
        pid, body = m.group(1), m.group(2)
        im = IMG_RE.search(body)
        if im:
            leaf = im.group(1).replace('\\', '/').split('/')[-1]
            if leaf in available and 'placeholder' not in leaf and 'cropped-vapor' not in leaf:
                pcard_img[pid] = leaf

# Mapa slug de produto individual -> imagem (das 29 pastas produto/)
produto_img = {}
prod_dir = ROOT / 'produto'
for d in prod_dir.iterdir():
    if not d.is_dir(): continue
    idx = d / 'index.html'
    if not idx.exists(): continue
    html = idx.read_text(encoding='utf-8', errors='replace')
    # imagem principal geralmente aparece perto de product_title/gallery
    for m in IMG_RE.finditer(html):
        leaf = m.group(1).replace('\\', '/').split('/')[-1]
        if leaf in available and 'placeholder' not in leaf and 'cropped-vapor' not in leaf \
           and 'DESCARTAVEIS' not in leaf and 'E-LIQUIDOS' not in leaf and 'ACESSORIOS' not in leaf \
           and 'RESISTENCIAS' not in leaf and 'VAPORIZADORES' not in leaf and 'logo' not in leaf.lower():
            produto_img[d.name] = leaf
            break

fixed_by_pcard, fixed_by_produto, unmatched = 0, 0, []

for p in db['products']:
    if p.get('image'):  # ja tem imagem valida
        continue
    sid = p.get('source_id', '')

    # 1) por pcard-id numerico
    if sid in pcard_img:
        p['image'] = 'assets/images/' + pcard_img[sid]
        fixed_by_pcard += 1
        continue

    # 2) por pasta produto/ cujo slug aparece na url do produto
    url = p.get('url', '') or ''
    m = re.search(r'produto/([^/"]+)', url)
    slug = m.group(1) if m else ''
    if slug and slug in produto_img:
        p['image'] = 'assets/images/' + produto_img[slug]
        fixed_by_produto += 1
        continue

    # 3) tenta casar nome: "Ignite P100" -> pasta ignite-p100?
    name_slug = re.sub(r'[^a-z0-9]+', '-', p['name'].lower()).strip('-')
    for folder, leaf in produto_img.items():
        if name_slug[:20] in folder or folder[:20] in name_slug:
            p['image'] = 'assets/images/' + leaf
            fixed_by_produto += 1
            break
    else:
        unmatched.append((p['name'], sid, url))

DB_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')

valid = sum(1 for p in db['products'] if p['image'])
print(f'Corrigidas via pcard-id: {fixed_by_pcard}')
print(f'Corrigidas via pasta produto/: {fixed_by_produto}')
print(f'Total com imagem valida: {valid}/{len(db["products"])}')
print(f'Sem imagem no disco ({len(unmatched)}):')
for name, sid, url in unmatched:
    print(f'  - {name[:50]} | id={sid} | {url[:50]}')
