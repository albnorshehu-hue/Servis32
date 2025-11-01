const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// --- Krijo folderin për imazhe nëse nuk ekziston ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// --- Konfigurimi për ruajtje të imazheve ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueName + ext);
  }
});
const upload = multer({ storage });

// --- Shërbe imazhet statike ---
app.use('/uploads', express.static(uploadDir));

// --- Krijo DB nëse nuk ekziston ---
const db = new sqlite3.Database('./parts.db', err => {
  if (err) return console.error(err);
  db.run(`CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT,
    model TEXT,
    category TEXT,
    name TEXT NOT NULL,
    fuel TEXT,
    engine TEXT,
    qty INTEGER DEFAULT 0,
    price REAL,
    note TEXT,
    location TEXT,
    image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// --- Login demo ---
const DEMO_USER = { user: 'admin', pass: '1234' };
const tokens = new Map();
const makeToken = () => crypto.randomBytes(24).toString('hex');

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === DEMO_USER.user && pass === DEMO_USER.pass) {
    const token = makeToken();
    tokens.set(token, user);
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Kredenciale të pavlefshme' });
  }
});

// --- Middleware për autorizim ---
function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && tokens.has(parts[1])) {
    req.user = tokens.get(parts[1]);
    return next();
  }
  res.status(401).json({ error: 'Jo i autorizuar' });
}

// --- Ruaj pjesë me imazh ---
app.post('/api/savePart', auth, upload.single('image'), (req, res) => {
  const {
    brand = '',
    model = '',
    category = '',
    name = '',
    fuel = '',
    engine = '',
    qty = 0,
    price = null,
    note = '',
    location = ''
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Emri i pjesës është i detyrueshëm.' });
  }

  const imagePath = req.file ? '/uploads/' + req.file.filename : '';

  db.run(
    `INSERT INTO parts 
    (brand, model, category, name, fuel, engine, qty, price, note, location, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [brand, model, category, name, fuel, engine, qty, price, note, location, imagePath],
    function (err) {
      if (err) {
  console.error('Gabim DB:', err.message);
  return res.status(500).json({ error: err.message });
}

      res.json({ success: true, id: this.lastID });
    }
  );
});





// --- Kërko pjesë ---
app.get('/api/search', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ rows: [] });

  const terms = q.split(/\s+/).map(t => t.toLowerCase());
  db.all(`SELECT * FROM parts ORDER BY id DESC LIMIT 1000`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Gabim DB.' });
    const filtered = rows.filter(row =>
      terms.every(term => Object.values(row).join(' ').toLowerCase().includes(term))
    );
    res.json({ rows: filtered });
  });
});

// --- Lista e pjesëve ---
app.get('/api/parts', auth, (req, res) => {
  db.all(`SELECT * FROM parts ORDER BY id DESC LIMIT 300`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Gabim DB.' });
    res.json({ rows });
  });
});

// --- Përditëso pjesë ---
app.put('/api/parts/:id', auth, upload.single('image'), (req, res) => {
  const id = parseInt(req.params.id);
  const {
    brand = '',
    model = '',
    category = '',
    name = '',
    fuel = '',
    engine = '',
    qty = 0,
    price = null,
    note = '',
    location = ''
  } = req.body;

  if (!name)
    return res.status(400).json({ error: 'Emri i pjesës është i detyrueshëm.' });

  let imagePath = null;
  if (req.file) imagePath = '/uploads/' + req.file.filename;

  const fields = [
    brand, model, category, name, fuel, engine,
    parseInt(qty) || 0,
    parseFloat(price) || null,
    note, location
  ];

  let sql = `UPDATE parts SET 
      brand=?, model=?, category=?, name=?, fuel=?, engine=?, 
      qty=?, price=?, note=?, location=?`;

  if (imagePath) {
    sql += `, image=?`;
    fields.push(imagePath);
  }

  sql += ` WHERE id=?`;
  fields.push(id);

  db.run(sql, fields, function (err) {
    if (err) return res.status(500).json({ error: 'Gabim gjatë përditësimit.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Pjesa nuk u gjet.' });
    res.json({ success: true });
  });
});

// --- Fshij pjesë ---
app.delete('/api/parts/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  db.run(`DELETE FROM parts WHERE id=?`, [id], function (err) {
    if (err) return res.status(500).json({ error: 'Gabim gjatë fshirjes.' });
    if (this.changes === 0) return res.status(404).json({ error: 'Pjesa nuk u gjet.' });
    res.json({ success: true });
  });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
