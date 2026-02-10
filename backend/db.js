const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const db = new sqlite3.Database(path.join(__dirname, "partyPass.db"));

const ensureColumn = (table, column, definition) => {
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err) {
      console.error(`PRAGMA failed for ${table}:`, err.message);
      return;
    }
    const exists = rows.some((row) => row.name === column);
    if (!exists) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  });
};

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      password TEXT,
      role TEXT,
      ticket_limit INTEGER DEFAULT 100,
      tickets_sold INTEGER DEFAULT 0,
      approved INTEGER DEFAULT 0,
      seller_whatsapp TEXT,
      suspended INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      date TEXT,
      time TEXT,
      venue TEXT,
      active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER,
      event_name TEXT,
      event_date TEXT,
      event_time TEXT,
      event_venue TEXT,
      seller_id INTEGER,
      customer_name TEXT,
      customer_whatsapp TEXT,
      qr_code_data TEXT,
      ticket_code TEXT,
      issued_at TEXT,
      status TEXT DEFAULT 'unused',
      scanned_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER,
      ticket_code TEXT,
      scanner_id INTEGER,
      scanned_at TEXT
    )
  `);

  ensureColumn("users", "approved", "INTEGER DEFAULT 0");
  ensureColumn("users", "seller_whatsapp", "TEXT");
  ensureColumn("users", "suspended", "INTEGER DEFAULT 0");
  ensureColumn("events", "active", "INTEGER DEFAULT 1");
  ensureColumn("tickets", "ticket_code", "TEXT");
  ensureColumn("tickets", "issued_at", "TEXT");
  ensureColumn("tickets", "event_name", "TEXT");
  ensureColumn("tickets", "event_date", "TEXT");
  ensureColumn("tickets", "event_time", "TEXT");
  ensureColumn("tickets", "event_venue", "TEXT");

  db.get(`SELECT * FROM users WHERE role='admin'`, (err, row) => {
    if (err) {
      console.error("Failed to check for admin:", err.message);
      return;
    }
    if (!row) {
      db.run(
        `INSERT INTO users (name, email, password, role, approved) VALUES (?, ?, ?, ?, ?)`,
        ["Admin User", "admin@party.com", "admin123", "admin", 1]
      );
      console.log("Admin user created: admin@party.com / admin123");
    }
  });
});

module.exports = db;
