import os
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')

def main():
    for html_path in ROOT.rglob('*.html'):
        text = html_path.read_text(encoding='utf-8', errors='ignore')
        if 'podpahh-store.js' in text and 'podpahh-db.js' not in text:
            depth = len(html_path.relative_to(ROOT).parts) - 1
            prefix = '../' * depth
            db_tag = f'<script src="{prefix}js/podpahh-db.js"></script>'
            
            # replace podpahh-store.js script tag with db.js + store.js
            target = f'<script src="{prefix}js/podpahh-store.js"></script>'
            replacement = f'{db_tag}\n  {target}'
            
            if target in text:
                text = text.replace(target, replacement)
                html_path.write_text(text, encoding='utf-8')
                print(f'Injected db into {html_path.relative_to(ROOT)}')

if __name__ == '__main__':
    main()
