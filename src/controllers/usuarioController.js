// src/controllers/usuarioController.js
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const logService = require('../services/logService');

const usuarioController = {

  // LISTAR
  listar: async (req, res) => {
    try {
      const { perfil } = req.user;
      
      let query = 'SELECT id, nome, email, perfil, carteira, data_criacao, assinatura_padrao_id FROM usuarios';
      
      // Ordena por nome
      query += ' ORDER BY nome ASC';

      const connection = await db.getConnection();
      const [rows] = await connection.execute(query);
      connection.release();

      res.json(rows);
    } catch (error) {
      console.error('Erro ao listar usuários:', error);
      res.status(500).json({ message: 'Erro interno.' });
    }
  },

  // OBTER POR ID
  obterPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const connection = await db.getConnection();
      const [rows] = await connection.execute(
        'SELECT id, nome, email, perfil, carteira, assinatura_padrao_id FROM usuarios WHERE id = ?', 
        [id]
      );
      connection.release();

      if (rows.length === 0) return res.status(404).json({ message: 'Usuário não encontrado.' });
      res.json(rows[0]);
    } catch (error) {
      console.error('Erro ao obter usuário:', error);
      res.status(500).json({ message: 'Erro interno.' });
    }
  },

  // CRIAR
  criar: async (req, res) => {
    try {
      const { nome, email, senha, perfil, carteira } = req.body;
      const solicitante = req.user;

      if (!nome || !email || !senha) return res.status(400).json({ message: 'Campos obrigatórios faltando.' });

      // Regras de Hierarquia
      if (solicitante.perfil === 'colaborador') return res.status(403).json({ message: 'Acesso negado.' });
      
      if (solicitante.perfil === 'supervisor' && (perfil === 'ceo' || perfil === 'supervisor')) {
        return res.status(403).json({ message: 'Supervisores só podem criar Colaboradores.' });
      }

      const connection = await db.getConnection();
      const [existe] = await connection.execute('SELECT id FROM usuarios WHERE email = ?', [email]);
      
      if (existe.length > 0) {
        connection.release();
        return res.status(400).json({ message: 'E-mail já cadastrado.' });
      }

      const salt = await bcrypt.genSalt(10);
      const senhaHash = await bcrypt.hash(senha, salt);

      const [result] = await connection.execute(
        'INSERT INTO usuarios (nome, email, senha_hash, perfil, carteira, data_criacao) VALUES (?, ?, ?, ?, ?, NOW())',
        [nome, email, senhaHash, perfil || 'colaborador', carteira || null]
      );
      connection.release();

      // --- LOG ---
      logService.registrar(solicitante.id, 'CRIOU_USUARIO', `Criou usuário: ${nome} (${perfil})`, req);

      res.status(201).json({ message: 'Usuário criado com sucesso!', id: result.insertId });

    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      res.status(500).json({ message: 'Erro ao criar usuário.' });
    }
  },

  // ATUALIZAR
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const { nome, email, senha, perfil, carteira } = req.body;
      const solicitante = req.user;

      if (solicitante.perfil === 'colaborador' && parseInt(id) !== solicitante.id) {
        return res.status(403).json({ message: 'Acesso negado.' });
      }

      if (solicitante.perfil === 'supervisor') {
        const connectionCheck = await db.getConnection();
        const [alvo] = await connectionCheck.execute('SELECT perfil FROM usuarios WHERE id = ?', [id]);
        connectionCheck.release();
        
        if (alvo.length > 0 && (alvo[0].perfil === 'ceo' || alvo[0].perfil === 'supervisor')) {
           if (parseInt(id) !== solicitante.id) {
             return res.status(403).json({ message: 'Você não tem permissão para editar este usuário.' });
           }
        }
      }

      const connection = await db.getConnection();
      let query = 'UPDATE usuarios SET nome = ?, email = ?, perfil = ?, carteira = ?';
      let params = [nome, email, perfil, carteira || null];

      if (senha) {
        const salt = await bcrypt.genSalt(10);
        const senhaHash = await bcrypt.hash(senha, salt);
        query += ', senha_hash = ?';
        params.push(senhaHash);
      }

      query += ' WHERE id = ?';
      params.push(id);

      await connection.execute(query, params);
      connection.release();

      // --- LOG ---
      logService.registrar(solicitante.id, 'EDITOU_USUARIO', `Editou usuário ID: ${id} - Nome: ${nome}`, req);

      res.json({ message: 'Usuário atualizado com sucesso.' });

    } catch (error) {
      console.error('Erro ao atualizar usuário:', error);
      res.status(500).json({ message: 'Erro interno.' });
    }
  },

  // REMOVER (AQUI ESTÁ A CORREÇÃO)
  remover: async (req, res) => {
    try {
      const { id } = req.params;
      const solicitante = req.user;

      // 1. REGRA DE OURO: Não pode se excluir
      if (parseInt(id) === solicitante.id) {
        return res.status(400).json({ message: 'Você não pode excluir seu próprio usuário.' });
      }

      // Regras de Hierarquia
      if (solicitante.perfil === 'colaborador') {
        return res.status(403).json({ message: 'Acesso negado.' });
      }

      // Busca nome do usuário antes de apagar para salvar no log
      const [alvo] = await db.query('SELECT nome, perfil FROM usuarios WHERE id = ?', [id]);

      // Supervisor não deleta CEO
      if (solicitante.perfil === 'supervisor') {
         const connectionCheck = await db.getConnection();
         const [alvo] = await connectionCheck.execute('SELECT perfil FROM usuarios WHERE id = ?', [id]);
         connectionCheck.release();
         if (alvo.length > 0 && alvo[0].perfil === 'ceo') {
            return res.status(403).json({ message: 'Acesso negado.' });
         }
      }

      const nomeExcluido = alvo.length > 0 ? alvo[0].nome : 'Desconhecido';

      const connection = await db.getConnection();
      await connection.execute('DELETE FROM usuarios WHERE id = ?', [id]);
      connection.release();

      // --- LOG ---
      logService.registrar(solicitante.id, 'EXCLUIU_USUARIO', `Excluiu usuário: ${nomeExcluido} (ID: ${id})`, req);

      res.json({ message: 'Usuário removido com sucesso.' });

    } catch (error) {
      console.error('Erro ao remover usuário:', error);
      res.status(500).json({ message: 'Erro interno.' });
    }
  },

  // --- VERSÃO CORRIGIDA ---
  uploadFoto: async (req, res) => {
    try {
      const id = req.user.id;
      
      // Log para depuração (aparecerá no seu terminal)
      console.log('📸 Tentativa de upload por usuário:', id);
      console.log('📂 Arquivo recebido:', req.file);

      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
      }

      // Normaliza o caminho: public\uploads\foto.png -> public/uploads/foto.png
      const caminhoFoto = req.file.path.replace(/\\/g, '/');

      const connection = await db.getConnection();
      // Usamos .query em vez de .execute para garantir compatibilidade
      await connection.query(
        'UPDATE usuarios SET foto = ? WHERE id = ?',
        [caminhoFoto, id]
      );
      connection.release();

      console.log('✅ Caminho salvo no banco:', caminhoFoto);
      res.json({ message: 'Foto atualizada com sucesso!', foto: caminhoFoto });

    } catch (error) {
      console.error('❌ Erro no upload de foto:', error);
      res.status(500).json({ message: 'Erro interno ao salvar foto.' });
    }
  },

  obterDadosLogado: async (req, res) => {
    try {
      // Pega o ID que veio do token de autenticação
      const id = req.user.id; 

      // --- CORREÇÃO AQUI: Adicionei ', foto' no SELECT ---
      const [rows] = await db.query(
        'SELECT id, nome, email, perfil, carteira, foto FROM usuarios WHERE id = ?', 
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      const usuario = rows[0];
      res.json(usuario);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao buscar dados do usuário.' });
    }
  }
  
};

module.exports = usuarioController;