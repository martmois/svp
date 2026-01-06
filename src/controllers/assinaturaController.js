// src/controllers/assinaturaController.js
const db = require('../config/database');

const assinaturaController = {
  // Busca todas as assinaturas do usuário logado
  getAll: async (req, res) => {
    try {
      const usuarioId = req.user.id;
      
      // QUERY AJUSTADA:
      // Faz um JOIN com a tabela de usuários para verificar se o ID da assinatura
      // é igual ao 'assinatura_padrao_id' salvo no perfil do usuário.
      const query = `
        SELECT a.*, 
               (CASE WHEN u.assinatura_padrao_id = a.id THEN 1 ELSE 0 END) as is_padrao
        FROM assinaturas a
        JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.usuario_id = ?
        ORDER BY a.id DESC
      `;

      const [assinaturas] = await db.query(query, [usuarioId]);
      
      // Converte o tinyint (0 ou 1) para boolean para facilitar no front
      const assinaturasFormatadas = assinaturas.map(a => ({
          ...a,
          is_padrao: !!a.is_padrao
      }));

      res.json(assinaturasFormatadas);
    } catch (error) {
      console.error('Erro ao buscar assinaturas:', error);
      res.status(500).json({ mensagem: 'Erro ao buscar assinaturas.' });
    }
  },

  // Cria uma nova assinatura
  create: async (req, res) => {
    try {
      const { titulo, corpo_html } = req.body;
      const usuarioId = req.user.id;

      const [result] = await db.execute(
        'INSERT INTO assinaturas (usuario_id, titulo, corpo_html) VALUES (?, ?, ?)', 
        [usuarioId, titulo, corpo_html]
      );
      res.status(201).json({ id: result.insertId, titulo, corpo_html, is_padrao: false });
    } catch (error) {
      console.error('Erro ao criar assinatura:', error);
      res.status(500).json({ mensagem: 'Erro ao criar assinatura.' });
    }
  },
  
  // Atualiza uma assinatura
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { titulo, corpo_html } = req.body;
      const usuarioId = req.user.id;

      await db.execute(
        'UPDATE assinaturas SET titulo = ?, corpo_html = ? WHERE id = ? AND usuario_id = ?', 
        [titulo, corpo_html, id, usuarioId]
      );
      res.json({ id, titulo, corpo_html });
    } catch (error) {
      console.error('Erro ao atualizar assinatura:', error);
      res.status(500).json({ mensagem: 'Erro ao atualizar assinatura.' });
    }
  },

  // Deleta uma assinatura
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const usuarioId = req.user.id;

      await db.execute('DELETE FROM assinaturas WHERE id = ? AND usuario_id = ?', [id, usuarioId]);
      
      // Opcional: Se deletou a padrão, o banco pode ficar com ID inválido ou NULL.
      // O ideal seria setar NULL no usuario, mas o MySQL lida bem se não for FK restrita.
      
      res.status(204).send();
    } catch (error) {
      console.error('Erro ao deletar assinatura:', error);
      res.status(500).json({ mensagem: 'Erro ao deletar assinatura.' });
    }
  },

  // Define a assinatura padrão para o usuário
  setDefault: async (req, res) => {
    try {
      const { assinaturaId } = req.body;
      const usuarioId = req.user.id;

      await db.execute('UPDATE usuarios SET assinatura_padrao_id = ? WHERE id = ?', [assinaturaId, usuarioId]);
      
      res.json({ mensagem: 'Assinatura padrão definida com sucesso.' });
    } catch (error) {
      console.error('Erro ao definir padrão:', error);
      res.status(500).json({ mensagem: 'Erro ao definir assinatura padrão.' });
    }
  }
};

module.exports = assinaturaController;