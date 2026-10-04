const bytes = value => new TextEncoder().encode(value);
const base64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)));
function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

export async function verifyResendSignature(raw, headers, secret, now = Date.now()) {
  const id = headers.get('svix-id') || headers.get('webhook-id');
  const timestamp = headers.get('svix-timestamp') || headers.get('webhook-timestamp');
  const signatures = headers.get('svix-signature') || headers.get('webhook-signature');
  if (!secret || !id || !/^\d+$/.test(timestamp || '') || !signatures || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  try {
    const decoded = atob(secret.replace(/^whsec_/, ''));
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(decoded, c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = base64(await crypto.subtle.sign('HMAC', key, bytes(`${id}.${timestamp}.${raw}`)));
    return signatures.split(/\s+/).some(value => value.startsWith('v1,') && constantEqual(value.slice(3), signature));
  } catch { return false; }
}

export async function verifyTwilioSignature(url, form, signature, token) {
  if (!token || !signature) return false;
  let input = url;
  for (const name of [...new Set(form.keys())].sort()) for (const value of [...new Set(form.getAll(name))].sort()) input += name + value;
  const key = await crypto.subtle.importKey('raw', bytes(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return constantEqual(base64(await crypto.subtle.sign('HMAC', key, bytes(input))), signature);
}

export function authenticatedEmail(authentication) {
  const passed = key => String(authentication?.[key]?.result || authentication?.[key] || '').toLowerCase() === 'pass';
  return passed('dmarc') || (passed('spf') && passed('dkim'));
}

export function receivedMessageText(received) {
  if (typeof received.text === 'string' && received.text.trim()) return received.text.slice(0, 20000);
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(received.html || '').slice(0, 200000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, key) => {
      if (!key.startsWith('#')) return entities[key.toLowerCase()] || whole;
      const number = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    }).trim().slice(0, 20000) || '[This reply has no readable text. Check the company email inbox.]';
}
