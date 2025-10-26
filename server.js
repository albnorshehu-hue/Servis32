const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const upload = multer();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname))); // Shërben index.html & dashboard.html

// --- Krijo DB nëse nuk ekziston ---
const db = new sqlite3.Database('./parts.db', (err) => {
  if (err) return console.error(err);
  db.run(`CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_type TEXT,
    brand TEXT,
    model TEXT,
    fuel TEXT,
    engine TEXT,
    name TEXT NOT NULL,
    part_no TEXT NOT NULL,
    qty INTEGER DEFAULT 0,
    price REAL,
    note TEXT,
    location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// --- Login i thjeshtë demo ---
const DEMO_USER = { user: 'admin', pass: '1234' };
function makeToken() { return crypto.randomBytes(24).toString('hex'); }
const tokens = new Map();

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === DEMO_USER.user && pass === DEMO_USER.pass) {
    const token = makeToken();
    tokens.set(token, user);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Kredenciale të pavlefshme' });
  }
});

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const parts = h.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && tokens.has(parts[1])) {
    req.user = tokens.get(parts[1]);
    return next();
  }
  return res.status(401).json({ error: 'Nuk jeni i autorizuar' });
}

// --- Regjistrimi i pjesëve ---
app.post('/api/parts', authMiddleware, upload.none(), (req, res) => {
  const {
    vehicle_type, brand, model, fuel, engine,
    name, part_no, qty, price, note, location
  } = req.body || {};

  if (!name || !part_no)
    return res.status(400).json({ error: 'Emri dhe numri i pjesës janë të nevojshme.' });

  const stmt = db.prepare(`INSERT INTO parts
    (vehicle_type, brand, model, fuel, engine, name, part_no, qty, price, note, location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  stmt.run(
    vehicle_type || '',
    brand || '',
    model || '',
    fuel || '',
    engine || '',
    name,
    part_no,
    parseInt(qty) || 0,
    parseFloat(price) || null,
    note || '',
    location || '',
    function (err) {
      if (err) return res.status(500).json({ error: 'Gabim gjatë ruajtjes në DB' });
      res.json({ id: this.lastID });
    }
  );

  stmt.finalize();
});

// --- Kërkimi i pjesëve (multi-word, fjalë të shumta) ---
app.get('/api/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ rows: [] });

  const terms = q.split(/\s+/).map(t => t.toLowerCase());

  const sql = `SELECT * FROM parts ORDER BY id DESC LIMIT 1000`;

  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Gabim DB' });

    const filtered = rows.filter(row => {
      const rowText = Object.values(row).join(' ').toLowerCase();
      // kontrollon që çdo term të ekzistojë në tekst
      return terms.every(term => rowText.includes(term));
    });

    res.json({ rows: filtered });
  });
});

// --- Marrja e të gjitha pjesëve ---
app.get('/api/parts', authMiddleware, (req, res) => {
  db.all('SELECT * FROM parts ORDER BY id DESC LIMIT 200', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Gabim DB' });
    res.json({ rows });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));



