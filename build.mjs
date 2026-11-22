// Build only the public assets and the server-side Pages entry point.
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve(process.argv[2] || 'dist');
await mkdir(out,{recursive:true});
const files=['index.html','admin.html','style.css','app.js','admin.js','shared.js','desk.jpg','notes.jpg','studio.jpg','forest.jpg'];
for(const file of files) await copyFile(file,resolve(out,file));
const seed=await readFile('seed.json','utf8');
let worker=(await readFile('backend.mjs','utf8')).replace(/^import seed [^\n]+/,()=> 'const seed = '+seed+';');
const hash=process.env.ADMIN_KEY_SHA256;
if(hash) {
  if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Expected a SHA-256 hex digest');
  worker=worker.replace('return await api(request,env);','return await api(request,{DB:env.DB,ADMIN_KEY_SHA256:env.ADMIN_KEY_SHA256 || "'+hash+'"});');
}
await writeFile(resolve(out,'_worker.js'),worker);
await writeFile(resolve(out,'_routes.json'),JSON.stringify({version:1,include:['/api/*'],exclude:[]}));
