import os
from pathlib import Path

ROOT = Path(r'c:\Users\Natanael\Documents\podpahh\pedevapor-shop')

def main():
    for html_path in ROOT.rglob('*.minha-conta.html') if False else ROOT.rglob('minha-conta.html'):
        text = html_path.read_text(encoding='utf-8', errors='ignore')
        if 'podpahh-auth.js' not in text:
            depth = len(html_path.relative_to(ROOT).parts) - 1
            prefix = '../' * depth
            auth_tag = f'<script src="{prefix}js/podpahh-auth.js"></script>'
            
            # inject before closing body or after store script
            if 'podpahh-store.js' in text:
                text = text.replace('podpahh-store.js">', f'podpahh-store.js"></script>\n  {auth_tag}')
                html_path.write_text(text, encoding='utf-8')
                print(f'Injected auth into {html_path.relative_to(ROOT)}')

if __name__ == '__main__':
    main()
