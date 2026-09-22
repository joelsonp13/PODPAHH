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

// Sem rede: validação de e-mail acontece antes de qualquer chamada Supabase.
test('forgot rejects invalid email without network', async () => {
  const r = await db.requestPasswordReset('nao-email');
  assert.equal(r.success, false);
  assert.equal(r.status, 400);
});

// Conta inexistente: sucesso genérico (anti-enumeração), sem rede.
test('forgot unknown email returns generic success', async () => {
  const r = await db.requestPasswordReset('ninguem@exemplo.com');
  assert.equal(r.success, true);
});

// Token inválido/sem Supabase: 4xx, nunca 500 com stack.
test('reset with bad session fails closed', async () => {
  const r = await db.resetPasswordSupabase('token-invalido', 'novasenha123');
  assert.equal(r.success, false);
  assert.ok([400, 401].includes(r.status));
});

// Senha curta é barrada antes de qualquer rede.
test('reset rejects short password', async () => {
  const r = await db.resetPasswordSupabase('qualquer', 'curta');
  assert.equal(r.success, false);
  assert.equal(r.status, 400);
});
