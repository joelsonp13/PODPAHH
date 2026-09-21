# -*- coding: utf-8 -*-
"""PODPAHH cleanup: strip old-site trackers, fix image paths, inject store engine,
generate global catalog JS."""
import re, csv, html as htmlmod
from pathlib import Path

ROOT = Path(r"C:\Users\Natanael\Documents\podpahh\pedevapor-shop")
FILES = sorted(p for p in ROOT.rglob("*.html"))

def prefix_for(p: Path) -> str:
    depth = len(p.relative_to(ROOT).parts) - 1
    return "../" * depth

# ---------- 1. kill dead/tracker scripts ----------
KILL_PATTERNS = [
    'googletagmanager.com', 'function gtag(', 'gtag("event"',
    'connect.facebook.net', 'fbq', 'smartlook',
    'PixelYourSite', 'pysOptions', 'pysFacebookRest', 'pys_late_event',
    'hostinger_reach', 'wc_order_attribution', '_googlesitekit',
    'glaGtagData', 'gla-gtag-events', 'gtag-events.js',
    'wc_add_to_cart_params', 'woocommerce_params', 'var VS=', 'VS_PIX_PCT',
    'litespeed_load_delayed_js', 'litespeed_vary', 'litespeed_docref',
    'admin-ajax.php', 'vsAgeConfig',
]
KILL_RE = re.compile('|'.join(re.escape(p) for p in KILL_PATTERNS))
SCRIPT_RE = re.compile(r'<script\b[^>]*>.*?</script>', re.S | re.I)
LINK_RE = re.compile(r'<link\b[^>]*>', re.I)
NOS_PIXEL_RE = re.compile(r'<noscript>\s*<img[^>]*facebook\.com/tr[^>]*>\s*</noscript>', re.S | re.I)

def kill_scripts(html):
    removed = []
    def repl(m):
        if KILL_RE.search(m.group(0)):
            removed.append(m.group(0)[:70])
            return ''
        return m.group(0)
    return SCRIPT_RE.sub(repl, html), removed

def convert_litespeed(html):
    html = html.replace('type="litespeed/javascript"', 'type="text/javascript"')
    # script data-src -> src (LS loader was removed)
    def repl(m):
        return m.group(0).replace('data-src=', 'src=')
    return re.sub(r'<script\b[^>]*data-src=[^>]*>', repl, html)

def kill_dead_links(html):
    def repl(m):
        tag = m.group(0)
        if re.search(r'api\.w\.org|EditURI|oembed|wp-json|rel=.sitemap', tag):
            return ''
        return tag
    return LINK_RE.sub(repl, html)

# scripts pointing at wp-content/ (litespeed cache blobs etc.) never exist
# in the static export -> drop them entirely
WP_SCRIPT_RE = re.compile(
    r'<script\b[^>]*\bsrc=["\'](?:\.\./)*wp-content/[^"\']*["\'][^>]*>\s*</script>',
    re.I)

def strip_wp_scripts(html):
    return WP_SCRIPT_RE.sub('', html)

# ---------- 2. images: wp-content/uploads -> assets/images ----------
UPLOADS_RE = re.compile(r'(?:\.\./)*/?wp-content/uploads/\d{4}/\d{2}/([^"\'\s?#)\],]+)')

def rewrite_images(html, prefix, missing):
    def repl(m):
        leaf = m.group(1)
        if (ROOT / "assets" / "images" / leaf).exists():
            return f'{prefix}assets/images/{leaf}'
        missing.add(leaf)
        return m.group(0)
    return UPLOADS_RE.sub(repl, html)

# ---------- 3. inject store engine ----------
def inject_store(html, prefix):
    css_tag = f'<link rel="stylesheet" href="{prefix}css/podpahh-store.css" />'
    js_tags = (f'<script src="{prefix}js/podpahh-catalog.js"></script>\n'
               f'  <script src="{prefix}js/podpahh-store.js"></script>')
    if 'podpahh-store.css' not in html:
        m = re.search(r'<link rel="stylesheet" href="[^"]*podpahh-theme\.css"\s*/>', html)
        if m:
            html = html[:m.end()] + '\n  ' + css_tag + html[m.end():]
    if 'podpahh-store.js' not in html:
        m = re.search(r'<script src="[^"]*podpahh-animations\.js"></script>', html)
        if m:
            html = html[:m.end()] + '\n  ' + js_tags + html[m.end():]
    return html

def add_data_base(html, prefix):
    if 'data-base=' in html:
        return html
    base = prefix.rstrip('/') if prefix else '.'
    return re.sub(r'<body(\s)', lambda m: f'<body data-base="{base}"' + m.group(1), html, count=1)

def fix_drawer_links(html, prefix):
    # cart page always lives at <root>/pages/carrinho.html; prefix is the
    # relative path from the current file's dir back to root
    cart_href = f'{prefix}pages/carrinho.html'
    html = html.replace('href="../finalizar-compra/"', f'href="{cart_href}"')
    # FINALIZAR COMPRA / VER CARRINHO buttons in drawer -> correct cart page
    html = re.sub(
        r'<a href="[^"]*" class="cart-(checkout|view)-btn">',
        rf'<a href="{cart_href}" class="cart-\1-btn">',
        html)
    return html

CART_PAGE_MAIN = ('<main class="site-content">\n'
                  '  <div style="padding:20px 16px;max-width:1100px;margin:0 auto">\n'
                  '    <div id="podpahh-cart-page"></div>\n'
                  '  </div>\n'
                  '</main>')

def replace_cart_main(html):
    m = re.search(r'<main class="site-content">.*?</main>', html, re.S)
    if not m:
        return html
    return html[:m.start()] + CART_PAGE_MAIN + html[m.end():]

# ---------- 4. catalog extraction ----------
CARD_RE = re.compile(r'<div class="pcard" id="pcard-(\d+)">(.*?)</li>', re.S)
def extract_products(html):
    """Run AFTER rewrite_images; normalize image paths to site-root-relative."""
    out = {}
    for m in CARD_RE.finditer(html):
        pid, body = m.group(1), m.group(2)
        name = re.search(r'class="pcard-name"[^>]*>([^<]+)<', body)
        price = re.search(r'class="pcard-price[^"]*">([^<]+)<', body)
        img = re.search(r'data-src="([^"]+)"', body)
        link = re.search(r'href="([^"]*produto/[^"]*)"', body)
        if not (name and price):
            continue
        try:
            v = float(price.group(1).replace('R$', '').strip().replace('.', '').replace(',', '.'))
        except ValueError:
            continue
        img_path = img.group(1) if img else ''
        # normalize: strip leading ../ sequences -> root-relative
        while img_path.startswith('../'):
            img_path = img_path[3:]
        link_path = link.group(1) if link else ''
        while link_path.startswith('../'):
            link_path = link_path[3:]
        out[pid] = {
            'name': clean_name(name.group(1)),
            'price': v,
            'img': img_path,
            'url': link_path,
        }
    return out

def clean_name(s):
    s = htmlmod.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def main():
    missing = set()
    catalog = {}
    for p in FILES:
        prefix = prefix_for(p)
        html = p.read_text(encoding='utf-8', errors='replace')
        html, removed = kill_scripts(html)
        html = convert_litespeed(html)
        html = kill_dead_links(html)
        html = NOS_PIXEL_RE.sub('', html)
        html = rewrite_images(html, prefix, missing)
        # catalog after rewrite so image paths are normalized
        for pid, prod in extract_products(html).items():
            catalog.setdefault(pid, prod)
        html = inject_store(html, prefix)
        html = add_data_base(html, prefix)
        html = fix_drawer_links(html, prefix)
        if p.name == 'carrinho.html':
            html = replace_cart_main(html)
        p.write_text(html, encoding='utf-8')
        print(f'{p.name}: killed {len(removed)} scripts')

    # global catalog js
    js = "window.PODPAHH_CATALOG = " + repr(catalog).replace("'", '"') + ";\n"
    # safer: json
    import json
    (ROOT / "js" / "podpahh-catalog.js").write_text(
        "window.PODPAHH_CATALOG = " + json.dumps(catalog, ensure_ascii=False) + ";\n",
        encoding='utf-8')
    print(f"catalog: {len(catalog)} products -> js/podpahh-catalog.js")

    with open(ROOT / "missing-images.csv", "w", newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['file', 'status'])
        for m in sorted(missing):
            w.writerow([m, 'missing'])
    print(f"missing unique images: {len(missing)} -> missing-images.csv")

if __name__ == '__main__':
    main()
