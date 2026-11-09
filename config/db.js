// config/db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'db', // 'db' corrisponde al nome del servizio in docker-compose
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10
});

async function initDB() {
  let connected = false;
  let attempts = 5;

  while (!connected && attempts > 0) {
    try {
      // Forza una connessione di test
      const connection = await pool.getConnection();
      connection.release();
      connected = true;
    } catch (err) {
      console.log(`In attesa del database... Tentativi rimasti: ${attempts}`);
      attempts--;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Aspetta 5 secondi
    }
  }

  if (!connected) {
    throw new Error("Impossibile connettersi a MySQL dopo diversi tentativi.");
  }

  // Creazione Tabelle
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role ENUM('amministratore', 'operatore', 'utente') NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      cfg_key VARCHAR(50) PRIMARY KEY,
      cfg_value VARCHAR(255)
    )
  `);

  await pool.query(`INSERT IGNORE INTO config (cfg_key, cfg_value) VALUES ('last_batch_id', '0')`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS batches (
      id INT PRIMARY KEY,
      data JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  console.log("Database inizializzato con successo in Docker.");
}

module.exports = { pool, initDB };
