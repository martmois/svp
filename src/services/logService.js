// src/services/logService.js
const db = require('../config/database');

const logService = {
  /**
   * Registra uma ação no banco de dados.
   * @param {number} usuarioId - ID do usuário que fez a ação (pode ser null se for falha de login)
   * @param {string} acao - Código da ação (ex: 'LOGIN', 'CRIAR_CONDOMINIO')
   * @param {string} detalhes - Descrição extra (ex: 'Nome: Condominio Sol')
   * @param {object} req - O objeto da requisição (para pegar o IP)
   */
  registrar: async (usuarioId, acao, detalhes, req = null) => {
    try {
      // Tenta pegar o IP do request, se disponível
      let ip = null;
      if (req) {
        ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
      }

      const query = `INSERT INTO logs (usuario_id, acao, detalhes, ip, data_criacao) VALUES (?, ?, ?, ?, NOW())`;
      
      // Não usamos 'await' aqui para não travar a requisição principal do usuário.
      // O log é salvo em "segundo plano" (fire and forget).
      db.execute(query, [usuarioId, acao, detalhes, ip]).catch(err => {
        console.error('Falha silenciosa ao salvar log:', err);
      });

    } catch (error) {
      console.error('Erro no serviço de log:', error);
    }
  }
};

module.exports = logService;