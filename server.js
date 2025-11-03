const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(express.json());

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




// --- Krijo tabelën për përdoruesit ---
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT DEFAULT 'user'
)`);

// Shto adminin e parë nëse nuk ekziston
db.get(`SELECT * FROM users WHERE username=?`, ['admin'], (err, row) => {
  if (!row) {
    db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, ['admin', '1234', 'admin']);
    console.log('👑 Admini u shtua (user: admin, pass: 1234)');
  }
});


const tokens = new Map();


// --- Login real nga databaza ---
app.post('/api/login', (req, res) => {
  const { user, pass } = req.body;

  db.get(`SELECT * FROM users WHERE username=? AND password=?`, [user, pass], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Gabim në databazë' });
    }

    if (!row) {
      return res.status(401).json({ error: 'Kredencialet janë të pasakta' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    tokens.set(token, { username: row.username, role: row.role });
    res.json({ token, role: row.role });
  });
});







app.post('/api/addUser', auth, (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Vetëm admini mund të shtojë përdorues!' });
  
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Plotëso fushat!' });

  db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, 'user')`, [username, password], (err) => {
    if (err) return res.status(500).json({ error: 'Gabim gjatë regjistrimit (ndoshta ekziston).' });
    res.json({ success: true, message: 'Përdoruesi u shtua me sukses!' });
  });
});



// --- Middleware për autorizim ---
function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && tokens.has(parts[1])) {
    const info = tokens.get(parts[1]);
    req.user = info.username;
    req.role = info.role;
    return next();
  }
  res.status(401).json({ error: 'Jo i autorizuar' });
}


// --- Ruaj pjesë me deri në 5 imazhe ---
app.post('/api/savePart', upload.array('images', 5), (req, res) => {
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

  // ruaj deri në 5 foto
  const files = req.files || [];
  const imagePaths = files.map(f => '/uploads/' + f.filename);

  db.run(
    `INSERT INTO parts 
    (brand, model, category, name, fuel, engine, qty, price, note, location, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      brand, model, category, name, fuel, engine,
      qty, price, note, location, JSON.stringify(imagePaths)
    ],
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

/// --- Përditëso pjesë ---
app.put('/api/parts/:id', auth, upload.single('image'), (req, res) => {
  const id = parseInt(req.params.id);
  const {
    brand = '',
    model = '',
    category = '',
    name = '',
    fuel = '',
    engine = '',
    qty,
    price,
    note = '',
    location = ''
  } = req.body;

  if (!name)
    return res.status(400).json({ error: 'Emri i pjesës është i detyrueshëm.' });

  let imagePath = null;
  if (req.file) imagePath = '/uploads/' + req.file.filename;

  // 🔧 Ndërto dinamikisht fushat që do të përditësohen
  const updates = [];
  const values = [];

  function addField(field, value) {
    if (value !== undefined && value !== null && value !== '') {
      updates.push(`${field}=?`);
      values.push(value);
    }
  }

  addField('brand', brand);
  addField('model', model);
  addField('category', category);
  addField('name', name);
  addField('fuel', fuel);
  addField('engine', engine);
  addField('qty', qty ? parseInt(qty) : 0);
  addField('note', note);
  addField('location', location);

  // ✅ Vetëm nëse ka ardhur një `price` të ri, përditësoje
  if (price !== undefined && price !== '') {
    addField('price', parseFloat(price));
  }

  // ✅ Vetëm nëse ka ardhur një foto të re
  if (imagePath) {
    addField('image', imagePath);
  }

  if (updates.length === 0) {
    return res.json({ success: false, message: 'Asnjë ndryshim për t’u përditësuar.' });
  }

  const sql = `UPDATE parts SET ${updates.join(', ')} WHERE id=?`;
  values.push(id);

  db.run(sql, values, function (err) {
    if (err) return res.status(500).json({ error: 'Gabim gjatë përditësimit.' });
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



const { jsPDF } = require('jspdf');
require('jspdf-autotable');

app.post('/api/invoice', (req, res) => {
  const data = req.body;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('🧾 Faturë Shitje - Famon Garage', 10, 20);

  doc.setFontSize(12);
  doc.text(`Data: ${data.date}`, 10, 30);
  doc.text(`Marka: ${data.brand || ''}`, 10, 40);
  doc.text(`Modeli: ${data.model || ''}`, 10, 46);
  doc.text(`Emri i pjesës: ${data.name || ''}`, 10, 52);
  doc.text(`Karburanti: ${data.fuel || ''}`, 10, 58);
  doc.text(`Kubikazhi: ${data.engine || ''}`, 10, 64);
  doc.text(`Sasia: ${data.qty || 1}`, 10, 70);
  doc.text(`Çmimi: ${data.price || 0} €`, 10, 76);
  doc.text(`Totali: ${data.total} €`, 10, 82);
  doc.text(`Lokacion: ${data.location || ''}`, 10, 88);
  doc.text(`Përshkrimi: ${data.note || ''}`, 10, 94);

  // nëse ekziston imazhi
  if (data.image) {
    const imgUrl = path.join(__dirname, data.image.replace('/', ''));
    if (fs.existsSync(imgUrl)) {
      const imgData = fs.readFileSync(imgUrl).toString('base64');
      doc.addImage('data:image/jpeg;base64,' + imgData, 'JPEG', 140, 30, 50, 50);
    }
  }

  const pdf = doc.output('arraybuffer');
  res.setHeader('Content-Type', 'application/pdf');
  res.send(Buffer.from(pdf));
});




// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
