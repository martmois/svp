// src/controllers/processoController.js
const db = require('../config/database');

const processoController = {
  
  // Criar Processo
  criar: async (req, res) => {
    try {
      const { unidade_id, numero_processo, status, advogado_responsavel, data_inicio } = req.body;

      if (!unidade_id || !numero_processo) {
        return res.status(400).json({ message: 'Unidade e Número do Processo são obrigatórios.' });
      }

      const [result] = await db.execute(
        'INSERT INTO processos (unidade_id, numero_processo, status, advogado_responsavel, data_inicio) VALUES (?, ?, ?, ?, ?)',
        [unidade_id, numero_processo, status || 'Em andamento', advogado_responsavel, data_inicio || new Date()]
      );

      res.status(201).json({ id: result.insertId, message: 'Processo criado com sucesso!' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao criar processo.' });
    }
  },

  // Busca detalhes
  getDetalhes: async (req, res) => {
    try {
      const { id } = req.params;

      const [processo] = await db.query(`
        SELECT p.*, u.responsavel_nome, u.numero_unidade, u.bloco, c.nome as nome_condominio
        FROM processos p
        JOIN unidades u ON p.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE p.id = ?
      `, [id]);

      if (processo.length === 0) return res.status(404).json({ message: 'Processo não encontrado.' });

      const [debitosVinculados] = await db.query('SELECT * FROM debitos WHERE processo_id = ?', [id]);

      const [debitosDisponiveis] = await db.query(
        'SELECT * FROM debitos WHERE unidade_id = ? AND processo_id IS NULL AND status != "pago"', 
        [processo[0].unidade_id]
      );

      const [historico] = await db.query(`
        SELECT h.*, u.nome as usuario_nome 
        FROM historico_processos h
        LEFT JOIN usuarios u ON h.usuario_id = u.id
        WHERE h.processo_id = ? ORDER BY h.data_movimentacao DESC
      `, [id]);

      const [arquivos] = await db.query('SELECT * FROM arquivos_processos WHERE processo_id = ?', [id]);

      res.json({
        processo: processo[0],
        debitosVinculados,
        debitosDisponiveis,
        historico,
        arquivos
      });

    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao buscar processo.' });
    }
  },

  // --- FUNÇÃO ATUALIZADA COM A LÓGICA "MÁGICA" ---
  vincularDebitos: async (req, res) => {
    const connection = await db.getConnection(); // Abre conexão para transação
    try {
      await connection.beginTransaction();

      const { id } = req.params; // ID do Processo
      const { debitosIds } = req.body; // Array de IDs dos débitos
      const usuarioId = req.user.id;

      if (!debitosIds || debitosIds.length === 0) {
        return res.status(400).json({ message: 'Nenhum débito selecionado.' });
      }

      // 1. Busca o Número do Processo para o log
      const [proc] = await connection.query('SELECT numero_processo FROM processos WHERE id = ?', [id]);
      const numProcesso = proc[0]?.numero_processo || 'Desconhecido';

      // 2. Busca detalhes dos débitos ANTES de atualizar (para ter valor e vencimento nos logs)
      const placeholders = debitosIds.map(() => '?').join(',');
      const [debitosDetalhados] = await connection.query(
        `SELECT id, valor, data_vencimento, unidade_id FROM debitos WHERE id IN (${placeholders})`,
        debitosIds
      );

      // 3. Atualiza os débitos (Vínculo + Status Jurídico)
      await connection.query(
        `UPDATE debitos SET processo_id = ?, status = 'juridico' WHERE id IN (${placeholders})`, 
        [id, ...debitosIds]
      );

      // 4. GERA OS LOGS AUTOMÁTICOS
      for (const d of debitosDetalhados) {
        const valorF = parseFloat(d.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const dataF = new Date(d.data_vencimento).toLocaleDateString('pt-BR');

        // A) Log no Histórico do PROCESSO (igual a imagem 1b6d41.jpg)
        await connection.execute(
          'INSERT INTO historico_processos (processo_id, titulo, descricao, usuario_id) VALUES (?, ?, ?, ?)',
          [
            id, 
            'Cobrança Adicionada', 
            `Cobrança #${d.id} venc. ${dataF} valor ${valorF} foi adicionada ao processo.`, 
            usuarioId
          ]
        );

        // B) Log no CRM da UNIDADE (Timeline geral)
        await connection.execute(
          `INSERT INTO historico_cobranca 
           (unidade_id, usuario_id, tipo_contato, resultado, observacao, data_contato) 
           VALUES (?, ?, 'Sistema', 'Enviado p/ Jurídico', ?, NOW())`,
          [
            d.unidade_id,
            usuarioId,
            `Débito de ${valorF} (Venc: ${dataF}) vinculado ao Processo ${numProcesso}`
          ]
        );
      }

      await connection.commit();
      res.json({ message: 'Débitos vinculados e históricos gerados com sucesso.' });

    } catch (error) {
      await connection.rollback(); // Desfaz tudo se der erro
      console.error(error);
      res.status(500).json({ message: 'Erro ao vincular débitos.' });
    } finally {
      connection.release();
    }
  },

  // Adicionar Movimentação Manual
  adicionarHistorico: async (req, res) => {
    try {
      const { id } = req.params;
      const { titulo, descricao } = req.body;
      const usuarioId = req.user.id;

      await db.execute(
        'INSERT INTO historico_processos (processo_id, titulo, descricao, usuario_id) VALUES (?, ?, ?, ?)',
        [id, titulo, descricao, usuarioId]
      );
      res.json({ message: 'Movimentação registrada.' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao salvar histórico.' });
    }
  },

  // Upload de Arquivo
  uploadArquivo: async (req, res) => {
    try {
      const { id } = req.params;
      if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo.' });

      const caminho = req.file.path.replace(/\\/g, '/');
      
      await db.execute(
        'INSERT INTO arquivos_processos (processo_id, nome_arquivo, caminho_arquivo) VALUES (?, ?, ?)',
        [id, req.file.originalname, caminho]
      );
      res.json({ message: 'Arquivo anexado.' });
    } catch (error) {
      res.status(500).json({ message: 'Erro no upload.' });
    }
  },
  
  // --- NOVA FUNÇÃO DE ATUALIZAÇÃO ---
  update: async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      
      const { id } = req.params;
      const { numero_processo, status, advogado_responsavel } = req.body;
      const usuarioId = req.user.id;

      // 1. Busca dados antigos para comparar
      const [antigo] = await connection.query('SELECT status FROM processos WHERE id = ?', [id]);
      
      if (antigo.length === 0) {
        connection.release();
        return res.status(404).json({ message: 'Processo não encontrado.' });
      }

      // 2. Atualiza o Processo
      await connection.execute(
        'UPDATE processos SET numero_processo = ?, status = ?, advogado_responsavel = ? WHERE id = ?',
        [numero_processo, status, advogado_responsavel, id]
      );

      // 3. Se mudou o Status, gera log automático no histórico do processo
      if (antigo[0].status !== status) {
        await connection.execute(
          'INSERT INTO historico_processos (processo_id, titulo, descricao, usuario_id) VALUES (?, ?, ?, ?)',
          [
            id, 
            'Alteração de Status', 
            `Status alterado de "${antigo[0].status}" para "${status}".`, 
            usuarioId
          ]
        );
      }

      await connection.commit();
      res.json({ message: 'Processo atualizado com sucesso.' });

    } catch (error) {
      await connection.rollback();
      console.error(error);
      res.status(500).json({ message: 'Erro ao atualizar processo.' });
    } finally {
      connection.release();
    }
  }
};

module.exports = processoController;