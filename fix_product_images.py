# -*- coding: utf-8 -*-
"""Corrige imagens dos produtos no banco:
1. Valida imagens existentes no disco (assets/images);
2. Para quebradas/vazias, busca a imagem real nas paginas do site
   (paginas de produto individuais e cards das categorias);
3. Normaliza caminhos relativos -> caminhos servidos pelo Express (relativos a raiz).
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

def find_image_in_file(html_text):
    """Retorna primeira data-src que corresponda a um arquivo existente."""
    for m in IMG_RE.finditer(html_text):
        src = m.group(1)
        leaf = src.replace('\\', '/').split('/')[-1].split('?')[0]
        if leaf in available and 'placeholder' not in leaf and not leaf.startswith('cropped-vapor'):
            return leaf
    return None

def product_dir_candidates(url):
    """Dado url do produto (ex: produto/black-sheep-25k/), retorna caminhos da pasta do produto."""
    if not url: return []
    m = re.search(r'produto/([^/"]+)', url)
    if not m: return []
    slug = m.group(1)
    return [ROOT / 'produto' / slug / 'index.html']

def category_page_for(cat):
    return ROOT / 'pages' / 'categoria-produto' / (cat + '.html')

fixed, still_missing = 0, 0

for p in db['products']:
    img = p.get('image') or ''
    leaf = img.replace('\\', '/').split('/')[-1].split('?')[0] if img else ''
    valid = bool(leaf) and leaf in available and 'placeholder' not in leaf

    if valid:
        # normaliza para caminho relativo a raiz (servido pelo Express)
        p['image'] = 'assets/images/' + leaf
        continue

    # 1) tenta na pagina individual do produto
    new_leaf = None
    for cand in product_dir_candidates(p.get('url', '')):
        if cand.exists():
            new_leaf = find_image_in_file(cand.read_text(encoding='utf-8', errors='replace'))
            if new_leaf: break

    # 2) tenta no card da categoria (procura pelo slug do link do produto)
    if not new_leaf:
        cat_page = category_page_for(p.get('category', 'descartaveis'))
        if cat_page.exists():
            html = cat_page.read_text(encoding='utf-8', errors='replace')
            # localiza bloco do subcat-card/pcard que contenha o slug deste produto
            slug = ''
            m = re.search(r'produto/([^/"]+)', p.get('url', '') or '')
            if m: slug = m.group(1)
            # fallback: usa nome normalizado
            if not slug:
                slug = re.sub(r'[^a-z0-9]+', '-', p['name'].lower()).strip('-')
            # recorta janela em torno da ocorrencia do slug
            idx = html.find(slug)
            if idx >= 0:
                window = html[max(0, idx - 500): idx + 3000]
                new_leaf = find_image_in_file(window)

    if new_leaf:
        p['image'] = 'assets/images/' + new_leaf
        fixed += 1
    else:
        p['image'] = ''  # deixa vazio: front-end usa placeholder
        still_missing += 1

DB_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')

print(f'Imagens corrigidas: {fixed}')
print(f'Sem imagem disponivel: {still_missing}')
valid_now = sum(1 for p in db['products'] if p['image'])
print(f'Total com imagem valida: {valid_now}/{len(db["products"])}')
