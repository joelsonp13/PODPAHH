/* ================================================================
   PODPAHH — Auth, Account & Address Manager
   ================================================================ */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  function phoneDigits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function isValidPhone(v) {
    var d = phoneDigits(v);
    if (d.length !== 11 && d.length !== 10) return false;
    var ddd = parseInt(d.substring(0, 2), 10);
    if (ddd < 11 || ddd > 99) return false;
    if (d.length === 11 && d[2] !== '9') return false;
    return true;
  }

  function maskPhone(input) {
    var raw = phoneDigits(input.value).substring(0, 11);
    if (!raw) { input.value = ''; return; }
    if (raw.length <= 2) input.value = '(' + raw;
    else if (raw.length <= 6) input.value = '(' + raw.substring(0, 2) + ') ' + raw.substring(2);
    else if (raw.length <= 10) input.value = '(' + raw.substring(0, 2) + ') ' + raw.substring(2, 6) + '-' + raw.substring(6);
    else input.value = '(' + raw.substring(0, 2) + ') ' + raw.substring(2, 7) + '-' + raw.substring(7);
  }

  document.querySelectorAll('.vs-phone-input').forEach(function (f) {
    f.addEventListener('input', function () { maskPhone(f); });
  });

  // Login pede só e-mail + senha. Telefone só no cadastro.
  // Esconde o campo de WhatsApp do form de login (vale p/ HTML em cache).
  document.querySelectorAll('form.woocommerce-form-login').forEach(function (lf) {
    var lp = lf.querySelector('#login_phone');
    if (lp && lp.closest('.vs-form-group')) lp.closest('.vs-form-group').style.display = 'none';
  });

  function getSession() {
    try {
      var s = JSON.parse(localStorage.getItem('podpahh_session_v1'));
      if (s && s.token && s.user) return s;
    } catch (e) {}
    try {
      var legacy = JSON.parse(localStorage.getItem('podpahh_logged_user'));
      if (legacy && legacy.email) return { token: null, user: legacy };
    } catch (e) {}
    return null;
  }

  function saveSession(token, user) {
    localStorage.setItem('podpahh_session_v1', JSON.stringify({ token: token, user: user }));
    localStorage.setItem('podpahh_logged_user', JSON.stringify(user));
  }

  window.vsLogout = async function() {
    var session = getSession();
    if (session && session.token && window.PodpahhDB && window.PodpahhDB.logoutCustomer) {
      try { await window.PodpahhDB.logoutCustomer(session.token); } catch (e) {}
    }
    localStorage.removeItem('podpahh_session_v1');
    localStorage.removeItem('podpahh_logged_user');
    window.location.reload();
  };

  // Intercepta Login (só e-mail/usuário + senha; sem telefone)
  var loginForm = document.querySelector('form.woocommerce-form-login');
  if (loginForm) {
    loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var userinput = loginForm.querySelector('#username');
      var phoneInput = loginForm.querySelector('#login_phone');
      var passinput = loginForm.querySelector('#password');

      var user = userinput ? userinput.value.trim() : '';
      var phone = phoneInput ? phoneInput.value.trim() : '';
      var pass = passinput ? passinput.value.trim() : '';

      if (!user || !pass) {
        alert('Por favor, informe e-mail/usuário e senha.');
        return;
      }

      if (window.PodpahhDB) {
        try {
          var res = await window.PodpahhDB.loginCustomer(user, pass, phoneDigits(phone));
          if (!res || !res.success) {
            alert(res && res.error ? res.error : 'Erro ao entrar.');
            return;
          }
          saveSession(res.token, res.data);
          alert('Login efetuado com sucesso!');
          window.location.reload();
        } catch (err) {
          alert('Erro de conexão com o servidor.');
        }
      }
    });
  }

  // Intercepta Registro
  var regForm = document.querySelector('form.woocommerce-form-register');
  if (regForm) {
    regForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var usernameInput = regForm.querySelector('#reg_username');
      var emailInput = regForm.querySelector('#reg_email');
      var phoneInput = regForm.querySelector('#reg_phone');
      var passInput = regForm.querySelector('#reg_password');

      var username = usernameInput ? usernameInput.value.trim() : '';
      var email = emailInput ? emailInput.value.trim() : '';
      var phone = phoneInput ? phoneInput.value.trim() : '';
      var password = passInput ? passInput.value.trim() : '';

      if (!email || !password) {
        alert('Por favor, preencha e-mail e senha.');
        return;
      }
      if (password.length < 8) {
        alert('A senha precisa ter no mínimo 8 caracteres.');
        if (passInput) passInput.focus();
        return;
      }
      var digits = phoneDigits(phone);
      if (!digits || !isValidPhone(digits)) {
        alert('Informe um número de WhatsApp válido com DDD (ex: (41) 99999-9999).');
        if (phoneInput) phoneInput.focus();
        return;
      }

      if (window.PodpahhDB) {
        try {
          var res = await window.PodpahhDB.registerCustomer(
            username || email.split('@')[0],
            email,
            password,
            digits
          );
          if (!res || !res.success) {
            alert(res && res.error ? res.error : 'Erro ao criar conta.');
            return;
          }
          // Login automático após cadastro
          var loginRes = await window.PodpahhDB.loginCustomer(email, password, digits);
          if (loginRes && loginRes.success) {
            saveSession(loginRes.token, loginRes.data);
          } else {
            saveSession(null, res.data);
          }
          alert('Conta criada com sucesso!');
          window.location.reload();
        } catch (err) {
          alert('Erro de conexão ao criar conta.');
        }
      }
    });
  }

  // ---- ESQUECI A SENHA (e-mail de recovery do Supabase Auth) ----
  // Passo 1: pede o e-mail -> Supabase envia o link.
  // Passo 2: link abre .../minha-conta.html (sessão PASSWORD_RECOVERY) ->
  //          formulário de nova senha -> POST /api/auth/reset c/ access_token.
  document.querySelectorAll('.ma-forgot-link').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.vsForgotOpen();
    });
  });

  var SUPA_URL = 'https://qmspfcfdcuvvaxdqggzg.supabase.co';
  var SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtc3BmY2ZkY3V2dmF4ZHFnZ3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MDIzMzUsImV4cCI6MjEwMzI3ODMzNX0.IYsEPUTEGyV43xVPCgb7QnglSMISBaxRpY5uBoBYVBc';
  var supaRecovery = null;

  function supaClient() {
    if (supaRecovery) return supaRecovery;
    if (!window.supabase || !window.supabase.createClient) return null;
    supaRecovery = window.supabase.createClient(SUPA_URL, SUPA_ANON);
    return supaRecovery;
  }

  // Parâmetros de recovery em qualquer formato (hash #access_token,
  // ?code= PKCE ou ?token_hash=&type=recovery). Também detecta erro
  // (link expirado/usado) para avisar em vez de cair no login em silêncio.
  function recoveryParams() {
    try {
      var hash = String(window.location.hash || '');
      var q = new URLSearchParams(window.location.search);
      var hq = new URLSearchParams(hash.charAt(0) === '#' ? hash.substring(1) : hash);
      var err = hq.get('error') || q.get('error');
      return {
        implicit: hash.indexOf('access_token') !== -1,
        code: q.get('code') || '',
        tokenHash: q.get('token_hash') || '',
        type: q.get('type') || '',
        error: err || '',
        errorCode: hq.get('error_code') || q.get('error_code') || '',
        any: hash.indexOf('access_token') !== -1 || !!q.get('code') || !!q.get('token_hash') || q.get('type') === 'recovery' || !!err
      };
    } catch (e) { return { any: false }; }
  }

  function recoveryNotice(text) {
    if (document.getElementById('pp-forgot-overlay')) return;
    var div = document.createElement('div');
    div.innerHTML = forgotShell(
      '<p style="color:var(--txt);font-size:.9rem">' + esc(text) + '</p>' +
      '<button onclick="vsForgotOpen()" class="ma-submit-btn" style="width:100%;margin-top:12px;justify-content:center">GERAR NOVO LINK</button>'
    );
    document.body.appendChild(div.firstChild);
  }

  // Roda direto (este arquivo inteiro já executa dentro do DOMContentLoaded;
  // registrar outro listener aqui dentro nunca dispararia).
  (function initRecoveryDetection() {
    var rp = recoveryParams();
    if (!rp.any) return;
    // Link morto (expirado/usado): avisa de cara em vez de mostrar o login.
    if (rp.error) {
      setTimeout(function () {
        recoveryNotice('Este link expirou ou já foi usado. Gere um novo link abaixo — ele vale por 1 hora e abre o formulário automaticamente.');
      }, 800);
      return;
    }
    var client = supaClient();
    if (!client) {
      setTimeout(function () {
        recoveryNotice('Não foi possível validar o link (biblioteca offline). Gere um novo link.');
      }, 800);
      return;
    }
    var opened = false;
    function openOnce() {
      if (opened) return; opened = true;
      window.vsForgotToCodeSupa();
    }
    client.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setTimeout(openOnce, 300);
      }
    });
    // Cobre ?token_hash&type=recovery e evento perdido: tenta validar e
    // confere se já existe sessão (qualquer sessão válida serve p/ trocar).
    setTimeout(async function () {
      try {
        var p = recoveryParams();
        if (p.tokenHash && p.type) {
          var v = await client.auth.verifyOtp({ token_hash: p.tokenHash, type: 'recovery' });
          if (!v.error) { openOnce(); return; }
        }
        var s = await client.auth.getSession();
        if (s && s.data && s.data.session) { openOnce(); return; }
        if (p.any) recoveryNotice('Este link expirou ou já foi usado. Gere um novo link abaixo.');
      } catch (e) {
        if (recoveryParams().any) recoveryNotice('Não foi possível validar o link. Gere um novo.');
      }
    }, 1800);
  })();

  function forgotShell(inner) {
    return '<div id="pp-forgot-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:3000;display:flex;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)vsForgotClose()">' +
      '<div style="background:rgba(10,28,68,.62);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(80,140,255,.4);box-shadow:0 20px 60px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08);padding:28px;width:100%;max-width:420px;box-sizing:border-box">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<h3 style="margin:0;font-family:\'Barlow Condensed\',sans-serif;font-size:1.3rem;letter-spacing:1px;color:#fff"><i class="fa fa-key" style="color:var(--c)"></i> RECUPERAR SENHA</h3>' +
      '<button onclick="vsForgotClose()" style="background:none;border:none;color:var(--dim);font-size:1.1rem;cursor:pointer"><i class="fa fa-times"></i></button></div>' +
      '<div id="pp-forgot-body">' + inner + '</div></div></div>';
  }

  function forgotStep1Html() {
    return '<p style="color:var(--dim);font-size:.85rem;margin:0 0 14px">Informe o e-mail da conta. Enviamos um link válido por <b>1 hora</b> para criar uma nova senha.</p>' +
      '<div class="acc-field"><label>E-MAIL DA CONTA *</label><input type="email" id="fg_email" placeholder="seu@email.com" style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.9rem;border-radius:0;box-sizing:border-box"></div>' +
      '<div id="fg_msg" style="font-size:.82rem;margin-bottom:10px"></div>' +
      '<button onclick="vsForgotSend()" class="ma-submit-btn" style="width:100%;justify-content:center"><i class="fa fa-paper-plane"></i> ENVIAR LINK</button>';
  }

  window.vsForgotOpen = function() {
    if (document.getElementById('pp-forgot-overlay')) return;
    var div = document.createElement('div');
    div.innerHTML = forgotShell(forgotStep1Html());
    document.body.appendChild(div.firstChild);
    setTimeout(function () { var el = document.getElementById('fg_email'); if (el) el.focus(); }, 50);
  };

  window.vsForgotClose = function() {
    var ov = document.getElementById('pp-forgot-overlay');
    if (ov) ov.remove();
    try {
      var clean = false;
      var u = new URL(window.location.href);
      ['reset_token', 'code', 'token_hash', 'type'].forEach(function (k) {
        if (u.searchParams.has(k)) { u.searchParams.delete(k); clean = true; }
      });
      if (window.location.hash && window.location.hash.indexOf('access_token') !== -1) {
        clean = true;
      }
      if (clean) {
        u.hash = '';
        window.history.replaceState({}, '', u.toString().split('#')[0]);
      }
    } catch (e) {}
  };

  function fgMsg(text, ok) {
    var el = document.getElementById('fg_msg');
    if (!el) { if (text) alert(text); return; }
    el.textContent = text || '';
    el.style.color = ok ? '#4ade80' : '#ff5252';
  }

  window.vsForgotSend = async function() {
    var input = document.getElementById('fg_email');
    var email = input ? input.value.trim() : '';
    if (!email || email.indexOf('@') === -1) { fgMsg('Informe um e-mail válido.'); return; }
    if (!window.PodpahhDB || !window.PodpahhDB.forgotPassword) { fgMsg('Servidor offline.'); return; }
    fgMsg('Enviando...', true);
    try {
      var res = await window.PodpahhDB.forgotPassword(email);
      if (!res || !res.success) { fgMsg(res && res.error ? res.error : 'Erro ao enviar.'); return; }
      document.getElementById('pp-forgot-body').innerHTML =
        '<div style="text-align:center;padding:12px 0">' +
        '<i class="fa fa-envelope-circle-check" style="font-size:2.4rem;color:#4ade80;display:block;margin-bottom:12px"></i>' +
        '<p style="color:var(--txt);font-size:.9rem;margin:0 0 6px"><b>Verifique seu e-mail.</b></p>' +
        '<p style="color:var(--dim);font-size:.82rem;margin:0">Se existir conta para <b>' + esc(email) + '</b>, o link de redefinição (válido por 1 hora) já foi enviado.</p></div>';
    } catch (e) { fgMsg('Erro de conexão.'); }
  };

  // Passo 2 via sessão de recovery do Supabase (chegou pelo link do e-mail).
  window.vsForgotToCodeSupa = function() {
    if (!document.getElementById('pp-forgot-overlay')) window.vsForgotOpen();
    var body = document.getElementById('pp-forgot-body');
    if (!body) return;
    body.innerHTML =
      '<p style="color:var(--dim);font-size:.85rem;margin:0 0 14px">Link verificado. Crie sua nova senha abaixo.</p>' +
      '<div class="acc-field"><label>NOVA SENHA (MÍN. 8) *</label><input type="password" id="fg_pass" autocomplete="new-password" style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.9rem;border-radius:0;box-sizing:border-box"></div>' +
      '<div class="acc-field"><label>CONFIRMAR NOVA SENHA *</label><input type="password" id="fg_pass2" autocomplete="new-password" style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.9rem;border-radius:0;box-sizing:border-box"></div>' +
      '<div id="fg_msg" style="font-size:.82rem;margin-bottom:10px"></div>' +
      '<button onclick="vsResetSendSupa()" class="ma-submit-btn" style="width:100%;justify-content:center"><i class="fa fa-save"></i> TROCAR SENHA</button>';
  };

  window.vsForgotToCode = function() {
    window.vsForgotToCodeSupa();
  };

  window.vsResetSendSupa = async function() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var p1 = g('fg_pass'), p2 = g('fg_pass2');
    if (p1.length < 8) { fgMsg('A nova senha precisa de no mínimo 8 caracteres.'); return; }
    if (p1 !== p2) { fgMsg('A confirmação não confere.'); return; }
    var client = supaClient();
    if (!client) { fgMsg('Sessão de recuperação indisponível. Gere um novo link.'); return; }
    try {
      var sess = await client.auth.getSession();
      var token = sess && sess.data && sess.data.session && sess.data.session.access_token;
      if (!token) { fgMsg('Sessão expirada. Gere um novo link.'); return; }
      var res = await window.PodpahhDB.resetPassword(token, p1);
      if (!res || !res.success) { fgMsg(res && res.error ? res.error : 'Erro ao trocar.'); return; }
      try {
        if (res.token && res.data) saveSession(res.token, res.data);
        await client.auth.signOut();
      } catch (e) {}
      window.vsForgotClose();
      alert('Senha trocada com sucesso! Você já está logado.');
      window.location.href = window.location.pathname;
    } catch (e) { fgMsg('Erro de conexão.'); }
  };

  window.vsResetSend = function() {
    window.vsResetSendSupa();
  };

  // Renderiza área autenticada e gerenciamento de endereços se logado
  var session = getSession();
  if (session && session.user) {
    var authWrap = document.querySelector('.ma-auth-wrap');
    if (authWrap) {
      renderAccountDashboard(authWrap, session);
    }
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtMoney(v) {
    var n = Number(v || 0);
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return '—'; }
  }

  function fmtPhone(digits) {
    var d = String(digits || '').replace(/\D/g, '');
    if (d.length === 11) return '(' + d.substring(0, 2) + ') ' + d.substring(2, 7) + '-' + d.substring(7);
    if (d.length === 10) return '(' + d.substring(0, 2) + ') ' + d.substring(2, 6) + '-' + d.substring(6);
    return d || '—';
  }

  // Normaliza status legado EN -> PT (pending->pendente etc.)
  var ORDER_PT = { pending: 'pendente', paid: 'confirmado', processing: 'confirmado', shipped: 'confirmado', delivered: 'confirmado', cancelled: 'cancelado', pendente: 'pendente', confirmado: 'confirmado', cancelado: 'cancelado' };
  function normStatus(s) { return ORDER_PT[String(s || 'pendente')] || 'pendente'; }

  function orderBadge(st) {
    var n = normStatus(st);
    if (n === 'confirmado') return '<span class="acc-ordbadge" style="background:rgba(0,200,83,.15);color:#4ade80;padding:4px 10px;border-radius:0;font-size:.75rem;font-weight:700">CONFIRMADO</span>';
    if (n === 'cancelado') return '<span class="acc-ordbadge" style="background:rgba(255,65,108,.15);color:#ff8fb0;padding:4px 10px;border-radius:0;font-size:.75rem;font-weight:700">CANCELADO</span>';
    return '<span class="acc-ordbadge" style="background:rgba(255,179,0,.15);color:#ffb300;padding:4px 10px;border-radius:0;font-size:.75rem;font-weight:700">PENDENTE</span>';
  }

  function orderAddressText(o) {
    if (o.address && typeof o.address === 'string' && o.address.trim()) return o.address;
    if (o.address && typeof o.address === 'object') {
      var a = o.address;
      return [a.street + (a.number ? ', ' + a.number : ''), a.neighborhood, (a.city || '') + (a.state ? '/' + a.state : ''), a.postal_code ? 'CEP ' + a.postal_code : ''].filter(Boolean).join(' — ');
    }
    return '—';
  }

  // Catálogo para resolver nomes/preços dos favoritos (mesmas fontes da loja)
  function accountCatalog() {
    var cat = {};
    try {
      if (window.PODPAHH_CATALOG) for (var k in window.PODPAHH_CATALOG) cat[k] = window.PODPAHH_CATALOG[k];
      if (window.PODPAHH_ADMIN_PRODUCTS) for (var a in window.PODPAHH_ADMIN_PRODUCTS) cat[a] = window.PODPAHH_ADMIN_PRODUCTS[a];
      var saved = JSON.parse(localStorage.getItem('podpahh_catalog_v1')) || {};
      for (var s in saved) if (!cat[s]) cat[s] = saved[s];
      // Árvore pedevapor-shop usa chave v2 de cache do catálogo
      try {
        var saved2 = JSON.parse(localStorage.getItem('podpahh_catalog_v2')) || {};
        for (var s2 in saved2) if (!cat[s2]) cat[s2] = saved2[s2];
      } catch (e2) {}
    } catch (e) {}
    return cat;
  }

  function getAccountTab() {
    try {
      var t = sessionStorage.getItem('podpahh_account_tab') || 'painel';
      if (t === 'orders') return 'orders';
      return t;
    } catch (e) { return 'painel'; }
  }

  var ACC_TABS = ['painel', 'orders', 'addresses', 'dados', 'wishlist'];

  window.vsAccountTab = function(name) {
    if (ACC_TABS.indexOf(name) === -1) name = 'painel';
    try { sessionStorage.setItem('podpahh_account_tab', name); } catch (e) {}
    ACC_TABS.forEach(function (t) {
      var panel = document.getElementById('accTab-' + t);
      var btn = document.getElementById('accBtn-' + t);
      if (panel) panel.style.display = (t === name) ? 'block' : 'none';
      if (btn) {
        btn.classList.toggle('on', t === name);
        btn.style.opacity = (t === name) ? '1' : '.55';
      }
    });
  };

  window.vsAccountLogout = function() { window.vsLogout(); };

  function bindProfileMask() {
    var el = document.getElementById('acc_edit_phone');
    if (!el || el.getAttribute('data-mask')) return;
    el.setAttribute('data-mask', '1');
    el.addEventListener('input', function () {
      var raw = String(el.value || '').replace(/\D/g, '').substring(0, 11);
      if (!raw) { el.value = ''; return; }
      if (raw.length <= 2) el.value = '(' + raw;
      else if (raw.length <= 6) el.value = '(' + raw.substring(0, 2) + ') ' + raw.substring(2);
      else if (raw.length <= 10) el.value = '(' + raw.substring(0, 2) + ') ' + raw.substring(2, 6) + '-' + raw.substring(6);
      else el.value = '(' + raw.substring(0, 2) + ') ' + raw.substring(2, 7) + '-' + raw.substring(7);
    });
  }

  window.vsSaveProfile = async function(e) {
    if (e) e.preventDefault();
    var sess = getSession();
    if (!sess || !sess.token || !window.PodpahhDB || !window.PodpahhDB.updateCustomer) {
      alert('Sessão expirada. Faça login novamente.');
      return;
    }
    var nameEl = document.getElementById('acc_edit_name');
    var phoneEl = document.getElementById('acc_edit_phone');
    var msgEl = document.getElementById('acc_profile_msg');
    var name = nameEl ? nameEl.value.trim() : '';
    var digits = phoneEl ? String(phoneEl.value || '').replace(/\D/g, '') : '';
    if (name.length < 2) { alert('Informe seu nome completo.'); return; }
    if (digits.length !== 11) {
      alert('Informe um WhatsApp válido com DDD (ex: (41) 99999-9999).');
      if (phoneEl) phoneEl.focus();
      return;
    }
    try {
      var res = await window.PodpahhDB.updateCustomer(name, digits, sess.token);
      if (!res || !res.success) {
        if (msgEl) { msgEl.textContent = res && res.error ? res.error : 'Erro ao salvar.'; msgEl.style.color = '#ff5252'; }
        else alert(res && res.error ? res.error : 'Erro ao salvar.');
        return;
      }
      try {
        var s1 = JSON.parse(localStorage.getItem('podpahh_session_v1'));
        if (s1 && s1.user) { s1.user.name = res.data.name; s1.user.phone = res.data.phone; localStorage.setItem('podpahh_session_v1', JSON.stringify(s1)); }
        localStorage.setItem('podpahh_logged_user', JSON.stringify(res.data));
      } catch (e2) {}
      if (msgEl) { msgEl.textContent = 'Dados atualizados com sucesso!'; msgEl.style.color = '#4ade80'; }
      setTimeout(function () { window.location.reload(); }, 800);
    } catch (err) {
      alert('Erro de conexão ao salvar.');
    }
  };

  function ensureAccStyle() {
    if (document.getElementById('acc-style')) return;
    var css = '.acc-shell{max-width:1090px;margin:0 auto}' +
      '.acc-topline{height:1px;background:var(--brd);margin-bottom:18px}' +
      '.acc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}' +
      '.acc-eyebrow{color:var(--c);font-size:.75rem;letter-spacing:3px;font-weight:700}' +
      '.acc-title{font-family:\'Barlow Condensed\',sans-serif;font-size:2rem;color:#fff;margin:2px 0 0;letter-spacing:1px;display:flex;align-items:center;gap:10px}' +
      '.acc-title i{color:var(--c)}' +
      '.acc-usercard{display:flex;align-items:center;gap:12px;background:transparent;border:1px solid var(--brd);border-radius:0;padding:10px 18px 10px 10px}' +
      '.acc-avatar{width:44px;height:44px;border-radius:0;background:linear-gradient(135deg,var(--c),#1a56db);display:flex;align-items:center;justify-content:center;font-size:1.2rem;font-weight:800;color:#fff;flex-shrink:0}' +
      '.acc-avatar.big{width:76px;height:76px;font-size:2rem}' +
      '.acc-uname{color:#fff;font-weight:700;font-size:.95rem}' +
      '.acc-umail{color:var(--dim);font-size:.78rem}' +
      '.acc-body{display:flex;gap:24px;margin-top:20px;align-items:flex-start}' +
      '.acc-side{width:240px;flex-shrink:0;background:transparent;border:1px solid var(--brd);border-radius:0;padding:12px;min-height:397px;display:flex;flex-direction:column}' +
      '.acc-menu{display:flex;flex-direction:column;gap:4px}' +
      '.acc-mi{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:0;border:1px solid transparent;background:transparent;color:var(--dim);font-size:.88rem;font-weight:600;cursor:pointer;width:100%;text-align:left}' +
      '.acc-mi i{width:18px;text-align:center}' +
      '.acc-mi:hover{color:#fff;background:rgba(255,255,255,.03)}' +
      '.acc-mi.on{background:rgba(0,220,255,.08);border-color:var(--c);color:var(--c)}' +
      '.acc-mi.danger{color:#ff5252}' +
      '.acc-sidefoot{margin-top:auto;padding-top:12px;display:flex;gap:8px}' +
      '.acc-footbox{flex:1;background:transparent;border:1px solid var(--brd);border-radius:0;padding:10px;text-align:center}' +
      '.acc-footbox b{color:#fff;font-size:1.1rem;display:block}' +
      '.acc-footbox span{font-size:.68rem;color:var(--dim);text-transform:uppercase;letter-spacing:1px}' +
      '.acc-main{flex:1;min-width:0}' +
      '.acc-welcome{position:relative;background:transparent;border:1px solid var(--brd);border-top:3px solid var(--c);border-radius:0;padding:22px;min-height:137px;display:flex;justify-content:space-between;align-items:center;gap:16px;overflow:hidden;box-sizing:border-box}' +
      '.acc-welcome:after{content:\'\';position:absolute;top:0;right:0;width:56px;height:3px;background:#ff2fb3}' +
      '.acc-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:14px 0}' +
      '.acc-card{background:transparent;border:1px solid var(--brd);border-radius:0;padding:14px;display:flex;gap:10px;align-items:center;cursor:pointer;text-align:left;color:var(--txt);width:100%}' +
      '.acc-card:hover{border-color:var(--c)}' +
      '.acc-card i{font-size:1.25rem;color:var(--c);flex-shrink:0}' +
      '.acc-card b{color:#fff;font-size:.88rem;display:block}' +
      '.acc-card span{font-size:.74rem;color:var(--dim);display:block}' +
      '.acc-orders{background:transparent;border:1px solid var(--brd);border-radius:0;padding:26px;min-height:284px;box-sizing:border-box}' +
      '.acc-ordgrid{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px;-webkit-overflow-scrolling:touch}' +
      '.acc-ordcard{background:transparent;border:1px solid var(--brd);border-radius:0;padding:16px;flex:0 0 300px;max-width:300px;min-width:0;overflow:hidden;scroll-snap-align:start;box-sizing:border-box}' +
      '.acc-ordcard code,.acc-ordcard span,.acc-ordcard div{overflow-wrap:break-word;min-width:0}' +
      '.acc-ordid{display:inline-block;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}' +
      '.acc-ordbadge{white-space:nowrap;flex-shrink:0}' +
      '.acc-ordaddr{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.acc-empty{text-align:center;padding:40px 16px;color:var(--dim)}' +
      '.acc-empty i{font-size:2.4rem;opacity:.4;display:block;margin-bottom:12px}' +
      '.acc-trap{display:inline-block;min-width:190px;min-height:78px;line-height:78px;padding:0 28px;background:var(--c);color:#001318;font-weight:800;letter-spacing:1.5px;transform:skewX(-10deg);border:none;cursor:pointer;font-size:.92rem;text-decoration:none;box-sizing:border-box}' +
      '.acc-trap>span{display:inline-block;transform:skewX(10deg)}' +
      '.acc-panel{background:transparent;border:1px solid var(--brd);border-radius:0;padding:22px;box-sizing:border-box}' +
      '.acc-h3{margin:0 0 14px;font-family:\'Barlow Condensed\',sans-serif;font-size:1.25rem;letter-spacing:1.5px;color:#fff}' +
      '.acc-h3 i{color:var(--c)}' +
      '.acc-field{margin-bottom:12px}' +
      '.acc-field label{font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px;font-weight:600}' +
      '.acc-field input{width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.9rem;border-radius:0;box-sizing:border-box}' +
      '@media(max-width:900px){.acc-body{flex-direction:column}.acc-side{width:100%;min-height:0}.acc-cards{grid-template-columns:repeat(2,1fr)}.acc-top{flex-direction:column}.acc-ordgrid{display:block;overflow:visible}.acc-ordgrid .acc-ordcard{max-width:none;margin-bottom:12px}}';
    var st = document.createElement('style');
    st.id = 'acc-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  window.vsAccountUnwish = async function(pid, mid) {
    var sess = getSession();
    if (!sess || !sess.token || !window.PodpahhDB || !window.PodpahhDB.removeWishlist) return;
    try {
      var res = await window.PodpahhDB.removeWishlist(String(pid), String(mid || ''), sess.token);
      if (res && res.success) {
        try {
          var wish = JSON.parse(localStorage.getItem('podpahh_wishlist_v1')) || {};
          delete wish[pid];
          localStorage.setItem('podpahh_wishlist_v1', JSON.stringify(wish));
        } catch (e) {}
        window.location.reload();
      } else {
        alert(res && res.error ? res.error : 'Erro ao remover favorito.');
      }
    } catch (e) { alert('Erro de conexão.'); }
  };

  window.vsAccountBuy = function(pid) {
    if (window.vsAddToCart) window.vsAddToCart(String(pid));
    else window.location.href = accStoreHome();
  };

  var ACC_ORDERS_PAGE = 6;

  window.vsOrdersMore = function() {
    var hidden = document.getElementById('accOrdersRest');
    var btn = document.getElementById('accOrdersMoreBtn');
    if (!hidden) return;
    var show = hidden.style.display === 'none';
    hidden.style.display = show ? '' : 'none';
    if (btn) btn.innerHTML = show ? 'MOSTRAR MENOS <i class="fa fa-chevron-up"></i>' : btn.getAttribute('data-label');
  };

  function orderCardHtml(o) {
    var items = (o.items || []).map(function (i) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:.85rem">' +
        '<span style="color:var(--txt)">' + esc(i.name) + ' <b style="color:var(--dim)">×' + esc(i.qty) + '</b></span>' +
        '<span style="color:var(--txt);white-space:nowrap">' + fmtMoney(Number(i.price || 0) * Number(i.qty || 0)) + '</span></div>';
    }).join('');
    return '<div class="acc-ordcard">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">' +
      '<b style="color:#fff;font-size:.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Pedido <code class="acc-ordid" title="' + esc(o.id) + '">' + esc(o.id) + '</code></b>' + orderBadge(o.status) + '</div>' +
      '<div style="font-size:.8rem;color:var(--dim);margin-bottom:10px"><i class="fa fa-calendar"></i> ' + fmtDate(o.created_at) + ' &nbsp;|&nbsp; <i class="fa fa-credit-card"></i> ' + esc(o.payment_method || 'PIX') + '</div>' +
      items +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:1px solid var(--brd);gap:8px">' +
      '<span class="acc-ordaddr" title="' + esc(orderAddressText(o)).replace(/"/g, '&quot;') + '" style="font-size:.78rem;color:var(--dim)"><i class="fa fa-map-marker-alt"></i> ' + esc(orderAddressText(o)) + '</span>' +
      '<b style="color:#4ade80;font-size:1rem;white-space:nowrap">' + fmtMoney(o.total) + '</b></div></div>';
  }

  // Vitrine conforme a árvore: raiz tem loja.html; pedevapor-shop usa a
  // categoria descartáveis (lá não existe loja.html).
  function accStoreHome() {
    try {
      if (String(window.location.pathname || '').indexOf('/pedevapor-shop/') !== -1) {
        return '/pedevapor-shop/pages/categoria-produto/descartaveis.html';
      }
    } catch (e) {}
    return 'loja.html';
  }

  function renderOrdersHtml(orders) {
    if (!orders.length) {
      return '<div style="text-align:center;padding:36px 16px;color:var(--dim)">' +
        '<i class="fa fa-receipt" style="font-size:2.2rem;opacity:.4;display:block;margin-bottom:12px"></i>' +
        '<p style="margin:0 0 14px">Você ainda não fez nenhum pedido.</p>' +
        '<a href="' + accStoreHome() + '" class="ma-submit-btn" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none"><i class="fa fa-store"></i> VER PRODUTOS</a></div>';
    }
    var first = orders.slice(0, ACC_ORDERS_PAGE).map(orderCardHtml).join('');
    var html = '<div class="acc-ordgrid">' + first + '</div>';
    if (orders.length > ACC_ORDERS_PAGE) {
      var rest = orders.slice(ACC_ORDERS_PAGE).map(orderCardHtml).join('');
      var left = orders.length - ACC_ORDERS_PAGE;
      html += '<div id="accOrdersRest" style="display:none"><div class="acc-ordgrid" style="margin-top:12px">' + rest + '</div></div>' +
        '<div style="text-align:center;margin-top:14px">' +
        '<button id="accOrdersMoreBtn" data-label="MOSTRAR MAIS (' + left + ') <i class=&quot;fa fa-chevron-down&quot;></i>" onclick="vsOrdersMore()" class="ma-submit-btn" style="justify-content:center">MOSTRAR MAIS (' + left + ') <i class="fa fa-chevron-down"></i></button></div>';
    }
    return html;
  }

  function renderWishlistHtml(wishlist, cat) {
    if (!wishlist.length) {
      return '<div style="text-align:center;padding:36px 16px;color:var(--dim)">' +
        '<i class="fa fa-heart" style="font-size:2.2rem;opacity:.4;display:block;margin-bottom:12px"></i>' +
        '<p style="margin:0 0 14px">Nenhum favorito ainda. Toque no <i class="fa fa-heart"></i> dos produtos para salvar aqui.</p>' +
        '<a href="' + accStoreHome() + '" class="ma-submit-btn" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none"><i class="fa fa-store"></i> VER PRODUTOS</a></div>';
    }
    return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">' +
      wishlist.map(function (w) {
        var p = cat[w.product_id] || {};
        var modelName = '';
        if (w.model_id && p.models) {
          var found = (p.models || []).filter(function (m) { return String(m.id) === String(w.model_id); })[0];
          if (found) modelName = found.name;
        }
        var img = p.image || '';
        var price = (modelName && found && found.price) ? found.price : (p.price || 0);
        var pid = String(w.product_id).replace(/'/g, '');
        var mid = String(w.model_id || '').replace(/'/g, '');
        return '<div style="background:transparent;border:1px solid var(--brd);border-radius:0;overflow:hidden">' +
          (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" style="width:100%;height:130px;object-fit:cover" onerror="this.style.display=\'none\'">' : '') +
          '<div style="padding:12px">' +
          '<div style="color:#fff;font-size:.88rem;font-weight:700;line-height:1.3;margin-bottom:2px">' + esc(p.name || w.product_id) + '</div>' +
          (modelName ? '<div style="font-size:.76rem;color:var(--c);margin-bottom:4px"><i class="fa fa-layer-group"></i> ' + esc(modelName) + '</div>' : '') +
          '<div style="color:#4ade80;font-weight:800;margin-bottom:10px">' + fmtMoney(price) + '</div>' +
          '<div style="display:flex;gap:8px">' +
          '<button onclick="vsAccountBuy(\'' + pid + '\')" class="ma-submit-btn" style="flex:1;justify-content:center;padding:8px;font-size:.78rem"><i class="fa fa-cart-plus"></i> COMPRAR</button>' +
          '<button onclick="vsAccountUnwish(\'' + pid + '\',\'' + mid + '\')" class="ma-submit-btn" style="width:auto;justify-content:center;padding:8px 10px" title="Remover"><i class="fa fa-trash"></i></button>' +
          '</div></div></div>';
      }).join('') + '</div>';
  }

  async function renderAccountDashboard(wrap, sess) {
    var user = sess.user;
    var token = sess.token;
    var addresses = [], orders = [], wishlist = [];
    // Esqueleto imediato (síncrono): nada de flash do form de login.
    // Dados já vêm do cache da sessão; o fetch paralelo completa em seguida.
    ensureAccStyle();
    wrap.style.visibility = 'visible';
    wrap.innerHTML = '<div class="acc-shell"><div class="acc-topline"></div>' +
      '<div class="acc-top"><div><div class="acc-eyebrow">// CONTA</div>' +
      '<h1 class="acc-title"><i class="fa fa-user-circle"></i> MINHA CONTA</h1></div>' +
      '<div class="acc-usercard"><div class="acc-avatar">' + esc(String((user && user.name) || 'C').charAt(0).toUpperCase()) + '</div>' +
      '<div><div class="acc-uname">' + esc(user.name) + '</div><div class="acc-umail"><i class="fa fa-spinner fa-spin"></i> carregando...</div></div></div></div>' +
      '<div class="acc-body"><aside class="acc-side"><nav class="acc-menu">' +
      '<button class="acc-mi on"><i class="fa fa-grid-2"></i> Painel</button>' +
      '<button class="acc-mi"><i class="fa fa-receipt"></i> Meus Pedidos</button>' +
      '<button class="acc-mi"><i class="fa fa-map-marker-alt"></i> Endereços</button>' +
      '<button class="acc-mi"><i class="fa fa-id-card"></i> Dados da Conta</button>' +
      '<button class="acc-mi"><i class="fa fa-heart"></i> Favoritos</button>' +
      '</nav></div><div class="acc-main"><div class="acc-panel"><p style="color:var(--dim)"><i class="fa fa-spinner fa-spin"></i> Carregando seus dados...</p></div></div></div></div>';
    if (window.PodpahhDB) {
      var settled = await Promise.all([
        window.PodpahhDB.getAddresses ? window.PodpahhDB.getAddresses(token).catch(function () { return null; }) : Promise.resolve(null),
        window.PodpahhDB.getMyOrders ? window.PodpahhDB.getMyOrders(token).catch(function () { return null; }) : Promise.resolve(null),
        window.PodpahhDB.getWishlist ? window.PodpahhDB.getWishlist(token).catch(function () { return null; }) : Promise.resolve(null)
      ]);
      if (settled[0] && settled[0].success) addresses = settled[0].data || [];
      if (settled[1] && settled[1].success) orders = settled[1].data || [];
      if (settled[2] && settled[2].success) wishlist = settled[2].data || [];
    }
    try {
      orders.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    } catch (e) {}
    var cat = accountCatalog();
    var activeTab = getAccountTab();

    var addrHtml = '';
    if (!addresses.length) {
      addrHtml = '<p style="color:var(--dim);font-size:.88rem">Nenhum endereço cadastrado ainda.</p>';
    } else {
      addrHtml = '<div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:20px">';
      addresses.forEach(function(a) {
        addrHtml += '<div style="background:transparent;border:1px solid ' + (a.is_default ? 'var(--c)' : 'var(--brd)') + ';padding:14px;border-radius:0;position:relative">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
          '<b style="color:var(--txt);font-size:.92rem">' + esc(a.label || 'Endereço') + ' ' + (a.is_default ? '<span style="background:var(--c);color:#000;font-size:.65rem;padding:2px 6px;border-radius:0;font-weight:700">PADRÃO</span>' : '') + '</b>' +
          '<div style="display:flex;gap:8px">' +
          '<button onclick="vsEditAddressModal(\'' + a.id + '\')" class="ma-submit-btn" style="width:auto;justify-content:center;padding:4px 8px;font-size:.72rem"><i class="fa fa-edit"></i></button>' +
          '<button onclick="vsDeleteAddressItem(\'' + a.id + '\')" class="ma-submit-btn" style="width:auto;justify-content:center;padding:4px 8px;font-size:.72rem"><i class="fa fa-trash"></i></button>' +
          '</div></div>' +
          '<div style="color:rgba(232,232,240,.8);font-size:.85rem;line-height:1.5">' +
          'Destinatário: <b>' + esc(a.recipient_name) + '</b> (' + esc(a.phone) + ')<br>' +
          esc(a.street) + ', ' + esc(a.number) + (a.complement ? ' — ' + esc(a.complement) : '') + '<br>' +
          esc(a.neighborhood) + ' — ' + esc(a.city) + '/' + esc(a.state) + ' (CEP: ' + esc(a.postal_code) + ')' +
          '</div></div>';
      });
      addrHtml += '</div>';
    }

    var memberSince = '—';
    try { if (user.created_at) memberSince = new Date(user.created_at).toLocaleDateString('pt-BR'); } catch (e) {}
    var initial = esc(String(user.name || 'C').charAt(0).toUpperCase());
    var firstName = esc(String(user.name || 'cliente').split(' ')[0]);
    var activeTab = getAccountTab();
    ensureAccStyle();
    try {
      var cpHead = document.querySelector('.cp-header');
      if (cpHead) cpHead.style.display = 'none';
    } catch (e) {}

    var recentOrders = orders.slice(0, 3);
    var recentHtml = recentOrders.length
      ? recentOrders.map(function (o) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;border-bottom:1px dashed rgba(255,255,255,.08);font-size:.85rem;flex-wrap:wrap">' +
          '<span style="color:var(--txt)"><code style="font-size:.72rem;opacity:.7">' + esc(o.id) + '</code> &nbsp; ' + fmtDate(o.created_at) + '</span>' +
          '<span style="display:flex;align-items:center;gap:10px">' + orderBadge(o.status) + '<b style="color:#4ade80">' + fmtMoney(o.total) + '</b></span></div>';
      }).join('') +
      '<div style="text-align:right;margin-top:10px"><button onclick="vsAccountTab(\'orders\')" class="ma-submit-btn" style="width:auto;justify-content:center;font-size:.78rem">VER TODOS <i class="fa fa-arrow-right"></i></button></div>'
      : '<div class="acc-empty"><i class="fa fa-receipt"></i><p style="margin:0 0 18px">Você ainda não fez nenhum pedido.</p>' +
      '<a href="' + accStoreHome() + '" class="acc-trap"><span>IR PARA A LOJA</span></a></div>';

    wrap.innerHTML = '<div class="acc-shell">' +
      '<div class="acc-topline"></div>' +
      '<div class="acc-top">' +
      '<div><div class="acc-eyebrow">// CONTA</div>' +
      '<h1 class="acc-title"><i class="fa fa-user-circle"></i> MINHA CONTA</h1></div>' +
      '<div class="acc-usercard"><div class="acc-avatar">' + initial + '</div>' +
      '<div><div class="acc-uname">' + esc(user.name) + '</div><div class="acc-umail">' + esc(user.email) + '</div></div></div>' +
      '</div>' +
      '<div class="acc-body">' +
      '<aside class="acc-side"><nav class="acc-menu">' +
      '<button id="accBtn-painel" class="acc-mi" onclick="vsAccountTab(\'painel\')"><i class="fa fa-grid-2"></i> Painel</button>' +
      '<button id="accBtn-orders" class="acc-mi" onclick="vsAccountTab(\'orders\')"><i class="fa fa-receipt"></i> Meus Pedidos</button>' +
      '<button id="accBtn-addresses" class="acc-mi" onclick="vsAccountTab(\'addresses\')"><i class="fa fa-map-marker-alt"></i> Endereços</button>' +
      '<button id="accBtn-dados" class="acc-mi" onclick="vsAccountTab(\'dados\')"><i class="fa fa-id-card"></i> Dados da Conta</button>' +
      '<button id="accBtn-wishlist" class="acc-mi" onclick="vsAccountTab(\'wishlist\')"><i class="fa fa-heart"></i> Favoritos</button>' +
      '<button class="acc-mi danger" onclick="vsAccountLogout()"><i class="fa fa-right-from-bracket"></i> Sair</button>' +
      '</nav><div class="acc-sidefoot"><div class="acc-footbox"><b>' + orders.length + '</b><span>Pedidos</span></div></div></aside>' +
      '<div class="acc-main">' +
      '<div id="accTab-painel">' +
      '<div class="acc-welcome"><div>' +
      '<div class="acc-eyebrow">// PAINEL DO CLIENTE</div>' +
      '<h2 style="margin:4px 0 6px;color:#fff;font-size:1.4rem">Olá, ' + firstName + '!</h2>' +
      '<p style="margin:0;color:var(--dim);font-size:.85rem">Acompanhe seus pedidos, endereços e favoritos por aqui.</p>' +
      '</div><div class="acc-avatar big">' + initial + '</div></div>' +
      '<div class="acc-cards">' +
      '<button class="acc-card" onclick="vsAccountTab(\'orders\')"><i class="fa fa-receipt"></i><div><b>Meus Pedidos</b><span>' + orders.length + ' pedido(s)</span></div></button>' +
      '<button class="acc-card" onclick="vsAccountTab(\'addresses\')"><i class="fa fa-map-marker-alt"></i><div><b>Endereços</b><span>' + addresses.length + ' salvo(s)</span></div></button>' +
      '<button class="acc-card" onclick="vsAccountTab(\'dados\')"><i class="fa fa-id-card"></i><div><b>Meus Dados</b><span>' + esc(fmtPhone(user.phone)) + '</span></div></button>' +
      '<button class="acc-card" onclick="vsAccountTab(\'wishlist\')"><i class="fa fa-heart"></i><div><b>Favoritos</b><span>' + wishlist.length + ' item(ns)</span></div></button>' +
      '</div>' +
      '<div class="acc-orders">' + recentHtml + '</div>' +
      '</div>' +
      '<div id="accTab-orders" style="display:none">' +
      '<div class="acc-panel"><h3 class="acc-h3"><i class="fa fa-receipt"></i> HISTÓRICO DE PEDIDOS</h3>' +
      renderOrdersHtml(orders) +
      '</div></div>' +
      '<div id="accTab-addresses" style="display:none">' +
      '<div class="acc-panel">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">' +
      '<h3 class="acc-h3" style="margin:0"><i class="fa fa-map-marker-alt"></i> MEUS ENDEREÇOS</h3>' +
      '<button onclick="vsToggleAccountAddressForm(true)" class="ma-submit-btn" style="justify-content:center"><i class="fa fa-plus"></i> ADICIONAR ENDEREÇO</button>' +
      '</div>' +
      addrHtml +
      '<div id="accountAddressFormWrap" style="display:none;background:transparent;border:1px solid var(--brd);padding:20px;border-radius:0;margin-top:16px">' +
      '<h4 id="accountFormTitle" style="margin:0 0 14px;font-family:\'Barlow Condensed\',sans-serif;font-size:1.1rem;letter-spacing:1px;color:#fff">Novo Endereço</h4>' +
      '<form id="accountAddressForm" onsubmit="vsSaveAccountAddress(event)">' +
      '<input type="hidden" id="edit_address_id" value="">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">NOME DO DESTINATÁRIO *</label><input type="text" id="acc_recipient_name" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">WHATSAPP DE CONTATO *</label><input type="tel" id="acc_phone" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">CEP (8 DÍGITOS) *</label><input type="text" id="acc_postal_code" maxlength="8" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">RÓTULO (EX: CASA, TRABALHO)</label><input type="text" id="acc_label" value="Casa" style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:3fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">RUA / AVENIDA *</label><input type="text" id="acc_street" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">NÚMERO *</label><input type="text" id="acc_number" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">COMPLEMENTO</label><input type="text" id="acc_complement" style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">BAIRRO *</label><input type="text" id="acc_neighborhood" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">CIDADE *</label><input type="text" id="acc_city" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">UF (ESTADO) *</label><input type="text" id="acc_state" maxlength="2" required style="width:100%;background:rgb(30,30,30);border:1px solid rgba(255,255,255,.1);color:var(--txt);padding:11px 14px;font-size:.88rem;border-radius:0"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px">' +
      '<button type="submit" class="ma-submit-btn" style="flex:1;justify-content:center"><i class="fa fa-save"></i> SALVAR ENDEREÇO</button>' +
      '<button type="button" onclick="vsToggleAccountAddressForm(false)" class="ma-submit-btn" style="width:auto;justify-content:center">CANCELAR</button>' +
      '</div>' +
      '</form>' +
      '</div>' +
      '</div></div>' +
      '<div id="accTab-dados" style="display:none">' +
      '<div class="acc-panel"><h3 class="acc-h3"><i class="fa fa-id-card"></i> DADOS DA CONTA</h3>' +
      '<form onsubmit="vsSaveProfile(event)">' +
      '<div class="acc-field"><label>NOME COMPLETO *</label><input type="text" id="acc_edit_name" required value="' + esc(user.name).replace(/"/g, '&quot;') + '"></div>' +
      '<div class="acc-field"><label>WHATSAPP (DDD + NÚMERO) *</label><input type="tel" id="acc_edit_phone" required maxlength="15" value="' + esc(fmtPhone(user.phone)).replace(/"/g, '&quot;') + '"></div>' +
      '<div class="acc-field"><label>E-MAIL (NÃO PODE SER ALTERADO)</label><input type="email" value="' + esc(user.email).replace(/"/g, '&quot;') + '" disabled style="opacity:.55"></div>' +
      '<div class="acc-field"><label>CLIENTE DESDE</label><input type="text" value="' + esc(memberSince) + '" disabled style="opacity:.55"></div>' +
      '<div id="acc_profile_msg" style="font-size:.85rem;margin-bottom:10px"></div>' +
      '<button type="submit" class="ma-submit-btn" style="width:100%;justify-content:center"><i class="fa fa-save"></i> SALVAR DADOS</button>' +
      '</form></div></div>' +
      '<div id="accTab-wishlist" style="display:none">' +
      '<div class="acc-panel"><h3 class="acc-h3"><i class="fa fa-heart"></i> MEUS FAVORITOS</h3>' +
      renderWishlistHtml(wishlist, cat) +
      '</div></div>' +
      '</div>' +
      '</div>' +
      '</div>';
    bindProfileMask();
    window.vsAccountTab(activeTab);
  }

  var activeEditingAddresses = [];
  // Guarda cache local para edição rápida
  window.vsToggleAccountAddressForm = function(show, addr) {
    var wrap = document.getElementById('accountAddressFormWrap');
    if (!wrap) return;
    wrap.style.display = show ? 'block' : 'none';
    var title = document.getElementById('accountFormTitle');
    var idInput = document.getElementById('edit_address_id');
    if (addr && addr.id) {
      if (title) title.textContent = 'Editar Endereço';
      if (idInput) idInput.value = addr.id;
      document.getElementById('acc_recipient_name').value = addr.recipient_name || '';
      document.getElementById('acc_phone').value = addr.phone || '';
      document.getElementById('acc_postal_code').value = addr.postal_code || '';
      document.getElementById('acc_label').value = addr.label || 'Casa';
      document.getElementById('acc_street').value = addr.street || '';
      document.getElementById('acc_number').value = addr.number || '';
      document.getElementById('acc_complement').value = addr.complement || '';
      document.getElementById('acc_neighborhood').value = addr.neighborhood || '';
      document.getElementById('acc_city').value = addr.city || '';
      document.getElementById('acc_state').value = addr.state || '';
    } else {
      if (title) title.textContent = 'Novo Endereço';
      if (idInput) idInput.value = '';
      var form = document.getElementById('accountAddressForm');
      if (form) form.reset();
      var sess = getSession();
      if (sess && sess.user && sess.user.phone) {
        var pInput = document.getElementById('acc_phone');
        if (pInput && !pInput.value) pInput.value = sess.user.phone;
      }
      if (sess && sess.user && sess.user.name) {
        var rInput = document.getElementById('acc_recipient_name');
        if (rInput && !rInput.value) rInput.value = sess.user.name;
      }
    }
  };

  window.vsEditAddressModal = async function(id) {
    var sess = getSession();
    if (!sess || !sess.token) return;
    try {
      var r = await window.PodpahhDB.getAddresses(sess.token);
      if (r && r.success && r.data) {
        var found = r.data.find(function(x) { return x.id === id; });
        if (found) window.vsToggleAccountAddressForm(true, found);
      }
    } catch (e) {}
  };

  window.vsSetDefaultAddress = async function(id) {
    var sess = getSession();
    if (!sess || !sess.token) return;
    try {
      var r = await window.PodpahhDB.getAddresses(sess.token);
      if (r && r.success && r.data) {
        var found = r.data.find(function(x) { return x.id === id; });
        if (found) {
          found.is_default = true;
          var res = await window.PodpahhDB.updateAddress(id, found, sess.token);
          if (res && res.success) {
            window.location.reload();
          } else {
            alert(res && res.error ? res.error : 'Erro ao definir padrão.');
          }
        }
      }
    } catch (e) {
      alert('Erro de conexão.');
    }
  };

  window.vsDeleteAddressItem = async function(id) {
    if (!confirm('Tem certeza que deseja excluir este endereço?')) return;
    var sess = getSession();
    if (!sess || !sess.token) return;
    try {
      var res = await window.PodpahhDB.deleteAddress(id, sess.token);
      if (res && res.success) {
        window.location.reload();
      } else {
        alert(res && res.error ? res.error : 'Erro ao excluir.');
      }
    } catch (e) {
      alert('Erro de conexão.');
    }
  };

  window.vsSaveAccountAddress = async function(e) {
    e.preventDefault();
    var sess = getSession();
    if (!sess || !sess.token) {
      alert('Sessão expirada. Faça login novamente.');
      return;
    }
    var editId = document.getElementById('edit_address_id').value;
    var data = {
      label: document.getElementById('acc_label').value.trim() || 'Casa',
      recipient_name: document.getElementById('acc_recipient_name').value.trim(),
      phone: document.getElementById('acc_phone').value.trim(),
      postal_code: document.getElementById('acc_postal_code').value.trim(),
      street: document.getElementById('acc_street').value.trim(),
      number: document.getElementById('acc_number').value.trim(),
      complement: document.getElementById('acc_complement').value.trim(),
      neighborhood: document.getElementById('acc_neighborhood').value.trim(),
      city: document.getElementById('acc_city').value.trim(),
      state: document.getElementById('acc_state').value.trim(),
      is_default: true
    };

    try {
      var res;
      if (editId) {
        res = await window.PodpahhDB.updateAddress(editId, data, sess.token);
      } else {
        res = await window.PodpahhDB.saveAddress(data, sess.token);
      }
      if (res && res.success) {
        alert('Endereço salvo com sucesso!');
        window.location.reload();
      } else {
        alert(res && res.error ? res.error : 'Erro ao salvar endereço.');
      }
    } catch (err) {
      alert('Erro de conexão ao salvar endereço.');
    }
  };
});
