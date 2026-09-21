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

  // Intercepta Login
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
      var digits = phoneDigits(phone);
      if (!digits || !isValidPhone(digits)) {
        alert('Informe um número de WhatsApp válido com DDD (ex: (41) 99999-9999).');
        if (phoneInput) phoneInput.focus();
        return;
      }

      if (window.PodpahhDB) {
        try {
          var res = await window.PodpahhDB.loginCustomer(user, pass, digits);
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

  async function renderAccountDashboard(wrap, sess) {
    var user = sess.user;
    var token = sess.token;
    var addresses = [];
    if (window.PodpahhDB && window.PodpahhDB.getAddresses) {
      try {
        var r = await window.PodpahhDB.getAddresses(token);
        if (r && r.success) addresses = r.data || [];
      } catch (e) {}
    }

    var addrHtml = '';
    if (!addresses.length) {
      addrHtml = '<p style="color:var(--dim);font-size:.88rem">Nenhum endereço cadastrado ainda.</p>';
    } else {
      addrHtml = '<div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:20px">';
      addresses.forEach(function(a) {
        addrHtml += '<div style="background:var(--bg3);border:1px solid ' + (a.is_default ? 'var(--c)' : 'var(--brd)') + ';padding:14px;border-radius:8px;position:relative">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
          '<b style="color:var(--txt);font-size:.92rem">' + esc(a.label || 'Endereço') + ' ' + (a.is_default ? '<span style="background:var(--c);color:#000;font-size:.65rem;padding:2px 6px;border-radius:4px;font-weight:700">PADRÃO</span>' : '') + '</b>' +
          '<div style="display:flex;gap:8px">' +
          (!a.is_default ? '<button onclick="vsSetDefaultAddress(\'' + a.id + '\')" class="pp-btn-ghost" style="padding:4px 8px;font-size:.72rem">Tornar Padrão</button>' : '') +
          '<button onclick="vsEditAddressModal(\'' + a.id + '\')" class="pp-btn-ghost" style="padding:4px 8px;font-size:.72rem"><i class="fa fa-edit"></i></button>' +
          '<button onclick="vsDeleteAddressItem(\'' + a.id + '\')" class="pp-btn-ghost" style="padding:4px 8px;font-size:.72rem;border-color:rgba(255,50,50,.3);color:#ff5252"><i class="fa fa-trash"></i></button>' +
          '</div></div>' +
          '<div style="color:rgba(232,232,240,.8);font-size:.85rem;line-height:1.5">' +
          'Destinatário: <b>' + esc(a.recipient_name) + '</b> (' + esc(a.phone) + ')<br>' +
          esc(a.street) + ', ' + esc(a.number) + (a.complement ? ' — ' + esc(a.complement) : '') + '<br>' +
          esc(a.neighborhood) + ' — ' + esc(a.city) + '/' + esc(a.state) + ' (CEP: ' + esc(a.postal_code) + ')' +
          '</div></div>';
      });
      addrHtml += '</div>';
    }

    wrap.innerHTML = '<div style="background:var(--bg1);border:1px solid var(--brd);padding:30px;border-radius:12px;color:var(--txt)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--brd);padding-bottom:16px;margin-bottom:24px;flex-wrap:wrap;gap:12px">' +
      '<div>' +
      '<h2 style="margin:0 0 4px;font-family:\'Barlow Condensed\',sans-serif;font-size:1.5rem;letter-spacing:1px;color:#fff"><i class="fa fa-user-circle" style="color:var(--c)"></i> ' + esc(user.name) + '</h2>' +
      '<p style="margin:0;color:var(--dim);font-size:.85rem"><i class="fa fa-envelope"></i> ' + esc(user.email) + ' | <i class="fa-brands fa-whatsapp"></i> ' + esc(user.phone) + '</p>' +
      '</div>' +
      '<button onclick="vsLogout()" class="pp-btn-ghost" style="border-color:rgba(255,50,50,.3);color:#ff5252"><i class="fa fa-sign-out-alt"></i> SAIR DA CONTA</button>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<h3 style="margin:0;font-family:\'Barlow Condensed\',sans-serif;font-size:1.2rem;letter-spacing:1.5px;color:#fff"><i class="fa fa-map-marker-alt" style="color:var(--c)"></i> MEUS ENDEREÇOS</h3>' +
      '<button onclick="vsToggleAccountAddressForm(true)" class="pp-btn-ghost" style="border-color:var(--c);color:var(--c)"><i class="fa fa-plus"></i> ADICIONAR ENDEREÇO</button>' +
      '</div>' +
      addrHtml +
      '<div id="accountAddressFormWrap" style="display:none;background:var(--bg3);border:1px solid var(--brd);padding:20px;border-radius:10px;margin-top:16px">' +
      '<h4 id="accountFormTitle" style="margin:0 0 14px;font-family:\'Barlow Condensed\',sans-serif;font-size:1.1rem;letter-spacing:1px;color:#fff">Novo Endereço</h4>' +
      '<form id="accountAddressForm" onsubmit="vsSaveAccountAddress(event)">' +
      '<input type="hidden" id="edit_address_id" value="">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">NOME DO DESTINATÁRIO *</label><input type="text" id="acc_recipient_name" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">WHATSAPP DE CONTATO *</label><input type="tel" id="acc_phone" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">CEP (8 DÍGITOS) *</label><input type="text" id="acc_postal_code" maxlength="8" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">RÓTULO (EX: CASA, TRABALHO)</label><input type="text" id="acc_label" value="Casa" style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:3fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">RUA / AVENIDA *</label><input type="text" id="acc_street" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">NÚMERO *</label><input type="text" id="acc_number" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">COMPLEMENTO</label><input type="text" id="acc_complement" style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">BAIRRO *</label><input type="text" id="acc_neighborhood" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:16px">' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">CIDADE *</label><input type="text" id="acc_city" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '<div><label style="font-size:.72rem;color:var(--dim);display:block;margin-bottom:4px">UF (ESTADO) *</label><input type="text" id="acc_state" maxlength="2" required style="width:100%;background:var(--bg2);border:1px solid var(--brd);color:var(--txt);padding:9px;font-size:.88rem"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px">' +
      '<button type="submit" class="pp-btn-ghost" style="flex:1;border-color:var(--c);color:var(--c)"><i class="fa fa-save"></i> SALVAR ENDEREÇO</button>' +
      '<button type="button" onclick="vsToggleAccountAddressForm(false)" class="pp-btn-ghost" style="border-color:rgba(255,50,50,.3);color:#ff5252">CANCELAR</button>' +
      '</div>' +
      '</form>' +
      '</div>' +
      '</div>';
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
