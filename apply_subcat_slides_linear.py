# -*- coding: utf-8 -*-
"""Varredura linear: para cada data-src=placeholder.svg, procura o slug da
subcategoria mais recente ANTES dele no texto e substitui. Sem regex com
backtracking — split por marcadores."""
from pathlib import Path
import re

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

SLUG_RE = re.compile(r'categoria-produto/[^/"]+/([^/"]+)/')
PH_TOKEN = 'PH__TOKEN__PH'

total = 0
for html_path in sorted(ROOT.rglob('*.html')):
    if 'node_modules' in str(html_path):
        continue
    txt = html_path.read_text(encoding='utf-8', errors='replace')
    n = 0
    # trabalha por segmentos: cada occurrence de placeholder vira token,
    # depois processa com finditer sobre slugs
    occurrences = [m.start() for m in re.finditer(r'data-src="((?:\.\./)*)assets/images/placeholder\.svg"', txt)]
    if not occurrences:
        continue
    out = []
    last = 0
    for pos in occurrences:
        # contexto: 2500 chars antes; slug mais proximo ANTES do placeholder
        ctx_start = max(0, pos - 2500)
        ctx = txt[ctx_start:pos]
        slugs = SLUG_RE.findall(ctx)
        seg = txt[last:pos]
        if slugs and slugs[-1] in MAPPING:
            # substitui o placeholder que ocorre logo apos
            m2 = re.match(r'(.*)data-src="((?:\.\./)*)assets/images/placeholder\.svg"(.*)$', txt[pos:pos+200], re.S)
            # mais simples: acha o fim do literal placeholder a partir de pos
            lit = re.compile(r'data-src="((?:\.\./)*)assets/images/placeholder\.svg"')
            m2 = lit.match(txt, pos)
            if m2:
                out.append(seg)
                out.append(f'data-src="{m2.group(1)}assets/images/{MAPPING[slugs[-1]]}"')
                last = m2.end()
                n += 1
    if n:
        out.append(txt[last:])
        html_path.write_text(''.join(out), encoding='utf-8')
        print(f'{html_path.relative_to(ROOT)}: {n} placeholder(s) restante(s) substituido(s)')
        total += n
print('TOTAL:', total)
