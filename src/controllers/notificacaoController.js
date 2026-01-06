// backend/src/controllers/notificacaoController.js
const db = require('../config/database');

const notificacaoController = {
  // Lista notificações não lidas (ou as últimas 20)
  listar: async (req, res) => {
    try {
      // Busca não lidas primeiro, depois as lidas recentes
      const [rows] = await db.query(
        "SELECT * FROM notificacoes ORDER BY lida ASC, data_criacao DESC LIMIT 20"
      );
      
      // Conta quantas não lidas existem no total
      const [countResult] = await db.query("SELECT COUNT(*) as total FROM notificacoes WHERE lida = 0");
      
      res.json({ notificacoes: rows, totalNaoLidas: countResult[0].total });
    } catch (error) {
      console.error(error);
      res.status(500).json({ mensagem: 'Erro ao buscar notificações.' });
    }
  },

  // Marca uma específica como lida (ao clicar)
  marcarLida: async (req, res) => {
    try {
      const { id } = req.params;
      await db.query("UPDATE notificacoes SET lida = 1 WHERE id = ?", [id]);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ mensagem: 'Erro ao atualizar.' });
    }
  },

  // Marca todas como lidas (opcional, botão "Ler todas")
  marcarTodasLidas: async (req, res) => {
    try {
      await db.query("UPDATE notificacoes SET lida = 1 WHERE lida = 0");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ mensagem: 'Erro ao atualizar.' });
    }
  }
};

module.exports = notificacaoController;