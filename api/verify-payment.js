const { checkPaytmStatus } = require('../lib/payment');
const { sendPurchase } = require('../lib/meta-purchase');

const LONG_POLL_TIMEOUT_MS = 9_000;
const PAYTM_API_INTERVAL_MS = 2_500;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { txnid } = req.body || {};
  if (!txnid) {
    return res.status(400).json({ success: false, error: 'Transaction ID required' });
  }

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < LONG_POLL_TIMEOUT_MS) {
      const result = await checkPaytmStatus(String(txnid));
      if (result.status === 'success' || result.status === 'failure') {
        let purchase;
        if (result.status === 'success') {
          try { purchase = await sendPurchase(String(txnid), result, req); }
          catch { purchase = { sent: false, reason: 'delivery_failed' }; console.error('Meta Purchase delivery failed'); }
        }
        return res.status(200).json({
          success: true,
          status: result.status,
          utr: result.utr,
          amount: result.amount,
          purchase,
        });
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed + PAYTM_API_INTERVAL_MS >= LONG_POLL_TIMEOUT_MS) break;
      await new Promise((resolve) => setTimeout(resolve, PAYTM_API_INTERVAL_MS));
    }
    return res.status(200).json({ success: true, status: 'pending' });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      status: 'pending',
    });
  }
};
