const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
async function setup(path,settingsPromise=Promise.resolve({pixels:['123456789','987654321']}),storageOverride){const events=[],saved=new Map();const storage=storageOverride||{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};const context={location:{pathname:path,search:''},fetch:async()=>({ok:true,json:async()=>settingsPromise}),document:{createElement:()=>({}),head:{appendChild(){}}},history:{pushState(){},replaceState(){}},addEventListener(){},localStorage:storage};context.window=context;context.fbq=(...args)=>events.push(args);vm.runInNewContext(fs.readFileSync('assets/store-pixels.js','utf8'),context);await new Promise(r=>setImmediate(r));return{context,events};}
const flush=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));};
test('PageView on each SPA route and no cart/checkout events',async()=>{const {context:c,events}=await setup('/');assert.equal(events.filter(e=>e[2]==='PageView').length,2);c.location.pathname='/cart';c.history.pushState();await new Promise(r=>setImmediate(r));assert.equal(events.filter(e=>e[2]==='PageView').length,4);});
test('only the latest route fires PageView when settings resolve late',async()=>{let resolveSettings;const settingsPromise=new Promise(resolve=>{resolveSettings=resolve;});const {context:c,events}=await setup('/',settingsPromise);c.location.pathname='/cart';c.history.pushState();resolveSettings({pixels:['123456789','987654321']});await flush();assert.equal(events.filter(e=>e[2]==='PageView').length,2);});
test('success page sends PageView for exact-URL Event Setup Tool rules',async()=>{let resolveSettings;const settingsPromise=new Promise(resolve=>{resolveSettings=resolve;});const {context:c,events}=await setup('/',settingsPromise);c.location.pathname='/success.html';c.history.pushState();resolveSettings({pixels:['123456789','987654321']});await flush();assert.equal(events.filter(e=>e[2]==='PageView').length,2);});
test('AddPaymentInfo uses the dynamic amount and dedupes by transaction',async()=>{const {context:c,events}=await setup('/payment');await c.fireStorePixelEvent('AddPaymentInfo',{value:398,currency:'INR'},'TXN123');await c.fireStorePixelEvent('AddPaymentInfo',{value:398,currency:'INR'},'TXN123');const paymentInfo=events.filter(e=>e[2]==='AddPaymentInfo');assert.equal(paymentInfo.length,2);assert.equal(paymentInfo[0][3].value,398);assert.equal(paymentInfo[0][3].currency,'INR');assert.equal(paymentInfo[0][4].eventID,'AddPaymentInfo:TXN123');});
test('blocked localStorage does not prevent AddPaymentInfo',async()=>{const storage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};const {context:c,events}=await setup('/payment',undefined,storage);await c.fireStorePixelEvent('AddPaymentInfo',{value:249,currency:'INR'},'TXN123');const paymentInfo=events.filter(e=>e[2]==='AddPaymentInfo');assert.equal(paymentInfo.length,2);assert.equal(paymentInfo[0][4].eventID,'AddPaymentInfo:TXN123');});

function successPageContext(search,verification={success:true,status:'success',amount:'398.00',utr:'UTR123'},savedQuery='') {
  const calls=[];const fetches=[];const elements=new Map();
  const context={
    location:{search},URLSearchParams,console,
    document:{getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',hidden:true});return elements.get(id);}},
    localStorage:{removeItem(){}},
    sessionStorage:{getItem:key=>key==='nexshop_success_query'?savedQuery:null},
    fetch:async(url,options)=>{fetches.push({url,options});return{ok:true,json:async()=>verification};},
    fireStorePixelEvent:async(...args)=>calls.push(args),
  };
  context.window=context;
  vm.runInNewContext(fs.readFileSync('assets/payment-success.js','utf8'),context);
  return{calls,fetches,elements};
}

test('thank-you page re-verifies and displays the server amount without firing Purchase',async()=>{
  const orderId='TXN1729000000000123';
  const {calls,fetches,elements}=successPageContext(`?transactionId=${orderId}&amount=1&status=done`);
  await flush();
  assert.equal(fetches.length,1);
  assert.equal(fetches[0].url,'/api/verify-payment');
  assert.deepEqual(JSON.parse(fetches[0].options.body),{txnid:orderId});
  assert.equal(calls.length,0);
  assert.equal(elements.get('amount').textContent,'₹398');
});

test('clean thank-you URL restores transaction data saved before URL normalization',async()=>{
  const orderId='TXN1729000000000123';
  const savedQuery=`?transactionId=${orderId}&amount=398&status=done`;
  const {fetches,elements}=successPageContext('',undefined,savedQuery);
  await flush();
  assert.equal(fetches.length,1);
  assert.deepEqual(JSON.parse(fetches[0].options.body),{txnid:orderId});
  assert.equal(elements.get('status').textContent,'done');
});

test('thank-you page does not verify failed URLs, invalid order IDs or unconfirmed payments',async()=>{
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



test('real payment action fires only AddPaymentInfo with transaction dedupe',()=>{const source=fs.readFileSync('assets/cashfree-checkout.js','utf8');assert.match(source,/fireStorePixelEvent\?\.\('AddPaymentInfo',[\s\S]*payment\.txnid\);/);assert.doesNotMatch(source,/trackVerifiedPurchase|['"]Purchase['"]/);});
test('success page has no code-based Purchase event',()=>{const source=fs.readFileSync('assets/payment-success.js','utf8');assert.doesNotMatch(source,/fireStorePixelEvent|['"]Purchase['"]/);});
test('success HTML normalizes query parameters before loading Meta Pixel',()=>{const source=fs.readFileSync('success.html','utf8');assert.ok(source.indexOf("history.replaceState(null, '', '/success.html')")<source.indexOf('/assets/store-pixels.js'));assert.match(source,/payment-success\.js\?v=7/);});
