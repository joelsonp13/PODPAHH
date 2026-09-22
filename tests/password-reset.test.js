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

test('forgot/reset link cycle with session rotation', async () => {
  const reg = db.registerCustomer('Reset User', 'reset@email.com', 'senha12345', '41999999999');
  assert.equal(reg.success, true);

  // sem chave de e-mail: gera token mesmo assim (link vai pro log em dev)
  const f1 = await db.requestPasswordReset('reset@email.com');
  assert.equal(f1.success, true);

  // unknown email: generic success (anti-enumeration)
  const f2 = await db.requestPasswordReset('ninguem@email.com');
  assert.equal(f2.success, true);

  const list = db.listResets();
  assert.equal(list.length, 1);
  const token = db.readDb().resets[0].token;
  assert.ok(token && token.length >= 32);

  // invalid token rejected
  const bad = await db.resetPasswordByToken('nope', 'novasenha1');
  assert.equal(bad.success, false);

  // short password rejected
  const short = await db.resetPasswordByToken(token, 'curta');
  assert.equal(short.success, false);

  // valid token rotates password + returns fresh session
  const good = await db.resetPasswordByToken(token, 'novasenha1');
  assert.equal(good.success, true);
  assert.ok(good.token);

  // old password dead, new works
  assert.equal(db.loginCustomer('reset@email.com', 'senha12345', '41999999999').success, false);
  const login = db.loginCustomer('reset@email.com', 'novasenha1', '41999999999');
  assert.equal(login.success, true);

  // token single-use + list empty
  assert.equal((await db.resetPasswordByToken(token, 'outrasenha')).success, false);
  assert.equal(db.listResets().length, 0);
});

test('revoke kills pending reset', async () => {
  db.registerCustomer('Rev User', 'rev@email.com', 'senha12345', '41988888888');
  await db.requestPasswordReset('rev@email.com');
  assert.equal(db.listResets().length, 1);
  const id = db.readDb().resets[0].id;
  assert.equal(db.revokeReset(id).success, true);
  assert.equal(db.listResets().length, 0);
  assert.equal(db.revokeReset('rst-nope').status, 404);
});
