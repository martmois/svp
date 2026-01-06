// src/middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

// Middleware para proteger rotas (verifica se o usuário está autenticado)
function protegerRota(req, res, next) {
  let token;

  // 1. Verifica se o cabeçalho existe e começa com Bearer
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Extrai o token
      token = req.headers.authorization.split(' ')[1];

      // Verifica a validade
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // --- CORREÇÃO PRINCIPAL AQUI ---
      // Salvamos em 'req.user' porque é onde os controllers novos estão buscando
      req.user = decoded; 

      // Passa para o próximo
      return next();
    } catch (error) {
      console.error('Erro na autenticação do token:', error);
      return res.status(401).json({ mensagem: 'Não autorizado, token falhou.' });
    }
  }

  // Se não tiver token ou não for Bearer
  if (!token) {
    return res.status(401).json({ mensagem: 'Não autorizado, token não fornecido.' });
  }
}

// Middleware para autorizar com base no perfil do usuário
function autorizar(...perfis) {
  return (req, res, next) => {
    // Verifica se 'req.user' existe (garantido pelo protegerRota)
    // E verifica se o perfil está na lista permitida
    if (!req.user || !perfis.includes(req.user.perfil)) {
      return res.status(403).json({ mensagem: 'Acesso negado. Você não tem permissão para acessar este recurso.' });
    }
    next();
  }
}

module.exports = { protegerRota, autorizar };