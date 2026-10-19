(() => {
  const params = new URLSearchParams(location.search);
  const transactionId = String(
    params.get('transactionId') || params.get('order_id') || '',
  ).trim();
  const amountFromUrl = Number(params.get('amount')) || 0;
  const statusFromUrl = String(params.get('status') || '').trim();
  const date = params.get('date') || new Date().toLocaleString('en-IN');
  const utrFromUrl = params.get('utr') || '';

  document.getElementById('transaction-id').textContent = transactionId || '—';
  document.getElementById('amount').textContent = `₹${amountFromUrl}`;
  document.getElementById('status').textContent = statusFromUrl || 'unknown';
  document.getElementById('date').textContent = date;
  const utrRow = document.getElementById('utr-row');

  function showUtr(utr) {
    if (!utr) return;
    document.getElementById('utr').textContent = utr;
    utrRow.hidden = false;
  }

  showUtr(utrFromUrl);

  async function verifyPurchase() {
    const response = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txnid: transactionId }),
    });
    const result = await response.json();

    if (!response.ok || result.success === false) {
      throw new Error(result.error || 'Payment verification unavailable');
    }

    return result;
  }

  async function trackConfirmedPurchase() {
    const status = statusFromUrl.toLowerCase();
    const looksLikeRealOrder = /^TXN\d{10,20}$/.test(transactionId);

    if (!looksLikeRealOrder || !['done', 'success'].includes(status)) {
      return;
    }

    const verified = await verifyPurchase();

    if (verified.status !== 'success') {
      return;
    }

    const amount = Number(verified.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    document.getElementById('amount').textContent = `₹${amount}`;
    document.getElementById('status').textContent = 'done';
    showUtr(verified.utr || utrFromUrl);

    if (typeof window.fireStorePixelEvent !== 'function') {
      return;
    }

    await window.fireStorePixelEvent(
      'Purchase',
      {
        value: amount,
        currency: 'INR',
        order_id: transactionId,
      },
      transactionId,
    );
  }

  trackConfirmedPurchase().catch(() => {});

  try {
    localStorage.removeItem('nexshop_cart');
  } catch {}
})();

