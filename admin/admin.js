// 鉴权
var adminToken = localStorage.getItem('adminToken');
if (!adminToken) { window.location.href = '/admin/login.html'; }
function logout() { localStorage.removeItem('adminToken'); localStorage.removeItem('adminRole'); localStorage.removeItem('adminUser'); window.location.href = '/admin/login.html'; }

// 心跳（每30秒）
setInterval(function() {
  var u = localStorage.getItem('adminUser') || '';
  fetch('/admin/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: adminToken, username: u }) }).catch(function() {});
}, 30000);

// 操作日志上报（全局）
function logAction(action, target, detail) {
  var u = localStorage.getItem('adminUser') || 'unknown';
  fetch('/admin/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, action: action, target: target || '', detail: detail || '' }) }).catch(function() {});
}

// --- 工具 ---
function api(url, opts) {
  return fetch(url, opts).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || '请求失败'); return d; }); });
}
function esc(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function fmtDate(iso) {
  if (!iso) return '-';
  var d = new Date(iso);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }

var statusLabels = {
  pending: '待确认', confirmed: '已确认', renting: '租赁中',
  completed: '已完成', renew_pending: '续约待确认', cancelled: '已取消'
};

// ========== Tab 切换 ==========
document.querySelectorAll('.sidebar-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.sidebar-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'cameras') loadCamerasTab();
    if (btn.dataset.tab === 'users') loadUsersTab();
    if (btn.dataset.tab === 'archive') loadArchive();
    if (btn.dataset.tab === 'calendar') loadCalendarTab();
    if (btn.dataset.tab === 'review') loadPosts();
    if (btn.dataset.tab === 'announcements') loadAnnouncements();
    if (btn.dataset.tab === 'featured') loadFeatured();
    if (btn.dataset.tab === 'hero') loadHero();
    if (btn.dataset.tab === 'privacy') loadPrivacy();
  });
});

// ========== 订单管理 ==========
var allBookings = [];

async function loadBookings(status) {
  var url = '/admin/api/bookings';
  if (status === 'all') { /* no filter */ }
  else if (status) url += '?status=' + status;
  else url += '?exclude=completed,cancelled';
  allBookings = await api(url);
  renderBookingsTable(allBookings);
  updateStats();
}

function updateStats(){
  var today=new Date().toISOString().split('T')[0];
  document.getElementById('statPending').textContent=allBookings.filter(function(b){return b.status==='pending'||b.status==='renew_pending'}).length;
  document.getElementById('statRenting').textContent=allBookings.filter(function(b){return b.status==='renting'}).length;
  document.getElementById('statToday').textContent=allBookings.filter(function(b){return b.startDate===today}).length;
}

function doSearch(){
  var q=document.getElementById('searchInput').value.trim().toLowerCase();
  var filtered=q?allBookings.filter(function(b){return (b.name||'').toLowerCase().indexOf(q)>=0||(b.phone||'').indexOf(q)>=0}):allBookings;
  renderBookingsTable(filtered);
}

function renderBookingsTable(bookings) {
  var tbody = document.getElementById('bookingsTable');
  if (bookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;">暂无数据</td></tr>';
    return;
  }
  tbody.innerHTML = bookings.map(function (b) {
    var today = new Date().toISOString().split('T')[0];
    var tomorrow = new Date(Date.now()+86400000).toISOString().split('T')[0];
    var rowCls = 'row-' + (b.status || 'pending');
    if (b.status==='renting' && b.endDate < today) rowCls += ' row-overdue';
    if (b.startDate === today) rowCls += ' row-today';
    else if (b.startDate === tomorrow) rowCls += ' row-tomorrow';
    var hasRenew = b.renewRequest && b.renewRequest.status === 'pending';
    var renewHTML = '';
    if (hasRenew) {
      renewHTML = '<span style="font-size:0.8rem;color:var(--yellow);">续约申请</span>' +
        '<br><button class="btn btn-sm" style="background:#27ae60;color:#fff;padding:2px 8px;font-size:0.75rem;margin-top:2px;" onclick="approveRenew(' + b.id + ')">通过</button>' +
        '<button class="btn btn-sm" style="background:#e74c3c;color:#fff;padding:2px 8px;font-size:0.75rem;margin-top:2px;margin-left:2px;" onclick="rejectRenew(' + b.id + ')">拒绝</button>';
    }

    var statusOpts = ['pending', 'confirmed', 'renting', 'completed', 'cancelled'].map(function (s) {
      return '<option value="' + s + '"' + (b.status === s ? ' selected' : '') + '>' + statusLabels[s] + '</option>';
    }).join('');

    return '<tr class="' + rowCls + '">' +
      '<td>' + b.id + '</td>' +
      '<td>' + esc(b.cameraModel) + '</td>' +
      '<td>' + esc(b.name) + '</td>' +
      '<td>' + esc(b.phone || '-') + '</td>' +
      '<td>' + esc(b.school) + '</td>' +
      '<td>' + b.startDate + '</td>' +
      '<td>' + b.endDate + '</td>' +
      '<td><select onchange="changeStatus(' + b.id + ', this.value)">' + statusOpts + '</select></td>' +
      '<td>' + renewHTML + '</td>' +
      '<td><button class="delete-btn" onclick="deleteBooking(' + b.id + ')">删除</button></td>' +
      '</tr>';
  });
}

async function changeStatus(id, status) {
  try {
    await api('/admin/api/bookings/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    });
    logAction('改状态','订单#'+id,status);
    loadBookings(document.getElementById('statusFilter').value);
    logAction('改状态', '订单ID:'+id, '→'+status);
  } catch (e) { alert(e.message); }
}

async function deleteBooking(id) {
  if (!confirm('确定要删除该预约吗？')) return;
  try {
    await fetch('/admin/api/bookings/' + id, { method: 'DELETE' });
    logAction('删除','订单#'+id);loadBookings(document.getElementById('statusFilter').value);
    logAction('删除订单', 'ID:'+id, '');
  } catch (e) { alert(e.message); }
}

async function approveRenew(id) {
  if (!confirm('确定通过续约申请吗？')) return;
  try {
    await api('/admin/api/renew/' + id + '/approve', { method: 'PUT' });
    loadBookings(document.getElementById('statusFilter').value);
    logAction('通过续约', '订单ID:'+id, '');
  } catch (e) { alert(e.message); }
}

async function rejectRenew(id) {
  if (!confirm('确定拒绝续约申请吗？')) return;
  try {
    await api('/admin/api/renew/' + id + '/reject', { method: 'PUT' });
    loadBookings(document.getElementById('statusFilter').value);
  } catch (e) { alert(e.message); }
}

document.getElementById('statusFilter').addEventListener('change', function () {
  loadBookings(this.value);
});

function exportCSV() {
  var rows = allBookings.map(function (b) {
    return [b.id, b.cameraModel, b.name, b.phone, b.school, b.startDate, b.endDate, statusLabels[b.status] || b.status, b.createdAt];
  });
  var header = ['ID', '相机型号', '预约人', '手机号', '地址/学校', '起始日期', '结束日期', '状态', '提交时间'];
  var csv = [header].concat(rows).map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bookings.csv';
  a.click();
}

// ========== 内容审核 ==========
var allPosts = [];

async function loadPosts(status) {
  var url = '/admin/api/posts';
  if (status) url += '?status=' + status;
  allPosts = await api(url);
  renderPostsTable(allPosts);
}

function renderPostsTable(posts) {
  var tbody = document.getElementById('postsTable');
  if (posts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;">暂无数据</td></tr>';
    return;
  }
  tbody.innerHTML = posts.map(function (p) {
    var imgHTML = p.image
      ? '<img src="' + p.image + '" style="width:80px;height:60px;object-fit:cover;border-radius:4px;">'
      : '<span style="color:#999;">无图片</span>';
    var statusClass = 'status-' + (p.status === 'pending' ? 'pending' : p.status === 'approved' ? 'completed' : 'pending');
    var statusText = p.status === 'pending' ? '待审核' : p.status === 'approved' ? '已通过' : '已拒绝';
    var actions = '';
    if (p.status === 'pending') {
      actions = '<button class="btn btn-sm" style="background:#27ae60;color:#fff;margin-right:4px;" onclick="approvePost(' + p.id + ')">通过</button>' +
        '<button class="btn btn-sm" style="background:#e74c3c;color:#fff;margin-right:4px;" onclick="rejectPost(' + p.id + ')">拒绝</button>';
    }
    actions += '<button class="delete-btn" onclick="deletePost(' + p.id + ')">删除</button>';
    return '<tr>' +
      '<td>' + p.id + '</td>' +
      '<td>' + imgHTML + '</td>' +
      '<td><strong>' + esc(p.title || '无标题') + '</strong><br><span style="color:var(--gray-dark);font-size:0.8rem;">' + esc(p.description || '').substring(0, 50) + '</span></td>' +
      '<td>' + esc(p.phoneMasked || p.phone) + '</td>' +
      '<td>' + fmtDate(p.createdAt) + '</td>' +
      '<td><span class="status-tag ' + statusClass + '">' + statusText + '</span></td>' +
      '<td>' + actions + '</td>' +
      '</tr>';
  });
}

async function approvePost(id) {
  try {
    await api('/admin/api/posts/' + id + '/approve', { method: 'PUT' });
    loadPosts(document.getElementById('postStatusFilter').value);
    logAction('通过帖子', '帖子ID:'+id, '');
  } catch (e) { alert(e.message); }
}

async function rejectPost(id) {
  try {
    await api('/admin/api/posts/' + id + '/reject', { method: 'PUT' });
    loadPosts(document.getElementById('postStatusFilter').value);
  } catch (e) { alert(e.message); }
}

async function deletePost(id) {
  if (!confirm('确定删除该帖子？')) return;
  try { await fetch('/admin/api/posts/' + id, { method: 'DELETE' }); loadPosts(document.getElementById('postStatusFilter').value); }
  catch (e) { alert(e.message); }
}

document.getElementById('postStatusFilter').addEventListener('change', function () {
  loadPosts(this.value);
});

// ========== 公告管理 ==========
async function loadAnnouncements() {
  var list = await api('/admin/api/announcements');
  var tbody = document.getElementById('announcementsTable');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;">暂无公告</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function (a) {
    return '<tr>' +
      '<td>' + a.id + '</td>' +
      '<td>' + esc(a.content) + '</td>' +
      '<td>' + fmtDate(a.createdAt) + '</td>' +
      '<td><button class="delete-btn" onclick="deleteAnnouncement(' + a.id + ')">删除</button></td>' +
      '</tr>';
  }).join('');
}

async function addAnnouncement() {
  var input = document.getElementById('newAnnouncement');
  var content = input.value.trim();
  if (!content) { alert('请输入公告内容'); return; }
  try {
    await api('/admin/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    input.value = '';
    loadAnnouncements();
  } catch (e) { alert(e.message); }
}

async function deleteAnnouncement(id) {
  if (!confirm('确定删除该公告？')) return;
  try {
    await fetch('/admin/api/announcements/' + id, { method: 'DELETE' });
    loadAnnouncements();
  } catch (e) { alert(e.message); }
}

// ========== 精选管理 ==========
var _featuredImages = [];
async function loadFeatured() {
  var d = await api('/admin/api/featured'); _featuredImages = d.gallery_images ? d.gallery_images.split(',').filter(Boolean) : []; renderFeaturedImages();
}
function renderFeaturedImages() {
  var list = document.getElementById('featuredImagesList');
  list.innerHTML = _featuredImages.length ? _featuredImages.map(function (url, i) {
    return '<div style="position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--border);"><img src="' + url + '" style="width:100%;height:140px;object-fit:cover;"><span style="position:absolute;top:4px;left:6px;background:rgba(0,0,0,.6);color:#fff;border-radius:3px;padding:1px 6px;font-size:.7rem;">' + (i + 1) + '</span><button style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:4px;cursor:pointer;padding:2px 8px;font-size:.7rem;" onclick="removeFeatured(\'' + encodeURIComponent(url) + '\')">删除</button></div>';
  }).join('') : '<p style="color:#999;grid-column:1/-1;text-align:center;padding:20px;">暂无图片</p>';
}
async function uploadFeaturedPhoto() {
  var file = document.getElementById('featuredPhotoInput').files[0]; if (!file) return;
  var fd = new FormData(); fd.append('photo', file);
  var d = await api('/admin/api/featured/upload', { method: 'POST', body: fd });
  _featuredImages.push(d.url); renderFeaturedImages(); document.getElementById('featuredPhotoInput').value = '';
}
function removeFeatured(url) { url = decodeURIComponent(url); _featuredImages = _featuredImages.filter(function (i) { return i !== url; }); renderFeaturedImages(); }
async function saveFeatured() {
  try {
    await api('/admin/api/featured', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrls: _featuredImages }) });
    var m = document.getElementById('featuredMsg'); m.style.display = 'inline'; setTimeout(function () { m.style.display = 'none'; }, 2000);
  } catch (e) { alert(e.message); }
}

// ========== 侧边栏折叠 ==========
function toggleParent(btn) { btn.nextElementSibling.classList.toggle('open'); btn.textContent = btn.textContent.replace('▾', '').replace('▸', '') + (btn.nextElementSibling.classList.contains('open') ? ' ▾' : ' ▸'); }

// ========== Hero 管理 ==========
async function loadHero() {
  try {
    var data = await api('/api/hero');
    document.getElementById('heroBadge').value = data.badge || '';
    document.getElementById('heroInterval').value = data.interval || 20;
    window._heroImages = data.images || [];
    renderHeroImages(window._heroImages);
  } catch (e) { alert(e.message); }
}

async function uploadHeroPhoto() {
  var input = document.getElementById('heroPhotoInput');
  var file = input.files[0];
  if (!file) return;
  var fd = new FormData();
  fd.append('photo', file);
  try {
    var data = await api('/admin/api/hero/upload', { method: 'POST', body: fd });
    if (!window._heroImages) window._heroImages = [];
    window._heroImages.push(data.url);
    renderHeroImages(window._heroImages);
  } catch (e) { alert(e.message); }
  input.value = '';
}

function renderHeroImages(images) {
  var list = document.getElementById('heroImagesList');
  if (!images || images.length === 0) {
    list.innerHTML = '<span style="color:#999;font-size:0.85rem;">暂无</span>';
    return;
  }
  list.innerHTML = images.map(function (url, i) {
    return '<div class="hero-img-item" draggable="true" data-index="' + i + '" style="position:relative;width:80px;height:60px;border-radius:6px;overflow:hidden;border:2px solid transparent;cursor:grab;flex-shrink:0;transition:border-color .2s,transform .2s;">' +
      '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;pointer-events:none;" alt="背景' + (i + 1) + '" draggable="false">' +
      '<span style="position:absolute;top:2px;left:4px;background:rgba(0,0,0,.6);color:#fff;border-radius:3px;padding:0 5px;font-size:0.6rem;">' + (i + 1) + '</span>' +
      '<button style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:3px;cursor:pointer;padding:1px 6px;font-size:0.65rem;" onclick="removeHeroImage(\'' + encodeURIComponent(url) + '\')">✕</button></div>';
  }).join('');

  // drag & drop
  var dragging = null;
  list.querySelectorAll('.hero-img-item').forEach(function (item) {
    item.addEventListener('dragstart', function (e) {
      dragging = this;
      this.style.opacity = '0.5';
      this.style.cursor = 'grabbing';
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', function () {
      this.style.opacity = '1';
      this.style.cursor = 'grab';
      list.querySelectorAll('.hero-img-item').forEach(function (el) { el.style.borderColor = 'transparent'; });
      dragging = null;
    });
    item.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (this !== dragging) this.style.borderColor = 'var(--orange)';
    });
    item.addEventListener('dragleave', function () {
      if (this !== dragging) this.style.borderColor = 'transparent';
    });
    item.addEventListener('drop', function (e) {
      e.preventDefault();
      this.style.borderColor = 'transparent';
      if (this === dragging) return;
      var from = parseInt(dragging.dataset.index);
      var to = parseInt(this.dataset.index);
      var imgs = window._heroImages;
      var moved = imgs.splice(from, 1)[0];
      imgs.splice(to, 0, moved);
      renderHeroImages(imgs);
      window._heroImages = imgs;
    });
  });
}

async function removeHeroImage(url) {
  url = decodeURIComponent(url);
  if (!window._heroImages) return;
  window._heroImages = window._heroImages.filter(function (img) { return img !== url; });
  renderHeroImages(window._heroImages);
  updateHeroPreview();
  try { await api('/admin/api/hero/remove', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) }); } catch (e) {}
}

async function saveHero() {
  var images = window._heroImages;
  if (!images) { var h = await api('/api/hero'); images = h.images; }
  try {
    await api('/admin/api/hero', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        badge: document.getElementById('heroBadge').value.trim(),
        interval: parseInt(document.getElementById('heroInterval').value) || 20,
        imageUrls: images
      })
    });
    var msg = document.getElementById('heroMsg');
    msg.style.display = 'inline';
    setTimeout(function () { msg.style.display = 'none'; }, 2000);
  } catch (e) { alert(e.message); }
}

// ========== 隐私协议 ==========
async function loadPrivacy() {
  var data = await api('/admin/api/privacy');
  document.getElementById('privacyContent').value = data.content || '';
}

async function savePrivacy() {
  var content = document.getElementById('privacyContent').value;
  try {
    await api('/admin/api/privacy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    var msg = document.getElementById('privacyMsg');
    msg.style.display = 'inline';
    setTimeout(function () { msg.style.display = 'none'; }, 2000);
  } catch (e) { alert(e.message); }
}

// ========== 订单日历 ==========
var adminCalYear, adminCalMonth, adminCalBookings = {}, adminCalBlocks = {}, adminCalCameraId = null;

async function loadCalendarTab() {
  var sel = document.getElementById('calCameraFilter');
  var cameras = await api('/api/cameras');
  sel.innerHTML = '<option value="">选择机型...</option>' +
    cameras.map(function(c) { return '<option value="' + c.id + '">' + c.model + '</option>'; }).join('');
  sel.onchange = function() {
    adminCalCameraId = this.value ? parseInt(this.value) : null;
    if (adminCalCameraId) loadAdminCalendar();
    else document.getElementById('adminCalGrid').innerHTML = '';
  };

  var now = new Date();
  adminCalYear = now.getFullYear();
  adminCalMonth = now.getMonth();
  document.getElementById('adminPrevMonth').onclick = function() { adminCalMonth--; if(adminCalMonth<0){adminCalMonth=11;adminCalYear--;} renderAdminCal(); };
  document.getElementById('adminNextMonth').onclick = function() { adminCalMonth++; if(adminCalMonth>11){adminCalMonth=0;adminCalYear++;} renderAdminCal(); };
}

async function loadAdminCalendar() {
  try {
    var data = await api('/api/bookings?cameraId=' + adminCalCameraId);
    var blocks = await api('/admin/api/blocks?cameraId=' + adminCalCameraId);
    adminCalBookings = {}; adminCalBlocks = {};
    data.forEach(function(b) {
      var s = new Date(b.startDate), e = new Date(b.endDate), cur = new Date(s);
      while (cur <= e) {
        var key = cur.getFullYear() + '-' + pad(cur.getMonth()+1) + '-' + pad(cur.getDate());
        adminCalBookings[key] = adminCalBookings[key] || [];
        adminCalBookings[key].push(b.name||b.phone+'');
        cur.setDate(cur.getDate() + 1);
      }
    });
    blocks.forEach(function(b) {
      var s = new Date(b.startDate), e = new Date(b.endDate), cur = new Date(s);
      while (cur <= e) {
        var key = cur.getFullYear() + '-' + pad(cur.getMonth()+1) + '-' + pad(cur.getDate());
        adminCalBlocks[key] = { id: b.id, type: b.blockType || 'buffer' };
        cur.setDate(cur.getDate() + 1);
      }
    });
  } catch(e) { adminCalBookings = {}; adminCalBlocks = {}; }
  renderAdminCal();
}

function calDayClick(e){
  var el = e.target;
  var dsv = el.dataset.date;
  if(!dsv)return;
  if(adminCalBlocks[dsv]){
    var blk=adminCalBlocks[dsv];
    if(confirm('解除 '+dsv+' 的封锁（当前类型：'+(blk.type==='buffer'?'🟢缓冲期':blk.type==='admin'?'🔵管理员预留':'🔴封锁')+'）？')){
      api('/admin/api/blocks/'+blk.id,{method:'DELETE'}).then(function(){loadAdminCalendar()}).catch(function(e){alert(e.message)});
    }
  } else if(!adminCalBookings[dsv]){
    var type=prompt('选择封锁类型：\n1 - 🟢 缓冲期（寄送/维护两天）\n2 - 🔵 管理员预留（超7天租聘）\n\n输入 1 或 2','1');
    if(type==='1'||type==='2'){
      api('/admin/api/blocks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cameraId:adminCalCameraId,startDate:dsv,endDate:dsv,blockType:type==='2'?'admin':'buffer'})}).then(function(){loadAdminCalendar()}).catch(function(e){alert(e.message)});
    }
  }
}

function renderAdminCal() {
  document.getElementById('adminMonthLabel').textContent = adminCalYear + ' 年 ' + (adminCalMonth + 1) + ' 月';
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + pad(today.getMonth()+1) + '-' + pad(today.getDate());
  var first = new Date(adminCalYear, adminCalMonth, 1), last = new Date(adminCalYear, adminCalMonth + 1, 0);
  var off = first.getDay(), total = last.getDate();
  var html = '';
  for (var i = 0; i < off; i++) html += '<div class="calendar-day empty"></div>';
  for (var day = 1; day <= total; day++) {
    var dsv = adminCalYear + '-' + pad(adminCalMonth+1) + '-' + pad(day);
    var booked = adminCalBookings[dsv];
    var blocked = adminCalBlocks[dsv];
    var cls = 'calendar-day';
    if (dsv === todayStr) cls += ' today';
    if (booked) { cls += ' booked-date'; var titles=booked.slice(0,3).join('、')+(booked.length>3?'等'+booked.length+'人':''); }
    if (blocked) {
      if (blocked.type === 'buffer') cls += ' blocked-green';
      else if (blocked.type === 'admin') cls += ' blocked-blue';
      else cls += ' blocked-date';
      if (!booked) titles = blocked.type === 'buffer' ? '缓冲期' : (blocked.type === 'admin' ? '管理员预留' : '封锁');
    }
    html += '<div class="' + cls + '" data-date="' + dsv + '"' + (booked||blocked?' title="'+titles+'"':'') + '>' + day + '</div>';
  }
  document.getElementById('adminCalGrid').innerHTML = html;
  document.querySelectorAll('#adminCalGrid .calendar-day').forEach(function(el){el.addEventListener('click',calDayClick)});
}

// ========== 库存数据 ==========
async function loadArchive(){
  var status=document.getElementById('archiveStatus').value;
  var data=await api('/admin/api/bookings?status='+status);
  data.sort(function(a,b){return new Date(b.endDate)-new Date(a.endDate)});
  document.getElementById('archiveBody').innerHTML=data.length?data.map(function(b){return '<tr><td>'+b.id+'</td><td>'+esc(b.cameraModel)+'</td><td>'+esc(b.name)+'</td><td>'+b.startDate+'</td><td>'+b.endDate+'</td><td>'+fmtDate(b.createdAt)+'</td></tr>'}).join(''):'<tr><td colspan="6" style="color:#999;text-align:center;">暂无</td></tr>';
}

// ========== 机型管理 ==========
var adminCameras=[],camPhotoFile=null;

async function loadCamerasTab(){adminCameras=await api('/api/cameras');renderCamTable()}
function renderCamTable(){
  var tbody=document.getElementById('camerasTable');
  if(!adminCameras.length){tbody.innerHTML='<tr><td colspan="10" style="color:#999;text-align:center;">暂无机型</td></tr>';return}
  tbody.innerHTML=adminCameras.map(function(c){return '<tr><td><img src="'+c.image+'" style="width:50px;height:35px;object-fit:cover;border-radius:4px;"></td><td>'+esc(c.model)+'</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;">'+esc(c.advantage)+'</td><td>'+c.price1day+'</td><td>'+c.price2day+'</td><td>'+c.price3dayPerDay+'</td><td>'+(c.price5dayPerDay||0)+'</td><td>'+(c.price7day||0)+'</td><td>'+(c.hot?'':'')+'</td><td><button class="delete-btn" style="margin-right:4px;" onclick="editCam('+c.id+')">编辑</button><button class="delete-btn" onclick="deleteCam('+c.id+')">删除</button></td></tr>'}).join('')}

function showCamForm(cam){camPhotoFile=null;document.getElementById('camPhotoFile').value='';document.getElementById('camPhotoPreview').style.display='none';if(cam){document.getElementById('camId').value=cam.id;document.getElementById('camModel').value=cam.model;document.getElementById('camAdvantage').value=cam.advantage;document.getElementById('camDetail').value=cam.detail||'';document.getElementById('camImageUrl').value=cam.image||'';document.getElementById('camPrice1').value=cam.price1day;document.getElementById('camPrice2').value=cam.price2day;document.getElementById('camPrice3').value=cam.price3dayPerDay;document.getElementById('camPrice5').value=cam.price5dayPerDay||'';document.getElementById('camPrice7').value=cam.price7day||'';document.getElementById('camHot').checked=cam.hot===true;document.getElementById('camFormTitle').textContent='编辑机型';if(cam.image){document.getElementById('camPhotoPreviewImg').src=cam.image;document.getElementById('camPhotoPreview').style.display=''}}else{document.getElementById('camId').value='';document.getElementById('camModel').value='';document.getElementById('camAdvantage').value='';document.getElementById('camDetail').value='';document.getElementById('camImageUrl').value='';document.getElementById('camPrice1').value='';document.getElementById('camPrice2').value='';document.getElementById('camPrice3').value='';document.getElementById('camPrice5').value='';document.getElementById('camPrice7').value='';document.getElementById('camHot').checked=false;document.getElementById('camFormTitle').textContent='新增机型'}document.getElementById('camForm').style.display='block';document.getElementById('camForm').scrollIntoView({behavior:'smooth'})}

async function editCam(id){var c=adminCameras.find(function(cc){return cc.id===id});if(c)showCamForm(c)}

function hideCamForm(){document.getElementById('camForm').style.display='none'}
function handleCamPhoto(e){var f=e.target.files[0];if(!f)return;camPhotoFile=f;var r=new FileReader();r.onload=function(ev){document.getElementById('camPhotoPreviewImg').src=ev.target.result;document.getElementById('camPhotoPreview').style.display=''};r.readAsDataURL(f)}

async function saveCamera(){
  var id=document.getElementById('camId').value,url=id?'/admin/api/cameras/'+id:'/admin/api/cameras',method=id?'PUT':'POST';
  try{
    var res;
    if(camPhotoFile){var fd=new FormData();fd.append('photo',camPhotoFile);fd.append('model',document.getElementById('camModel').value);fd.append('advantage',document.getElementById('camAdvantage').value);fd.append('detail',document.getElementById('camDetail').value);fd.append('price1day',document.getElementById('camPrice1').value);fd.append('price2day',document.getElementById('camPrice2').value);fd.append('price3dayPerDay',document.getElementById('camPrice3').value);fd.append('price5dayPerDay',document.getElementById('camPrice5').value);fd.append('price7day',document.getElementById('camPrice7').value);fd.append('hot',document.getElementById('camHot').checked);res=await fetch(url,{method:method,body:fd})}
    else{res=await fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:document.getElementById('camModel').value,advantage:document.getElementById('camAdvantage').value,detail:document.getElementById('camDetail').value,image:document.getElementById('camImageUrl').value,price1day:document.getElementById('camPrice1').value,price2day:document.getElementById('camPrice2').value,price3dayPerDay:document.getElementById('camPrice3').value,price5dayPerDay:document.getElementById('camPrice5').value,price7day:document.getElementById('camPrice7').value,hot:document.getElementById('camHot').checked})})}
    if(!res.ok){var d=await res.json().catch(function(){return{}});throw new Error(d.error||'保存失败')}
    hideCamForm();loadCamerasTab()
  }catch(e){alert(e.message)}
}

async function deleteCam(id){logAction('删除','机型#'+id);if(!confirm('确定删除？'))return;await fetch('/admin/api/cameras/'+id,{method:'DELETE'});loadCamerasTab()}

// ========== 用户管理 ==========
async function loadUsersTab(){await loadRegCode();await loadUsersList()}
async function loadRegCode(){var d=await api('/admin/api/reg-code');document.getElementById('currentRegCode').textContent=d.code||'未生成'}
async function generateRegCode(){if(!confirm('生成新注册码后旧码立即失效，确定？'))return;var d=await api('/admin/api/reg-code',{method:'POST'});document.getElementById('currentRegCode').textContent=d.code}
async function loadUsersList(){
  var users=await api('/admin/api/users');
  var q=(document.getElementById('userSearch').value||'').trim().toLowerCase();
  if(q)users=users.filter(function(u){return(u.username||'').toLowerCase().indexOf(q)>=0||(u.phone||'').indexOf(q)>=0});
  document.getElementById('usersTable').innerHTML=users.length?users.map(function(u){return '<tr><td>'+u.id+'</td><td>'+esc(u.username||'-')+'</td><td>'+esc(u.password||'-')+'</td><td>'+esc(u.phone||'-')+'</td><td>'+fmtDate(u.createdAt)+'</td><td><button class="delete-btn" onclick="changeUserPwd('+u.id+')">改密</button></td></tr>'}).join(''):'<tr><td colspan="6" style="color:#999;text-align:center;">暂无</td></tr>';
}
async function changeUserPwd(id){
  var pwd=prompt('请输入新密码（至少6位）：');
  if(!pwd||pwd.length<6){alert('密码至少6位');return}
  await api('/admin/api/users/'+id+'/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pwd})});
  alert('密码已修改');loadUsersList();
}

// ========== 初始化 ==========
loadBookings('');
