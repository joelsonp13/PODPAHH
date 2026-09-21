import urllib.request
import urllib.error

# Testa rotas do servidor atual diretamente
for path in ['/api/admin/login', '/api/admin/stats', '/api/public/products', '/api/admin/products']:
    try:
        r = urllib.request.urlopen('http://localhost:3000' + path, timeout=3)
        print(f'GET {path}: HTTP {r.status}')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8')[:120].replace(chr(10), ' ')
        print(f'GET {path}: HTTP {e.code} | {body}')
    except Exception as e:
        print(f'GET {path}: ERRO {e}')
