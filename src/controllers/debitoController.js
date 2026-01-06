// backend/src/controllers/debitoController.js

const db = require('../config/database');
const xlsx = require('xlsx');
const logService = require('../services/logService');

/**
 * Função de conversão de data robusta.
 * Converte datas do Excel (número serial) ou texto (DD/MM/AAAA) para o formato do SQL (AAAA-MM-DD).
 */
function formatarDataParaSQL(excelDate) {
  // Se o valor for nulo, indefinido ou vazio, retorna null.
  if (excelDate == null || excelDate === '') {
    return null;
  }

  // Se for um número (formato de data serial do Excel), converte.
  if (typeof excelDate === 'number') {
    const jsDate = xlsx.SSF.parse_date_code(excelDate);
    if (jsDate) {
      const year = jsDate.y;
      const month = String(jsDate.m).padStart(2, '0');
      const day = String(jsDate.d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  // Se for um texto no formato DD/MM/AAAA, converte.
  if (typeof excelDate === 'string' && excelDate.includes('/')) {
    const partes = excelDate.split('/');
    if (partes.length === 3) {
      return `${partes[2]}-${partes[1]}-${partes[0]}`;
    }
  }

  // Se já estiver no formato AAAA-MM-DD, retorna diretamente.
  if (typeof excelDate === 'string' && excelDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return excelDate;
  }
  
  // Se não conseguir converter por qualquer outro motivo, retorna null.
  return null;
}

const debitoController = {
  importFromSheet: async (req, res) => {
    try {
      const { condominioId } = req.params;
      const { id: usuarioId } = req.user;

      if (!req.file) return res.status(400).json({ mensagem: 'Nenhum arquivo enviado.' });

      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      //{ raw: false } para ajudar na formatação de datas
      const debitosJSON = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { raw: false });

      if (debitosJSON.length === 0) return res.status(400).json({ mensagem: 'A planilha está vazia.' });

      const connection = await db.getConnection();
      let importados = 0;
      let naoEncontrados = [];

      for (const row of debitosJSON) {
        const [unidades] = await connection.query(
          'SELECT id FROM unidades WHERE condominio_id = ? AND numero_unidade = ? AND (bloco = ? OR (? IS NULL AND bloco IS NULL))',
          [condominioId, row.unidade, row.bloco || null, row.bloco || null]
        );

        if (unidades.length > 0) {
          const unidadeId = unidades[0].id;
          const novoDebito = {
            unidade_id: unidadeId,
            valor: parseFloat(row.valor),
            // Usa a nova função de conversão de data
            data_vencimento: formatarDataParaSQL(row.data_vencimento),
            status: 'pendente'
          };
          
          await connection.query('INSERT INTO debitos SET ?', novoDebito);
          importados++;
        } else {
          naoEncontrados.push(`Bloco: ${row.bloco || 'N/A'}, Unidade: ${row.unidade}`);
        }
      }

      // --- LOG DE IMPORTAÇÃO ---
      // 1. Busca nome do condomínio
      const [condoRows] = await connection.query('SELECT nome FROM condominios WHERE id = ?', [condominioId]);
      const nomeCondo = condoRows.length > 0 ? condoRows[0].nome : 'Desconhecido';

      // 2. Registra
      const detalhesLog = `Importou ${importados} débitos para: ${nomeCondo}. (${naoEncontrados.length} não encontrados)`;
      logService.registrar(usuarioId, 'IMPORTOU_DEBITOS', detalhesLog, req);
      
      connection.release();
      res.status(201).json({ 
        mensagem: 'Importação concluída.',
        importados,
        naoEncontrados: naoEncontrados.length,
        detalhesNaoEncontrados: naoEncontrados,
      });

    } catch (error) {
      console.error("Erro na importação de débitos:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },
  getByUnidadeId: async (req, res) => {
    try {
      const { unidadeId } = req.params;
      const query = 'SELECT * FROM debitos WHERE unidade_id = ? ORDER BY data_vencimento DESC';
      const [debitos] = await db.query(query, [unidadeId]);
      res.json(debitos);
    } catch (error) {
      console.error("Erro ao listar débitos por unidade:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

// --- NOVA FUNÇÃO PARA CRIAR UM DÉBITO ---
  create: async (req, res) => {
    try {
      const { unidade_id, valor, data_vencimento, status, descricao } = req.body;
      const { id: usuarioId } = req.user;

      if (!unidade_id || !valor || !data_vencimento) {
        return res.status(400).json({ mensagem: 'Unidade, valor e data de vencimento são obrigatórios.' });
      }

      // 1. Inserir o débito
      const query = 'INSERT INTO debitos (unidade_id, valor, data_vencimento, status, descricao) VALUES (?, ?, ?, ?, ?)';
      const [result] = await db.execute(query, [unidade_id, valor, data_vencimento, status || 'pendente', descricao || 'Lançamento Manual']);

      // 2. Buscar dados para o Log (Nome do Condomínio e Unidade)
      const [dadosUnidade] = await db.query(`
        SELECT u.numero_unidade, u.bloco, c.nome as nome_condominio 
        FROM unidades u 
        JOIN condominios c ON u.condominio_id = c.id 
        WHERE u.id = ?
      `, [unidade_id]);

      if (dadosUnidade.length > 0) {
        const u = dadosUnidade[0];
        const nomeUnidade = `${u.bloco ? u.bloco + '-' : ''}${u.numero_unidade}`;
        const dataFormatada = new Date(data_vencimento).toLocaleDateString('pt-BR');
        
        // --- REGISTRA LOG ---
        logService.registrar(
          usuarioId, 
          'CRIOU_DEBITO', 
          `Criou débito manual: R$ ${valor} para Unidade ${nomeUnidade} (${u.nome_condominio}). Venc: ${dataFormatada}`, 
          req
        );
      }

      res.status(201).json({ id: result.insertId, ...req.body });
    } catch (error) {
      console.error("Erro ao criar débito:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

  // --- NOVA FUNÇÃO PARA DELETAR UM DÉBITO ---
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const { id: usuarioId } = req.user;

      // 1. Busca dados do débito ANTES de excluir para salvar no log
      const [dadosDebito] = await db.query(`
        SELECT d.valor, d.data_vencimento, u.numero_unidade, u.bloco, c.nome as nome_condominio
        FROM debitos d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE d.id = ?
      `, [id]);

      const [result] = await db.execute('DELETE FROM debitos WHERE id = ?', [id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ mensagem: 'Débito não encontrado.' });
      }

      // --- REGISTRA LOG ---
      if (dadosDebito.length > 0) {
        const d = dadosDebito[0];
        const nomeUnidade = `${d.bloco ? d.bloco + '-' : ''}${d.numero_unidade}`;
        const dataFormatada = new Date(d.data_vencimento).toLocaleDateString('pt-BR');
        
        logService.registrar(
          usuarioId, 
          'EXCLUIU_DEBITO', 
          `Excluiu débito: R$ ${d.valor} da Unidade ${nomeUnidade} (${d.nome_condominio}). Venc: ${dataFormatada}`, 
          req
        );
      }

      res.status(204).send(); // Sucesso, sem conteúdo
    } catch (error) {
      console.error("Erro ao deletar débito:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },

  alterarStatusEmMassa: async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { ids, novo_status, usuario_id, observacao } = req.body;

      if (!ids || ids.length === 0) return res.status(400).json({ mensagem: 'Nenhum débito selecionado.' });

      for (const id of ids) {
        // Pega status anterior
        const [rows] = await connection.query('SELECT status FROM debitos WHERE id = ?', [id]);
        if (rows.length === 0) continue;
        const statusAnterior = rows[0].status;

        // Atualiza tabela de débitos
        await connection.execute('UPDATE debitos SET status = ? WHERE id = ?', [novo_status, id]);

        // Insere no histórico
        await connection.execute(
          'INSERT INTO historico_debitos (debito_id, usuario_id, status_anterior, status_novo, observacao) VALUES (?, ?, ?, ?, ?)',
          [id, usuario_id, statusAnterior, novo_status, observacao]
        );
      }

      await connection.commit();
      res.json({ mensagem: 'Status atualizados com sucesso.' });
    } catch (error) {
      await connection.rollback();
      console.error(error);
      res.status(500).json({ mensagem: 'Erro ao atualizar status.' });
    } finally {
      connection.release();
    }
  },

  baixarDebitos: async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { ids, usuario_id, observacao } = req.body; // ids = array de IDs dos débitos

      if (!ids || ids.length === 0) return res.status(400).json({ mensagem: 'Nenhum débito selecionado.' });

      // 1. Atualiza Status
      const placeholders = ids.map(() => '?').join(',');
      await connection.query(
        `UPDATE debitos SET status = 'pago' WHERE id IN (${placeholders})`,
        ids
      );

      // 2. Busca valor total para a nota
      const [rows] = await connection.query(`SELECT valor FROM debitos WHERE id IN (${placeholders})`, ids);
      const totalPago = rows.reduce((acc, d) => acc + Number(d.valor), 0);

      // 3. Insere Nota na Timeline
      const textoNota = `
        <strong>BAIXA DE PAGAMENTO (MANUAL)</strong><br/>
        <strong>Total Pago:</strong> R$ ${totalPago.toFixed(2)}<br/>
        <strong>Qtd Débitos:</strong> ${ids.length}<br/>
        <strong>Obs:</strong> ${observacao || 'Baixa realizada via CRM'}
      `;

      // Precisamos do unidade_id. Pegamos do primeiro débito (assumindo que todos são da mesma unidade)
      const [unidadeRow] = await connection.query(`SELECT unidade_id FROM debitos WHERE id = ?`, [ids[0]]);
      const unidadeId = unidadeRow[0].unidade_id;

      await connection.execute(
        'INSERT INTO notas_internas (unidade_id, usuario_id, texto) VALUES (?, ?, ?)',
        [unidadeId, usuario_id, textoNota]
      );

      await connection.commit();
      res.json({ mensagem: 'Baixa realizada com sucesso.' });

    } catch (error) {
      await connection.rollback();
      console.error(error);
      res.status(500).json({ mensagem: 'Erro na baixa.' });
    } finally {
      connection.release();
    }
  }

};

module.exports = debitoController;