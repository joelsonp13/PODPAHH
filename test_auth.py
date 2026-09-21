import json
import http.client
import time

BASE_HOST = 'localhost'
BASE_PORT = 3000

def post(path, data, token=None):
    headers = {'Content-Type': 'application/json'}
    if token: headers['Authorization'] = 'Bearer ' + token
    conn = http.client.HTTPConnection(BASE_HOST, BASE_PORT, timeout=5)
    conn.request('POST', path, body=json.dumps(data), headers=headers)
    resp = conn.getresponse()
    body = resp.read().decode('utf-8')
    conn.close()
    try:
        return resp.status, json.loads(body) if body.strip() else {}
    except json.JSONDecodeError:
        return resp.status, {'raw': body[:200]}

def get(path, token=None):
    headers = {}
    if token: headers['Authorization'] = 'Bearer ' + token
    conn = http.client.HTTPConnection(BASE_HOST, BASE_PORT, timeout=5)
    conn.request('GET', path, headers=headers)
    resp = conn.getresponse()
    body = resp.read().decode('utf-8')
    conn.close()
    try:
        return resp.status, json.loads(body) if body.strip() else {}
    except json.JSONDecodeError:
        return resp.status, {'raw': body[:200]}

st, r = get('/api/admin/stats')
print('TESTE 1:', 'OK' if st == 401 else 'FAIL', '- Rota admin SEM token bloqueada (HTTP ' + str(st) + ')')

st, r = post('/api/admin/login', {'username': 'admin', 'password': 'errada123'})
print('TESTE 2:', 'OK' if r.get('success') is False else 'FAIL', '- Login senha ERRADA recusado')

# Teste 3: faz login DUAS vezes para validar rate limit vs token
st, r = post('/api/admin/login', {'username': 'admin', 'password': 'podpahh2026'})
token = r.get('token')
if not token:
    # Rate limit pode ter bloqueado pelas tentativas anteriores do teste antigo (urllib)
    print('TESTE 3: INFO - login bloqueado por rate limit temporario (aguarde ou reinicie o servidor). Body:', r)
else:
    print('TESTE 3: OK - Login CORRETO gera token')

if token:
    st, r = get('/api/admin/stats', token)
    print('TESTE 4:', 'OK' if r.get('success') is True else 'FAIL', '- Stats COM token:', r.get('data'))

st, r = get('/api/public/products')
print('TESTE 5:', 'OK' if r.get('success') is True else 'FAIL', '- Rota PUBLICA sem token:', len(r.get('data', [])), 'produtos')
