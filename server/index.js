const express = require("express");
const cors = require("cors");
const { pool } = require("./db");
const { hashPassword, verifyPassword, signToken, requireAuth, EMAIL_RE } = require("./auth");

const app = express();
app.use(express.json({ limit: "256kb" }));

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

app.get("/api/health", (req, res) => res.json({ ok: true }));

/* ---------------- Auth ---------------- */

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const existing = await pool.query("SELECT id FROM parents WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    const { hash, salt } = hashPassword(password);
    const result = await pool.query(
      "INSERT INTO parents (email, password_hash, password_salt) VALUES ($1, $2, $3) RETURNING id, email",
      [normalizedEmail, hash, salt]
    );
    const parent = result.rows[0];
    res.status(201).json({ token: signToken(parent), parent });
  } catch (e) {
    console.error("register failed", e);
    res.status(500).json({ error: "Could not create the account. Please try again." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const normalizedEmail = email.trim().toLowerCase();
  try {
    const result = await pool.query(
      "SELECT id, email, password_hash, password_salt FROM parents WHERE email = $1",
      [normalizedEmail]
    );
    const row = result.rows[0];
    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    const parent = { id: row.id, email: row.email };
    res.json({ token: signToken(parent), parent });
  } catch (e) {
    console.error("login failed", e);
    res.status(500).json({ error: "Could not sign in. Please try again." });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ parent: { id: req.parentId, email: req.parentEmail } });
});

app.delete("/api/auth/me", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM parents WHERE id = $1", [req.parentId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("delete account failed", e);
    res.status(500).json({ error: "Could not delete the account." });
  }
});

/* ---------------- Child profiles ---------------- */
/* `data` is an opaque JSON blob owned by the frontend: settings, childModeConfig,
   voiceCategories, wordsActions, photoCategories, security.pinHash/pinSalt, etc.
   Photos, videos and audio recordings are never sent here — they stay in
   IndexedDB on the device that captured them. */

app.get("/api/children", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, data, sort_order, created_at, updated_at FROM children WHERE parent_id = $1 ORDER BY sort_order ASC, created_at ASC",
      [req.parentId]
    );
    res.json({ children: result.rows });
  } catch (e) {
    console.error("list children failed", e);
    res.status(500).json({ error: "Could not load child profiles." });
  }
});

app.post("/api/children", requireAuth, async (req, res) => {
  const { name, data } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "A child profile needs a name." });
  }
  try {
    const countResult = await pool.query("SELECT COUNT(*)::int AS n FROM children WHERE parent_id = $1", [req.parentId]);
    const sortOrder = countResult.rows[0].n;
    const result = await pool.query(
      "INSERT INTO children (parent_id, name, data, sort_order) VALUES ($1, $2, $3, $4) RETURNING id, name, data, sort_order, created_at, updated_at",
      [req.parentId, name.trim(), JSON.stringify(data || {}), sortOrder]
    );
    res.status(201).json({ child: result.rows[0] });
  } catch (e) {
    console.error("create child failed", e);
    res.status(500).json({ error: "Could not create the child profile." });
  }
});

app.put("/api/children/:id", requireAuth, async (req, res) => {
  const { name, data } = req.body || {};
  try {
    const owns = await pool.query("SELECT id FROM children WHERE id = $1 AND parent_id = $2", [req.params.id, req.parentId]);
    if (!owns.rows.length) return res.status(404).json({ error: "Child profile not found." });
    const result = await pool.query(
      `UPDATE children SET
         name = COALESCE($1, name),
         data = COALESCE($2, data),
         updated_at = now()
       WHERE id = $3 AND parent_id = $4
       RETURNING id, name, data, sort_order, created_at, updated_at`,
      [typeof name === "string" && name.trim() ? name.trim() : null, data ? JSON.stringify(data) : null, req.params.id, req.parentId]
    );
    res.json({ child: result.rows[0] });
  } catch (e) {
    console.error("update child failed", e);
    res.status(500).json({ error: "Could not save changes." });
  }
});

app.delete("/api/children/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM children WHERE id = $1 AND parent_id = $2 RETURNING id", [req.params.id, req.parentId]);
    if (!result.rows.length) return res.status(404).json({ error: "Child profile not found." });
    res.json({ ok: true });
  } catch (e) {
    console.error("delete child failed", e);
    res.status(500).json({ error: "Could not delete the child profile." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`My Voice and Safe Space API listening on ${PORT}`));
