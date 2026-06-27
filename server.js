require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { initDB, query, get, run } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { setHeaders: function(res, filePath) { if (filePath.endsWith('.pdf')) { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline'); } } }));

// uploads dir
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only images')) });

// 日期格式化
function fmtDate(d) {
  if (!d) return '';
  var dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d).slice(0, 19).replace('T', ' ');
  var y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, '0'), day = String(dt.getDate()).padStart(2, '0');
  var h = String(dt.getHours()).padStart(2, '0'), min = String(dt.getMinutes()).padStart(2, '0'), s = String(dt.getSeconds()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + h + ':' + min + ':' + s;
}
function fmtBookings(rows) {
  return rows.map(function(b) {
    b.startDate = fmtDateOnly(b.startDate);
    b.endDate = fmtDateOnly(b.endDate);
    b.createdAt = fmtDate(b.createdAt);
    return b;
  });
}
function fmtDateOnly(d) {
  if (!d) return '';
  var dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d).slice(0, 10);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

// ==================== PUBLIC API ====================
app.get('/api/cameras', async (req, res) => {
  try { res.json(await query('SELECT * FROM cameras ORDER BY id')); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bookings', async (req, res) => {
  try {
    const { cameraId } = req.query;
    const rows = await query('SELECT startDate, endDate FROM bookings WHERE cameraId=? AND status NOT IN (?,?)', [parseInt(cameraId), 'cancelled', 'rejected']);
    const blocks = await query('SELECT startDate, endDate FROM camera_blocks WHERE cameraId=?', [parseInt(cameraId)]);
    // 统一日期格式为 YYYY-MM-DD（本地时间，避免 UTC 偏移）
    var fmtDateOnly = function(d) { if (d instanceof Date) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } return String(d).slice(0,10); };
    res.json([...rows.map(function(r){return {startDate:fmtDateOnly(r.startDate),endDate:fmtDateOnly(r.endDate)}}), ...blocks.map(function(r){return {startDate:fmtDateOnly(r.startDate),endDate:fmtDateOnly(r.endDate)}})]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { cameraId, startDate, endDate, name, school, remark, phone } = req.body;
    if (!cameraId || !startDate || !endDate || !name || !school || !phone) return res.status(400).json({ error: '缺少必填字段' });
    const start = new Date(startDate), end = new Date(endDate);
    if (end < start) return res.status(400).json({ error: '结束日期不能早于开始日期' });
    if (Math.ceil((end - start) / 86400000) + 1 > 7) return res.status(400).json({ error: '最多7天，超过请联系管理员' });
    const conflicts = await query('SELECT 1 FROM bookings WHERE cameraId=? AND status NOT IN (?,?) AND startDate<=? AND endDate>=?', [parseInt(cameraId), 'cancelled', 'rejected', endDate, startDate]);
    if (conflicts.length > 0) return res.status(409).json({ error: '该时间段已被预约' });
    const id = Date.now();
    // 计算金额
    const cam = await get('SELECT * FROM cameras WHERE id=?', [parseInt(cameraId)]);
    const days = Math.ceil((end - start) / 86400000) + 1;
    let amount = 0;
    if (days === 1) amount = cam.price1day;
    else if (days === 2) amount = cam.price2day;
    else if (days === 3 || days === 4) amount = (cam.price3dayPerDay || 0) * days;
    else if (days === 5 || days === 6) amount = (cam.price5dayPerDay || 0) * days;
    else if (days === 7) amount = cam.price7day || 0;

    await run('INSERT INTO bookings (id,cameraId,startDate,endDate,name,school,remark,phone,status,amount,createdAt) VALUES (?,?,DATE(?),DATE(?),?,?,?,?,?,?,NOW())', [id, parseInt(cameraId), startDate, endDate, name.trim(), school.trim(), (remark || '').trim(), phone.trim(), 'pending', amount]);
    res.status(201).json({ message: '预约成功！', booking: { id, cameraId: parseInt(cameraId), startDate, endDate, name: name.trim(), school: school.trim(), remark: (remark || '').trim(), phone: phone.trim(), status: 'pending', amount } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: '请输入用户名/手机号和密码' });
    const user = await get('SELECT id, username, phone FROM users WHERE (username=? OR phone=?) AND password=?', [login, login, password]);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    res.json({ success: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my-bookings', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: '缺少手机号' });
    const rows = await query('SELECT b.*, c.model as cameraModel FROM bookings b LEFT JOIN cameras c ON b.cameraId=c.id WHERE b.phone=? ORDER BY b.createdAt DESC', [phone]);
    res.json(fmtBookings(rows));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/renew', async (req, res) => {
  try {
    const { orderId, newEndDate } = req.body;
    if (!orderId || !newEndDate) return res.status(400).json({ error: '缺少必填字段' });
    const booking = await get('SELECT * FROM bookings WHERE id=?', [parseInt(orderId)]);
    if (!booking) return res.status(404).json({ error: '订单不存在' });
    if (!['confirmed', 'renting'].includes(booking.status)) return res.status(400).json({ error: '当前状态不支持续约' });
    const newStartDate = booking.endDate; // 续约开始 = 原订单结束日期
    if (newEndDate <= newStartDate) return res.status(400).json({ error: '续约结束日期必须晚于原订单结束日期' });
    const days = Math.ceil((new Date(newEndDate) - new Date(newStartDate)) / 86400000) + 1;
    if (days > 7) return res.status(400).json({ error: '续约最多7天' });
    const conflicts = await query('SELECT 1 FROM bookings WHERE cameraId=? AND id!=? AND status NOT IN (?,?) AND startDate<=? AND endDate>=?', [booking.cameraId, parseInt(orderId), 'cancelled', 'rejected', newEndDate, newStartDate]);
    if (conflicts.length > 0) return res.status(409).json({ error: '续约时间段已被预约' });
    await run('UPDATE bookings SET status=?, renewNewEndDate=?, renewStatus=? WHERE id=?', ['renew_pending', newEndDate, 'pending', parseInt(orderId)]);
    res.json({ message: '续约申请已提交，等待审核' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/privacy', async (req, res) => {
  try { const row = await get('SELECT content FROM privacy WHERE id=1'); res.json(row || { content: '' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/announcements', async (req, res) => {
  try { res.json(await query('SELECT * FROM announcements ORDER BY createdAt DESC')); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/posts', async (req, res) => {
  try {
    const { status } = req.query;
    let rows = status ? await query('SELECT * FROM posts WHERE status=? ORDER BY createdAt DESC', [status]) : await query('SELECT * FROM posts ORDER BY createdAt DESC');
    rows = rows.map(p => ({ ...p, phoneMasked: p.phone ? p.phone.substring(0, 3) + '****' + p.phone.substring(7) : '未知' }));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/posts', upload.single('photo'), async (req, res) => {
  try {
    const { phone, title, description } = req.body;
    if (!phone || !title || !description) return res.status(400).json({ error: '缺少必填字段' });
    let imagePath = req.file ? '/uploads/' + req.file.filename : (req.body.imageUrl || '').trim();
    const id = Date.now();
    await run('INSERT INTO posts (id,phone,title,image,description,status,createdAt) VALUES (?,?,?,?,?,?,NOW())', [id, phone.trim(), title.trim(), imagePath, description.trim(), 'pending']);
    res.status(201).json({ message: '分享已提交，等待审核', post: { id } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/hero', async (req, res) => {
  try { const row = await get('SELECT * FROM hero_config WHERE id=1'); res.json(row ? { badge: row.badge, title: row.title, subtitle: row.subtitle, interval: row.intervalSec, images: row.images ? row.images.split(',') : [] } : {}); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== AUTH (REGISTER + SMS) ====================
app.post('/api/send-sms', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1\d{10}$/.test(phone)) return res.status(400).json({ error: '请输入正确的手机号' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await run('INSERT INTO sms_codes (phone,code,expires) VALUES (?,?,?) ON DUPLICATE KEY UPDATE code=?,expires=?', [phone, code, Date.now() + 300000, code, Date.now() + 300000]);
  res.json({ success: true, message: '验证码已发送' });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, phone, regCode } = req.body;
    if (!username || !password || !phone) return res.status(400).json({ error: '请填写完整信息' });
    if (username.trim().length < 2) return res.status(400).json({ error: '用户名至少2个字符' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    const reg = await get('SELECT code FROM reg_code WHERE id=1');
    if (!reg || !reg.code || regCode !== reg.code) return res.status(400).json({ error: '注册码错误' });
    const existing = await get('SELECT 1 FROM users WHERE phone=?', [phone.trim()]);
    if (existing) return res.status(400).json({ error: '该手机号已注册' });
    const existing2 = await get('SELECT 1 FROM users WHERE username=?', [username.trim()]);
    if (existing2) return res.status(400).json({ error: '该用户名已被使用' });
    const id = Date.now();
    await run('INSERT INTO users (id,username,password,phone,createdAt) VALUES (?,?,?,?,NOW())', [id, username.trim(), password, phone.trim()]);
    res.json({ success: true, user: { id, username: username.trim(), phone: phone.trim() } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN AUTH ====================
const adminSessions = {};
function adminLog(adminUser, action, target, detail) {
  if (adminUser === 'gxh666') return;
  run('INSERT INTO admin_log (id,adminUser,action,target,detail,timestamp) VALUES (?,?,?,?,?,NOW())', [Date.now(), adminUser, action, target || '', detail || '']).catch(() => {});
}

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await get('SELECT * FROM admin_users WHERE username=? AND password=?', [username, password]);
    if (!admin) return res.status(401).json({ error: '用户名或密码错误' });
    const token = 'at-' + Date.now();
    adminSessions[token] = { adminId: admin.id, username: admin.username, role: admin.role, loginAt: new Date().toISOString(), lastActive: Date.now() };
    adminLog(username, '登录', '后台', '');
    res.json({ success: true, token, role: admin.role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/heartbeat', (req, res) => {
  const { token, username } = req.body;
  if (adminSessions[token]) adminSessions[token].lastActive = Date.now();
  else if (username) adminSessions[token || ('hb-' + Date.now())] = { adminId: 0, username, role: 'admin', loginAt: new Date().toISOString(), lastActive: Date.now() };
  res.json({ ok: true });
});

app.get('/admin/api/sessions', (req, res) => {
  const now = Date.now();
  const sessions = Object.entries(adminSessions).map(([token, s]) => ({
    token: token.substring(0, 20) + '...', username: s.username, role: s.role, loginAt: s.loginAt,
    lastActive: s.lastActive, idleSeconds: Math.floor((now - s.lastActive) / 1000), isIdle: now - s.lastActive > 600000
  }));
  res.json(sessions);
});

app.get('/admin/api/admins', async (req, res) => {
  try { res.json(await query('SELECT id,username,role,createdAt FROM admin_users ORDER BY id')); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/admins', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) return res.status(400).json({ error: '请填写完整（密码至少6位）' });
    const exists = await get('SELECT 1 FROM admin_users WHERE username=?', [username.trim()]);
    if (exists) return res.status(400).json({ error: '该用户名已存在' });
    await run('INSERT INTO admin_users (id,username,password,role,createdAt) VALUES (?,?,?,?,NOW())', [Date.now(), username.trim(), password, 'admin']);
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/admins/:id', async (req, res) => {
  try {
    const a = await get('SELECT * FROM admin_users WHERE id=?', [parseInt(req.params.id)]);
    if (!a) return res.status(404).json({ error: '不存在' });
    if (a.role === 'supervisor') return res.status(403).json({ error: '不能删除超级管理员' });
    await run('DELETE FROM admin_users WHERE id=?', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/admins/:id/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    await run('UPDATE admin_users SET password=? WHERE id=?', [password, parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/admin/api/log', async (req, res) => {
  try {
    const { username, action, target, detail } = req.body;
    if (!username || !action) return res.status(400).json({});
    adminLog(username, action, target || '', detail || '');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/api/log', async (req, res) => {
  try {
    const { admin, limit = 100 } = req.query;
    const admins = (await query('SELECT DISTINCT adminUser FROM admin_log ORDER BY adminUser')).map(r => r.adminUser);
    let logs = [];
    if (admin) {
      logs = await query('SELECT * FROM admin_log WHERE adminUser=? ORDER BY timestamp DESC LIMIT ?', [admin, parseInt(limit)]);
    } else {
      logs = await query('SELECT * FROM admin_log ORDER BY timestamp DESC LIMIT ?', [parseInt(limit)]);
    }
    res.json({ admins, logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN BOOKINGS ====================
app.get('/admin/api/bookings', async (req, res) => {
  try {
    const { status, exclude } = req.query;
    let sql = 'SELECT b.*, c.model as cameraModel FROM bookings b LEFT JOIN cameras c ON b.cameraId=c.id WHERE 1=1';
    const params = [];
    if (status) { sql += ' AND b.status=?'; params.push(status); }
    if (exclude) { const ex = exclude.split(','); sql += ' AND b.status NOT IN (?' + ',?'.repeat(ex.length - 1) + ')'; params.push(...ex); }
    sql += ' ORDER BY b.startDate ASC';
    res.json(fmtBookings(await query(sql, params)));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/bookings/:id', async (req, res) => {
  try {
    const { status, amount } = req.body;
    if (status !== undefined) await run('UPDATE bookings SET status=? WHERE id=?', [status, parseInt(req.params.id)]);
    if (amount !== undefined) await run('UPDATE bookings SET amount=? WHERE id=?', [parseInt(amount), parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 收支统计
app.get('/admin/api/revenue', async (req, res) => {
  try {
    const { date, month, year } = req.query;
    let sql = '', params = [];
    if (date) { sql = "SELECT COALESCE(SUM(amount),0) as total FROM bookings WHERE status IN ('confirmed','renting','completed') AND DATE(createdAt)=?"; params = [date]; }
    else if (month) { sql = "SELECT COALESCE(SUM(amount),0) as total FROM bookings WHERE status IN ('confirmed','renting','completed') AND DATE_FORMAT(createdAt,'%Y-%m')=?"; params = [month]; }
    else if (year) { sql = "SELECT COALESCE(SUM(amount),0) as total FROM bookings WHERE status IN ('confirmed','renting','completed') AND YEAR(createdAt)=?"; params = [year]; }
    else return res.status(400).json({ error: '缺少参数' });
    const [row] = await query(sql, params);
    res.json({ total: row.total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/api/bookings/:id', async (req, res) => {
  try {
    await run('DELETE FROM bookings WHERE id=?', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/renew/:id/approve', async (req, res) => {
  try {
    const booking = await get('SELECT * FROM bookings WHERE id=?', [parseInt(req.params.id)]);
    if (!booking || !booking.renewNewEndDate) return res.status(404).json({ error: '续约申请不存在' });
    await run('UPDATE bookings SET endDate=?, renewStatus=?, status=? WHERE id=?', [booking.renewNewEndDate, 'approved', booking.status === 'renew_pending' ? (booking.startDate <= new Date().toISOString().split('T')[0] ? 'renting' : 'confirmed') : booking.status, parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/renew/:id/reject', async (req, res) => {
  try {
    await run('UPDATE bookings SET renewStatus=?, status=? WHERE id=? AND renewNewEndDate IS NOT NULL', ['rejected', 'confirmed', parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN POSTS ====================
app.get('/admin/api/posts', async (req, res) => {
  try {
    const { status } = req.query;
    let rows = status ? await query('SELECT * FROM posts WHERE status=? ORDER BY createdAt DESC', [status]) : await query('SELECT * FROM posts ORDER BY createdAt DESC');
    rows = rows.map(p => ({ ...p, phoneMasked: p.phone ? p.phone.substring(0, 3) + '****' + p.phone.substring(7) : '未知' }));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/posts/:id/approve', async (req, res) => {
  try { await run('UPDATE posts SET status=? WHERE id=?', ['approved', parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/posts/:id/reject', async (req, res) => {
  try { await run('UPDATE posts SET status=? WHERE id=?', ['rejected', parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/posts/:id', async (req, res) => {
  try { await run('DELETE FROM posts WHERE id=?', [parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN ANNOUNCEMENTS ====================
app.get('/admin/api/announcements', async (req, res) => {
  try { res.json(await query('SELECT * FROM announcements ORDER BY createdAt DESC')); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/announcements', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: '请输入内容' });
    await run('INSERT INTO announcements (id,content,createdAt) VALUES (?,?,NOW())', [Date.now(), content.trim()]);
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/announcements/:id', async (req, res) => {
  try { await run('DELETE FROM announcements WHERE id=?', [parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN PRIVACY ====================
app.get('/admin/api/privacy', async (req, res) => {
  try { const row = await get('SELECT content FROM privacy WHERE id=1'); res.json(row || { content: '' }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/contract/file', async (req, res) => {
  try {
    const row = await get('SELECT file FROM contract WHERE id=1');
    if (!row || !row.file) return res.status(404).send('暂无合同文件');
    res.redirect(row.file);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/contract', async (req, res) => {
  try { const row = await get('SELECT * FROM contract WHERE id=1'); res.json(row || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/admin/api/contract', async (req, res) => {
  try { const row = await get('SELECT * FROM contract WHERE id=1'); res.json(row || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/contract', async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: '内容不能为空' });
    await run('INSERT INTO contract (id,content) VALUES (1,?) ON DUPLICATE KEY UPDATE content=?', [content, content]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/api/privacy', async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: '内容不能为空' });
    await run('INSERT INTO privacy (id,content) VALUES (1,?) ON DUPLICATE KEY UPDATE content=?', [content, content]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN HERO ====================
app.get('/admin/api/hero', async (req, res) => {
  try { const row = await get('SELECT * FROM hero_config WHERE id=1'); res.json(row || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/hero', upload.array('photos', 5), async (req, res) => {
  try {
    let row = await get('SELECT * FROM hero_config WHERE id=1') || { badge: '', title: '', subtitle: '', intervalSec: 8, images: '' };
    const { badge, interval, imageUrls } = req.body;
    if (badge !== undefined) row.badge = badge.trim();
    if (interval !== undefined) row.intervalSec = Math.max(5, Math.min(120, parseInt(interval) || 20));
    let images = imageUrls ? (Array.isArray(imageUrls) ? imageUrls : JSON.parse(imageUrls)) : (row.images ? row.images.split(',') : []);
    if (req.files && req.files.length > 0) images = [...images, ...req.files.map(f => '/uploads/' + f.filename)];
    images = [...new Set(images)].slice(0, 5);
    row.images = images.join(',');
    await run('INSERT INTO hero_config (id,badge,title,subtitle,intervalSec,images) VALUES (1,?,?,?,?,?) ON DUPLICATE KEY UPDATE badge=?,title=?,subtitle=?,intervalSec=?,images=?', [row.badge, row.title, row.subtitle, row.intervalSec, row.images, row.badge, row.title, row.subtitle, row.intervalSec, row.images]);
    res.json({ success: true, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/hero/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  res.json({ success: true, url: '/uploads/' + req.file.filename });
});
app.put('/admin/api/hero/remove', async (req, res) => {
  try {
    const row = await get('SELECT images FROM hero_config WHERE id=1');
    if (!row) return res.status(404).json({ error: '不存在' });
    const { url } = req.body;
    let images = row.images ? row.images.split(',') : [];
    images = images.filter(img => img !== url);
    await run('UPDATE hero_config SET images=? WHERE id=1', [images.join(',')]);
    res.json({ success: true, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== FEATURED CONFIG ====================
app.get('/api/featured', async (req, res) => {
  try { const row = await get('SELECT * FROM featured_config WHERE id=1'); res.json(row ? { gallery_images: row.gallery_images ? row.gallery_images.split(',') : [] } : { gallery_images: [] }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/admin/api/featured', async (req, res) => {
  try { const row = await get('SELECT * FROM featured_config WHERE id=1'); res.json(row || {}); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/featured', upload.array('photos', 4), async (req, res) => {
  try {
    const { imageUrls } = req.body;
    let images = imageUrls ? (Array.isArray(imageUrls) ? imageUrls : JSON.parse(imageUrls)) : [];
    if (req.files && req.files.length > 0) images = [...images, ...req.files.map(f => '/uploads/' + f.filename)];
    images = [...new Set(images)].slice(0, 4);
    await run('INSERT INTO featured_config (id,gallery_images) VALUES (1,?) ON DUPLICATE KEY UPDATE gallery_images=?', [images.join(','), images.join(',')]);
    res.json({ success: true, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/featured/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  res.json({ success: true, url: '/uploads/' + req.file.filename });
});
app.put('/admin/api/featured/remove', async (req, res) => {
  try {
    const row = await get('SELECT gallery_images FROM featured_config WHERE id=1');
    if (!row) return res.status(404).json({ error: '不存在' });
    let images = row.gallery_images ? row.gallery_images.split(',').filter(Boolean) : [];
    images = images.filter(img => img !== req.body.url);
    await run('UPDATE featured_config SET gallery_images=? WHERE id=1', [images.join(',')]);
    res.json({ success: true, images });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN REG CODE ====================
app.get('/admin/api/reg-code', async (req, res) => {
  try { const row = await get('SELECT code FROM reg_code WHERE id=1'); res.json(row || { code: '' }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/reg-code', async (req, res) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  let code = '';
  for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)];
  await run('INSERT INTO reg_code (id,code) VALUES (1,?) ON DUPLICATE KEY UPDATE code=?', [code, code]);
  res.json({ success: true, code });
});

// ==================== ADMIN USERS ====================
app.get('/admin/api/users', async (req, res) => {
  try { res.json(await query('SELECT * FROM users ORDER BY createdAt DESC')); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/users/:id/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    await run('UPDATE users SET password=? WHERE id=?', [password, parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== ADMIN CAMERAS ====================
app.post('/admin/api/cameras', upload.single('photo'), async (req, res) => {
  try {
    const { model, advantage, detail, price1day, price2day, price3dayPerDay, price5dayPerDay, price7day, renewPrice, hot } = req.body;
    if (!model || !advantage) return res.status(400).json({ error: '型号和优势为必填' });
    let image = req.file ? '/uploads/' + req.file.filename : (req.body.image || '').trim();
    await run('INSERT INTO cameras (model,advantage,detail,image,price1day,price2day,price3dayPerDay,price5dayPerDay,price7day,hot) VALUES (?,?,?,?,?,?,?,?,?,?)', [model.trim(), advantage.trim(), (detail || '').trim(), image, parseInt(price1day) || 0, parseInt(price2day) || 0, parseInt(price3dayPerDay) || 0, parseInt(price5dayPerDay) || 0, parseInt(price7day) || 0, hot === 'true' || hot === true ? 1 : 0]);
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/cameras/:id', upload.single('photo'), async (req, res) => {
  try {
    const { model, advantage, detail, price1day, price2day, price3dayPerDay, price5dayPerDay, price7day, renewPrice, hot } = req.body;
    const cam = await get('SELECT * FROM cameras WHERE id=?', [parseInt(req.params.id)]);
    if (!cam) return res.status(404).json({ error: '不存在' });
    let image = cam.image;
    if (req.file) image = '/uploads/' + req.file.filename;
    else if (req.body.image !== undefined) image = req.body.image.trim();
    await run('UPDATE cameras SET model=?,advantage=?,detail=?,image=?,price1day=?,price2day=?,price3dayPerDay=?,price5dayPerDay=?,price7day=?,hot=? WHERE id=?', [model !== undefined ? model.trim() : cam.model, advantage !== undefined ? advantage.trim() : cam.advantage, detail !== undefined ? detail.trim() : cam.detail, image, parseInt(price1day) || 0, parseInt(price2day) || 0, parseInt(price3dayPerDay) || 0, parseInt(price5dayPerDay) || 0, parseInt(price7day) || 0, hot === 'true' || hot === true ? 1 : 0, parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 相机封锁日期管理
app.get('/admin/api/blocks', async (req, res) => {
  try {
    const { cameraId } = req.query;
    const blocks = cameraId ? await query('SELECT * FROM camera_blocks WHERE cameraId=? ORDER BY startDate', [parseInt(cameraId)]) : await query('SELECT * FROM camera_blocks ORDER BY startDate');
    var fmtDateOnly = function(d) { if (d instanceof Date) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } return String(d).slice(0,10); };
    res.json(blocks.map(function(r){r.startDate=fmtDateOnly(r.startDate);r.endDate=fmtDateOnly(r.endDate);return r}));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/blocks', async (req, res) => {
  try {
    const { cameraId, startDate, endDate, blockType } = req.body;
    if (!cameraId || !startDate || !endDate) return res.status(400).json({ error: '缺少参数' });
    // 确保日期格式 YYYY-MM-DD
    const sd = String(startDate).slice(0, 10);
    const ed = String(endDate).slice(0, 10);
    await run('INSERT INTO camera_blocks (cameraId,startDate,endDate,blockType,createdAt) VALUES (?,DATE(?),DATE(?),?,NOW())', [parseInt(cameraId), sd, ed, blockType || 'buffer']);
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/blocks/:id', async (req, res) => {
  try { await run('DELETE FROM camera_blocks WHERE id=?', [parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/admin/api/cameras/:id', async (req, res) => {
  try { await run('DELETE FROM cameras WHERE id=?', [parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 机型实拍管理 ====================
app.get('/api/camera-photos', async (req, res) => {
  try {
    const { cameraId } = req.query;
    const sql = cameraId ? 'SELECT * FROM camera_photos WHERE cameraId=? ORDER BY \`sort_order\`' : 'SELECT * FROM camera_photos ORDER BY cameraId, sort_order';
    const rows = cameraId ? await query(sql, [parseInt(cameraId)]) : await query(sql);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/admin/api/camera-photos', upload.single('photo'), async (req, res) => {
  try {
    const { cameraId } = req.body;
    if (!cameraId || !req.file) return res.status(400).json({ error: '缺少参数' });
    const img = '/uploads/' + req.file.filename;
    await run('INSERT INTO camera_photos (cameraId,image,sort_order,createdAt) VALUES (?,?,0,NOW())', [parseInt(cameraId), img]);
    res.status(201).json({ success: true, image: img });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/admin/api/camera-photos/reorder', upload.none(), async (req, res) => {
  try {
    const ids = JSON.parse(req.body.photos || '[]');
    for (let i = 0; i < ids.length; i++) await run('UPDATE camera_photos SET sort_order=? WHERE id=?', [i, ids[i]]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/admin/api/camera-photos/:id', async (req, res) => {
  try { await run('DELETE FROM camera_photos WHERE id=?', [parseInt(req.params.id)]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== 404 ====================
app.use((req, res) => { res.status(404).sendFile(path.join(__dirname, 'public', '404.html')); });

// ==================== START ====================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
  });
});
