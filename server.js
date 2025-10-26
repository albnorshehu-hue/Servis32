// =======================
// 🚗 Servis32 - Server.js
// =======================

const express = require("express");
const path = require("path");
const app = express();

// Middleware për të lexuar form data & JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 📁 Shërbe skedarët statikë (index.html, css, js, etj.)
app.use(express.static(path.join(__dirname)));

// ✅ LOGIN - shembull i thjeshtë (mund ta lidhësh me DB më vonë)
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  // ndrysho këtu sipas dëshirës
  const validUsername = "admin";
  const validPassword = "1234";

  if (username === validUsername && password === validPassword) {
    console.log("✔️ Login sukses!");
    return res.redirect("/dashboard.html");
  } else {
    console.log("❌ Gabim në kredenciale");
    return res.send(`
      <script>
        alert("Emri ose fjalëkalimi është i gabuar!");
        window.location.href = "/";
      </script>
    `);
  }
});

// ✅ Default route (nëse hyn direkt në domen)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 🚀 Nis serverin në portin e Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
