// backend/src/controllers/eventoController.js
const db = require('../config/database');

const eventoController = {
  getAll: async (req, res) => {
    try {
      const { condominio_id, email, assunto } = req.query;
      const { perfil, carteira } = req.user; // <--- Pega quem está pedindo
      
      let whereClause = "WHERE m.tipo = 'enviado'";
      const params = [];

      // Filtros da UI
      if (condominio_id) {
        whereClause += ' AND u.condominio_id = ?';
        params.push(condominio_id);
      }
      if (email) {
        whereClause += ' AND m.destinatario LIKE ?';
        params.push(`%${email}%`);
      }
      if (assunto) {
        whereClause += ' AND com.assunto_inicial LIKE ?';
        params.push(`%${assunto}%`);
      }

      // --- FILTRO DE SEGURANÇA (CARTEIRA) ---
      if (perfil === 'colaborador') {
        if (!carteira) return res.json({ data: [], total: 0 });
        whereClause += ' AND c.carteira = ?';
        params.push(carteira);
      }

      const sql = `
        SELECT 
          m.id, 
          m.destinatario, 
          com.assunto_inicial, 
          m.data_envio,
          c.nome as nome_condominio, 
          u.numero_unidade, 
          u.bloco,
          m.message_id_externo,
          
          (SELECT data_evento FROM email_eventos WHERE message_id_externo = m.message_id_externo AND evento = 'Processado' ORDER BY data_evento DESC LIMIT 1) AS data_processado,
          (SELECT data_evento FROM email_eventos WHERE message_id_externo = m.message_id_externo AND evento = 'Entregue' ORDER BY data_evento DESC LIMIT 1) AS data_entregue,
          (SELECT data_evento FROM email_eventos WHERE message_id_externo = m.message_id_externo AND evento = 'Aberto' ORDER BY data_evento DESC LIMIT 1) AS data_aberto,
          (SELECT payload_json FROM email_eventos WHERE message_id_externo = m.message_id_externo AND evento = 'Erro' ORDER BY data_evento DESC LIMIT 1) AS erro_detalhes

        FROM mensagens m
        JOIN comunicacoes com ON m.comunicacao_id = com.id
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        JOIN unidades u ON ce.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        ${whereClause}
        ORDER BY m.data_envio DESC
        LIMIT 20
      `;

      const [rows] = await db.query(sql, params);
      
      const formatado = rows.map(row => ({
        id: row.id,
        destinatario: row.destinatario,
        unidade: `${row.nome_condominio} - ${row.bloco || ''} ${row.numero_unidade}`,
        assunto: row.assunto_inicial,
        status: {
          processado: row.data_processado, 
          entregue: row.data_entregue,
          aberto: row.data_aberto,
          erro: row.erro_detalhes
        }
      }));

      res.json({ data: formatado, total: rows.length });

    } catch (error) {
      console.error('Erro ao buscar eventos:', error);
      res.status(500).json({ error: 'Erro interno' });
    }
  }
};

module.exports = eventoController;