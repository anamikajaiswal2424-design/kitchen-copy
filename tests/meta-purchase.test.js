const test = require('node:test');
const assert = require('node:assert/strict');
const verify = require('../api/verify-payment');
const webhook = require('../api/payment-webhook');
function response() { return { code: 200, setHeader() {}, status(code) { this.code=code; return this; }, json(data) { this.data=data; return this; } }; }
test('confirmed payment sends CAPI before response; webhook retries share ID and reject forged amount', async () => {
  const saved = {...process.env}; const oldFetch=global.fetch; const events=[];
  Object.assign(process.env, {PAYTM_MID:'MID123', META_PIXEL_ID:'123456789', META_ACCESS_TOKEN:'test-only-token'});
  let status='TXN_SUCCESS', failMeta=false;
  global.fetch=async (url, options) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      events.push(JSON.parse(options.body).data[0]);
      return {ok:!failMeta,json:async()=>({events_received:failMeta?0:1})};
    }
    return {json:async()=>({STATUS:status,MID:'MID123',ORDERID:'TXN100',TXNID:'P1',TXNAMOUNT:'249.00'})};
  };
  try {
    let res=response();
    await verify({method:'POST',body:{txnid:'TXN100'},headers:{'user-agent':'shopper'}},res);
    assert.equal(res.data.purchase.sent,true); assert.equal(events.length,1);
    assert.equal(events[0].custom_data.value,249); assert.equal(events[0].event_id,'purchase:TXN100');
    res=response(); await webhook({method:'POST',body:{ORDERID:'TXN100',TXNAMOUNT:'1'}},res);
    assert.equal(res.code,200); assert.equal(events[1].event_id,events[0].event_id);
    assert.equal(events[1].custom_data.value,249); assert.equal(events[1].user_data.client_user_agent,undefined);
    failMeta=true; res=response(); await webhook({method:'POST',body:{ORDERID:'TXN100'}},res); assert.equal(res.code,503);
    status='TXN_FAILURE'; res=response(); await webhook({method:'POST',body:{ORDERID:'TXN100',STATUS:'TXN_SUCCESS'}},res);
    assert.equal(res.code,200); assert.equal(events.length,3);
  } finally {
    global.fetch=oldFetch;
    for (const key of ['PAYTM_MID','META_PIXEL_ID','META_ACCESS_TOKEN']) {
      if(saved[key]===undefined) delete process.env[key]; else process.env[key]=saved[key];
    }
  }
});
