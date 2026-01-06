// src/controllers/condominioController.js
const db = require('../config/database');
const logService = require('../services/logService');

const condominioController = {

  // =========================================================================
  // CREATE: Adicionar um novo condomínio (Apenas CEO/Supervisor)
  // =========================================================================
  create: async (req, res) => {
    try {
      // Verifica permissão (Colaborador não cria)
      const { perfil, id: usuarioId } = req.user;
      if (perfil === 'colaborador') {
        return res.status(403).json({ mensagem: 'Acesso negado. Apenas Gestores podem cadastrar.' });
      }

      const { 
        nome, cnpj, endereco, sindico_nome, sindico_telefone, 
        sindico_email, mandato_vigencia, sindico_aniversario, carteira 
      } = req.body;

      if (!nome || !cnpj) {
        return res.status(400).json({ mensagem: 'Nome e CNPJ são obrigatórios.' });
      }

      // Adicionei 'carteira' e 'data_criacao'
      const query = `
        INSERT INTO condominios 
        (nome, cnpj, endereco, sindico_nome, sindico_telefone, sindico_email, mandato_vigencia, sindico_aniversario, carteira, data_criacao) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      
      const [result] = await db.execute(query, [
        nome, 
        cnpj, 
        endereco, 
        sindico_nome, 
        sindico_telefone, 
        sindico_email, 
        mandato_vigencia, 
        sindico_aniversario || null,
        carteira || null // Salva a carteira definida no cadastro
      ]);

      // --- LOG ---
      logService.registrar(usuarioId, 'CRIOU_CONDOMINIO', `Criou: ${nome} - Carteira: ${carteira || 'Nenhuma'}`, req);

      res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
      console.error("Erro ao criar condomínio:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

  // =========================================================================
  // READ (ALL): Listar condomínios (Com filtro de Carteira)
  // =========================================================================
  getAll: async (req, res) => {
    try {
      const { perfil, carteira } = req.user;

      let query = 'SELECT * FROM condominios';
      let params = [];

      // SE FOR COLABORADOR: Vê apenas os condomínios da sua carteira
      if (perfil === 'colaborador') {
        if (!carteira) {
          return res.json([]); // Sem carteira = lista vazia
        }
        query += ' WHERE carteira = ?';
        params.push(carteira);
      }

      query += ' ORDER BY nome ASC';

      const [condominios] = await db.query(query, params);
      res.json(condominios);
    } catch (error) {
      console.error("Erro ao listar condomínios:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

  // =========================================================================
  // READ (ONE): Obter um condomínio pelo ID (Com segurança)
  // =========================================================================
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const { perfil, carteira } = req.user;

      let query = 'SELECT * FROM condominios WHERE id = ?';
      let params = [id];

      // SE FOR COLABORADOR: Garante que ele só acesse se for da carteira dele
      if (perfil === 'colaborador') {
        if (!carteira) return res.status(403).json({ mensagem: 'Acesso negado.' });
        
        query += ' AND carteira = ?';
        params.push(carteira);
      }

      const [rows] = await db.query(query, params);
      if (rows.length === 0) {
        return res.status(404).json({ mensagem: 'Condomínio não encontrado ou sem permissão.' });
      }
      res.json(rows[0]);
    } catch (error) {
      console.error("Erro ao obter condomínio:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

  // =========================================================================
  // UPDATE: Atualizar um condomínio (Apenas CEO/Supervisor)
  // =========================================================================
  update: async (req, res) => {
    try {
      // Verifica permissão
      const { id } = req.params;
      const { nome, cnpj, endereco, sindico_nome, sindico_telefone, sindico_email, mandato_vigencia, sindico_aniversario, carteira} = req.body;
      const { perfil, id: usuarioId } = req.user;
      if (perfil === 'colaborador') {
        return res.status(403).json({ mensagem: 'Acesso negado. Você não pode editar.' });
      }
      
      if (!nome || !cnpj) {
        return res.status(400).json({ mensagem: 'Nome e CNPJ são obrigatórios.' });
      }

      const query = `
        UPDATE condominios SET 
        nome = ?, cnpj = ?, endereco = ?, sindico_nome = ?, sindico_telefone = ?, 
        sindico_email = ?, mandato_vigencia = ?, sindico_aniversario = ?, carteira = ? 
        WHERE id = ?
      `;

      const [result] = await db.execute(query, [
        nome, 
        cnpj, 
        endereco, 
        sindico_nome, 
        sindico_telefone, 
        sindico_email, 
        mandato_vigencia, 
        sindico_aniversario || null, 
        carteira || null,    
        id
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ mensagem: 'Condomínio não encontrado.' });
      }

      // --- LOG ---
      logService.registrar(usuarioId, 'EDITOU_CONDOMINIO', `Editou: ${nome} (ID: ${id})`, req);

      res.json({ id, ...req.body });
    } catch (error) {
      console.error("Erro ao atualizar condomínio:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

  // =========================================================================
  // DELETE: Apagar um condomínio (Apenas CEO/Supervisor)
  // =========================================================================
  delete: async (req, res) => {
    try {
      // Verifica permissão
      const { id } = req.params;
      const { perfil, id: usuarioId } = req.user;
      if (perfil === 'colaborador') {
        return res.status(403).json({ mensagem: 'Acesso negado.' });
      }

      // Busca o nome antes de apagar para o log
      const [rows] = await db.query('SELECT nome FROM condominios WHERE id = ?', [id]);
      const nomeCondo = rows.length > 0 ? rows[0].nome : 'Desconhecido';

      const query = 'DELETE FROM condominios WHERE id = ?';
      const [result] = await db.execute(query, [id]);
      
      if (result.affectedRows === 0) {
        return res.status(404).json({ mensagem: 'Condomínio não encontrado.' });
      }

      // --- LOG ---
      logService.registrar(usuarioId, 'EXCLUIU_CONDOMINIO', `Excluiu: ${nomeCondo} (ID: ${id})`, req);

      res.status(204).send(); 
    } catch (error) {
      console.error("Erro ao deletar condomínio:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },
};

module.exports = condominioController;