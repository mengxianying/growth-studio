import {api,post,escapeHtml as esc,money,labels,isEnglish} from './shared.js';
const $=s=>document.querySelector(s);
const names={dashboard:'工作概览',project:'项目管理',article:'文章管理',course:'课程管理',product:'商品管理',categories:'分类管理',orders:'订单与交付',settings:'关于工作室'};
const statusName={draft:'草稿',published:'已发布',pending:'待确认',fulfilled:'已交付',cancelled:'已取消'};
let state,section='dashboard';
const note=text=>{$('#message').textContent=text;};
const badge=value=>'<span class="badge '+(value==='published'||value==='fulfilled'?'on':'')+'">'+esc(statusName[value])+'</span>';
async function refresh(){
  state=await api('admin/state');
  $('#login').hidden=true;$('#workspace').hidden=false;
  render();
}
function handleError(error){note(error.message);if(error.status===401){$('#workspace').hidden=true;$('#login').hidden=false;$('#edit').close();}}
async function update(action,message){
  try{await action();await refresh();note(message);}
  catch(error){handleError(error);}
}
$('#login-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget;
  try{await post('login',{key:form.key.value});form.reset();await refresh();note('');}
  catch(error){handleError(error);}
};
$('#logout').onclick=async()=>{try{await post('admin/logout',{});location.reload();}catch(error){handleError(error);}};
$('#sections').onclick=e=>{const b=e.target.closest('button');if(b){section=b.dataset.section;note('');render();}};
const rows=items=>items.map(x=>`<div class="row"><div><small>${esc((isEnglish && state.categoryLabels[x.category])||x.category)}</small><strong>${esc((isEnglish && x.english?.title)||x.title)}</strong></div>${badge(x.status)}<button data-edit="${esc(x.id)}">编辑</button></div>`).join('')||'<p class="muted">此栏目暂无内容。</p>';
function render(){
  $('#sections').innerHTML=Object.entries(names).map(([k,v])=>`<button data-section="${k}" aria-current="${section===k?'page':'false'}">${v}</button>`).join('');
  let body='';
  const heading=`<div class="section-head"><h1>${names[section]}</h1>${labels[section]?'<button class="gold-button" id="new">＋ 新建'+labels[section]+'</button>':''}</div>`;
  if(section==='dashboard'){
    const metrics=[['已发布内容',state.items.filter(x=>x.status==='published').length],['待编辑草稿',state.items.filter(x=>x.status==='draft').length],['订单总数',state.metrics.total],['待核订单',state.metrics.pending],['已确认金额','¥'+(state.metrics.revenue/100).toFixed(2)]];
    body='<div class="metrics">'+metrics.map(([k,v])=>`<div><small>${k}</small><b>${v}</b></div>`).join('')+'</div><h2>最近更新</h2>'+rows(state.items.slice(0,6));
  }else if(labels[section])body=rows(state.items.filter(x=>x.kind===section));
  else if(section==='categories')body=`<form id="category-form" class="controls"><input name="name" maxlength="60" required aria-label="分类名称" placeholder="中文分类名称"><input name="label" maxlength="90" placeholder="英文分类名称" aria-label="英文分类名称"><button>保存分类</button></form>${state.categories.map(c=>`<div class="row"><strong>${esc(c)} · ${esc(state.categoryLabels[c]||"—")}</strong><span>${state.items.filter(x=>x.category===c).length} 篇内容</span></div>`).join('')}`;
  else if(section==='settings')body=`<form id="settings-form"><label>工作室介绍<textarea name="about" rows="7" required maxlength="4000">${esc(state.about)}</textarea></label><label>英文工作室介绍<textarea name="aboutEn" rows="5" maxlength="6000">${esc(state.aboutEn)}</textarea></label><button class="gold-button">保存介绍</button></form>`;
  else if(section==='orders')body=state.orders.map(x=>`<div class="row order-row"><div><small>${esc(x.id)} · ${esc(x.created)} UTC</small><strong>${esc(x.title)} · ${money(x.price)}</strong></div>${badge(x.status)}${x.status==='pending'?`<button data-order="${x.id}" data-status="fulfilled">确认收款并交付</button><button data-order="${x.id}" data-status="cancelled">取消订单</button>`:''}</div>`).join('')||'<p class="muted">尚无订单。读者领取手册或提交商品订单后会出现在这里。</p>';
  if(section==='orders') {
    const courseRows=state.courseOrders.map(x=>`<div class="row order-row"><div><small>${esc(x.id)} · ${esc(x.username)} · ${esc(x.provider||'免费')}</small><strong>${esc(x.title)} · ${money(x.price)}</strong></div>${badge(x.status)}</div>`).join('')||'<p class="muted">尚无课程订单。</p>';
    body='<h2>课程订单</h2>'+courseRows+'<h2>商品订单</h2>'+body;
  }
  $('#panel').innerHTML=heading+body;
  if($('#new'))$('#new').onclick=()=>edit({kind:section,status:'draft',gallery:'[]',price:0});
  if($('#category-form'))$('#category-form').onsubmit=e=>{e.preventDefault();update(()=>post('admin/category',{name:e.currentTarget.name.value,label:e.currentTarget.label.value}),'分类已保存');};
  if($('#settings-form'))$('#settings-form').onsubmit=e=>{e.preventDefault();update(()=>post('admin/settings',{about:e.currentTarget.about.value,aboutEn:e.currentTarget.aboutEn.value}),'工作室介绍已更新');};
}
$('#panel').onclick=e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.edit)edit(state.items.find(x=>x.id===b.dataset.edit));
  if(b.dataset.order && confirm(b.textContent+'？'))update(()=>post('admin/order',{id:b.dataset.order,status:b.dataset.status}),'订单状态已更新');
};
function edit(x){
  const isProduct=['product','course'].includes(x.kind),dialog=$('#edit');
  $('#editor').innerHTML=`<p class="overline">${labels[x.kind]}</p><h2>${x.id?'编辑':'新建'}${labels[x.kind]}</h2><form id="content-form">
    <label>标题<input name="title" required maxlength="120" value="${esc(x.title)}"></label>
    <div class="form-grid"><label>分类<select name="category">${state.categories.map(c=>`<option value="${esc(c)}" ${c===x.category?'selected':''}>${esc((isEnglish && state.categoryLabels[c])||c)}</option>`).join('')}</select></label>
    <label>发布状态<select name="status"><option value="draft">草稿</option><option value="published" ${x.status==='published'?'selected':''}>已发布</option></select></label></div>
    <label>简介<textarea name="summary" required maxlength="500" rows="2">${esc(x.summary)}</textarea></label>
    <label>封面地址<input name="cover" value="${esc(x.cover)}" placeholder="HTTPS 图片地址，或上传图片"></label>
    <label>上传封面（JPG / PNG，≤ 900 KB）<input type="file" data-upload="cover" accept="image/jpeg,image/png"></label>
    <label>${x.kind==='course'?'课程介绍（公开）':'正文'}<textarea name="body" maxlength="40000" rows="7">${esc(x.body)}</textarea></label>
    ${isProduct?`<label>售价（元）<input name="amount" type="number" min="0" max="1000000" step=".01" value="${(x.price||0)/100}" required></label>
    <label>商品相册（每行一张，最多八张）<textarea name="gallery" rows="3">${esc(JSON.parse(x.gallery||'[]').join('\n'))}</textarea></label><label>添加相册图片<input type="file" data-upload="gallery" accept="image/jpeg,image/png"></label>
    <label>交付内容（确认后可见）<textarea name="delivery" maxlength="20000" rows="4">${esc(x.delivery)}</textarea></label>
    <label>交付文件（PDF / ZIP，≤ 900 KB）<input type="file" data-upload="attachment" accept=".pdf,.zip"></label><input name="attachment" type="hidden" value="${esc(x.attachment)}"><small id="file-state">${x.attachment?'已关联交付文件':''}</small>`:''}
    <fieldset class="translation-fields"><legend>英文内容</legend>
    <label>英文标题<input name="enTitle" maxlength="160" value="${esc(x.english?.title)}"></label>
    <label>英文简介<textarea name="enSummary" rows="2" maxlength="800">${esc(x.english?.summary)}</textarea></label>
    <label>英文正文<textarea name="enBody" rows="6" maxlength="50000">${esc(x.english?.body)}</textarea></label>
    ${isProduct?`<label>英文交付内容<textarea name="enDelivery" rows="4" maxlength="30000">${esc(x.english?.delivery)}</textarea></label>`:''}</fieldset>
    <p id="edit-message" role="status"></p><button class="gold-button" type="submit">保存${labels[x.kind]}</button></form>`;
  dialog.showModal();
  const form=$('#content-form'),save=form.querySelector('[type=submit]');
  form.onchange=async e=>{
    const field=e.target.dataset.upload,file=e.target.files?.[0];
    if(!field||!file)return;
    const files=[...form.querySelectorAll('[type=file]')];files.forEach(input=>input.disabled=true);save.disabled=true;
    try{
      if(file.size>900000)throw new Error('文件超过 900 KB');
      const privateFile=field==='attachment';
      const mime=file.name.toLowerCase().endsWith('.zip')?'application/zip':file.type;
      const uploaded=await api('admin/media'+(privateFile?'?private=1':''),{method:'POST',headers:{'Content-Type':mime},body:file});
      if(field==='gallery')form.gallery.value=[form.gallery.value.trim(),uploaded.url].filter(Boolean).join('\n');
      else form.elements[field].value=privateFile?uploaded.id:uploaded.url;
      if(privateFile)$('#file-state').textContent=file.name;
      $('#edit-message').textContent='上传成功，保存后生效';
    }catch(error){$('#edit-message').textContent=error.message;}finally{files.forEach(input=>input.disabled=false);save.disabled=false;}
  };
  form.onsubmit=async e=>{
    e.preventDefault();save.disabled=true;
    const {enTitle,enSummary,enBody,enDelivery,...fields}=Object.fromEntries(new FormData(form));
    try{
      await post('admin/content',{...fields,english:{title:enTitle,summary:enSummary,body:enBody,delivery:enDelivery||''},id:x.id,kind:x.kind,price:Math.round(Number(fields.amount||0)*100),gallery:(fields.gallery||'').split('\n').map(s=>s.trim()).filter(Boolean)});
      dialog.close();await refresh();note('内容已保存');
    }catch(error){$('#edit-message').textContent=error.message;}finally{save.disabled=false;}
  };
}
$('.close').onclick=()=>$('#edit').close();
refresh().catch(error=>{if(error.status!==401)handleError(error);});
