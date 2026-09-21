import re
from pathlib import Path
site = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')
slugs = {}
for p in site.rglob('*.html'):
    for m in re.finditer(r'href="([^"]*produto/([^/"]+)/?)"', p.read_text(encoding='utf-8', errors='replace')):
        slugs.setdefault(m.group(2), set()).add(m.group(1))
print('unique slugs:', len(slugs))
for s in sorted(slugs):
    print(' ', s, '->', sorted(slugs[s])[:2])
