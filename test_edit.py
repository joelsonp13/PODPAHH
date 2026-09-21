import json
import urllib.request

# Testa edição de produto via API do servidor local
data = json.dumps({
    "id": "prod_31858",
    "name": "Elfbar EW9K KIT: Maçã e Kiwi",
    "price": "109.99",
    "old_price": "129.99",
    "category": "outlet",
    "stock": "40",
    "image": "",
    "description": "Teste de edicao pelo admin"
}).encode('utf-8')

req = urllib.request.Request(
    'http://localhost:3000/api/admin/products',
    data=data,
    headers={'Content-Type': 'application/json'},
    method='POST'
)

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode('utf-8'))
        print('Edicao testada com sucesso!')
        print('Resultado:', json.dumps(result, ensure_ascii=False, indent=2))
except Exception as e:
    print('Erro ao testar edicao:', e)
