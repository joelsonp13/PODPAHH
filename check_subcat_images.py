# -*- coding: utf-8 -*-
"""Verifica se as imagens dos sliders de subcategoria (site original/backup)
existem em assets/images do site novo."""
import re
from pathlib import Path

BK = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop-backup')
NEW = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
IMG = NEW / 'assets' / 'images'
avail = {f.name.lower(): f.name for f in IMG.glob('*') if f.is_file()}

cat_dir = BK / 'pages' / 'categoria-produto'
results = {}
for html in cat_dir.glob('*.html'):
    t = html.read_text(encoding='utf-8', errors='replace')
    # cada card de subcategoria: href=".../categoria-produto/<cat>/<slug>/" ... primeiro data-src
    for m in re.finditer(r'href="[^"]*?categoria-produto/([^/"]+)/([^/"]+)/"[^>]*class="subcat-card-slider-link">(.*?)</a>\s*</div>', t, re.S):
        cat, slug, body = m.group(1), m.group(2), m.group(3)
        im = re.search(r'data-src="([^"]+)"', body)
        if im:
            leaf = im.group(1).replace('\\', '/').split('/')[-1]
            results.setdefault(slug, (cat, leaf, leaf.lower() in avail))

found = missing = 0
print(f'{"SLUG":50} | {"IMAGEM (original)":45} | existe em assets/images?')
print('-' * 110)
for slug, (cat, leaf, ok) in sorted(results.items()):
    print(f'{slug[:50]:50} | {leaf[:45]:45} | {"SIM" if ok else "NAO"}')
    if ok: found += 1
    else: missing += 1
print(f'\nTotal subcats c/ imagem no original: {len(results)} | encontradas localmente: {found} | faltando: {missing}')

# semelhanca: tenta casar por nome-base (sem -600x600 etc.)
print('\n=== TENTATIVA DE MATCH POR NOME-BASE ===')
def base(n):
    n = re.sub(r'-\d+x\d+(?=\.\w+$)', '', n.lower())
    return re.sub(r'[^a-z0-9]+', '-', n).strip('-')

for slug, (cat, leaf, ok) in sorted(results.items()):
    if ok: continue
    b = base(leaf)
    cands = [orig for low, orig in avail.items() if base(low) == b]
    if cands:
        print(f'  {slug[:45]:45} -> {cands[0]}')
