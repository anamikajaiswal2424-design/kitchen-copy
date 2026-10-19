const { checkPaytmStatus } = require('../lib/payment');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body || {};
  const txnid = body.ORDERID || body.orderId;
  if (typeof txnid !== 'string' || !/^TXN\d{1,40}$/.test(txnid)) return res.status(400).json({ error: 'Invalid order ID' });
  // Never trust the callback's status or amount: independently confirm with Paytm.
  const payment = await checkPaytmStatus(txnid);
  if (payment.status === 'failure') return res.status(200).json({ received: true });
  if (payment.status !== 'success') return res.status(503).json({ error: 'Payment not confirmed yet' });
  return res.status(200).json({ received: true });
};
