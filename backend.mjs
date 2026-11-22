import seed from './seed.json' with {type:'json'};

const publicFields = 'id,kind,category,title,summary,body,cover,gallery,price,updated';
const kinds = ['project','article','course','product'];
const schema = [
  'CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, about TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY)',
  `CREATE TABLE IF NOT EXISTS contents (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL REFERENCES categories(name),
    title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, cover TEXT NOT NULL,
    gallery TEXT NOT NULL DEFAULT '[]', price INTEGER NOT NULL DEFAULT 0,
    delivery TEXT NOT NULL DEFAULT '', attachment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft', updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, item TEXT NOT NULL, title TEXT NOT NULL,
    price INTEGER NOT NULL, status TEXT NOT NULL, delivery TEXT NOT NULL, attachment TEXT NOT NULL,
    created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  'CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL, private INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)'
];
const ready = new WeakMap();
function initialize(db) {
  if (ready.has(db)) return ready.get(db);
  const setup = (async () => {
    try { if (await db.prepare('SELECT id FROM settings WHERE id=1').first()) return; }
    catch (error) { if (!String(error).includes('no such table')) throw error; }
    const statements = schema.map(s => db.prepare(s));
    statements.push(db.prepare('INSERT OR IGNORE INTO settings VALUES (1,?)').bind('生长计划记录独立创作者的项目、方法与作品。你可以从一个具体的问题出发，在这里找到工具、课程和可直接使用的手册。'));
    for (const category of new Set(seed.map(row => row.category))) statements.push(db.prepare('INSERT OR IGNORE INTO categories VALUES (?)').bind(category));
    for (const row of seed) {
      statements.push(db.prepare("INSERT OR IGNORE INTO contents(id,kind,category,title,summary,body,cover,price,delivery,status) VALUES (?,?,?,?,?,?,?,?,?,'published')").bind(row.id,row.kind,row.category,row.title,row.summary,row.body,row.cover,row.price,row.delivery || ''));
    }
    await db.batch(statements);
  })().catch(e => { ready.delete(db); throw e; });
  ready.set(db,setup);
  return setup;
}
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail = (status,message) => { throw new HttpError(status,message); };
const json = (value,status=200,headers={}) => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
}
function textField(value,max,required=false) {
  if (value == null) value='';
  if (typeof value!=='string' || value.length>max || (required && !value.trim())) fail(400,'请检查必填字段和文字长度');
  return value.trim();
}
async function payload(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) fail(415,'需要 JSON 数据');
  const raw=await req.text();
  if (raw.length>80000) fail(413,'内容过长');
  let data;
  try { data=JSON.parse(raw); } catch { fail(400,'数据格式错误'); }
  if (!data || typeof data!=='object' || Array.isArray(data)) fail(400,'数据格式错误');
  return data;
}
async function limit(db,req,action,max) {
  const window=Math.floor(Date.now()/600000);
  const key=await digest(action+':'+window+':'+(req.headers.get('CF-Connecting-IP')||'local'));
  const [_,res]=await db.batch([
    db.prepare('DELETE FROM rate_limits WHERE expires < ?').bind(window),
    db.prepare('INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(key,window)
  ]);
  if (res.results[0].count>max) fail(429,'操作频繁，请稍后再试');
}
const cookie='gs_admin';
function imagePath(value) {
  if (!value) return '';
  if (/^(desk|studio|notes|forest)\.jpg$|^\/api\/media\/[a-f0-9-]{36}$/.test(value)) return value;
  try { if (new URL(value).protocol==='https:') return value; } catch {}
  fail(400,'图片需要使用 HTTPS 地址或已上传的图片');
}
async function saveContent(db,data) {
  const id=data.id || crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !kinds.includes(data.kind) || !['draft','published'].includes(data.status)) fail(400,'无效的内容类型或发布状态');
  const category=textField(data.category,60,true);
  if (!await db.prepare('SELECT name FROM categories WHERE name=?').bind(category).first()) fail(400,'请选择已有分类');
  const price=data.kind==='product'?data.price:0;
  if (!Number.isSafeInteger(price)||price<0||price>100000000) fail(400,'金额超出范围');
  if (!Array.isArray(data.gallery)||data.gallery.length>8) fail(400,'相册最多支持八张图片');
  const attachment=textField(data.attachment,50);
  if(attachment && !await db.prepare('SELECT id FROM media WHERE id=? AND private=1').bind(attachment).first()) fail(400,'交付文件不存在');
  const fields=[id,data.kind,category,textField(data.title,120,true),textField(data.summary,500,true),textField(data.body,40000),imagePath(textField(data.cover,1800)),JSON.stringify(data.gallery.map(x=>imagePath(textField(x,1800,true)))),price,textField(data.delivery,20000),attachment,data.status];
  await db.prepare(`INSERT INTO contents(id,kind,category,title,summary,body,cover,gallery,price,delivery,attachment,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,category=excluded.category,title=excluded.title,summary=excluded.summary,body=excluded.body,cover=excluded.cover,gallery=excluded.gallery,price=excluded.price,delivery=excluded.delivery,attachment=excluded.attachment,status=excluded.status,updated=CURRENT_TIMESTAMP`).bind(...fields).run();
  return json({id});
}
async function upload(db,req,isPrivate) {
  const mime=(req.headers.get('content-type')||'').split(';')[0];
  const signatures={'image/jpeg':[255,216,255],'image/png':[137,80,78,71,13,10,26,10],'application/pdf':[37,80,68,70,45],'application/zip':[80,75,3,4]};
  if(!signatures[mime] || (isPrivate?mime.startsWith('image/'):!mime.startsWith('image/'))) fail(415,'请选择 JPG、PNG 图片或 PDF、ZIP 交付文件');
  if(Number(req.headers.get('content-length'))>900000) fail(413,'单个文件限 900 KB');
  const bytes=await req.arrayBuffer();
  if(bytes.byteLength>900000) fail(413,'单个文件限 900 KB');
  if(!signatures[mime].every((byte,i)=>new Uint8Array(bytes)[i]===byte)) fail(400,'文件类型与内容不匹配');
  const id=crypto.randomUUID();
  await db.prepare('INSERT INTO media VALUES (?,?,?,?)').bind(id,mime,bytes,+isPrivate).run();
  return json({id,url:'/api/media/'+id},201);
}
function fileResponse(row,download=false) {
  if(!row) fail(404,'文件不存在');
  const ext=row.mime==='application/pdf'?'pdf':'zip';
  return new Response(new Uint8Array(row.bytes),{headers:{'Content-Type':row.mime,'X-Content-Type-Options':'nosniff','Cache-Control':download?'no-store':'public, max-age=86400',...(download?{'Content-Disposition':'attachment; filename="delivery.'+ext+'"'}:{})}});
}
async function api(req,env) {
  const url=new URL(req.url), path=url.pathname, method=req.method;
  const db=env.DB;
  if (!db) fail(503,'数据库尚未连接');
  if(method!=='GET' && req.headers.get('origin') && req.headers.get('origin')!==url.origin) fail(403,'请求来源无效');
  await initialize(db);
  if(path==='/api/catalog' && method==='GET') {
    const [items,settings]=await db.batch([db.prepare('SELECT '+publicFields+" FROM contents WHERE status='published' ORDER BY updated DESC,rowid"),db.prepare('SELECT about FROM settings WHERE id=1')]);
    return json({items:items.results,about:settings.results[0].about});
  }
  if(path.startsWith('/api/media/') && method==='GET') return fileResponse(await db.prepare('SELECT mime,bytes FROM media WHERE id=? AND private=0').bind(path.split('/').pop()).first());
  if(path==='/api/orders' && method==='POST') {
    const data=await payload(req);
    const item=await db.prepare("SELECT * FROM contents WHERE id=? AND kind='product' AND status='published'").bind(textField(data.item,64,true)).first();
    if(!item) fail(404,'商品已下架');
    await limit(db,req,'order',25);
    const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID();
    await db.prepare('INSERT INTO orders(id,token_hash,item,title,price,status,delivery,attachment) VALUES (?,?,?,?,?,?,?,?)').bind(id,await digest(token),item.id,item.title,item.price,item.price?'pending':'fulfilled',item.delivery,item.attachment).run();
    return json({id,token},201);
  }
  if(path.startsWith('/api/orders/') && method==='GET') {
    const parts=path.split('/');
    const token=req.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
    const order=await db.prepare('SELECT * FROM orders WHERE id=? AND token_hash=?').bind(parts[3],await digest(token)).first();
    if(!order) fail(404,'订单不存在或查询凭证无效');
    const released=order.status==='fulfilled';
    if(parts[4]==='file') {
      if(!released) fail(403,'订单尚未确认');
      return fileResponse(await db.prepare('SELECT mime,bytes FROM media WHERE id=? AND private=1').bind(order.attachment).first(),true);
    }
    return json({id:order.id,title:order.title,price:order.price,status:order.status,delivery:released?order.delivery:'',file:released&&Boolean(order.attachment)});
  }
  if(path==='/api/login' && method==='POST') {
    const {key}=await payload(req);
    await limit(db,req,'login',25);
    if(!env.ADMIN_KEY_SHA256 || await digest(textField(key,200,true))!==env.ADMIN_KEY_SHA256) fail(401,'管理密钥不正确');
    const session=crypto.randomUUID()+crypto.randomUUID();
    await db.batch([db.prepare('DELETE FROM sessions WHERE expires<=?').bind(Date.now()),db.prepare('INSERT INTO sessions VALUES (?,?)').bind(await digest(session),Date.now()+8*3600000)]);
    return json({ok:true},200,{'Set-Cookie':cookie+'='+session+'; Path=/api; HttpOnly; SameSite=Strict; Max-Age=28800'+(url.protocol==='https:'?'; Secure':'')});
  }
  if(!path.startsWith('/api/admin/')) fail(404,'接口不存在');
  const session=(req.headers.get('Cookie')||'').match(/(?:^|;\s*)gs_admin=([a-z0-9-]+)/)?.[1]||'';
  const hash=await digest(session);
  if(!session || !await db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').bind(hash,Date.now()).first()) fail(401,'请登录管理后台');
  if(path==='/api/admin/logout' && method==='POST') {
    await db.prepare('DELETE FROM sessions WHERE hash=?').bind(hash).run();
    return json({ok:true},200,{'Set-Cookie':cookie+'=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0'});
  }
  if(path==='/api/admin/state' && method==='GET') {
    const [items,categories,orders,settings,metrics]=await db.batch(['SELECT * FROM contents ORDER BY updated DESC,rowid','SELECT name FROM categories ORDER BY name','SELECT id,title,price,status,created FROM orders ORDER BY created DESC,rowid DESC LIMIT 250','SELECT about FROM settings WHERE id=1',"SELECT COUNT(*) AS total, COUNT(CASE WHEN status='pending' THEN 1 END) AS pending, COALESCE(SUM(CASE WHEN status='fulfilled' THEN price END),0) AS revenue FROM orders"].map(s=>db.prepare(s)));
    return json({items:items.results,categories:categories.results.map(x=>x.name),orders:orders.results,about:settings.results[0].about,metrics:metrics.results[0]});
  }
  if(path==='/api/admin/content' && method==='POST') return saveContent(db,await payload(req));
  if(path==='/api/admin/category' && method==='POST') {
    const {name}=await payload(req);
    await db.prepare('INSERT OR IGNORE INTO categories VALUES (?)').bind(textField(name,60,true)).run();
    return json({ok:true});
  }
  if(path==='/api/admin/settings' && method==='POST') {
    const data=await payload(req);
    await db.prepare('UPDATE settings SET about=? WHERE id=1').bind(textField(data.about,4000,true)).run();
    return json({ok:true});
  }
  if(path==='/api/admin/media' && method==='POST') return upload(db,req,url.searchParams.get('private')==='1');
  if(path==='/api/admin/order' && method==='POST') {
    const data=await payload(req);
    if(!['fulfilled','cancelled'].includes(data.status)) fail(400,'订单状态无效');
    const result=await db.prepare("UPDATE orders SET status=? WHERE id=? AND status='pending'").bind(data.status,textField(data.id,64,true)).run();
    if(!result.meta.changes) fail(409,'订单状态已改变，请刷新');
    return json({ok:true});
  }
  fail(404,'接口不存在');
}
export default {
  async fetch(request,env) {
    if(!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {return await api(request,env);} catch(error) {
      if(!error.status) console.error(String(error));
      return json({error:error.status?error.message:'暂时无法读取数据，请稍后重试'},error.status||500);
    }
  }
};
