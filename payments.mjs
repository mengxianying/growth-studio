import { fail, json } from './backend.mjs';
import { randomHex } from './account.mjs';

// Payment notifications are authenticated before any course is unlocked.
const paymentSchema = new WeakMap();
function initializePayments(db) {
  if(!paymentSchema.has(db)) paymentSchema.set(db,Promise.resolve().then(()=>db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS payment_attempts (id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE REFERENCES course_orders(id), provider TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS one_open_course_order ON course_orders(member_id,item) WHERE status IN ('pending','fulfilled')")
  ])).catch(error=>{paymentSchema.delete(db);throw error;}));
  return paymentSchema.get(db);
}
function paymentConfig(env,provider) {
  const names=provider==='wechat'?['WX_APP_ID','WX_MCH_ID','WX_CERT_SERIAL','WX_PRIVATE_KEY','WX_PUBLIC_KEY_ID','WX_PUBLIC_KEY','WX_API_V3_KEY']:provider==='alipay'?['ALIPAY_APP_ID','ALIPAY_SELLER_ID','ALIPAY_PRIVATE_KEY','ALIPAY_PUBLIC_KEY']:['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'];
  if(!names.every(name=>env[name])) fail(503,provider==='wechat'?'微信支付尚未开通':provider==='alipay'?'支付宝尚未开通':'Stripe 尚未开通');
}
function decodePem(pem) {
  const raw=atob(pem.replace(/-----[^-]+-----/g,'').replace(/\s/g,''));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function fromBase64(value) {return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function toBase64(value) {return btoa(String.fromCharCode(...new Uint8Array(value)));}
async function rsaSign(pem,message) {
  const key=await crypto.subtle.importKey('pkcs8',decodePem(pem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  return toBase64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(message)));
}
async function rsaVerify(pem,signature,message) {
  try {
    const key=await crypto.subtle.importKey('spki',decodePem(pem),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,fromBase64(signature),new TextEncoder().encode(message));
  }catch{return false;}
}
function alipaySignString(values) {
  return Object.keys(values).filter(k=>k!=='sign' && k!=='sign_type' && values[k]!=='').sort().map(k=>k+'='+values[k]).join('&');
}
async function createAlipay(order,env,origin,lang) {
  const params={
    app_id:env.ALIPAY_APP_ID,method:'alipay.trade.page.pay',charset:'utf-8',sign_type:'RSA2',
    timestamp:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' '),version:'1.0',
    notify_url:origin+'/api/payments/alipay/notify',
    return_url:origin+(lang==='en'?'/en?lang=en':'/?lang=zh')+'#my-courses',
    biz_content:JSON.stringify({out_trade_no:order.id,total_amount:(order.price/100).toFixed(2),subject:order.title.slice(0,120),product_code:'FAST_INSTANT_TRADE_PAY'})
  };
  // Request signatures include sign_type, unlike asynchronous notification signatures.
  const signed=Object.keys(params).sort().map(k=>k+'='+params[k]).join('&');
  params.sign=await rsaSign(env.ALIPAY_PRIVATE_KEY,signed);
  return {url:'https://openapi.alipay.com/gateway.do?'+new URLSearchParams(params)};
}
async function wechatRequest(env,method,path,body='') {
  const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomHex(16);
  const signature=await rsaSign(env.WX_PRIVATE_KEY,method+'\n'+path+'\n'+timestamp+'\n'+nonce+'\n'+body+'\n');
  const auth='WECHATPAY2-SHA256-RSA2048 mchid="'+env.WX_MCH_ID+'",nonce_str="'+nonce+'",signature="'+signature+'",timestamp="'+timestamp+'",serial_no="'+env.WX_CERT_SERIAL+'"';
  const response=await fetch('https://api.mch.weixin.qq.com'+path,{method,headers:{Authorization:auth,Accept:'application/json','Content-Type':'application/json','User-Agent':'GrowthStudio/1.0'},...(body?{body}:{})});
  const raw=await response.text(),stamp=response.headers.get('Wechatpay-Timestamp'),random=response.headers.get('Wechatpay-Nonce'),sig=response.headers.get('Wechatpay-Signature'),serial=response.headers.get('Wechatpay-Serial');
  if(!stamp || !random || !sig || serial!==env.WX_PUBLIC_KEY_ID || !await rsaVerify(env.WX_PUBLIC_KEY,sig,stamp+'\n'+random+'\n'+raw+'\n')) fail(502,'微信支付响应验签失败');
  if(!response.ok) fail(502,'微信支付暂不可用，请稍后重试');
  return JSON.parse(raw);
}
async function createWechat(order,env,origin) {
  const body=JSON.stringify({appid:env.WX_APP_ID,mchid:env.WX_MCH_ID,description:order.title.slice(0,100),out_trade_no:order.id,notify_url:origin+'/api/payments/wechat/notify',amount:{total:order.price,currency:'CNY'}});
  const result=await wechatRequest(env,'POST','/v3/pay/transactions/native',body);
  if(!result.code_url?.startsWith('weixin://'))fail(502,'微信支付暂不可用，请稍后重试');
  return {qr:result.code_url};
}
async function createStripe(order,env,origin,lang) {
  const fields=new URLSearchParams({
    mode:'payment',
    success_url:origin+(lang==='en'?'/en?lang=en':'/?lang=zh')+'#my-courses',
    cancel_url:origin+(lang==='en'?'/en?lang=en':'/?lang=zh')+'#read/'+encodeURIComponent(order.item),
    client_reference_id:order.id,
    'metadata[order_id]':order.id,
    'line_items[0][quantity]':'1',
    'line_items[0][price_data][currency]':'cny',
    'line_items[0][price_data][unit_amount]':String(order.price),
    'line_items[0][price_data][product_data][name]':order.title
  });
  const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'course-'+order.id},body:fields.toString()});
  if(!response.ok)fail(502,'Stripe 暂不可用，请稍后重试');
  const session=await response.json();
  if(!session.url || new URL(session.url).hostname!=='checkout.stripe.com') fail(502,'Stripe 返回的收银台地址无效');
  return {url:session.url};
}
async function verifyStripeSignature(secret,header,body) {
  const entries=header.split(',').map(part=>part.split('='));
  const timestamp=entries.find(([key])=>key==='t')?.[1];
  if(!timestamp || Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for(const [,value] of entries.filter(([name])=>name==='v1')) {
    if(!/^[a-f0-9]{64}$/i.test(value))continue;
    const bytes=Uint8Array.from(value.match(/../g),hex=>parseInt(hex,16));
    if(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+body)))return true;
  }
  return false;
}
async function settleOrder(db,orderId,provider,amount) {
  const order=await db.prepare('SELECT o.*,p.provider FROM course_orders o JOIN payment_attempts p ON p.order_id=o.id WHERE o.id=?').bind(orderId).first();
  if(!order || order.provider!==provider || order.price!==amount) fail(400,'支付信息不匹配');
  if(!['pending','fulfilled'].includes(order.status)) fail(409,'订单状态无效');
  await db.prepare("UPDATE course_orders SET status='fulfilled' WHERE id=? AND status='pending'").bind(order.id).run();
}
async function paymentApi(req,env,url) {
  const {DB:db}=env,path=url.pathname;
  if(!path.startsWith('/api/payments/')) return null;
  if(req.method!=='POST') fail(404,'接口不存在');
  if(path==='/api/payments/stripe/notify') {
    paymentConfig(env,'stripe');
    const raw=await req.text();if(raw.length>100000)fail(413,'内容过长');
    if(!await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET,req.headers.get('Stripe-Signature')||'',raw))fail(401,'回调签名无效');
    const event=JSON.parse(raw),session=event.data?.object;
    if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && session?.payment_status==='paid') {
      if(session.currency!=='cny' || session.client_reference_id!==session.metadata?.order_id)fail(400,'支付信息不匹配');
      await settleOrder(db,session.metadata.order_id,'stripe',session.amount_total);
    }
    return json({received:true});
  }
  if(path==='/api/payments/wechat/notify') {
    paymentConfig(env,'wechat');
    const raw=await req.text(),timestamp=req.headers.get('Wechatpay-Timestamp'),nonce=req.headers.get('Wechatpay-Nonce'),signature=req.headers.get('Wechatpay-Signature'),serial=req.headers.get('Wechatpay-Serial');
    if(!timestamp || Math.abs(Date.now()/1000-Number(timestamp))>300 || !nonce || !signature || serial!==env.WX_PUBLIC_KEY_ID || !await rsaVerify(env.WX_PUBLIC_KEY,signature,timestamp+'\n'+nonce+'\n'+raw+'\n')) fail(401,'回调签名无效');
    const data=JSON.parse(raw);
    if(data.event_type!=='TRANSACTION.SUCCESS' || data.resource?.algorithm!=='AEAD_AES_256_GCM') fail(400,'无效的支付通知');
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.WX_API_V3_KEY),'AES-GCM',false,['decrypt']);
    const resource=data.resource;
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:new TextEncoder().encode(resource.nonce),additionalData:new TextEncoder().encode(resource.associated_data||''),tagLength:128},key,fromBase64(resource.ciphertext));
    const transaction=JSON.parse(new TextDecoder().decode(plaintext));
    if(transaction.mchid!==env.WX_MCH_ID || transaction.appid!==env.WX_APP_ID || transaction.trade_state!=='SUCCESS' || transaction.amount?.currency!=='CNY') fail(400,'支付信息不匹配');
    await settleOrder(db,transaction.out_trade_no,'wechat',transaction.amount.total);
    return json({code:'SUCCESS',message:'成功'});
  }
  if(path==='/api/payments/alipay/notify') {
    paymentConfig(env,'alipay');
    const body=await req.text(); if(body.length>30000)fail(413,'内容过长');
    const entries=[...new URLSearchParams(body)];
    if(new Set(entries.map(([key])=>key)).size!==entries.length)fail(400,'无效的支付通知');
    const values=Object.fromEntries(entries);
    if(!values.sign || values.sign_type!=='RSA2' || !await rsaVerify(env.ALIPAY_PUBLIC_KEY,values.sign,alipaySignString(values))) fail(401,'回调签名无效');
    if(values.app_id!==env.ALIPAY_APP_ID || values.seller_id!==env.ALIPAY_SELLER_ID)fail(400,'支付信息不匹配');
    if(!['TRADE_SUCCESS','TRADE_FINISHED'].includes(values.trade_status)) return new Response('success');
    if(!/^\d{1,8}\.\d{2}$/.test(values.total_amount)) fail(400,'支付金额无效');
    await settleOrder(db,values.out_trade_no,'alipay',Math.round(Number(values.total_amount)*100));
    return new Response('success',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }
  fail(404,'接口不存在');
}
export { initializePayments, paymentApi, paymentConfig, createWechat, createAlipay, createStripe };
