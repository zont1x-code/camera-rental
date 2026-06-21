// 种子数据：从 JSON 迁移到 MySQL（运行一次即可）
require('dotenv').config();
const { initDB, run, get } = require('./db');
const fs = require('fs');
const path = require('path');

function readJSON(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', name + '.json'), 'utf-8'));
}

async function seed() {
  await initDB();
  console.log('Seeding...');

  // cameras
  const cameras = readJSON('cameras');
  for (const c of cameras) {
    await run('INSERT IGNORE INTO cameras (id,model,advantage,detail,image,price1day,price2day,price3dayPerDay,hot) VALUES (?,?,?,?,?,?,?,?,?)',
      [c.id, c.model, c.advantage, c.detail || '', c.image || '', c.price1day, c.price2day, c.price3dayPerDay, c.hot ? 1 : 0]);
  }
  console.log('  cameras: ' + cameras.length);

  // bookings
  const bookings = readJSON('bookings');
  for (const b of bookings) {
    await run('INSERT IGNORE INTO bookings (id,cameraId,startDate,endDate,name,school,remark,phone,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [b.id, b.cameraId, b.startDate, b.endDate, b.name, b.school, b.remark || '', b.phone || '', b.status || 'pending', b.createdAt]);
  }
  console.log('  bookings: ' + bookings.length);

  // users
  const users = readJSON('users');
  for (const u of users) {
    await run('INSERT IGNORE INTO users (id,username,password,phone,createdAt) VALUES (?,?,?,?,?)',
      [u.id || Date.now(), u.username || '', u.password || '', u.phone, u.createdAt || new Date().toISOString()]);
  }
  console.log('  users: ' + users.length);

  // posts
  const posts = readJSON('posts');
  for (const p of posts) {
    await run('INSERT IGNORE INTO posts (id,phone,title,image,description,status,createdAt) VALUES (?,?,?,?,?,?,?)',
      [p.id, p.phone, p.title || '', p.image || p.imageUrl || '', p.description, p.status || 'pending', p.createdAt]);
  }
  console.log('  posts: ' + posts.length);

  // announcements
  const announcements = readJSON('announcements');
  for (const a of announcements) {
    await run('INSERT IGNORE INTO announcements (id,content,createdAt) VALUES (?,?,?)', [a.id, a.content, a.createdAt]);
  }
  console.log('  announcements: ' + announcements.length);

  // privacy
  const privacy = readJSON('privacy');
  await run('INSERT IGNORE INTO privacy (id,content) VALUES (1,?) ON DUPLICATE KEY UPDATE content=?', [privacy.content, privacy.content]);

  // hero
  const hero = readJSON('hero');
  await run('INSERT IGNORE INTO hero_config (id,badge,title,subtitle,intervalSec,images) VALUES (1,?,?,?,?,?) ON DUPLICATE KEY UPDATE badge=?,intervalSec=?,images=?',
    [hero.badge || '', hero.title || '', hero.subtitle || '', hero.interval || 20, (hero.images || []).join(','), hero.badge || '', hero.interval || 20, (hero.images || []).join(',')]);

  // reg_code
  const reg = readJSON('reg_code');
  await run('INSERT IGNORE INTO reg_code (id,code) VALUES (1,?) ON DUPLICATE KEY UPDATE code=?', [reg.code || '', reg.code || '']);

  // admin_users
  const admins = readJSON('admin_users');
  for (const a of admins) {
    await run('INSERT IGNORE INTO admin_users (id,username,password,role,createdAt) VALUES (?,?,?,?,?)',
      [a.id, a.username, a.password, a.role || 'admin', a.createdAt]);
  }
  console.log('  admin_users: ' + admins.length);

  // admin_log (seed empty)
  const log = readJSON('admin_log');
  if (Array.isArray(log) && log.length > 0) {
    for (const l of log) {
      await run('INSERT IGNORE INTO admin_log (id,adminUser,action,target,detail,timestamp) VALUES (?,?,?,?,?,?)',
        [l.id || Date.now(), l.adminUser, l.action, l.target || '', l.detail || '', l.timestamp]);
    }
  }
  console.log('Done!');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
