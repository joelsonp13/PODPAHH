import json
import re
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
DB_FILE = ROOT / 'data' / 'podpahh_db.json'

db = json.loads(DB_FILE.read_text(encoding='utf-8'))

# O produto do outlet (Elfbar EW9K) tem preço especial no site:
# encontra pelo source_id 31858 e aplica old_price simulando preço original
for p in db['products']:
    if p.get('source_id') == '31858':
        p['old_price'] = 129.99  # preço original estimado do Elfbar EW9K KIT
        print('Desconto aplicado no produto outlet:', p['name'])

DB_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding='utf-8')

disc = [p for p in db['products'] if p.get('old_price') and p['old_price'] > p['price']]
print('Produtos com desconto ativo agora:', len(disc))
