# -*- coding: utf-8 -*-
"""Diagnostico: produtos sem imagem / imagens invalidas no DB e no front."""
import json, re
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
DB_FILE = ROOT / 'data' / 'podpahh_db.json'
IMG_DIR = ROOT / 'assets' / 'images'

db = json.loads(DB_FILE.read_text(encoding='utf-8'))
imgs = {f.name for f in IMG_DIR.glob('*') if f.is_file()}
products = db['products']

total = len(products)
sem_img = [p for p in products if not p.get('image')]
invalid = []
placeholder = []
for p in products:
    im = p.get('image') or ''
    leaf = im.replace('\\', '/').split('/')[-1]
    if im and leaf not in imgs:
        invalid.append((p['name'], im, p.get('source_id')))
    if 'placeholder' in leaf:
        placeholder.append((p['name'], p.get('source_id'), p.get('url')))

print(f'TOTAL produtos no DB: {total}')
print(f'Sem campo image:      {len(sem_img)}')
print(f'Com image p/ arquivo inexistente: {len(invalid)}')
print(f'Com placeholder.svg:  {len(placeholder)}')
print()

print('=== SEM IMAGEM ===')
for p in sem_img:
    print(f"  {p['name'][:55]:55} | sid={p.get('source_id')} | {p.get('url','')[:60]}")
print()
print('=== IMAGEM APONTA P/ ARQUIVO QUE NAO EXISTE ===')
for n, im, sid in invalid:
    print(f"  {n[:50]:50} | {im}")
print()
print('=== PLACEHOLDER NO DB ===')
for n, sid, url in placeholder:
    print(f"  {n[:55]:55} | sid={sid}")

# Verifica o front: onde os cards sao renderizados e de onde vem a imagem
print()
print('=== COMO O FRONT USA A IMAGEM ===')
for js in (ROOT / 'js').glob('*.js'):
    txt = js.read_text(encoding='utf-8', errors='replace')
    hits = [l.strip()[:110] for l in txt.splitlines() if ('image' in l.lower() and ('img' in l.lower() or 'src' in l.lower()))]
    if hits:
        print(f'--- {js.name} ({len(hits)} linhas c/ image+img/src) ---')
        for h in hits[:8]:
            print('   ', h)

# Admin page
adm = ROOT / 'pages' / 'admin.html'
if adm.exists():
    txt = adm.read_text(encoding='utf-8', errors='replace')
    hits = [l.strip()[:110] for l in txt.splitlines() if 'image' in l.lower() and ('img' in l.lower() or 'src' in l.lower() or 'placeholder' in l.lower())]
    print(f'--- admin.html ({len(hits)} linhas) ---')
    for h in hits[:8]:
        print('   ', h)
