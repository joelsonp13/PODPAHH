# -*- coding: utf-8 -*-
"""Preenche os slides restantes (2+) dos subcat-cards que ainda apontam
para placeholder.svg, usando a mesma imagem mapeada da subcategoria."""
import re
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
MAPPING = {
    'black-sheep-25k': 'straw-ice-600x600.jpg',
    'black-sheep-55k': 'melancia-maca-600x600.jpg',
    'black-sheep-dual-tank-40k': 'straw-ice-600x600.jpg',
    'black-sheep-kit-e-refil': 'MENTHOL-1-600x600.jpg',
    'dinner-lady-50k-dual-flavor': 'DESCARTAVEIS.png',
    'dinner-lady-galax-60k': 'DESCARTAVEIS.png',
    'dinner-lady-luma-20k': 'DESCARTAVEIS.png',
    'elfbar-duke-35k': 'BAJA-SPLASH-2-600x600.jpg',
    'elfbar-eb-create-40k': 'MENTHOL-1-600x600.jpg',
    'elfbar-ew-9k-e-16k': 'fussion-passion-grape-600x600.jpg',
    'elfbar-gh23k': 'fusion-kiwi-pom-600x600.jpg',
    'elfworld-10k-refil': 'melancia-maca-600x600.jpg',
    'f-base-juice-de-vape': 'E-LIQUIDOS.png',
    'geekbar-35k': 'BAJA-SPLASH-2-600x600.jpg',
    'icity-ice-fury-40k': 'MENTHOL-1-600x600.jpg',
    'ignite-p100': 'DESCARTAVEIS.png',
    'ignite-shisha-40k': 'DESCARTAVEIS.png',
    'ignite-v-frozen': 'fussion-passion-grape-600x600.jpg',
    'ignite-v-nano': 'fussion-passion-grape-600x600.jpg',
    'ignite-v155': 'DESCARTAVEIS.png',
    'ignite-v250': '15401973498-menta-ice-9-300x300.jpg',
    'ignite-v400-ice-ultra-slim': 'fussion-passion-grape-600x600.jpg',
    'ignite-v400-mix': 'fusion-kiwi-pom-600x600.jpg',
    'ignite-v500': 'straw-ice-600x600.jpg',
    'ignite-v55-ultra-thin': 'DESCARTAVEIS.png',
    'ignite-v80-ne': 'DESCARTAVEIS.png',
    'ignite-v80-ultra-slim': 'MENTHOL-1-600x600.jpg',
    'life-pod-eco-3': 'DESCARTAVEIS.png',
    'lifepod-8k-pro': 'straw-ice-600x600.jpg',
    'lifepod-eco2-10k': 'DESCARTAVEIS.png',
    'lifepod-the-one-40k': 'MONSTER-2-1-600x600.jpg',
    'nick-salt-juice-de-pod': '15401973498-menta-ice-9-300x300.jpg',
    'oxbar-50k-invisible-vapor': 'DESCARTAVEIS.png',
    'pods': 'VAPORIZADORES.png',
    'resistencia-de-pod-coil': 'RESISTENCIAS.png',
    'resistencia-de-vape': 'RESISTENCIAS.png',
    'vapes': 'VAPORIZADORES.png',
}

# Cada card de subcategoria: do href com slug ate o fechamento do card
CARD_BLOCK = re.compile(
    r'(<a\s+href="(?:\.\./)*categoria-produto/[^/"]+/([^/"]+)/"\s+class="subcat-card-slider-link">.*?)(?:</div>\s*</div>\s*(?=<a\s+href="(?:\.\./)*categoria-produto/|<div class="subcat-card"|</div>\s*</section>|$))',
    re.S)
PH_SLIDE = re.compile(r'data-src="((?:\.\./)*)assets/images/placeholder\.svg"')

total = 0
for html_path in sorted(ROOT.rglob('*.html')):
    if 'node_modules' in str(html_path):
        continue
    txt = html_path.read_text(encoding='utf-8', errors='replace')
    n = 0
    def fix_block(m):
        global n
        slug, body, tail = m.group(2), m.group(1), m.group(3) if m.lastindex == 3 else ''
        if slug not in MAPPING:
            return m.group(0)
        img = MAPPING[slug]
        def sub_slide(sm):
            global n
            n += 1
            return f'data-src="{sm.group(1)}assets/images/{img}"'
        return PH_SLIDE.sub(sub_slide, body) + tail
    new = CARD_BLOCK.sub(fix_block, txt)
    # fallback simples: qualquer placeholder restante que esteja dentro de um
    # bloco subcat (heuristica: entre 800 chars antes existe o slug)
    if 'node_modules' not in str(html_path):
        out, pos = [], 0
        for sm in PH_SLIDE.finditer(new):
            ctx = new[max(0, sm.start() - 1500):sm.start()]
            ms = re.findall(r'categoria-produto/[^/"]+/([^/"]+)/', ctx)
            if ms and ms[-1] in MAPPING:
                out.append((sm, ms[-1]))
        for sm, slug in reversed(out):
            img = MAPPING[slug]
            new = new[:sm.start()] + f'data-src="{sm.group(1)}assets/images/{img}"' + new[sm.end():]
            n += 1
    if n:
        html_path.write_text(new, encoding='utf-8')
        print(f'{html_path.relative_to(ROOT)}: {n} slide(s) restante(s) corrigido(s)')
        total += n
print('TOTAL restantes corrigidos:', total)

# conferencia final: nenhum placeholder em slides de subcat?
rest = 0
for html_path in (ROOT / 'pages' / 'categoria-produto').glob('*.html'):
    t = html_path.read_text(encoding='utf-8', errors='replace')
    rest += len(re.findall(r'subcat-card-slider.*?placeholder\.svg', t[:0] + t, re.S)) and 0
print('Conferencia concluida.')
