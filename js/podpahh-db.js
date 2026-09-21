/* ================================================================
   PODPAHH — Database Adapter (Supabase & Local Server Hybrid)
   Modo:
     'local'     -> usa o servidor Node local (porta 3000)
     'supabase'  -> usa o Supabase na nuvem (RLS ativo)
   Para produção: troque MODE para 'supabase' (o schema SQL já cria
   as tabelas e políticas RLS — veja supabase/schema.sql).
   ================================================================ */
(function (window) {
  'use strict';

  var MODE = 'local'; // 'local' ou 'supabase'

  var LOCAL_API = 'http://localhost:3000/api';

  // Chaves PÚBLICAS — seguras no navegador SOMENTE com RLS habilitado.
  // A SECRET KEY nunca entra aqui (fica no servidor, .env).
  var SB_CONFIG = {
    url: 'https://qmspfcfdcuvvaxdqggzg.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtc3BmY2ZkY3V2dmF4ZHFnZ3pnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MDIzMzUsImV4cCI6MjEwMzI3ODMzNX0.IYsEPUTEGyV43xVPCgb7QnglSMISBaxRpY5uBoBYVBc'
  };

  var supabaseClient = null;
  if (MODE === 'supabase' && window.supabase) {
    supabaseClient = window.supabase.createClient(SB_CONFIG.url, SB_CONFIG.anonKey);
  }

  window.PodpahhDB = {
    getMode: function() { return MODE; },
    getConfig: function() { return { mode: MODE, url: SB_CONFIG.url }; },

    // ID do usuário logado (sessão guardada pelo podpahh-auth.js)
    _sessionUserId: function() {
      try {
        var s = JSON.parse(localStorage.getItem('podpahh_session_v1'));
        if (s && s.user && s.user.id) return s.user.id;
      } catch (e) {}
      return null;
    },

    // Cadastrar / Salvar Cliente
    // SEMPRE via gateway local: o servidor gera o hash scrypt (nunca texto puro).
    // O modo supabase direto inseria a senha em texto puro — desativado de propósito.
    registerCustomer: async function(name, email, password, phone) {
      try {
        var res = await fetch(LOCAL_API + '/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, phone })
        });
        return await res.json();
      } catch (err) {
        console.error('Erro de conexão com o servidor local:', err);
        return { success: false, error: 'Servidor local offline.' };
      }
    },

    // Login — também sempre via gateway (hash verificado no servidor).
    loginCustomer: async function(email, password, phone) {
      try {
        var res = await fetch(LOCAL_API + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, phone })
        });
        return await res.json();
      } catch (err) {
        console.error('Erro de conexão:', err);
        return { success: false, error: 'Servidor local offline.' };
      }
    },

    // Salvar Pedido
    saveOrder: async function(orderData) {
      if (MODE === 'supabase' && supabaseClient) {
        var { data, error } = await supabaseClient.from('orders').insert([orderData]).select();
        if (error) throw error;
        return { success: true, data: data[0] };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    // Endereços do cliente
    getAddresses: async function(token) {
      if (MODE === 'supabase' && supabaseClient) {
        var { data, error } = await supabaseClient.from('customer_addresses').select('*').order('is_default', { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/addresses', {
            headers: { 'Authorization': 'Bearer ' + (token || '') }
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    saveAddress: async function(addressData, token) {
      if (MODE === 'supabase' && supabaseClient) {
        var { data, error } = await supabaseClient.from('customer_addresses').insert([addressData]).select();
        if (error) throw error;
        return { success: true, data: data[0] };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/addresses', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (token || '')
            },
            body: JSON.stringify(addressData)
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    updateAddress: async function(id, addressData, token) {
      if (MODE === 'supabase' && supabaseClient) {
        var { data, error } = await supabaseClient.from('customer_addresses').update(addressData).eq('id', id).select();
        if (error) throw error;
        return { success: true, data: data[0] };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/addresses/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (token || '')
            },
            body: JSON.stringify(addressData)
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    deleteAddress: async function(id, token) {
      if (MODE === 'supabase' && supabaseClient) {
        var { error } = await supabaseClient.from('customer_addresses').delete().eq('id', id);
        if (error) throw error;
        return { success: true };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/addresses/' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + (token || '') }
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    logoutCustomer: async function(token) {
      if (MODE === 'supabase' && supabaseClient) {
        return { success: true };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + (token || '') }
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    // Favoritos por conta (sincroniza o coração da loja entre aparelhos)
    getWishlist: async function(token) {
      if (MODE === 'supabase' && supabaseClient) {
        var uid = window.PodpahhDB._sessionUserId();
        if (!uid) return { success: false, error: 'Sessão expirada.' };
        var { data, error } = await supabaseClient.from('customer_wishlist').select('id,product_id,model_id,created_at').eq('customer_id', uid).order('created_at', { ascending: false });
        if (error) throw error;
        return { success: true, data: data || [] };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/wishlist', {
            headers: { 'Authorization': 'Bearer ' + (token || '') }
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    toggleWishlist: async function(productId, modelId, token) {
      var body = { product_id: productId, model_id: modelId || '' };
      if (MODE === 'supabase' && supabaseClient) {
        var uid = window.PodpahhDB._sessionUserId();
        if (!uid) return { success: false, error: 'Sessão expirada.' };
        var check = await supabaseClient.from('customer_wishlist').select('id').eq('customer_id', uid).eq('product_id', body.product_id).eq('model_id', body.model_id).limit(1);
        if (check.error) throw check.error;
        if (check.data && check.data.length) {
          var del = await supabaseClient.from('customer_wishlist').delete().eq('customer_id', uid).eq('product_id', body.product_id).eq('model_id', body.model_id);
          if (del.error) throw del.error;
          return { success: true, wished: false };
        }
        var ins = await supabaseClient.from('customer_wishlist').insert([{ customer_id: uid, product_id: body.product_id, model_id: body.model_id }]).select();
        if (ins.error) throw ins.error;
        return { success: true, wished: true, data: ins.data && ins.data[0] };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/wishlist/toggle', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (token || '')
            },
            body: JSON.stringify(body)
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    removeWishlist: async function(productId, modelId, token) {
      var body = { product_id: productId, model_id: modelId || '' };
      if (MODE === 'supabase' && supabaseClient) {
        var uid = window.PodpahhDB._sessionUserId();
        if (!uid) return { success: false, error: 'Sessão expirada.' };
        var { error } = await supabaseClient.from('customer_wishlist').delete().eq('customer_id', uid).eq('product_id', body.product_id).eq('model_id', body.model_id);
        if (error) throw error;
        return { success: true, wished: false };
      } else {
        try {
          var res = await fetch(LOCAL_API + '/wishlist', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (token || '')
            },
            body: JSON.stringify(body)
          });
          return await res.json();
        } catch (err) {
          return { success: false, error: 'Servidor offline.' };
        }
      }
    },

    // Buscar configurações da loja (número do WhatsApp do checkout)
    getSettings: async function() {
      try {
        if (MODE === 'supabase' && supabaseClient) {
          var { data, error } = await supabaseClient.from('settings').select('whatsapp, whatsapp_message').single();
          if (!error && data) return { whatsapp: data.whatsapp, whatsapp_message: data.whatsapp_message };
        } else {
          var res = await fetch(LOCAL_API + '/settings');
          var json = await res.json();
          if (json.success) return json.data;
        }
      } catch (err) { /* servidor offline: usa padrão */ }
      return { whatsapp: '5547999453628', whatsapp_message: '' };
    }
  };

})(window);