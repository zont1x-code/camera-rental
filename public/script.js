// ====== 公用脚本 ======
var currentUser=null;
// 从 localStorage 恢复登录态
var savedToken=localStorage.getItem('userToken');
if(savedToken){try{currentUser=JSON.parse(savedToken)}catch(e){}}

function getCookie(name){var m=document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)'));return m?decodeURIComponent(m[2]):null}
function setCookie(name,value,days){var d=new Date();d.setTime(d.getTime()+days*86400000);document.cookie=name+'='+encodeURIComponent(value)+';expires='+d.toUTCString()+';path=/'}

function showToast(msg,type){var t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.className='toast '+type;t.style.display='block';setTimeout(function(){t.style.display='none'},3000)}

async function api(url,opts){var r=await fetch(url,opts);var d=await r.json();if(!r.ok)throw new Error(d.error||'请求失败');return d}

function formatDate(iso){var d=new Date(iso);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function pad(n){return n<10?'0'+n:''+n}
function esc(str){var div=document.createElement('div');div.textContent=str||'';return div.innerHTML}

// ====== 鉴权重定向 ======
function requireLogin(){
  if(!currentUser){var back=encodeURIComponent(location.href);location.href='/login.html?back='+back;return false}
  return true
}
// login.html 回调
(function(){var m=location.search.match(/[?&]back=([^&]+)/);if(m&&localStorage.getItem('userToken'))location.replace(decodeURIComponent(m[1]))})();

// ====== 隐私协议 ======
async function checkPrivacy(){if(getCookie('privacy_agreed')==='1')return true;try{var data=await api('/api/privacy');var overlay=document.createElement('div');overlay.className='privacy-overlay';overlay.innerHTML='<div class="privacy-box"><h2>隐私协议</h2><div class="privacy-content">'+esc(data.content)+'</div><div class="privacy-actions"><button class="btn btn-primary" id="privacyAgree">同意并继续</button><button class="btn btn-outline" id="privacyReject">不同意</button></div></div>';document.body.appendChild(overlay);return new Promise(function(resolve){document.getElementById('privacyAgree').onclick=function(){setCookie('privacy_agreed','1',30);overlay.remove();resolve(true)};document.getElementById('privacyReject').onclick=function(){alert('您需要同意隐私协议才能使用本平台。');resolve(false)}})}catch(e){return true}}

// ====== 底部标签栏 ======
var TAB_ICONS={index:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',discover:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',mybookings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/></svg>'};
var TAB_LABELS={index:'首页',discover:'发现',mybookings:'我的'};

function renderTabBar(page){var tabs=['index','discover','mybookings'];var html=tabs.map(function(k){var cls=k===page?' active':'';return '<a href="/'+(k==='index'?'book.html':k==='discover'?'discover.html':'my-bookings.html')+'" class="tab-bar-item'+cls+'">'+TAB_ICONS[k]+'<span class="tab-label">'+TAB_LABELS[k]+'</span></a>'}).join('');var bar=document.createElement('nav');bar.className='tab-bar';bar.innerHTML=html;document.body.appendChild(bar)}

function renderHeader(page){
  var userHTML='';
  if(currentUser){userHTML='<a href="/my-bookings.html" class="user-phone" style="text-decoration:none;">'+currentUser.username+'</a>'}
  else{userHTML='<a href="/login.html" class="login-btn" style="text-decoration:none;">登录</a>'}
  var header=document.createElement('header');header.className='page-header';
  header.innerHTML='<a href="/index.html" class="logo"><span style="color:#FF6B35;">春</span><span style="font-weight:400;color:#FF6B35;">叶</span><span style="background:linear-gradient(135deg,#FF6B35,#FF9500);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">棠</span><span style="font-size:0.45em;font-weight:400;letter-spacing:.2em;opacity:.5;margin-left:6px;">CAMERA RENTAL</span></a><div class="user-area">'+userHTML+'</div>';
  document.body.insertBefore(header,document.body.firstChild);
}

function updateHeaderUser(){var area=document.querySelector('.user-area');if(area&&currentUser){area.innerHTML='<span class="user-phone">'+currentUser.username+'</span>'}}

// ====== 图片灯箱 ======
document.addEventListener('click',function(e){
  var img=e.target.closest('.gallery img,.post-card img,.camera-detail-item img');
  if(!img||!img.src||img.src.startsWith('data:'))return;
  var overlay=document.createElement('div');overlay.className='lightbox-overlay';
  var close=document.createElement('button');close.className='lightbox-close';close.innerHTML='&times;';
  var big=document.createElement('img');big.src=img.src;
  overlay.appendChild(big);overlay.appendChild(close);document.body.appendChild(overlay);
  function closeLb(){overlay.remove();document.body.style.overflow=''}
  close.onclick=closeLb;overlay.onclick=function(e2){if(e2.target===overlay)closeLb()};
  document.addEventListener('keydown',function esc(e3){if(e3.key==='Escape'){closeLb();document.removeEventListener('keydown',esc)}});
  document.body.style.overflow='hidden';
});

// ====== Header scroll ======
window.addEventListener('scroll',function(){var h=document.querySelector('.page-header');if(h)h.classList.toggle('scrolled',window.scrollY>50)});

// ====== 初始化 ======
async function initApp(page){renderHeader(page);renderTabBar(page);var agreed=await checkPrivacy();if(!agreed)return}
