# -*- coding: utf-8 -*-
"""One-shot fix for PODPAHH site: bugs #1-#5 + catalog regen + product pages."""
import re, json, os, csv
from pathlib import Path

ROOT = Path(r"c:\Users\Natanael\Documents\podpahh\pedevapor-shop")
PLACEHOLDER = "assets/images/placeholder.svg"
WHATSAPP = "554531977964"

FILES = sorted(ROOT.rglob("*.html"))

# ================================================================
# 1. CART LINKS — correct relative path per depth
# ================================================================
def depth_for(p):
    return len(p.relative_to(ROOT).parts) - 1

def cart_href_for(p):
    d = depth_for(p)
    if d == 0:
        return "pages/carrinho.html"
    elif d == 1:
        return "carrinho.html"
    else:
        return "../" * (d - 1) + "pages/carrinho.html"

def fix_cart_links(html, p):
    target = cart_href_for(p)
    # cart-checkout-btn
    html = re.sub(
        r'<a href="[^"]*" class="cart-checkout-btn">',
        f'<a href="{target}" class="cart-checkout-btn">', html)
    # cart-view-btn
    html = re.sub(
        r'<a href="[^"]*" class="cart-view-btn">',
        f'<a href="{target}" class="cart-view-btn">', html)
    return html

# ================================================================
# 2. REMOVE LITESPEED WP-CONTENT SCRIPT TAGS
# ================================================================
WP_SCRIPT_RE = re.compile(
    r'<script\b[^>]*\bsrc=["\'](?:\.\./)*wp-content/[^"\']*["\'][^>]*>\s*</script>',
    re.S | re.I)
def strip_wp_scripts(html):
    return WP_SCRIPT_RE.sub('', html)

# ================================================================
# 3. FIX WHATSAPP IN JSON-LD (old 5547... → 5545...)
# ================================================================
def fix_whatsapp_jsonld(html):
    return html.replace("5547992466801", WHATSAPP)

# ================================================================
# 4. FIX OUTLET JSON-LD CORRUPTED URLs
# ================================================================
def fix_outlet_jsonld(html):
    # ../index.htmlproduto/ -> ../produto/
    return html.replace('../index.htmlproduto/', '../produto/')

# ================================================================
# 5. FIX WP-CONTENT IMAGE PATHS → PLACEHOLDER
# ================================================================
UPLOADS_RE = re.compile(
    r'(?:\.\./)*/?wp-content/uploads/\d{4}/\d{2}/([^"\'\s?#)\],]+)')

def fix_images(html, prefix, missing_set):
    def repl(m):
        leaf = m.group(1)
        if (ROOT / "assets" / "images" / leaf).exists():
            return f'{prefix}assets/images/{leaf}'
        missing_set.add(leaf)
        return f'{prefix}{PLACEHOLDER}'
    return UPLOADS_RE.sub(repl, html)

# ================================================================
# 6. EXTRACT PRODUCTS FROM ALL CARDS (scrape all pcards)
# ================================================================
CARD_RE = re.compile(
    r'<div class="pcard" id="pcard-(\d+)">(.*?)</li>', re.S)
PRICE_RE = re.compile(r'class="pcard-price(?:\s[^"]*)?">([^<]+)<')
NAME_RE = re.compile(r'class="pcard-name"[^>]*>([^<]+)<')
IMG_RE = re.compile(r'data-src="([^"]+)"')
LINK_RE = re.compile(r'href="([^"]*produto/[^"]*)"')
BRAND_RE = re.compile(r'class="pcard-brand"[^>]*>([^<]+)<')

def extract_products(html):
    out = {}
    for m in CARD_RE.finditer(html):
        pid, body = m.group(1), m.group(2)
        name_m = NAME_RE.search(body)
        price_m = PRICE_RE.search(body)
        img_m = IMG_RE.search(body)
        link_m = LINK_RE.search(body)
        brand_m = BRAND_RE.search(body)
        if not name_m:
            continue
        try:
            price_str = price_m.group(1).replace('R$', '').strip() if price_m else '0'
            v = float(price_str.replace('.', '').replace(',', '.')) if price_str else 0
        except ValueError:
            v = 0
        img_path = img_m.group(1) if img_m else ''
        # normalize: strip leading ../ to get root-relative
        while img_path.startswith('../'):
            img_path = img_path[3:]
        link_path = link_m.group(1) if link_m else ''
        while link_path.startswith('../'):
            link_path = link_path[3:]
        out[pid] = {
            'name': re.sub(r'\s+', ' ', name_m.group(1).strip()),
            'price': v,
            'img': img_path,
            'url': link_path,
            'brand': brand_m.group(1).strip() if brand_m else '',
        }
    return out

# ================================================================
# 7. RESOLVE IMAGE PATHS FOR CATALOG
# ================================================================
def resolve_img(img_path):
    """Resolve an img path: if assets, return as-is. If wp-content, use placeholder."""
    if not img_path:
        return PLACEHOLDER
    leaf = os.path.basename(img_path)
    if (ROOT / "assets" / "images" / leaf).exists():
        return f'assets/images/{leaf}'
    return PLACEHOLDER

# ================================================================
# 8. GENERATE PRODUCT PAGES
# ================================================================
def extract_chrome(html):
    """Extract header (<body> to </header>) and footer from index.html."""
    body_i = html.find('<body')
    header_end = html.find('</header>') + len('</header>')
    footer_i = html.find('<footer')
    footer_end = html.find('</footer>') + len('</footer>')
    header = html[body_i:header_end]
    footer = html[footer_i:footer_end] if footer_i >= 0 else ''
    return header, footer

def prefix_paths(text, prefix):
    """Rewrite src/href/content='X' where X is root-relative (no http, #, data:, mailto:)."""
    def repl(m):
        attr = m.group(1)
        url = m.group(2)
        if re.match(r'^(https?:|#|data:|mailto:)', url) or url.startswith('javascript:'):
            return m.group(0)
        clean = url.lstrip('/')
        return f'{attr}="{prefix}{clean}"'
    return re.sub(r'((?:href|src|content))="([^"]+)"', repl, text)

def build_product_page(pid, prod, prefix, header, footer, product_main):
    """Assemble a complete product page."""
    name_esc = prod['name'].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    desc = name_esc + ' — PODPAHH. 10% OFF no PIX, entrega rapida.'
    img_src = f'{prefix}{resolve(prod["img"])}' if prod.get('img') else f'{prefix}{PLACEHOLDER}'
    price_str = f"R$ {prod['price']:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    pix_val = prod['price'] * 0.9
    pix_str = f"R$ {pix_val:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
    brand_line = f'<div class="brand">{esc(prod["brand"])}</div>' if prod.get('brand') else ''

    page = f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{name_esc} | PODPAHH</title>
<meta name="description" content="{desc}">
<link rel="icon" href="{prefix}assets/images/varejo-100x100.png" sizes="32x32">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link rel="stylesheet" href="{prefix}css/podpahh-theme.css">
<link rel="stylesheet" href="{prefix}css/podpahh-store.css">
<style>
.pp-product{{max-width:900px;margin:40px auto 60px;padding:0 16px;display:flex;gap:32px;flex-wrap:wrap}}
.pp-product img{{width:100%;max-width:420px;border-radius:12px;object-fit:cover;background:#0a0a14}}
.pp-info{{flex:1;min-width:280px}}
.pp-info h1{{font-size:1.5rem;margin:0 0 8px;color:#eee}}
.pp-price{{font-size:1.6rem;color:#00e676;font-weight:700;margin:12px 0}}
.pp-pix{{color:#00bfa5;font-size:.95rem;margin-bottom:16px}}
.pp-pix i{{margin-right:4px}}
.pp-qty{{display:flex;align-items:center;gap:8px;margin:16px 0}}
.pp-qty button{{width:36px;height:36px;border:none;border-radius:8px;background:#222;color:#fff;font-size:1.1rem;cursor:pointer}}
.pp-qty span{{font-size:1.1rem;min-width:24px;text-align:center;color:#eee}}
.pp-btns{{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}}
.pp-btn-primary{{flex:1;min-width:180px;padding:14px 20px;border:none;border-radius:10px;background:linear-gradient(135deg,#2d7aff,#ff2d87);color:#fff;font-size:1rem;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}}
.pp-btn-wa{{flex:1;min-width:180px;padding:14px 20px;border:none;border-radius:10px;background:#25d366;color:#fff;font-size:1rem;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}}
.pp-back{{display:inline-block;margin-top:24px;color:#888;text-decoration:none;font-size:.9rem}}
.pp-back:hover{{color:#fff}}
@media(max-width:600px){{.pp-product{{flex-direction:column;align-items:center}}.pp-info{{width:100%}}}}
</style>
</head>
<body data-base="{prefix.rstrip('/')}" class="product-page">
{prefix_paths(header, prefix)}
<main class="site-content" style="padding-top:20px">
<div class="pp-product">
<div class="pp-img"><img src="{img_src}" alt="{name_esc}" onerror="this.onerror=null;this.src='{prefix}{PLACEHOLDER}'"></div>
<div class="pp-info">
{brand_line}
<h1>{name_esc}</h1>
<div class="pp-price">{price_str}</div>
<div class="pp-pix"><i class="fa-brands fa-pix"></i> No PIX ({pix_str}) 10% OFF</div>
<div class="pp-qty">
<button onclick="var s=document.getElementById('ppQty');s.textContent=Math.max(1,parseInt(s.textContent)-1)">-</button>
<span id="ppQty">1</span>
<button onclick="var s=document.getElementById('ppQty');s.textContent=Math.min(99,parseInt(s.textContent)+1)">+</button>
</div>
<div class="pp-btns">
<button class="pp-btn-primary" onclick="for(var i=0;i<parseInt(document.getElementById('ppQty').textContent);i++)vsAddToCart('{pid}',this)"><i class="fa fa-cart-plus"></i> ADICIONAR AO CARRINHO</button>
<a class="pp-btn-wa" href="https://wa.me/{WHATSAPP}?text={name_esc.replace(' ','%20')}%20%E2%80%94%20{price_str.replace(' ','%20')}%0AOla!%20Tenho%20interesse." target="_blank"><i class="fa-brands fa-whatsapp"></i> COMPRAR NO WHATSAPP</a>
</div>
<a class="pp-back" href="{prefix}pages/loja.html"><i class="fa fa-arrow-left"></i> CONTINUAR COMPRANDO</a>
</div>
</div>
</main>
{prefix_paths(footer, prefix)}
<script src="{prefix}js/podpahh-catalog.js"></script>
<script src="{prefix}js/podpahh-store.js"></script>
</body>
</html>'''
    return page

def esc(s):
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

def resolve(p):
    """Normalize a path: strip ../, return root-relative leaf."""
    while p and p.startswith('../'):
        p = p[3:]
    return p.lstrip('/')

# ================================================================
# MAIN
# ================================================================
def main():
    missing = set()
    catalog = {}

    # Pass 1: fix HTML + extract catalog from cards
    for p in FILES:
        html = p.read_text(encoding='utf-8', errors='replace')
        html = fix_cart_links(html, p)
        html = strip_wp_scripts(html)
        html = fix_whatsapp_jsonld(html)
        if p.name == 'outlet.html':
            html = fix_outlet_jsonld(html)
        # Fix wp-content images → placeholder
        prefix = '../' * depth_for(p) if depth_for(p) > 0 else ''
        html = fix_images(html, prefix, missing)
        # Extract products
        for pid, prod in extract_products(html).items():
            catalog.setdefault(pid, prod)
        p.write_text(html, encoding='utf-8')
        print(f'Fixed: {p.name} (depth={depth_for(p)})')

    # Add outlet product 31858 (sour-apple-kiwi) if not in catalog
    if '31858' not in catalog:
        # Check if the card exists with different price format
        outlet = (ROOT / 'pages' / 'categoria-produto' / 'outlet.html').read_text(encoding='utf-8', errors='replace')
        m = re.search(r'pcard-31858.*?pcard-name[^>]*>([^<]+)<.*?pcard-price[^"]*">([^<]+)<', outlet, re.S)
        if m:
            name = m.group(1).strip()
            try:
                price_str = m.group(2).replace('R$', '').strip()
                price = float(price_str.replace('.', '').replace(',', '.'))
            except:
                price = 0
            catalog['31858'] = {
                'name': name,
                'price': price,
                'img': 'assets/images/15401974940-sour-apple-kiwi-300x300.jpg',
                'url': 'produto/elfbar-ew9k-kit-maca-e-kiwi-sour-apple-kiwi/',
                'brand': 'Elfbar',
            }

    # Resolve all catalog images
    for pid in catalog:
        catalog[pid]['img'] = resolve_img(catalog[pid].get('img', ''))

    # Write catalog JS
    catalog_js = "window.PODPAHH_CATALOG = " + json.dumps(catalog, ensure_ascii=False) + ";\n"
    (ROOT / 'js' / 'podpahh-catalog.js').write_text(catalog_js, encoding='utf-8')
    print(f'\nCatalog: {len(catalog)} products written to podpahh-catalog.js')

    # ================================================================
    # 9. GENERATE PRODUCT PAGES
    # ================================================================
    index_html = (ROOT / 'index.html').read_text(encoding='utf-8', errors='replace')
    header, footer = extract_chrome(index_html)

    produto_dir = ROOT / 'produto'
    produto_dir.mkdir(exist_ok=True)

    for pid, prod in catalog.items():
        slug = prod.get('url', '').rstrip('/')
        slug = slug.replace('produto/', '')
        if not slug:
            continue
        page_dir = produto_dir / slug
        page_dir.mkdir(exist_ok=True)
        prefix = '../../'
        page = build_product_page(pid, prod, prefix, header, footer, None)
        (page_dir / 'index.html').write_text(page, encoding='utf-8')
    print(f'Generated {len(catalog)} product pages under produto/')

    # ================================================================
    # 10. WRITE MISSING-IMAGES REPORT
    # ================================================================
    with open(ROOT / 'missing-images.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['file', 'status'])
        for m in sorted(missing):
            w.writerow([m, 'replaced with placeholder'])
    print(f'Missing images: {len(missing)} → missing-images.csv')

if __name__ == '__main__':
    main()
