// 数据库连接模块
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// 优先用环境变量，不然 fallback 本地测试
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT) || 4000,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'camera_rental',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true
});

// 初始化建表（首次启动自动创建）
async function initDB() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  const statements = sql.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    try { await pool.execute(stmt); } catch (e) { if (!e.message.includes('already exists') && !e.message.includes('Duplicate')) console.error('DB init:', e.message); }
  }
  console.log('Database ready');
}

// 快捷方法
async function query(sql, params) { const [rows] = await pool.execute(sql, params || []); return rows; }
async function get(sql, params) { const rows = await query(sql, params); return rows[0] || null; }
async function run(sql, params) { const [result] = await pool.execute(sql, params || []); return result; }

module.exports = { pool, initDB, query, get, run };
