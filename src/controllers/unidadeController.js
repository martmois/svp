// backend/src/controllers/unidadeController.js

const db = require('../config/database');
const xlsx = require('xlsx');
const logService = require('../services/logService');

const unidadeController = {
  
  // --- MANTENHA A FUNÇÃO IMPORTAR CSV IGUAL ---
  importFromCSV: async (req, res) => {
    try {
      const { condominioId } = req.params;
      const { id: usuarioId } = req.user;
      if (!req.file) return res.status(400).json({ mensagem: 'Nenhum arquivo enviado.' });

      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const unidadesJSON = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

      if (unidadesJSON.length === 0) {
        return res.status(400).json({ mensagem: 'A planilha está vazia.' });
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        for (const row of unidadesJSON) {
          const dadosUnidade = {
            condominio_id: parseInt(condominioId),
            bloco: row.bloco || null,
            numero_unidade: row.unidade,
            responsavel_nome: row.responsavel,
            tipo_responsavel: row.tipo ? row.tipo.toLowerCase() : 'proprietario',
            tipo_inscricao: row.tipo_inscricao ? row.tipo_inscricao.toUpperCase() : null,
            inscricao: row.inscricao || null,
          };

          const [unidadeResult] = await connection.query('INSERT INTO unidades SET ?', dadosUnidade);
          const unidadeId = unidadeResult.insertId;

          if (row.email) {
            const emails = String(row.email).split(',').map(e => e.trim());
            for (const email of emails) {
              if (email) await connection.query('INSERT INTO contatos_email SET ?', { unidade_id: unidadeId, email: email });
            }
          }
          
          if (row.telefone) {
            const telefones = String(row.telefone).split(',').map(t => t.trim());
            for (const telefone of telefones) {
              if (telefone) await connection.query('INSERT INTO contatos_telefone SET ?', { unidade_id: unidadeId, telefone: telefone });
            }
          }
        }
        
        await connection.commit();

        // --- LOG DE IMPORTAÇÃO ---
        // 1. Busca nome do condomínio
        const [condoRows] = await connection.query('SELECT nome FROM condominios WHERE id = ?', [condominioId]);
        const nomeCondo = condoRows.length > 0 ? condoRows[0].nome : 'Desconhecido';

        // 2. Registra
        logService.registrar(
          usuarioId, 
          'IMPORTOU_UNIDADES', 
          `Importou ${unidadesJSON.length} unidades para: ${nomeCondo}`, 
          req
        );

        res.status(201).json({ mensagem: `${unidadesJSON.length} unidades importadas.` });

      } catch (error) {
        await connection.rollback();
        console.error("Erro importação:", error);
        res.status(500).json({ mensagem: 'Erro ao salvar os dados.' });
      } finally {
        connection.release();
      }
    } catch (error) {
      console.error("Erro processamento:", error);
      res.status(500).json({ mensagem: 'Erro interno.' });
    }
  },
  
  // --- CORREÇÃO DA PESQUISA ---
  getByCondominioId: async (req, res) => {
    try {
      const { condominioId } = req.params;
      const { 
        page = 1, limit = 10, 
        numero_unidade, bloco, responsavel_nome, cpf, email, telefone, 
        status_financeiro, 
        numero_processo, advogado
      } = req.query;

      const offset = (page - 1) * limit;
      
      // Construção Segura da Query
      // 1. Base (Joins)
      let baseJoins = `
        FROM unidades u
        LEFT JOIN processos p ON p.unidade_id = u.id AND p.status = 'Ativo'
        LEFT JOIN contatos_email ce ON ce.unidade_id = u.id
        LEFT JOIN contatos_telefone ct ON ct.unidade_id = u.id
      `;

      // 2. Condições (Where)
      let whereClause = ` WHERE u.condominio_id = ?`;
      const params = [condominioId];

      if (numero_unidade) { whereClause += ' AND u.numero_unidade LIKE ?'; params.push(`%${numero_unidade}%`); }
      if (bloco) { whereClause += ' AND u.bloco LIKE ?'; params.push(`%${bloco}%`); }
      if (responsavel_nome) { whereClause += ' AND u.responsavel_nome LIKE ?'; params.push(`%${responsavel_nome}%`); }
      if (cpf) { whereClause += ' AND u.inscricao LIKE ?'; params.push(`%${cpf}%`); }
      if (email) { whereClause += ' AND ce.email LIKE ?'; params.push(`%${email}%`); }
      if (telefone) { whereClause += ' AND ct.telefone LIKE ?'; params.push(`%${telefone}%`); }
      if (numero_processo) { whereClause += ' AND p.numero_processo LIKE ?'; params.push(`%${numero_processo}%`); }
      if (advogado) { whereClause += ' AND p.advogado_responsavel LIKE ?'; params.push(`%${advogado}%`); }

      if (status_financeiro) {
        if (status_financeiro === 'inadimplente') {
          whereClause += ` AND EXISTS (SELECT 1 FROM debitos d WHERE d.unidade_id = u.id AND d.status = 'pendente')`;
        } else if (status_financeiro === 'em_acordo') {
          whereClause += ` AND EXISTS (SELECT 1 FROM debitos d WHERE d.unidade_id = u.id AND d.status = 'em_acordo')`;
        } else if (status_financeiro === 'juridico') {
          whereClause += ` AND (EXISTS (SELECT 1 FROM debitos d WHERE d.unidade_id = u.id AND d.status = 'juridico') OR p.id IS NOT NULL)`;
        } else if (status_financeiro === 'em_dia') {
          whereClause += ` AND NOT EXISTS (SELECT 1 FROM debitos d WHERE d.unidade_id = u.id AND (d.status = 'pendente' OR d.status = 'juridico'))`;
        }
      }

      // --- EXECUÇÃO 1: CONTAGEM TOTAL (Sem os campos extras do SELECT, para ser rápido) ---
      const sqlTotal = `SELECT COUNT(DISTINCT u.id) as total ${baseJoins} ${whereClause}`;
      const [countResult] = await db.query(sqlTotal, params);
      const total = countResult[0]?.total || 0;

      // --- EXECUÇÃO 2: BUSCA DE DADOS ---
      // Aqui adicionamos as subqueries complexas no SELECT apenas para as linhas que vamos exibir
      const selectColumns = `
        SELECT DISTINCT u.*, 
        p.numero_processo, p.advogado_responsavel,
        (SELECT COUNT(*) FROM debitos d WHERE d.unidade_id = u.id AND d.status = 'pendente') as qtd_pendente,
        (SELECT COUNT(*) FROM debitos d WHERE d.unidade_id = u.id AND d.status = 'em_acordo') as qtd_acordo,
        (SELECT COUNT(*) FROM debitos d WHERE d.unidade_id = u.id AND d.status = 'juridico') as qtd_juridico
      `;

      let sqlData = `${selectColumns} ${baseJoins} ${whereClause} ORDER BY u.bloco, u.numero_unidade LIMIT ? OFFSET ?`;
      
      // Precisamos clonar os params e adicionar o limit/offset para a segunda query
      const paramsData = [...params, parseInt(limit), parseInt(offset)];
      
      const [unidades] = await db.query(sqlData, paramsData);

      // --- POPULAR CONTATOS ---
      for (let unidade of unidades) {
        const [emails] = await db.query('SELECT email FROM contatos_email WHERE unidade_id = ?', [unidade.id]);
        const [telefones] = await db.query('SELECT telefone FROM contatos_telefone WHERE unidade_id = ?', [unidade.id]);
        unidade.emails = emails;
        unidade.telefones = telefones;
      }

      res.json({
        total,
        unidades,
      });

    } catch (error) {
      console.error("Erro ao listar unidades:", error);
      res.status(500).json({ mensagem: 'Erro interno ao listar unidades.' });
    }
  },

  // Mantido igual
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const [unidades] = await db.query(`
        SELECT u.*, c.nome as nome_condominio 
        FROM unidades u
        JOIN condominios c ON u.condominio_id = c.id
        WHERE u.id = ?
      `, [id]);

      if (unidades.length === 0) return res.status(404).json({ mensagem: 'Unidade não encontrada.' });
      
      const [emails] = await db.query('SELECT * FROM contatos_email WHERE unidade_id = ?', [id]);
      const [telefones] = await db.query('SELECT * FROM contatos_telefone WHERE unidade_id = ?', [id]);
      
      const unidadeCompleta = { ...unidades[0], emails, telefones };
      res.json(unidadeCompleta);
    } catch (error) {
      console.error("Erro ao buscar unidade:", error);
      res.status(500).json({ mensagem: 'Erro interno.' });
    }
  },
  
  // Mantido igual
  update: async (req, res) => {
    const connection = await db.getConnection();
    try {
      const { id } = req.params;
      const { bloco, numero_unidade, responsavel_nome, tipo_responsavel, tipo_inscricao, inscricao, emails, telefones } = req.body;
      const { id: usuarioId } = req.user;

      // 1. Busca dados ANTES de atualizar para o Log
      const [dadosAtuais] = await connection.query(`
        SELECT u.bloco, u.numero_unidade, u.responsavel_nome, c.nome as nome_condominio 
        FROM unidades u 
        JOIN condominios c ON u.condominio_id = c.id 
        WHERE u.id = ?`, [id]);
      
      const unidadeInfo = dadosAtuais[0] || {};
      const nomeUnidade = `${unidadeInfo.bloco || ''} ${unidadeInfo.numero_unidade}`;
      const nomeCondo = unidadeInfo.nome_condominio || 'Desconhecido';

      await connection.beginTransaction();

      await connection.query(
        `UPDATE unidades SET bloco = ?, numero_unidade = ?, responsavel_nome = ?, tipo_responsavel = ?, tipo_inscricao = ?, inscricao = ? WHERE id = ?`,
        [bloco, numero_unidade, responsavel_nome, tipo_responsavel, tipo_inscricao, inscricao, id]
      );

      await connection.query('DELETE FROM contatos_email WHERE unidade_id = ?', [id]);
      await connection.query('DELETE FROM contatos_telefone WHERE unidade_id = ?', [id]);

      if (emails && emails.length > 0) {
        for (const email of emails) await connection.query('INSERT INTO contatos_email SET ?', { unidade_id: id, email: email });
      }
      if (telefones && telefones.length > 0) {
        for (const telefone of telefones) await connection.query('INSERT INTO contatos_telefone SET ?', { unidade_id: id, telefone: telefone });
      }

      await connection.commit();

      // --- LOG DE EDIÇÃO ---
      const detalhesLog = `Editou Unidade: ${nomeUnidade} (${nomeCondo}). Responsável: ${responsavel_nome}`;
      logService.registrar(usuarioId, 'EDITOU_UNIDADE', detalhesLog, req);


      res.json({ id, ...req.body });
    } catch (error) {
      await connection.rollback();
      console.error("Erro update:", error);
      res.status(500).json({ mensagem: 'Erro interno.' });
    } finally {
      connection.release();
    }
  },

  create: async (req, res) => { res.status(501).json({ mensagem: 'Não implementado.' }); },
  delete: async (req, res) => { res.status(501).json({ mensagem: 'Não implementado.' }); },
  getTelefonesByUnidadeId: async (req, res) => {
      try {
        const { unidadeId } = req.params;
        const [telefones] = await db.query('SELECT telefone FROM contatos_telefone WHERE unidade_id = ?', [unidadeId]);
        res.json(telefones);
      } catch (error) {
        res.status(500).json({ mensagem: 'Erro ao buscar telefones.' });
      }
    }
};

module.exports = unidadeController;