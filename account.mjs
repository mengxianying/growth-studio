import { textField, fail, payload, limit, digest, json, fileResponse } from './backend.mjs';
import { paymentConfig, createWechat, createAlipay, createStripe } from './payments.mjs';

// Account and email verification routes use a separate session from the editorial desk.
const ACCOUNT_SESSION = 'gs_account';
const ACCOUNT_TTL = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL = 10 * 60 * 1000;

const accountSchema=new WeakMap();
function initializeAccounts(db) {
  if(accountSchema.has(db)) return accountSchema.get(db);
  const setup=Promise.resolve().then(()=>db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, email TEXT NOT NULL COLLATE NOCASE UNIQUE, account_type TEXT NOT NULL CHECK(account_type IN ('opc','company')), password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created INTEGER NOT NULL)"),
    db.prepare('CREATE TABLE IF NOT EXISTS email_codes (email TEXT PRIMARY KEY COLLATE NOCASE, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, sent INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE TABLE IF NOT EXISTS member_sessions (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), expires INTEGER NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS course_orders (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), item TEXT NOT NULL, title TEXT NOT NULL, price INTEGER NOT NULL, status TEXT NOT NULL, delivery TEXT NOT NULL, attachment TEXT NOT NULL, created INTEGER NOT NULL)")
  ])).catch(error=>{accountSchema.delete(db);throw error;});
  accountSchema.set(db,setup);
  return setup;
}
function normalizedEmail(value) {
  const email=textField(value,254,true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'请填写有效的邮箱地址');
  return email;
}
async function secretHash(secret, message) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))),x=>x.toString(16).padStart(2,'0')).join('');
}
function randomHex(length) {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)),x=>x.toString(16).padStart(2,'0')).join('');
}
async function passwordHash(password,salt) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:210000},key,256);
  return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
}
function memberCookie(value,url,maxAge) {
  return ACCOUNT_SESSION+'='+value+'; Path=/api; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(url.protocol==='https:'?'; Secure':'');
}
async function currentMember(db,req) {
  const value=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)gs_account=([a-f0-9]+)/)?.[1]||'';
  if(!value) return null;
  return db.prepare('SELECT m.id,m.username,m.email,m.account_type FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.hash=? AND s.expires>?').bind(await digest(value),Date.now()).first();
}
async function startMemberSession(db,member,url) {
  const session=randomHex(32);
  await db.batch([
    db.prepare('DELETE FROM member_sessions WHERE expires<=?').bind(Date.now()),
    db.prepare('INSERT INTO member_sessions VALUES (?,?,?)').bind(await digest(session),member.id,Date.now()+ACCOUNT_TTL)
  ]);
  return json({member},200,{'Set-Cookie':memberCookie(session,url,ACCOUNT_TTL/1000)});
}
async function accountApi(req,env,url) {
  const {DB:db}=env, path=url.pathname, method=req.method;
  if(!path.startsWith('/api/account/')) return null;
  if(path==='/api/account/me' && method==='GET') return json({member:await currentMember(db,req)});
  if(path==='/api/account/send-code' && method==='POST') {
    if(!env.RESEND_API_KEY || !env.MAIL_FROM || !env.EMAIL_CODE_SECRET) fail(503,'邮箱验证服务尚未配置');
    const data=await payload(req),email=normalizedEmail(data.email),now=Date.now();
    await limit(db,req,'email-code',8);
    if(await db.prepare('SELECT id FROM members WHERE email=?').bind(email).first()) fail(409,'该邮箱已注册，请直接登录');
    const existing=await db.prepare('SELECT sent FROM email_codes WHERE email=?').bind(email).first();
    if(existing && now-existing.sent<60000) fail(429,'请等待一分钟后再发送验证码');
    const random=crypto.getRandomValues(new Uint32Array(1))[0];
    const code=String(random%1000000).padStart(6,'0');
    const hash=await secretHash(env.EMAIL_CODE_SECRET,email+':'+code);
    const changed=await db.prepare('INSERT INTO email_codes(email,code_hash,expires,sent,attempts) VALUES (?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires,sent=excluded.sent,attempts=0 WHERE email_codes.sent<=? RETURNING email').bind(email,hash,now+CODE_TTL,now,now-60000).first();
    if(!changed) fail(429,'请等待一分钟后再发送验证码');
    let response;
    try {
      response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:'生长计划 · 邮箱验证码 / Verification code',text:'您的注册验证码是 '+code+'，10 分钟内有效。\nYour verification code is '+code+'. It expires in 10 minutes.'})});
    } catch {
      await db.prepare('DELETE FROM email_codes WHERE email=? AND code_hash=?').bind(email,hash).run();
      fail(503,'邮件发送失败，请稍后重试');
    }
    if(!response.ok) {
      await db.prepare('DELETE FROM email_codes WHERE email=? AND code_hash=?').bind(email,hash).run();
      fail(503,'邮件发送失败，请稍后重试');
    }
    return json({ok:true});
  }
  if(path==='/api/account/register' && method==='POST') {
    if(!env.EMAIL_CODE_SECRET) fail(503,'邮箱验证服务尚未配置');
    await limit(db,req,'register',15);
    const data=await payload(req),email=normalizedEmail(data.email),username=textField(data.username,32,true),password=data.password,code=textField(data.code,6,true);
    if(username.length<2 || !/^[\p{L}\p{N}_-]+$/u.test(username)) fail(400,'用户名需为 2–32 个字母、数字、下划线或连字符');
    if(typeof password!=='string' || password.length<10 || password.length>128) fail(400,'密码须为 10–128 个字符');
    if(!['opc','company'].includes(data.accountType) || !/^\d{6}$/.test(code)) fail(400,'请检查账户类型和验证码');
    if(await db.prepare('SELECT id FROM members WHERE email=? OR username=?').bind(email,username).first()) fail(409,'邮箱或用户名已被使用');
    const hash=await secretHash(env.EMAIL_CODE_SECRET,email+':'+code);
    const attempt=await db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE email=? AND expires>? AND attempts<5 RETURNING code_hash').bind(email,Date.now()).first();
    if(!attempt || attempt.code_hash!==hash) fail(400,'验证码无效、已过期或尝试次数过多');
    const salt=randomHex(16),password_hash=await passwordHash(password,salt),id=crypto.randomUUID();
    const used=await db.prepare('DELETE FROM email_codes WHERE email=? AND code_hash=? AND expires>? AND attempts<=5 RETURNING email').bind(email,hash,Date.now()).first();
    if(!used) fail(400,'验证码无效或已使用');
    try { await db.prepare('INSERT INTO members VALUES (?,?,?,?,?,?,?)').bind(id,username,email,data.accountType,password_hash,salt,Date.now()).run(); }
    catch(error) { if(String(error).includes('UNIQUE')) fail(409,'邮箱或用户名已被使用'); throw error; }
    return startMemberSession(db,{id,username,email,account_type:data.accountType},url);
  }
  if(path==='/api/account/login' && method==='POST') {
    await limit(db,req,'member-login',15);
    const data=await payload(req),identity=textField(data.identity,254,true),password=data.password;
    if(typeof password!=='string' || password.length>128) fail(401,'用户名、邮箱或密码不正确');
    const member=await db.prepare('SELECT * FROM members WHERE email=? OR username=?').bind(identity.toLowerCase(),identity).first();
    const computed=await passwordHash(password,member?.password_salt||'00000000000000000000000000000000');
    if(!member || computed!==member.password_hash) fail(401,'用户名、邮箱或密码不正确');
    const {id,username,email,account_type}=member;
    return startMemberSession(db,{id,username,email,account_type},url);
  }
  if(path==='/api/account/courses' && method==='GET') {
    const member=await currentMember(db,req);if(!member) fail(401,'请先登录');
    const orders=await db.prepare("SELECT id,title,item,price,status FROM course_orders WHERE member_id=? ORDER BY created DESC").bind(member.id).all();
    return json({orders:orders.results});
  }
  if(path.startsWith('/api/account/courses/') && method==='GET') {
    const member=await currentMember(db,req);if(!member) fail(401,'请先登录');
    const parts=path.split('/');
    const order=await db.prepare("SELECT * FROM course_orders WHERE id=? AND member_id=? AND status='fulfilled'").bind(parts[4],member.id).first();
    if(!order)fail(404,'课程尚未开通');
    if(parts[5]==='file') return fileResponse(await db.prepare('SELECT mime,bytes FROM media WHERE id=? AND private=1').bind(order.attachment).first(),true);
    const translation=url.searchParams.get('lang')==='en'?await db.prepare('SELECT title,delivery FROM english_contents WHERE id=?').bind(order.item).first():null;
    return json({id:order.id,title:translation?.title||order.title,delivery:translation?.delivery||order.delivery,file:!!order.attachment});
  }
  if(path==='/api/account/course-order' && method==='POST') {
    const member=await currentMember(db,req);if(!member) fail(401,'请先登录');
    await limit(db,req,'course-order',25);
    const data=await payload(req),item=await db.prepare("SELECT * FROM contents WHERE id=? AND kind='course' AND status='published'").bind(textField(data.item,64,true)).first();
    if(!item)fail(404,'课程已下架');
    let order=await db.prepare("SELECT * FROM course_orders WHERE member_id=? AND item=? AND status IN ('pending','fulfilled')").bind(member.id,item.id).first();
    if(order?.status==='fulfilled') return json({id:order.id,status:order.status});
    if(order && order.price!==item.price) fail(409,'课程价格已变化，请联系工作室处理原订单');
    if(item.price>0) {
      if(!['wechat','alipay','stripe'].includes(data.provider)) fail(400,'请选择支付方式');
      paymentConfig(env,data.provider);
    }
    if(!order) {
      const id=crypto.randomUUID().replaceAll('-','');
      try {
        const writes=[db.prepare('INSERT INTO course_orders VALUES (?,?,?,?,?,?,?,?,?)').bind(id,member.id,item.id,item.title,item.price,item.price?'pending':'fulfilled',item.delivery,item.attachment,Date.now())];
        if(item.price)writes.push(db.prepare('INSERT INTO payment_attempts(id,order_id,provider,created) VALUES (?,?,?,?)').bind(id,id,data.provider,Date.now()));
        await db.batch(writes);
      }catch(error){if(!String(error).includes('UNIQUE'))throw error;}
      order=await db.prepare("SELECT * FROM course_orders WHERE member_id=? AND item=? AND status IN ('pending','fulfilled')").bind(member.id,item.id).first();
      if(!order)throw new Error('Unable to create course order');
    }
    if(order.status==='fulfilled')return json({id:order.id,status:order.status});
    const attempt=await db.prepare('SELECT provider FROM payment_attempts WHERE order_id=?').bind(order.id).first();
    if(attempt?.provider!==data.provider)fail(409,'该课程已有待支付订单，请使用原支付方式完成付款');
    const details=data.provider==='wechat'?await createWechat(order,env,url.origin):data.provider==='alipay'?await createAlipay(order,env,url.origin,url.searchParams.get('lang')):await createStripe(order,env,url.origin,url.searchParams.get('lang'));
    return json({id:order.id,status:'pending',...details});
  }
  if(path==='/api/account/logout' && method==='POST') {
    const value=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)gs_account=([a-f0-9]+)/)?.[1]||'';
    if(value) await db.prepare('DELETE FROM member_sessions WHERE hash=?').bind(await digest(value)).run();
    return json({ok:true},200,{'Set-Cookie':memberCookie('',url,0)});
  }
  fail(404,'接口不存在');
}

export { accountApi, initializeAccounts, randomHex };
