import json
import urllib.request
import urllib.error
import http.client

# Testa direto com http.client para eliminar qualquer interferencia de proxy
conn = http.client.HTTPConnection('localhost', 3000, timeout=5)
conn.request('POST', '/api/admin/login', body=json.dumps({'username': 'admin', 'password': 'podpahh2026'}), headers={'Content-Type': 'application/json'})
resp = conn.getresponse()
body = resp.read().decode('utf-8')
print('Login HTTP', resp.status)
print('Body:', body[:300])
