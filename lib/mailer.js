/* ================================================================
   PODPAHH — Envio de e-mail transacional (Resend, via fetch puro)
   ENVs: RESEND_API_KEY (obrigatória p/ enviar de verdade)
         MAIL_FROM (ex: 'PODPAHH <contato@seudominio.com>'; padrão onboarding)
         APP_URL (ex: https://podpahh.vercel.app — usada nos links)
   Sem chave: loga o link no console (dev) e informa emailed:false.
   ================================================================ */
'use strict';

function appUrl() {
  const u = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return u || 'https://podpahh.vercel.app';
}

function mailFrom() {
  return String(process.env.MAIL_FROM || 'PODPAHH <onboarding@resend.dev>').trim();
}

function resetHtml(link, name) {
  const safeName = String(name || 'cliente').replace(/[<>&"]/g, '');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#0a0a0f;padding:32px 16px;font-family:Arial,sans-serif;color:#e8e8f0">
<div style="max-width:480px;margin:0 auto;background:#14141d;border:1px solid rgba(45,122,255,.25);padding:32px">
<h2 style="margin:0 0 8px;color:#fff">Redefinir senha — PODPAHH</h2>
<p style="margin:0 0 8px">Olá, ${safeName}!</p>
<p style="margin:0 0 20px;color:#aaa">Recebemos um pedido de nova senha para sua conta. O link abaixo vale <b>1 hora</b> e só pode ser usado uma vez:</p>
<p style="margin:0 0 20px;text-align:center"><a href="${link}" style="display:inline-block;background:#2d7aff;color:#fff;font-weight:bold;padding:14px 28px;text-decoration:none">CRIAR NOVA SENHA</a></p>
<p style="margin:0;color:#777;font-size:12px">Se você não pediu isso, ignore este e-mail — sua senha continua a mesma.</p>
</div></body></html>`;
}

async function sendPasswordReset(toEmail, toName, token) {
  const link = appUrl() + '/pedevapor-shop/pages/minha-conta.html?reset_token=' + encodeURIComponent(token);
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[PODPAHH mailer] SEM RESEND_API_KEY — link de reset (dev):', link);
    return { success: true, emailed: false, link };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: mailFrom(),
        to: [toEmail],
        subject: 'Redefinir senha — PODPAHH',
        html: resetHtml(link, toName)
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[PODPAHH mailer] Resend recusou:', data);
      return { success: false, error: (data && data.message) || 'Falha ao enviar e-mail.' };
    }
    return { success: true, emailed: true, id: data.id };
  } catch (err) {
    console.error('[PODPAHH mailer] erro de rede:', err.message);
    return { success: false, error: 'Falha de conexão com o provedor de e-mail.' };
  }
}

module.exports = { sendPasswordReset, appUrl, mailFrom };
