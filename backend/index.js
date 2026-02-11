require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { pool, initDb } = require("./db");
const QRCode = require("qrcode");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "12h";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_LOGIN_MAX = Number(process.env.RATE_LIMIT_LOGIN_MAX || 10);
const RATE_LIMIT_REGISTER_MAX = Number(process.env.RATE_LIMIT_REGISTER_MAX || 5);

if (IS_PROD && JWT_SECRET === "dev_secret_change_me") {
  console.error("JWT_SECRET must be set in production.");
  process.exit(1);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (!IS_PROD && CORS_ORIGINS.length === 0) return callback(null, true);
    if (CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin denied"));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: "1mb" }));

const rateBuckets = new Map();
const createRateLimiter = ({ keyPrefix, windowMs, max }) => (req, res, next) => {
  const source = req.headers["x-forwarded-for"] || req.ip || "unknown";
  const key = `${keyPrefix}:${source}:${req.path}`;
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (entry.count >= max) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }
  entry.count += 1;
  return next();
};

const loginRateLimit = createRateLimiter({
  keyPrefix: "login",
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_LOGIN_MAX
});

const registerRateLimit = createRateLimiter({
  keyPrefix: "register",
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_REGISTER_MAX
});

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets.entries()) {
    if (now > entry.resetAt) {
      rateBuckets.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

const dbGet = async (sql, params = []) => {
  const res = await pool.query(sql, params);
  return res.rows[0];
};

const dbAll = async (sql, params = []) => {
  const res = await pool.query(sql, params);
  return res.rows;
};

const dbRun = async (sql, params = []) => {
  const res = await pool.query(sql, params);
  return { rowCount: res.rowCount, rows: res.rows };
};

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

const isEmail = (value) =>
  typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isHttpsUrl = (value) => {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const parseNonNegativeInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
};

const requireFields = (body, fields = []) => {
  const missing = fields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || String(value).trim() === "";
  });
  return missing;
};

const sendServerError = (res, err) => {
  console.error(err);
  return res
    .status(500)
    .json({ error: IS_PROD ? "Internal server error" : err.message });
};

const logAudit = async (req, action, targetType, targetId, details = null) => {
  try {
    await dbRun(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user?.id || null,
        req.user?.role || null,
        action,
        targetType,
        targetId ? String(targetId) : null,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (err) {
    console.warn("Audit log write failed:", err.message);
  }
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

app.get("/api/health", async (req, res) => {
  try {
    await dbGet(`SELECT 1 as ok`);
    res.json({
      status: "ok",
      app: "up",
      db: "up",
      time: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      app: "up",
      db: "down",
      time: new Date().toISOString()
    });
  }
});

app.post("/api/login", loginRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;
    const missing = requireFields(req.body, ["email", "password"]);
    if (missing.length > 0) {
      return res.status(400).json({ error: "Email and password required" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    let user = await dbGet(`SELECT * FROM users WHERE email=$1`, [email.trim()]);

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
      await dbRun(`UPDATE users SET password=$1 WHERE id=$2`, [hashed, user.id]);
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
    sendServerError(res, err);
  }
});

app.post("/api/register", registerRateLimit, async (req, res) => {
  try {
    const { name, email, password, seller_whatsapp } = req.body;
    const missing = requireFields(req.body, [
      "name",
      "email",
      "password",
      "seller_whatsapp"
    ]);
    if (missing.length > 0) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await dbGet(`SELECT id FROM users WHERE email=$1`, [email]);
    if (existing) {
      return res.status(400).json({ error: "Email already in use" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun(
      `INSERT INTO users (name, email, password, role, approved, seller_whatsapp) VALUES ($1, $2, $3, 'seller', FALSE, $4) RETURNING id`,
      [name, email, hashed, seller_whatsapp]
    );

    res.json({ message: "Seller registered", id: result.rows[0].id });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/profile", auth(["admin", "seller"]), async (req, res) => {
  try {
    const user = await dbGet(
      `SELECT id, name, email, role, seller_whatsapp, phone, avatar_url FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.put("/api/profile", auth(["admin", "seller"]), async (req, res) => {
  try {
    const { name, phone, seller_whatsapp, avatar_url } = req.body;
    const current = await dbGet(
      `SELECT id, name, email, role, seller_whatsapp, phone, avatar_url FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!current) {
      return res.status(404).json({ error: "User not found" });
    }

    const nextName = name ?? current.name;
    const nextPhone = phone ?? current.phone ?? (current.role === "seller" ? seller_whatsapp : current.phone);
    const nextSellerWhatsApp =
      seller_whatsapp ??
      (current.role === "seller" ? nextPhone ?? current.seller_whatsapp : current.seller_whatsapp);
    const nextAvatar = avatar_url ?? current.avatar_url;
    if (String(nextName || "").trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!isHttpsUrl(nextAvatar)) {
      return res.status(400).json({ error: "Profile image URL must be a valid https URL" });
    }

    const updated = await dbRun(
      `UPDATE users SET name=$1, phone=$2, seller_whatsapp=$3, avatar_url=$4 WHERE id=$5
       RETURNING id, name, email, role, seller_whatsapp, phone, avatar_url`,
      [nextName, nextPhone, nextSellerWhatsApp, nextAvatar, req.user.id]
    );

    await logAudit(req, "profile_update", "user", req.user.id, {
      name_changed: nextName !== current.name,
      phone_changed: nextPhone !== current.phone,
      avatar_changed: nextAvatar !== current.avatar_url
    });

    res.json(updated.rows[0]);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.post("/api/events", auth(["admin"]), async (req, res) => {
  try {
    const { name, date, time, venue } = req.body;
    const missing = requireFields(req.body, ["name", "date", "time", "venue"]);
    if (missing.length > 0) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const created = await dbRun(
      `INSERT INTO events (name, date, time, venue, active) VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [name, date, time, venue]
    );
    await logAudit(req, "event_create", "event", created.rows?.[0]?.id || null, {
      name,
      date,
      time,
      venue
    });

    res.json({ message: "Event created" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/events", auth(["admin", "seller"]), async (req, res) => {
  try {
    const activeOnly = req.query.active === "1";
    const rows = await dbAll(
      `SELECT * FROM events ${activeOnly ? "WHERE active=TRUE" : ""} ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.put("/api/events/:id", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, time, venue } = req.body;
    const missing = requireFields(req.body, ["name", "date", "time", "venue"]);
    if (missing.length > 0) {
      return res.status(400).json({ error: "All fields are required" });
    }

    await dbRun(
      `UPDATE events SET name=$1, date=$2, time=$3, venue=$4 WHERE id=$5`,
      [name, date, time, venue, id]
    );
    await logAudit(req, "event_update", "event", id, { name, date, time, venue });

    res.json({ message: "Event updated" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.patch("/api/events/:id/activate", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE events SET active=TRUE WHERE id=$1`, [id]);
    await logAudit(req, "event_activate", "event", id);
    res.json({ message: "Event activated" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.patch("/api/events/:id/deactivate", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE events SET active=FALSE WHERE id=$1`, [id]);
    await logAudit(req, "event_deactivate", "event", id);
    res.json({ message: "Event deactivated" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.delete("/api/events/:id", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const event = await dbGet(`SELECT id, active FROM events WHERE id=$1`, [id]);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.active) {
      return res
        .status(400)
        .json({ error: "Deactivate the event before deleting." });
    }
    const tickets = await dbAll(`SELECT id FROM tickets WHERE event_id=$1`, [id]);
    for (const ticket of tickets) {
      await dbRun(`DELETE FROM scan_logs WHERE ticket_id=$1`, [ticket.id]);
    }
    await dbRun(`DELETE FROM tickets WHERE event_id=$1`, [id]);
    await dbRun(`DELETE FROM events WHERE id=$1`, [id]);
    await logAudit(req, "event_delete", "event", id, { deleted_tickets: tickets.length });
    res.json({ message: "Event deleted" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/sellers", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, name, email, role, ticket_limit, tickets_sold, approved, seller_whatsapp, suspended FROM users WHERE role='seller' ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/admin/events", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM events ORDER BY id DESC`);
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.patch("/api/sellers/:id/approve", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const seller = await dbGet(
      `SELECT id, name, email, seller_whatsapp, approved FROM users WHERE id=$1 AND role='seller'`,
      [id]
    );

    if (!seller) {
      return res.status(404).json({ error: "Seller not found" });
    }

    await dbRun(`UPDATE users SET approved=TRUE WHERE id=$1`, [id]);

    const notifications = await sendApprovalNotifications(seller);
    await logAudit(req, "seller_approve", "seller", id, { notifications });

    res.json({ message: "Seller approved", notifications });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.patch("/api/sellers/:id/limit", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const { ticket_limit } = req.body;
    const nextLimit = parseNonNegativeInt(ticket_limit);

    if (nextLimit === null) {
      return res.status(400).json({ error: "ticket_limit must be a non-negative integer" });
    }

    const seller = await dbGet(
      `SELECT id, role, tickets_sold FROM users WHERE id=$1`,
      [id]
    );

    if (!seller || seller.role !== "seller") {
      return res.status(404).json({ error: "Seller not found" });
    }

    if (nextLimit < seller.tickets_sold) {
      return res.status(400).json({
        error: `Limit cannot be lower than tickets sold (${seller.tickets_sold})`
      });
    }

    const updated = await dbRun(
      `UPDATE users SET ticket_limit=$1 WHERE id=$2 RETURNING id, ticket_limit, tickets_sold`,
      [nextLimit, id]
    );
    await logAudit(req, "seller_limit_change", "seller", id, {
      ticket_limit: nextLimit
    });

    res.json({ message: "Seller limit updated", seller: updated.rows[0] });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.patch("/api/sellers/:id/suspend", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE users SET suspended=TRUE WHERE id=$1 AND role='seller'`, [id]);
    await logAudit(req, "seller_suspend", "seller", id);
    res.json({ message: "Seller suspended" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.patch("/api/sellers/:id/unsuspend", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`UPDATE users SET suspended=FALSE WHERE id=$1 AND role='seller'`, [id]);
    await logAudit(req, "seller_unsuspend", "seller", id);
    res.json({ message: "Seller reactivated" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.delete("/api/sellers/:id", auth(["admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    const seller = await dbGet(`SELECT id, role, suspended FROM users WHERE id=$1`, [id]);
    if (!seller || seller.role !== "seller") {
      return res.status(404).json({ error: "Seller not found" });
    }
    if (!seller.suspended) {
      return res
        .status(400)
        .json({ error: "Suspend the seller before deleting." });
    }
    await dbRun(`DELETE FROM scan_logs WHERE ticket_id IN (SELECT id FROM tickets WHERE seller_id=$1)`, [id]);
    await dbRun(`DELETE FROM tickets WHERE seller_id=$1`, [id]);
    await dbRun(`DELETE FROM users WHERE id=$1`, [id]);
    await logAudit(req, "seller_delete", "seller", id);
    res.json({ message: "Seller deleted" });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/sellers/:id/summary", auth(["seller", "admin"]), async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user.role !== "admin" && Number(id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const seller = await dbGet(
      `SELECT id, name, ticket_limit, tickets_sold FROM users WHERE id=$1 AND role='seller'`,
      [id]
    );

    if (!seller) {
      return res.status(404).json({ error: "Seller not found" });
    }

    const totals = await dbGet(
      `SELECT COUNT(*)::int as total, COALESCE(SUM(CASE WHEN status='used' THEN 1 ELSE 0 END),0)::int as used FROM tickets WHERE seller_id=$1`,
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
    sendServerError(res, err);
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
       WHERE t.seller_id=$1
       ORDER BY t.id DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.post("/api/tickets", auth(["seller"]), async (req, res) => {
  try {
    const { event_id, customer_name, customer_whatsapp } = req.body;
    const seller_id = req.user.id;
    const missing = requireFields(req.body, [
      "event_id",
      "customer_name",
      "customer_whatsapp"
    ]);
    if (missing.length > 0) {
      return res.status(400).json({ error: "All fields are required" });
    }
    const parsedEventId = parseNonNegativeInt(event_id);
    if (parsedEventId === null || parsedEventId === 0) {
      return res.status(400).json({ error: "event_id must be a positive integer" });
    }

    const seller = await dbGet(
      `SELECT id, ticket_limit, tickets_sold, approved, suspended FROM users WHERE id=$1 AND role='seller'`,
      [seller_id]
    );

    if (!seller) {
      return res.status(404).json({ error: "Seller not found" });
    }

    if (seller.suspended) {
      return res.status(403).json({ error: "Seller account suspended" });
    }

    if (!seller.approved) {
      return res.status(403).json({ error: "Seller not approved" });
    }

    if (seller.tickets_sold >= seller.ticket_limit) {
      return res.status(400).json({ error: "Ticket limit reached" });
    }

    const event = await dbGet(`SELECT * FROM events WHERE id=$1`, [parsedEventId]);
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING id`,
      [
        event_id,
        event.name,
        event.date,
        event.time,
        event.venue,
        seller_id,
        String(customer_name).trim(),
        String(customer_whatsapp).trim(),
        qr,
        ticket_code
      ]
    );

    await dbRun(`UPDATE users SET tickets_sold = tickets_sold + 1 WHERE id=$1`, [
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
      ticket_id: result.rows[0].id,
      ticket_code,
      qr,
      event,
      customer_name,
      customer_whatsapp,
      whatsapp_delivery: delivery
    });
  } catch (err) {
    sendServerError(res, err);
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
    sendServerError(res, err);
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
       WHERE t.ticket_code=$1`,
      [ticketCode]
    );

    if (!ticket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    res.json(ticket);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/tickets/:ticketCode/qr.png", async (req, res) => {
  try {
    const { ticketCode } = req.params;
    const ticket = await dbGet(
      `SELECT qr_code_data FROM tickets WHERE ticket_code=$1`,
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
    sendServerError(res, err);
  }
});

app.post("/api/scan", auth(["admin"]), async (req, res) => {
  try {
    const { ticketCode } = req.body;
    if (!ticketCode || String(ticketCode).trim() === "") {
      return res.status(400).json({ error: "ticketCode is required" });
    }
    const normalizedTicketCode = String(ticketCode).trim();

    const ticket = await dbGet(`SELECT * FROM tickets WHERE ticket_code=$1`, [normalizedTicketCode]);

    if (!ticket) {
      return res.status(404).json({ error: "Invalid ticket" });
    }

    if (ticket.status === "used") {
      return res.status(400).json({ error: "Already used" });
    }

    await dbRun(`UPDATE tickets SET status='used', scanned_at=NOW() WHERE id=$1`, [
      ticket.id
    ]);

    await dbRun(
      `INSERT INTO scan_logs (ticket_id, ticket_code, scanner_id, scanned_at) VALUES ($1, $2, $3, NOW())`,
      [ticket.id, ticket.ticket_code, req.user?.id || null]
    );
    await logAudit(req, "ticket_scan_verify", "ticket", ticket.id, {
      ticket_code: ticket.ticket_code
    });

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
       WHERE t.id=$1`,
      [ticket.id]
    );

    res.json({ message: "Ticket verified", ticket: hydrated });
  } catch (err) {
    sendServerError(res, err);
  }
});

app.get("/api/admin/audit-logs", auth(["admin"]), async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT id, actor_id, actor_role, action, target_type, target_id, details, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    sendServerError(res, err);
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
    sendServerError(res, err);
  }
});

app.get("/api/admin/stats", auth(["admin"]), async (req, res) => {
  try {
    const totals = await dbGet(
      `SELECT
        (SELECT COUNT(*)::int FROM tickets) as total_tickets,
        (SELECT COUNT(*)::int FROM tickets WHERE status='used') as used_tickets,
        (SELECT COUNT(*)::int FROM tickets WHERE status='unused') as unused_tickets,
        (SELECT COUNT(*)::int FROM users WHERE role='seller') as sellers,
        (SELECT COUNT(*)::int FROM events) as events,
        (SELECT COUNT(*)::int FROM events WHERE active=TRUE) as active_events`
    );
    res.json(totals);
  } catch (err) {
    sendServerError(res, err);
  }
});

app.use((err, req, res, next) => {
  if (err?.message === "CORS origin denied") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  return next(err);
});

(async () => {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Backend running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to initialize database:", err.message);
    process.exit(1);
  }
})();

