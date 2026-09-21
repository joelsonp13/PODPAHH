const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const app = require('../server/index');

const TEST_DB = path.join(__dirname, 'test_db_' + Date.now() + '.json');

test.beforeEach(() => {
  db.setDbPath(TEST_DB);
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test.afterEach(() => {
  db.setDbPath(path.join(__dirname, '..', 'data', 'podpahh_db.json'));
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('address validation rejects incomplete or invalid fields', () => {
  const reg = db.registerCustomer('Cliente Teste', 'teste@email.com', 'senha12345', '41999999999');
  assert.equal(reg.success, true);
  const customerId = reg.data.id;

  const res1 = db.createAddress(customerId, { label: 'Casa' });
  assert.equal(res1.success, false);
  assert.equal(res1.status, 400);

  const res2 = db.createAddress(customerId, {
    recipient_name: 'João',
    phone: '41999999999',
    postal_code: '123', // inválido
    street: 'Rua A',
    number: '10',
    neighborhood: 'Centro',
    city: 'Curitiba',
    state: 'PR'
  });
  assert.equal(res2.success, false);
  assert.equal(res2.status, 400);
});

test('address creation respects default replacement and ownership', () => {
  const reg1 = db.registerCustomer('User Um', 'um@email.com', 'senha12345', '41988888888');
  const reg2 = db.registerCustomer('User Dois', 'dois@email.com', 'senha12345', '41977777777');
  const c1 = reg1.data.id;
  const c2 = reg2.data.id;

  const a1 = db.createAddress(c1, {
    label: 'Casa',
    recipient_name: 'Um',
    phone: '41988888888',
    postal_code: '80000000',
    street: 'Rua 1',
    number: '1',
    neighborhood: 'Bairro',
    city: 'Curitiba',
    state: 'PR',
    is_default: true
  });
  assert.equal(a1.success, true);
  assert.equal(a1.data.is_default, true);

  const a2 = db.createAddress(c1, {
    label: 'Trabalho',
    recipient_name: 'Um',
    phone: '41988888888',
    postal_code: '80000000',
    street: 'Rua 2',
    number: '2',
    neighborhood: 'Bairro',
    city: 'Curitiba',
    state: 'PR',
    is_default: true
  });
  assert.equal(a2.success, true);
  assert.equal(a2.data.is_default, true);

  const list = db.listAddresses(c1);
  assert.equal(list.length, 2);
  const first = list.find(x => x.id === a1.data.id);
  const second = list.find(x => x.id === a2.data.id);
  assert.equal(first.is_default, false);
  assert.equal(second.is_default, true);

  // Cliente 2 não pode acessar endereço do cliente 1
  const check = db.getAddress(c2, a1.data.id);
  assert.equal(check.forbidden, true);
});

test('order saves address snapshot correctly', () => {
  const orderRes = db.saveOrder({
    items: [{ id: 'prod_1', name: 'Pod', price: 50, qty: 1 }],
    subtotal: 50,
    total: 45,
    address_id: 'addr_999',
    address: 'Rua Teste, 123 - Centro, Curitiba/PR',
    payment_method: 'PIX'
  });
  assert.equal(orderRes.success, true);
  assert.equal(orderRes.data.address_id, 'addr_999');
  assert.match(orderRes.data.address, /Curitiba\/PR/);
});
