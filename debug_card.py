import re
from pathlib import Path
root = Path(r'C:\Users\Natanael\Documents\podpahh\pedevapor-shop-backup')
js = (root/'js/bdc5c89acae9c25394f4bc3d94c87144.js').read_text(encoding='utf-8', errors='replace')
for fn in ['vsToggleWish','vsInitWishStates']:
    m = re.search(r'(window\.'+fn+r'\s*=|function\s+'+fn+r'\s*\()', js)
    i = m.start()
    print(f'=== {fn} ===')
    print(js[i:i+600])
    print()
