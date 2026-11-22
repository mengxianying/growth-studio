// Build only the public assets and the server-side Pages entry point.
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(process.argv[2] || 'dist');
await mkdir(out,{recursive:true});
const files=['index.html','admin.html','style.css','app.js','admin.js','shared.js','language.js','desk.jpg','notes.jpg','studio.jpg','forest.jpg','seedling.jpg'];
for(const file of files) await copyFile(file,resolve(out,file));
const seed=await readFile('seed.json','utf8');
let worker=(await readFile('backend.mjs','utf8')).replace(/^import seed [^\n]+/,()=> 'const seed = '+seed+';');
const english=await readFile('english.json','utf8');
worker=worker.replace(/^import english [^\n]+/m,()=> 'const english = '+english+';');
const hash=process.env.ADMIN_KEY_SHA256;
if(hash) {
  if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Expected a SHA-256 hex digest');
  worker=worker.replace('return await api(request,env);','return await api(request,{DB:env.DB,ADMIN_KEY_SHA256:env.ADMIN_KEY_SHA256 || "'+hash+'"});');
}
await writeFile(resolve(out,'_worker.js'),worker);
await writeFile(resolve(out,'_routes.json'),JSON.stringify({version:1,include:['/api/*'],exclude:[]}));

// Translate the interface at build time. Database content and editor input are never rewritten.
const copy=JSON.parse(await readFile('interface-en.json','utf8'));
const escapePattern=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const phrases=new RegExp(Object.keys(copy).sort((a,b)=>b.length-a.length).map(escapePattern).join('|'),'g');
for (const [source,target] of [['index.html','en.html'],['admin.html','admin-en.html'],['app.js','app.en.js'],['admin.js','admin.en.js']]) {
  let result=(await readFile(source,'utf8')).replace(phrases,phrase=>copy[phrase]);
  if (source.endsWith('.html')) {
    result=result.replace('<html lang="zh-CN">','<html lang="en">')
      .replace('src="app.js"','src="app.en.js"').replace('src="admin.js"','src="admin.en.js"')
      .replace('href="admin.html"','href="/admin-en"').replaceAll('href="./"','href="/en"')
      .replaceAll('href="?lang=en" lang="en" hreflang="en">English','href="?lang=zh" lang="zh-CN" hreflang="zh-CN">中文');
  }
  await writeFile(resolve(out,target),result);
}
