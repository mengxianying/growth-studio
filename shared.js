export const isEnglish=document.documentElement.lang==='en';
export const labels=isEnglish?{project:'Project',article:'Note',course:'Course',product:'Product'}:{project:'项目',article:'笔记',course:'课程',product:'商品'};
export function escapeHtml(value='') {
  return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
export function money(cents) {
  return cents ? new Intl.NumberFormat(isEnglish?'en-GB':'zh-CN',{style:'currency',currency:'CNY'}).format(cents/100) : (isEnglish?'Free':'免费');
}
export async function api(path,options={}) {
  const url=new URL('/api/'+path,location.origin);
  if(isEnglish)url.searchParams.set('lang','en');
  const response=await fetch(url,options);
  const data=await response.json().catch(()=>({error:'服务暂时无法连接，请稍后重试'}));
  if(!response.ok || data.error) {
    const message=data.error||'请求失败';
    const fallback={400:'Check the form and try again.',401:'Please check your credentials and sign in.',403:'Access denied.',404:'This item could not be found.',409:'This record changed. Refresh and try again.',413:'The file or text is too large.',415:'Unsupported file type.',429:'Too many requests. Please try again later.'};
    throw Object.assign(new Error(isEnglish?(fallback[response.status]||'The service is temporarily unavailable. Please try again.'):message),{status:response.status});
  }
  return data;
}
export function post(path,data) {
  return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
}
