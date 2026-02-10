require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const db = require("./db");
const QRCode = require("qrcode");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "12h";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

const DEFAULT_ADMIN = {
  name: "Admin User",
  email: "admin@party.com",
  password: "admin123"
};

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

const makeTicketCode = () =>
  `PP-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;

const isHashedPassword = (value) => typeof value === "string" && value.startsWith("$2");

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES
  });

const sanitizeUser = (user) => {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
};

const auth = (roles = []) => async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization" });
    }
    const token = header.replace("Bearer ", "");
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;

    if (roles.length && !roles.includes(payload.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const normalizeWhatsApp = (value) => {
  if (!value) return null;
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
};

const createMailer = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return { transporter: null, from: null, status: "not_configured" };
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    return { transporter, from: SMTP_FROM, status: "ready" };
  } catch (err) {
    console.warn("Email notifications disabled:", err.message);
    return { transporter: null, from: null, status: "unavailable" };
  }
};

const createTwilioClient = () => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return null;
  }

  try {
    const twilio = require("twilio");
    return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch (err) {
    console.warn("WhatsApp notifications disabled:", err.message);
    return null;
  }
};

const sendApprovalNotifications = async (seller) => {
  const results = { email: "skipped", whatsapp: "skipped" };
  const message = `Hi ${seller.name}, your PartyPass seller account is approved. You can now log in and generate tickets.`;

  const mailer = createMailer();
  if (mailer.status === "ready") {
    try {
      await mailer.transporter.sendMail({
        from: mailer.from,
        to: seller.email,
        subject: "PartyPass Seller Approved",
        text: message
      });
      results.email = "sent";
    } catch (err) {
      results.email = `failed: ${err.message}`;
    }
  } else {
    results.email = mailer.status;
  }

  const twilioClient = createTwilioClient();
  const whatsappFrom = normalizeWhatsApp(process.env.TWILIO_WHATSAPP_FROM);
  const whatsappTo = normalizeWhatsApp(seller.seller_whatsapp);

  if (twilioClient && whatsappFrom && whatsappTo) {
    try {
      await twilioClient.messages.create({
        from: whatsappFrom,
        to: whatsappTo,
        body: message
      });
      results.whatsapp = "sent";
    } catch (err) {
      results.whatsapp = `failed: ${err.message}`;
    }
  } else if (!seller.seller_whatsapp) {
    results.whatsapp = "missing_number";
  } else {
    results.whatsapp = "not_configured";
  }

  return results;
};

const sendTicketWhatsApp = async ({ ticket, event }) => {
  const twilioClient = createTwilioClient();
  const whatsappFrom = normalizeWhatsApp(process.env.TWILIO_WHATSAPP_FROM);
  const whatsappTo = normalizeWhatsApp(ticket.customer_whatsapp);

  if (!ticket.customer_whatsapp) {
    return { status: "missing_number" };
  }

  if (!twilioClient || !whatsappFrom) {
    return { status: "not_configured" };
  }

  const ticketUrl = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/ticket/view/${ticket.ticket_code}`
    : null;
  const mediaUrl = PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/api/tickets/${ticket.ticket_code}/qr.png`
    : null;

  const body = [
    "PartyPass Ticket",
    `Event: ${event.name}`,
    `Date: ${event.date} ${event.time}`,
    `Venue: ${event.venue}`,
    `Ticket: ${ticket.ticket_code}`,
    ticketUrl ? `View: ${ticketUrl}` : null
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await twilioClient.messages.create({
      from: whatsappFrom,
      to: whatsappTo,
      body,
      mediaUrl: mediaUrl ? [mediaUrl] : undefined
    });

    return {
      status: "sent",
      media: mediaUrl ? "attached" : "none"
    };
  } catch (err) {
    return {
      status: "failed",
      error: err.message
    };
  }
};

app.get("/", (req, res) => {
  res.send("PartyPass Backend Running");
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    let user = await dbGet(`SELECT * FROM users WHERE email=?`, [email]);

    if (!user && email === DEFAULT_ADMIN.email && password === DEFAULT_ADMIN.password) {
      const hashed = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
      await dbRun(
        `INSERT INTO users (name, email, password, role, approved) VALUES (?, ?, ?, 'admin', 1)`,
        [DEFAULT_ADMIN.name, DEFAULT_ADMIN.email, hashed]
      );
      user = await dbGet(`SELECT * FROM users WHERE email=?`, [email]);
    }

    if (user && email === DEFAULT_ADMIN.email && password === DEFAULT_ADMIN.password) {
      const hashed = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
      await dbRun(
        `UPDATE users SET name=?, password=?, role='admin', approved=1 WHERE id=?`,
        [DEFAULT_ADMIN.name, hashed, user.id]
      );
      user = await dbGet(`SELECT * FROM users WHERE id=?`, [user.id]);
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const passwordMatches = isHashedPassword(user.password)
      ? await bcrypt.compare(password, user.password)
      : user.password === password;

    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!isHashedPassword(user.password)) {
      const hashed = await bcrypt.hash(password, 10);
      await dbRun(`UPDATE users SET password=? WHERE id=?`, [hashed, user.id]);
      user.password = hashed;
    }

    if (user.role === "seller" && user.suspended) {
      return res.status(403).json({ error: "Seller account suspended" });
    }

    if (user.role === "seller" && !user.approved) {
      return res.status(403).json({ error: "Seller not approved" });
    }

    const token = signToken(user);
    res.json({ user: sanitizeUser(user), token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password, seller_whatsapp } = req.body;
    if (!name || !email || !password || !seller_whatsapp) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existing = await dbGet(`SELECT id FROM users WHERE email=?`, [email]);
    if (existing) {
      return res.status(400).json({ error: "Email already in use" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun(
      `INSERT INTO users (name, email, password, role, approved, seller_whatsapp) VALUES (?, ?, ?, 'seller', 0, ?)`,
      [name, email, hashed, seller_whatsapp]
    );

    res.json({ message: "Seller registered", id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/events", auth(["admin"]), async (req, res) => {
  try {
    const { name, date, time, venue } = req.body;
    if (!name || !date || !time || !venue) {
      return res.status(400).json({ error: "All fields are required" });
    }

    await dbRun(
      `INSERT INTO events (name, date, time, venue, active) VALUES (?, ?, ?, ?, 1)`,
      [name, date, time, venue]
    );

    res.json({ message: "Event created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/events", auth(["admin", "seller"]), async (req, res) => {
  try {
    const activeOnly = req.query.active === "1";
    const rows = await dbAll(
      `SELECT * FROM events ${activeOnly ? "WHERE active=1" : ""} ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/events/:id", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, time, venue } = req.body;
    if (!name || !date || !time || !venue) {
      return res.status(400).json({ error: "All fields are required" });
    }

    await dbRun(
      `UPDATE events SET name=?, date=?, time=?, venue=? WHERE id=?`,
      [name, date, time, venue, id]
    );

    res.json({ message: "Event updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/events/:id/activate", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE events SET active=1 WHERE id=?`, [id]);
    res.json({ message: "Event activated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/events/:id/deactivate", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE events SET active=0 WHERE id=?`, [id]);
    res.json({ message: "Event deactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/events/:id", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const event = await dbGet(`SELECT id, active FROM events WHERE id=?`, [id]);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.active) {
      return res
        .status(400)
        .json({ error: "Deactivate the event before deleting." });
    }
    const tickets = await dbAll(`SELECT id FROM tickets WHERE event_id=?`, [id]);
    for (const ticket of tickets) {
      await dbRun(`DELETE FROM scan_logs WHERE ticket_id=?`, [ticket.id]);
    }
    await dbRun(`DELETE FROM tickets WHERE event_id=?`, [id]);
    await dbRun(`DELETE FROM events WHERE id=?`, [id]);
    res.json({ message: "Event deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sellers", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, name, email, role, ticket_limit, tickets_sold, approved, seller_whatsapp, suspended FROM users WHERE role='seller' ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/events", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM events ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/sellers/:id/approve", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const seller = await dbGet(
      `SELECT id, name, email, seller_whatsapp, approved FROM users WHERE id=? AND role='seller'`,
      [id]
    );

    if (!seller) {
      return res.status(404).json({ error: "Seller not found" });
    }

    await dbRun(`UPDATE users SET approved=1 WHERE id=?`, [id]);

    const notifications = await sendApprovalNotifications(seller);

    res.json({ message: "Seller approved", notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/sellers/:id/suspend", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE users SET suspended=1 WHERE id=? AND role='seller'`, [id]);
    res.json({ message: "Seller suspended" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/sellers/:id/unsuspend", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE users SET suspended=0 WHERE id=? AND role='seller'`, [id]);
    res.json({ message: "Seller reactivated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/sellers/:id", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const seller = await dbGet(`SELECT id, role, suspended FROM users WHERE id=?`, [id]);
    if (!seller || seller.role !== "seller") {
      return res.status(404).json({ error: "Seller not found" });
    }
    if (!seller.suspended) {
      return res
        .status(400)
        .json({ error: "Suspend the seller before deleting." });
    }
    await dbRun(`DELETE FROM scan_logs WHERE ticket_id IN (SELECT id FROM tickets WHERE seller_id=?)`, [id]);
    await dbRun(`DELETE FROM tickets WHERE seller_id=?`, [id]);
    await dbRun(`DELETE FROM users WHERE id=?`, [id]);
    res.json({ message: "Seller deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/sellers/:id/limit", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { ticket_limit } = req.body;
    if (ticket_limit === undefined) {
      return res.status(400).json({ error: "ticket_limit is required" });
    }

    await dbRun(`UPDATE users SET ticket_limit=? WHERE id=?`, [ticket_limit, id]);
    res.json({ message: "Limit updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sellers/:id/summary", auth(["seller", "admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && Number(id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const seller = await dbGet(
      `SELECT id, name, ticket_limit, tickets_sold FROM users WHERE id=? AND role='seller'`,
      [id]
    );

    if (!seller) {
      return res.status(404).json({ error: "Seller not found" });
    }

    const totals = await dbGet(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status='used' THEN 1 ELSE 0 END) as used FROM tickets WHERE seller_id=?`,
      [id]
    );

    res.json({
      total: totals?.total || 0,
      used: totals?.used || 0,
      remaining: Math.max(seller.ticket_limit - seller.tickets_sold, 0),
      limit: seller.ticket_limit,
      sold: seller.tickets_sold
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sellers/:id/tickets", auth(["seller", "admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && Number(id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await dbAll(
      `SELECT t.*,
              COALESCE(t.event_name, e.name) as event_name,
              COALESCE(t.event_date, e.date) as event_date,
              COALESCE(t.event_time, e.time) as event_time,
              COALESCE(t.event_venue, e.venue) as event_venue
       FROM tickets t
       LEFT JOIN events e ON t.event_id = e.id
       WHERE t.seller_id=?
       ORDER BY t.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tickets", auth(["seller"]), async (req, res) => {
  try {
    const { event_id, customer_name, customer_whatsapp } = req.body;
    const seller_id = req.user.id;
    if (!event_id || !customer_name || !customer_whatsapp) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const seller = await dbGet(
      `SELECT id, ticket_limit, tickets_sold, approved FROM users WHERE id=? AND role='seller'`,
      [seller_id]
    );

    if (!seller) {
      return res.status(404).json({ error: "Seller not found" });
    }

    if (!seller.approved) {
      return res.status(403).json({ error: "Seller not approved" });
    }

    if (seller.tickets_sold >= seller.ticket_limit) {
      return res.status(400).json({ error: "Ticket limit reached" });
    }

    const event = await dbGet(`SELECT * FROM events WHERE id=?`, [event_id]);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    if (!event.active) {
      return res.status(400).json({ error: "Event is inactive" });
    }

    const ticket_code = makeTicketCode();
    const qr = await QRCode.toDataURL(ticket_code);

    const result = await dbRun(
      `INSERT INTO tickets (event_id, event_name, event_date, event_time, event_venue, seller_id, customer_name, customer_whatsapp, qr_code_data, ticket_code, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        event_id,
        event.name,
        event.date,
        event.time,
        event.venue,
        seller_id,
        customer_name,
        customer_whatsapp,
        qr,
        ticket_code
      ]
    );

    await dbRun(`UPDATE users SET tickets_sold = tickets_sold + 1 WHERE id=?`, [
      seller_id
    ]);

    const delivery = await sendTicketWhatsApp({
      ticket: {
        ticket_code,
        customer_whatsapp,
        customer_name
      },
      event
    });

    res.json({
      message: "Ticket generated",
      ticket_id: result.lastID,
      ticket_code,
      qr,
      event,
      customer_name,
      customer_whatsapp,
      whatsapp_delivery: delivery
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tickets/:ticketCode", async (req, res) => {
  try {
    const { ticketCode } = req.params;
    const ticket = await dbGet(
      `SELECT t.*,
              COALESCE(t.event_name, e.name) as event_name,
              COALESCE(t.event_date, e.date) as event_date,
              COALESCE(t.event_time, e.time) as event_time,
              COALESCE(t.event_venue, e.venue) as event_venue,
              u.name as seller_name
       FROM tickets t
       LEFT JOIN events e ON t.event_id = e.id
       LEFT JOIN users u ON t.seller_id = u.id
       WHERE t.ticket_code=?`,
      [ticketCode]
    );

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tickets", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT t.*,
              COALESCE(t.event_name, e.name) as event_name,
              COALESCE(t.event_date, e.date) as event_date,
              COALESCE(t.event_time, e.time) as event_time,
              COALESCE(t.event_venue, e.venue) as event_venue,
              u.name as seller_name
       FROM tickets t
       LEFT JOIN events e ON t.event_id = e.id
       LEFT JOIN users u ON t.seller_id = u.id
       ORDER BY t.id DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tickets/:ticketCode/qr.png", async (req, res) => {
  try {
    const { ticketCode } = req.params;
    const ticket = await dbGet(
      `SELECT qr_code_data FROM tickets WHERE ticket_code=?`,
      [ticketCode]
    );

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const match = ticket.qr_code_data?.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "QR data missing" });
    }

    const buffer = Buffer.from(match[2], "base64");
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/scan", auth(["admin"]), async (req, res) => {
  try {
    const { ticketCode } = req.body;
    if (!ticketCode) {
      return res.status(400).json({ error: "ticketCode is required" });
    }

    const ticket = await dbGet(`SELECT * FROM tickets WHERE ticket_code=?`, [ticketCode]);

    if (!ticket) {
      return res.status(404).json({ error: "Invalid ticket" });
    }

    if (ticket.status === "used") {
      return res.status(400).json({ error: "Already used" });
    }

    await dbRun(`UPDATE tickets SET status='used', scanned_at=datetime('now') WHERE id=?`, [
      ticket.id
    ]);

    await dbRun(
      `INSERT INTO scan_logs (ticket_id, ticket_code, scanner_id, scanned_at) VALUES (?, ?, ?, datetime('now'))`,
      [ticket.id, ticket.ticket_code, req.user?.id || null]
    );

    const hydrated = await dbGet(
      `SELECT t.*,
              COALESCE(t.event_name, e.name) as event_name,
              COALESCE(t.event_date, e.date) as event_date,
              COALESCE(t.event_time, e.time) as event_time,
              COALESCE(t.event_venue, e.venue) as event_venue,
              u.name as seller_name
       FROM tickets t
       LEFT JOIN events e ON t.event_id = e.id
       LEFT JOIN users u ON t.seller_id = u.id
       WHERE t.id=?`,
      [ticket.id]
    );

    res.json({ message: "Ticket verified", ticket: hydrated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/scan-logs", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT l.id, l.scanned_at, l.ticket_code,
              t.customer_name,
              t.customer_whatsapp,
              t.issued_at,
              COALESCE(t.event_name, e.name) as event_name,
              u.name as seller_name
       FROM scan_logs l
       LEFT JOIN tickets t ON l.ticket_id = t.id
       LEFT JOIN events e ON t.event_id = e.id
       LEFT JOIN users u ON t.seller_id = u.id
       ORDER BY l.scanned_at DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/stats", auth(["admin"]), async (req, res) => {
  try {
    const totals = await dbGet(
      `SELECT
        (SELECT COUNT(*) FROM tickets) as total_tickets,
        (SELECT COUNT(*) FROM tickets WHERE status='used') as used_tickets,
        (SELECT COUNT(*) FROM tickets WHERE status='unused') as unused_tickets,
        (SELECT COUNT(*) FROM users WHERE role='seller') as sellers,
        (SELECT COUNT(*) FROM events) as events,
        (SELECT COUNT(*) FROM events WHERE active=1) as active_events`
    );
    res.json(totals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
