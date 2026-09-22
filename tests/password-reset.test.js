const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../server/db');

const TEST_DB = path.join(__dirname, 'test_db_reset_' + Date.now() + '.json');

test.beforeEach(() => {
  db.setDbPath(TEST_DB);
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test.afterEach(() => {
  db.setDbPath(path.join(__dirname, '..', 'data', 'podpahh_db.json'));
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

test('forgot/reset full cycle with session rotation', () => {
  const reg = db.registerCustomer('Reset User', 'reset@email.com', 'senha12345', '41999999999');
  assert.equal(reg.success, true);

  const f1 = db.requestPasswordReset('reset@email.com');
  assert.equal(f1.success, true);
  assert.match(f1.data.protocol, /^RST-/);
  assert.equal(f1.data.expires_in, 900);

  // unknown email: generic success, no protocol (anti-enumeration)
  const f2 = db.requestPasswordReset('ninguem@email.com');
  assert.equal(f2.success, true);
  assert.equal(f2.data, null);

  // reuse returns same protocol while valid
  const f3 = db.requestPasswordReset('reset@email.com');
  assert.equal(f3.data.protocol, f1.data.protocol);

  // wrong code rejected
  const bad = db.resetPassword('reset@email.com', '000000', 'novasenha1');
  assert.equal(bad.success, false);

  // short password rejected
  const list = db.listResets();
  assert.equal(list.length, 1);
  const short = db.resetPassword('reset@email.com', list[0].code, 'curta');
  assert.equal(short.success, false);

  // correct code rotates password + returns fresh session
  const good = db.resetPassword('reset@email.com', list[0].code, 'novasenha1');
  assert.equal(good.success, true);
  assert.ok(good.token);

  // old password dead, new works
  assert.equal(db.loginCustomer('reset@email.com', 'senha12345', '41999999999').success, false);
  const login = db.loginCustomer('reset@email.com', 'novasenha1', '41999999999');
  assert.equal(login.success, true);

  // code single-use + list empty
  assert.equal(db.resetPassword('reset@email.com', list[0].code, 'outrasenha').success, false);
  assert.equal(db.listResets().length, 0);
});

test('revoke kills pending reset', () => {
  db.registerCustomer('Rev User', 'rev@email.com', 'senha12345', '41988888888');
  const f = db.requestPasswordReset('rev@email.com');
  assert.equal(db.listResets().length, 1);
  assert.equal(db.revokeReset(f.data.protocol).success, true);
  assert.equal(db.listResets().length, 0);
  assert.equal(db.revokeReset('RST-NOPE').status, 404);
});
