export const labels={project:'项目',article:'笔记',course:'课程',product:'商品'};
export function escapeHtml(value='') {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
export function money(cents) {
  return cents ? new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100) : '免费';
}
export async function api(path,options={}) {
  const response=await fetch('/api/'+path,options);
  const data=await response.json().catch(()=>({error:'服务暂时无法连接，请稍后重试'}));
  if(!response.ok || data.error) throw Object.assign(new Error(data.error||'请求失败'),{status:response.status});
  return data;
}
export function post(path,data) {
  return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
