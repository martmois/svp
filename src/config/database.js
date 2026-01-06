// src/config/database.js

const mysql = require('mysql2/promise'); // Usa a versão com Promises do mysql2

// Cria um "pool" de conexões. É mais eficiente que criar uma conexão nova para cada consulta.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  timezone: '-03:00',
  waitForConnections: true, // Espera se todas as conexões estiverem em uso
  connectionLimit: 10,      // Número máximo de conexões no pool
  queueLimit: 0             // Fila de espera ilimitada
});

// Exporta o pool para que possa ser usado em outras partes do nosso código
module.exports = pool;