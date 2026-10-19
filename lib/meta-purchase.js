const { createHash } = require('node:crypto');

// The same event ID is used for webhook retries, polling and the browser pixel.
async function sendPurchase(txnid, payment, req = {}) {
  const token = process.env.META_ACCESS_TOKEN;
  const pixels = [...new Set(String(process.env.META_PIXEL_ID || process.env.NEXT_PUBLIC_META_PIXEL_ID || '')
    .split(',').map(id => id.trim()).filter(id => /^\d{5,25}$/.test(id)))];
  if (!token || !pixels.length) return { sent: false, reason: 'not_configured' };
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid confirmed amount');
  const headers = req.headers || {};
  const userData = {
    external_id: [createHash('sha256').update(String(payment.customerId || txnid)).digest('hex')],
  };
  // Webhook requests belong to Paytm, not to the shopper.
  if (!req.isPaymentWebhook) {
    if (headers['user-agent']) userData.client_user_agent = headers['user-agent'];
    const ip = String(headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (ip) userData.client_ip_address = ip;
    for (const key of ['_fbp', '_fbc']) {
      const value = String(headers.cookie || '').split(';').map(part => part.trim())
        .find(part => part.startsWith(`${key}=`))?.slice(key.length + 1);
      if (value) userData[key.slice(1)] = value;
    }
  }
  const event = {
    event_name: 'Purchase', event_id: `purchase:${txnid}`,
    event_time: Math.floor(Date.now() / 1000), action_source: 'website',
    user_data: userData,
    custom_data: { currency: 'INR', value: amount, order_id: txnid },
  };
  if (process.env.STORE_URL) event.event_source_url = new URL('/payment', process.env.STORE_URL).href;
  const results = await Promise.allSettled(pixels.map(async id => {
    const response = await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION || 'v25.0'}/${id}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [event], access_token: token }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (!response.ok || body.events_received !== 1) throw new Error('Meta Purchase delivery failed');
  }));
  if (results.some(result => result.status === 'rejected')) throw new Error('Meta Purchase delivery failed');
  return { sent: true };
}

module.exports = { sendPurchase };
