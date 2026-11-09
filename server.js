// server.js
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Telegraf } = require('telegraf');
const nodemailer = require('nodemailer');
const path = require('path');
const { pool, initDB } = require('./config/db');
const authorize = require('./middleware/auth');

require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inizializza Bot Telegram e Mail Transporter
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, 
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- FUNZIONE DI SYNC DATI (Punto 3 e 4) ---
async function fetchAndSaveProductionData() {
  try {
    // 1. Preleva l'ultimo ID salvato nel DB
    const [config] = await pool.query("SELECT cfg_value FROM config WHERE cfg_key = 'last_batch_id'");
    const lastId = config[0] ? parseInt(config[0].cfg_value) : 0;

    // 2. Richiesta API passando l'ultimo ID (es. come parametro di query, adegua se l'endpoint usa un formato diverso)
    const apiUrl = `http://gateways.smartlaundry.kannegiesser.cloud/api/gateways(v1/production-data/batches?afterId=${lastId}`;
    const response = await axios.get(apiUrl);
    const batches = response.data; // Assumiamo sia un array di oggetti batch

    if (batches && batches.length > 0) {
      let maxId = lastId;

      for (const batch of batches) {
        if (batch.id > lastId) {
          // 3. Salva nel database
          await pool.query(
            "INSERT INTO batches (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
            [batch.id, JSON.stringify(batch), JSON.stringify(batch)]
          );
          if (batch.id > maxId) maxId = batch.id;
        }
      }

      // 4. Aggiorna l'ultimo ID nel DB
      await pool.query("UPDATE config SET cfg_value = ? WHERE cfg_key = 'last_batch_id'", [maxId]);
      console.log(`Sincronizzati ${batches.length} nuovi batch. Ultimo ID: ${maxId}`);
    }
  } catch (error) {
    console.error("Errore durante il recupero dei dati di produzione:", error.message);
  }
}

// Avvia il sync automatico ogni 5 minuti
cron.schedule('*/5 * * * *', fetchAndSaveProductionData);

// --- FUNZIONI DI REPORTING (Punto 6 e 7) ---
async function generateReportText() {
  const [rows] = await pool.query("SELECT COUNT(*) as total FROM batches WHERE created_at >= NOW() - INTERVAL 1 DAY");
  return `Report di Produzione (Ultime 24h):\nBatch totali elaborati: ${rows[0].total}\nData di invio: ${new Date().toLocaleString()}`;
}

async function sendTelegramReport() {
  try {
    const text = await generateReportText();
    await bot.telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, text);
    console.log("Report inviato su Telegram.");
  } catch (err) {
    console.error("Errore Telegram:", err.message);
  }
}

async function sendEmailReport() {
  try {
    const text = await generateReportText();
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: 'Report Produzione Smart Laundry',
      text: text
    });
    console.log("Report inviato via Email.");
  } catch (err) {
    console.error("Errore Email:", err.message);
  }
}

// Schedula l'invio quotidiano dei report alle 22:00
cron.schedule('0 22 * * *', () => {
  sendTelegramReport();
  sendEmailReport();
});


// --- ROTTE API / AUTENTICAZIONE (Punto 5 e 8) ---

// Registrazione (Solo Amministratore può creare utenti)
app.post('/api/auth/register', authorize('amministratore'), async (req, res) => {
  const { username, password, role } = req.body;
  if (!['amministratore', 'operatore', 'utente'].includes(role)) {
    return res.status(400).json({ message: 'Ruolo non valido' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await pool.query("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", [username, hashedPassword, role]);
    res.json({ message: 'Utente registrato con successo' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login per tutti
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  console.log({username, password })
  const [users] = await pool.query("SELECT * FROM users WHERE username = ?", [username]);
  if (users.length === 0) return res.status(401).json({ message: 'Credenziali errate' });

  const user = users[0];
  const validPass = await bcrypt.compare(password, user.password);
  if (!validPass) return res.status(401).json({ message: 'Credenziali errate' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, role: user.role });
});

// Ottieni i dati di produzione (Accessibile a tutti i ruoli autenticati)
app.get('/api/production-data', authorize(['amministratore', 'operatore', 'utente']), async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM batches ORDER BY id DESC LIMIT 100");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger manuale report (Solo Amministratore ed Operatore)
app.post('/api/reports/trigger', authorize(['amministratore', 'operatore']), async (req, res) => {
  await sendTelegramReport();
  await sendEmailReport();
  res.json({ message: 'Report forzati inviati con successo via Telegram ed Email.' });
});

// --- START SERVER SULLA PORTA 80 (Punto 1) ---
const PORT = process.env.PORT || 80;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server Smart Laundry attivo sulla porta ${PORT}`);
  });
}).catch(err => {
    console.error("Impossibile avviare l'applicazione:", err);
});
