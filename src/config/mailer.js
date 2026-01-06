// backend/src/config/mailer.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: false, // true para 465, false para outras portas
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verificação de conexão ao iniciar
transporter.verify(function (error, success) {
  if (error) {
    console.error('❌ Erro na conexão SMTP (Mailgun):', error);
  } else {
    console.log('✅ Servidor de E-mail (Mailgun) pronto para envios!');
  }
});

module.exports = transporter;