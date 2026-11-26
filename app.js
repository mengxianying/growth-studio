import {requireMember,showMemberCourses} from './account.js';
import {labels,escapeHtml as esc,money,api,post,isEnglish} from './shared.js';
const $=s=>document.querySelector(s);
let items=[];
const reader=$('#reader');
const link=x=>'#read/'+encodeURIComponent(x.id);
function photo(x){return '<img loading="lazy" src="'+esc(x.cover||'desk.jpg')+'" alt="">'}
function renderCatalog(){
  const projects=items.filter(x=>x.kind==='project');
  $('#project-list').innerHTML=projects.slice(0,3).map(x=>`<a class="project-card" href="${link(x)}"><figure>${photo(x)}</figure><small>${esc(x.category)}</small><h3>${esc(x.title)} <b>↗</b></h3><p>${esc(x.summary)}</p></a>`).join('')||'暂无已发布项目';
  $('#article-list').innerHTML=items.filter(x=>x.kind==='article').map(x=>`<a href="${link(x)}"><small>${esc(x.category)}</small><h3>${esc(x.title)}</h3><span>↗</span></a>`).join('')||'暂无笔记';
  $('#resource-list').innerHTML=items.filter(x=>['course','product'].includes(x.kind)).map(x=>`<a class="resource" href="${link(x)}">${photo(x)}<div><small>${labels[x.kind]}</small><h3>${esc(x.title)}</h3><p>${esc(x.summary)}</p><b>${x.kind==='course'?money(x.price)+' · 查看课程':money(x.price)+' · 查看手册'} ↗</b></div></a>`).join('')||'暂无课程与手册';
  $('#category').innerHTML='<option value="">全部分类</option>'+[...new Set(items.map(x=>x.category))].map(c=>'<option>'+esc(c)+'</option>').join('');
  search();
}
function search(){
  const q=$('#query').value.trim().toLowerCase();
  const found=items.filter(x=>(!$('#kind').value||x.kind===$('#kind').value)&&(!$('#category').value||x.category===$('#category').value)&&(x.title+x.summary+x.category).toLowerCase().includes(q));
  $('#matches').innerHTML=found.map(x=>`<a href="${link(x)}"><small>${labels[x.kind]}</small><strong>${esc(x.title)}</strong><span>↗</span></a>`).join('')||'<p>没有匹配的内容，请调整筛选条件。</p>';
}
function openReader(html){$('#detail').innerHTML=html;if(!reader.open)reader.showModal();reader.scrollTop=0}
function readItem(x){
  const gallery=JSON.parse(x.gallery||'[]');
  openReader(`<small>${labels[x.kind]}　/　${esc(x.category)}</small><h2>${esc(x.title)}</h2><p class="lead">${esc(x.summary)}</p>${photo(x)}<div class="prose">${esc(x.body)}</div>${gallery.map(url=>'<img loading="lazy" alt="相册图片" src="'+esc(url)+'">').join('')}${x.kind==='course'?'<div id="course-purchase"></div>':''}${x.kind==='product'?'<button class="gold-button" id="order">'+(x.price?'提交订单 · '+money(x.price):'免费领取手册')+'</button><p id="order-msg" role="status">'+(x.price?'提交后由工作室线下核款，并在订单页开放交付。':'')+'</p>':''}`);
  if(x.kind==='course') {
    const area=$('#course-purchase'),en=isEnglish;
    area.innerHTML='<p><strong>'+money(x.price)+'</strong></p>'+(x.price?'<div class="payment-buttons"><button class="gold-button" data-pay="wechat">'+(en?'WeChat Pay':'微信支付')+'</button><button class="gold-button" data-pay="alipay">'+(en?'Alipay':'支付宝')+'</button><button class="gold-button" data-pay="stripe">'+(en?'Card / Stripe':'银行卡 / Stripe')+'</button></div>':'<button class="gold-button" data-pay="free">'+(en?'Get course':'免费学习')+'</button>')+'<p id="course-message" role="status"></p><div id="payment-qr"></div><button type="button" id="open-courses">'+(en?'My courses':'我的课程')+'</button>';
    area.querySelectorAll('[data-pay]').forEach(button=>button.onclick=()=>requireMember(async()=>{
      const message=$('#course-message'),buttons=area.querySelectorAll('[data-pay]');
      buttons.forEach(b=>b.disabled=true);
      try {
        const result=await post('account/course-order',{item:x.id,provider:button.dataset.pay});
        if(result.status==='fulfilled'){showMemberCourses();return;}
        if(result.url){location.href=result.url;return;}
        if(result.qr){
          const qr=window.qrcode(0,'M');qr.addData(result.qr);qr.make();
          $('#payment-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:8});
          message.textContent=en?'Scan with WeChat to pay. Your course opens after payment confirmation.':'请使用微信扫码付款，支付确认后课程会自动开通。';
          const refresh=async()=>{
            if(!reader.open || !document.querySelector('#course-message'))return;
            try{const {orders}=await api('account/courses');if(orders.some(order=>order.id===result.id&&order.status==='fulfilled')){message.textContent=en?'Payment confirmed. Your course is ready.':'付款已确认，课程已开通。';$('#payment-qr').innerHTML='';return;}}catch{}
            setTimeout(refresh,5000);
          };
          setTimeout(refresh,5000);
        }
      }catch(error){message.textContent=error.message;}
      finally{buttons.forEach(b=>b.disabled=false);}
    }));
    $('#open-courses').onclick=()=>requireMember(showMemberCourses);
  }
  if(x.kind==='product')$('#order').onclick=async e=>{
    e.currentTarget.disabled=true;
    try {const {id,token}=await post('orders',{item:x.id});location.hash='order/'+id+'/'+token;}
    catch(error){$('#order-msg').textContent=error.message;$('#order').disabled=false;}
  };
}
async function readOrder(id,token){
  const headers={Authorization:'Bearer '+token};
  const order=await api('orders/'+id,{headers});
  const status={fulfilled:'已交付',pending:'待工作室确认',cancelled:'已取消'}[order.status];
  openReader(`<small>订单　/　${status}</small><h2>${esc(order.title)}</h2><p>${money(order.price)} · ${esc(order.id)}</p><p>请收藏此页。链接内的凭证可查询订单和打开交付内容，请自行保管。</p><div class="prose">${esc(order.delivery)}</div>${order.file?'<button id="download" class="gold-button">下载文件 ↓</button>':''}`);
  if(order.file)$('#download').onclick=async()=>{
    const res=await fetch('/api/orders/'+id+'/file',{headers});
    if(!res.ok)return openReader('<p>文件暂不可用，请刷新订单重试。</p>');
    const blob=await res.blob(),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=blob.type==='application/pdf'?'手册.pdf':'资料.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
}
async function route(){
  const [view,id,token]=location.hash.slice(1).split('/');
  try{
    if(view==='my-courses'){requireMember(showMemberCourses);return;}
    if(view==='order')return await readOrder(id,token);
    if(view==='read'){const x=items.find(item=>item.id===id);return x?readItem(x):openReader('<p>此内容已下架。</p>');}
    if(reader.open)reader.close();
  }catch(error){openReader('<p>'+esc(error.message)+'</p>');}
}
function closeReader(){if(reader.open)reader.close();if(/^#(read|order)\//.test(location.hash))history.replaceState(null,'',location.pathname+location.search);}
$('.close').onclick=closeReader;
reader.addEventListener('cancel',closeReader);
reader.addEventListener('click',e=>{if(e.target===reader)closeReader()});
for(const id of ['#query','#kind','#category'])$(id).addEventListener('input',search);
addEventListener('hashchange',route);
try {const data=await api('catalog');items=data.items;$('#about').textContent=data.about;renderCatalog();await route();}
catch(error){$('#project-list').textContent=error.message+'。刷新页面可重试。';}
