const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL is not set. Backend will fail to connect.");
}
const isProd = process.env.NODE_ENV === "production";

const shouldUseSsl = (() => {
  if (process.env.DATABASE_SSL) {
    return process.env.DATABASE_SSL.toLowerCase() === "true";
  }
  if (!connectionString) return false;
  return /supabase\.co|render\.com|neon\.tech/i.test(connectionString);
})();

const normalizedConnectionString = connectionString
  ? connectionString.replace(/([?&])sslmode=[^&]+/i, "$1").replace(/[?&]$/, "")
  : connectionString;

const pool = new Pool({
  connectionString: normalizedConnectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  family: 4
});

const initDb = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT,
      ticket_limit INTEGER DEFAULT 100,
      tickets_sold INTEGER DEFAULT 0,
      approved BOOLEAN DEFAULT FALSE,
      seller_whatsapp TEXT,
      suspended BOOLEAN DEFAULT FALSE,
      phone TEXT,
      avatar_url TEXT
    )
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT,
      date TEXT,
      time TEXT,
      venue TEXT,
      active BOOLEAN DEFAULT TRUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      event_id INTEGER,
      event_name TEXT,
      event_date TEXT,
      event_time TEXT,
      event_venue TEXT,
      seller_id INTEGER,
      customer_name TEXT,
      customer_whatsapp TEXT,
      qr_code_data TEXT,
      ticket_code TEXT UNIQUE,
      issued_at TIMESTAMP DEFAULT NOW(),
      status TEXT DEFAULT 'unused',
      scanned_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER,
      ticket_code TEXT,
      scanner_id INTEGER,
      scanned_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER,
      actor_role TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const adminCheck = await pool.query(
    `SELECT id FROM users WHERE role='admin' LIMIT 1`
  );

  if (adminCheck.rows.length === 0) {
    const adminName = process.env.ADMIN_NAME || "Admin User";
    const adminEmail = process.env.ADMIN_EMAIL || (!isProd ? "admin@party.com" : "");
    const adminPassword =
      process.env.ADMIN_PASSWORD || (!isProd ? "admin123" : "");

    if (!adminEmail || !adminPassword) {
      console.warn(
        "Admin seed skipped: set ADMIN_EMAIL and ADMIN_PASSWORD to create initial admin."
      );
    } else {
      const hashed = await bcrypt.hash(adminPassword, 10);
      await pool.query(
        `INSERT INTO users (name, email, password, role, approved) VALUES ($1, $2, $3, 'admin', TRUE)`,
        [adminName, adminEmail, hashed]
      );
      console.log(`Admin user created: ${adminEmail}`);
    }
  }
};

module.exports = { pool, initDb };
