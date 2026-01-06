// src/services/cryptoService.js
const crypto = require('crypto');

// A chave deve estar no .env e ter 32 caracteres
const SECRET_KEY = process.env.CHAT_SECRET_KEY || '12345678901234567890123456789012'; 
const ALGORITHM = 'aes-256-ctr';

const cryptoService = {
  encrypt: (text) => {
    if (!text) return null;
    const iv = crypto.randomBytes(16); // Vetor de inicialização para aleatoriedade
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY), iv);
    
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Retorna IV:ConteudoCriptografado (precisamos do IV para descriptografar)
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  },

  decrypt: (hash) => {
    if (!hash) return null;
    try {
      const textParts = hash.split(':');
      const iv = Buffer.from(textParts.shift(), 'hex');
      const encryptedText = Buffer.from(textParts.join(':'), 'hex');
      
      const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY), iv);
      
      let decrypted = decipher.update(encryptedText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString();
    } catch (error) {
      console.error("Erro ao descriptografar mensagem:", error);
      return "[Mensagem indisponível]";
    }
  }
};

module.exports = cryptoService;