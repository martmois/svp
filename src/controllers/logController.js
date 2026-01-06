// src/controllers/logController.js
const db = require('../config/database');

const logController = {
  listar: async (req, res) => {
    try {
      // Segurança: Apenas CEO pode ver os logs
      if (req.user.perfil !== 'ceo') {
        return res.status(403).json({ mensagem: 'Acesso negado. Apenas CEO pode ver logs.' });
      }

      // 1. Captura os filtros da URL (ex: ?dataInicio=2023-01-01&acao=LOGIN)
      const { dataInicio, dataFim, acao, usuario } = req.query;

      let sql = `
        SELECT l.*, u.nome as nome_usuario, u.email as email_usuario, u.perfil
        FROM logs l
        LEFT JOIN usuarios u ON l.usuario_id = u.id
        WHERE 1=1 
      `;
      
      const params = [];

      // 2. Aplica os filtros dinamicamente
      if (dataInicio) {
        sql += ' AND DATE(l.data_criacao) >= ?';
        params.push(dataInicio);
      }

      if (dataFim) {
        sql += ' AND DATE(l.data_criacao) <= ?';
        params.push(dataFim);
      }

      if (acao) {
        // Busca parcial (ex: "EXCLUIU" traz tudo que for exclusão)
        sql += ' AND l.acao LIKE ?';
        params.push(`%${acao}%`);
      }

      if (usuario) {
        // Busca por nome ou email do usuário
        sql += ' AND (u.nome LIKE ? OR u.email LIKE ?)';
        params.push(`%${usuario}%`, `%${usuario}%`);
      }

      // Ordenação e Limite (Aumentei para 500 para buscas maiores)
      sql += ' ORDER BY l.data_criacao DESC LIMIT 500';

      const [rows] = await db.query(sql, params);
      res.json(rows);

    } catch (error) {
      console.error('Erro ao listar logs:', error);
      res.status(500).json({ mensagem: 'Erro interno.' });
    }
  }
};

module.exports = logController;