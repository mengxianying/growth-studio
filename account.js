import {api,post,escapeHtml as esc,isEnglish} from './shared.js';

const en=isEnglish;
const text=(zh,english)=>en?english:zh;
const dialog=document.querySelector('#account-dialog');
const panel=document.querySelector('#account-panel');
const button=document.querySelector('#account-button');
let member=null;
let afterLogin=null;

function showAccount(mode='login',message='') {
  const registration=mode==='register';
  panel.innerHTML=`<p class="overline">GROWTH STUDIO</p><h2>${registration?text('创建账户','Create an account'):text('欢迎回来','Welcome back')}</h2>
    <p class="account-hint">${registration?text('使用邮箱注册，开启你的成长旅程。','Register with your email to begin.') : text('登录后管理你的课程。','Sign in to manage your courses.')}</p>
    <form id="account-form">
    ${registration?`<label>${text('账户类型','Account type')}<select name="accountType"><option value="opc">${text('一人公司 / OPC','One-person company / OPC')}</option><option value="company">${text('公司','Company')}</option></select></label>
    <label>${text('用户名','Username')}<input name="username" required minlength="2" maxlength="32" autocomplete="username"></label>
    <label>${text('邮箱','Email')}<input name="email" required type="email" maxlength="254" autocomplete="email"></label>
    <div class="verification-row"><label>${text('邮箱验证码','Email verification code')}<input name="code" required pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><button type="button" id="send-code">${text('发送验证码','Send code')}</button></div>`:
    `<label>${text('用户名或邮箱','Username or email')}<input name="identity" required maxlength="254" autocomplete="username"></label>`}
    <label>${text('密码','Password')}<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${registration?'new-password':'current-password'}"></label>
    ${registration?`<p class="account-hint">${text('密码至少 10 个字符。','Use at least 10 characters.')}</p>`:''}
    <p id="account-message" role="status"></p>
    <button class="gold-button" type="submit">${registration?text('注册并登录','Create account'):text('登录','Sign in')}</button>
    </form><button type="button" class="account-switch" id="account-mode">${registration?text('已有账户？登录','Already have an account? Sign in'):text('还没有账户？注册','New here? Create an account')}</button>`;
  if(!dialog.open)dialog.showModal();
  panel.querySelector('#account-message').textContent=message;
  panel.querySelector('#account-mode').onclick=()=>showAccount(registration?'login':'register');
  const form=panel.querySelector('form'),messageEl=panel.querySelector('#account-message');
  if(registration)panel.querySelector('#send-code').onclick=async e=>{
    if(!form.email.reportValidity())return;
    e.currentTarget.disabled=true;
    try {
      await post('account/send-code',{email:form.email.value});
      messageEl.textContent=text('验证码已发送，请检查邮箱。','Code sent. Please check your email.');
    } catch(error) {messageEl.textContent=error.message;}
    finally {e.currentTarget.disabled=false;}
  };
  form.onsubmit=async e=>{
    e.preventDefault();
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const data=Object.fromEntries(new FormData(form));
      const result=await post('account/'+(registration?'register':'login'),data);
      member=result.member;renderButton();const action=afterLogin;afterLogin=null;dialog.close();
      if(action)await action();
    } catch(error){messageEl.textContent=error.message;} finally {submit.disabled=false;}
  };
}
function renderButton() { button.textContent=member?member.username:text('登录 / 注册','Sign in'); }
function showProfile(){
  panel.innerHTML=`<p class="overline">GROWTH STUDIO</p><h2>${esc(member.username)}</h2><p class="account-hint">${esc(member.email)} · ${member.account_type==='opc'?text('一人公司 / OPC','One-person company / OPC'):text('公司','Company')}</p><div id="my-courses"><p>${text('正在读取课程…','Loading your courses…')}</p></div><button type="button" id="account-logout">${text('退出登录','Sign out')}</button>`;
  if(!dialog.open)dialog.showModal();
  panel.querySelector('#account-logout').onclick=async()=>{await post('account/logout',{});member=null;renderButton();dialog.close();};
  loadMyCourses();
}
async function loadMyCourses(){
  const container=panel.querySelector('#my-courses');
  try {
    const {orders}=await api('account/courses');
    container.innerHTML='<h3>'+text('我的课程','My courses')+'</h3>'+(orders.map(order=>order.status==='fulfilled'?`<button class="account-course" data-course-order="${esc(order.id)}">${esc(order.title)} <span>↗</span></button>`:`<p class="account-hint">${esc(order.title)} · ${text('等待支付确认，请返回课程页面继续付款。','Awaiting payment. Return to the course to continue.')}</p>`).join('')||'<p class="account-hint">'+text('你还没有已获得的课程。','You have no courses yet.')+'</p>');
    container.querySelectorAll('[data-course-order]').forEach(b=>b.onclick=async()=>{
      try {
        const result=await api('account/courses/'+encodeURIComponent(b.dataset.courseOrder));
        container.innerHTML=`<h3>${esc(result.title)}</h3><div class="prose">${esc(result.delivery||text('课程内容即将更新。','Course materials are coming soon.'))}</div>${result.file?'<a class="gold-button" href="/api/account/courses/'+esc(result.id)+'/file">'+text('下载课程资料','Download materials')+' ↓</a>':''}<p><button type="button" id="back-courses">${text('返回我的课程','Back to my courses')}</button></p>`;
        container.querySelector('#back-courses').onclick=loadMyCourses;
      }catch(error){container.textContent=error.message;}
    });
  }catch(error){container.textContent=error.message;}
}
button.onclick=()=>member?showProfile():showAccount();
dialog.querySelector('.close').onclick=()=>{afterLogin=null;dialog.close();};
dialog.addEventListener('cancel',()=>{afterLogin=null;});
dialog.addEventListener('click',e=>{if(e.target===dialog){afterLogin=null;dialog.close();}});
try{member=(await api('account/me')).member;renderButton();}catch{renderButton();}
export function requireMember(action){if(member)return action();afterLogin=action;showAccount('login',text('请先登录后继续。','Sign in to continue.'));}
export function showMemberCourses(){if(member)showProfile();else requireMember(showProfile);}
