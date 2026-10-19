const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
async function setup(path,settingsPromise=Promise.resolve({pixels:['123456789','987654321']}),storageOverride){const events=[],saved=new Map();const storage=storageOverride||{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};const context={location:{pathname:path,search:''},fetch:async()=>({ok:true,json:async()=>settingsPromise}),document:{createElement:()=>({}),head:{appendChild(){}}},history:{pushState(){},replaceState(){}},addEventListener(){},localStorage:storage};context.window=context;context.fbq=(...args)=>events.push(args);vm.runInNewContext(fs.readFileSync('assets/store-pixels.js','utf8'),context);await new Promise(r=>setImmediate(r));return{context,events};}
const flush=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
test('PageView on each SPA route and no cart/checkout events',async()=>{const {context:c,events}=await setup('/');assert.equal(events.filter(e=>e[2]==='PageView').length,2);c.location.pathname='/cart';c.history.pushState();await new Promise(r=>setImmediate(r));assert.equal(events.filter(e=>e[2]==='PageView').length,4);});
test('only the latest route fires PageView when settings resolve late',async()=>{let resolveSettings;const settingsPromise=new Promise(resolve=>{resolveSettings=resolve;});const {context:c,events}=await setup('/',settingsPromise);c.location.pathname='/cart';c.history.pushState();resolveSettings({pixels:['123456789','987654321']});await flush();assert.equal(events.filter(e=>e[2]==='PageView').length,2);});
test('success page cancels a pending PageView',async()=>{let resolveSettings;const settingsPromise=new Promise(resolve=>{resolveSettings=resolve;});const {context:c,events}=await setup('/',settingsPromise);c.location.pathname='/success.html';c.history.pushState();resolveSettings({pixels:['123456789','987654321']});await flush();assert.equal(events.filter(e=>e[2]==='PageView').length,0);});
test('success page only Purchase, actual amount and dedupe per pixel/transaction',async()=>{const {context:c,events}=await setup('/success.html');assert.equal(events.filter(e=>e[2]==='PageView').length,0);const payment={transactionId:'TXN123',amount:398};await c.trackVerifiedPurchase(payment);await c.trackVerifiedPurchase(payment);const purchase=events.filter(e=>e[2]==='Purchase');assert.equal(purchase.length,2);assert.equal(purchase[0][3].value,398);assert.equal(purchase[0][3].currency,'INR');});
test('blocked localStorage does not prevent a verified Purchase',async()=>{const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};const {context:c,events}=await setup('/success.html',undefined,storage);await c.fireStorePixelEvent('Purchase',{value:249,currency:'INR'},'TXN123');const purchase=events.filter(e=>e[2]==='Purchase');assert.equal(purchase.length,2);assert.equal(purchase[0][4].eventID,'purchase:TXN123');});

function successPageContext(search,verification={success:true,status:'success',amount:'398.00',utr:'UTR123'}) {
  const calls=[];const fetches=[];const elements=new Map();
  const context={
    location:{search},URLSearchParams,console,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:true});return elements.get(id);}},
    localStorage:{removeItem(){}},
    fetch:async(url,options)=>{fetches.push({url,options});return{ok:true,json:async()=>verification};},
    fireStorePixelEvent:async(...args)=>calls.push(args),
  };
  context.window=context;
  vm.runInNewContext(fs.readFileSync('assets/payment-success.js','utf8'),context);
  return{calls,fetches,elements};
}

test('thank-you page re-verifies the order and tracks the server amount without trackVerifiedPurchase',async()=>{
  const orderId='TXN1729000000000123';
  const {calls,fetches,elements}=successPageContext(`?transactionId=${orderId}&amount=1&status=done`);
  await flush();
  assert.equal(fetches.length,1);
  assert.equal(fetches[0].url,'/api/verify-payment');
  assert.deepEqual(JSON.parse(fetches[0].options.body),{txnid:orderId});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'Purchase');
  assert.equal(calls[0][1].value,398);
  assert.equal(calls[0][1].currency,'INR');
  assert.equal(calls[0][1].order_id,orderId);
  assert.equal(calls[0][2],orderId);
  assert.equal(elements.get('amount').textContent,'₹398');
});

test('thank-you page rejects failed URLs, invalid order IDs and unconfirmed payments',async()=>{
  for(const [search,verification] of [
    ['?transactionId=TXN1729000000000123&amount=398&status=Failed',{success:true,status:'success',amount:'398.00'}],
    ['?transactionId=TEST123&amount=398&status=done',{success:true,status:'success',amount:'398.00'}],
    ['?transactionId=TXN1729000000000123&amount=398&status=done',{success:true,status:'pending'}],
  ]) {
    const {calls,fetches}=successPageContext(search,verification);
    await flush();
    assert.equal(calls.length,0);
    if(!search.includes('status=done')||search.includes('TEST123'))assert.equal(fetches.length,0);
  }
});

