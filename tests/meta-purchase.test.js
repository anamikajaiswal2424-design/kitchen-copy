const test = require('node:test');
const assert = require('node:assert/strict');
const verify = require('../api/verify-payment');
const webhook = require('../api/payment-webhook');

function response() {
  return {
    code: 200,
    setHeader() {},
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
  };
}

test('confirmed payments do not send a code-based Meta Purchase event', async () => {
  const oldFetch = global.fetch;
  const graphRequests = [];
  global.fetch = async (url) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      graphRequests.push(String(url));
      return { ok: true, json: async () => ({ events_received: 1 }) };
    }
    return {
      json: async () => ({
        STATUS: 'TXN_SUCCESS',
        MID: 'MID123',
        ORDERID: 'TXN100',
        TXNID: 'P1',
        TXNAMOUNT: '249.00',
      }),
    };
  };
  const oldMid = process.env.PAYTM_MID;
  process.env.PAYTM_MID = 'MID123';
  try {
    let res = response();
    await verify({ method: 'POST', body: { txnid: 'TXN100' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.data.status, 'success');
    assert.equal('purchase' in res.data, false);

    res = response();
    await webhook({ method: 'POST', body: { ORDERID: 'TXN100' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.data.received, true);
    assert.equal(graphRequests.length, 0);
  } finally {
    global.fetch = oldFetch;
    if (oldMid === undefined) delete process.env.PAYTM_MID;
    else process.env.PAYTM_MID = oldMid;
  }
});
