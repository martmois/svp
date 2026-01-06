// backend/src/controllers/acordoController.js
const db = require('../config/database');

const acordoController = {
  criar: async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const { unidade_id, usuario_id, debitos_ids, qtd_parcelas, observacao } = req.body;

      // 1. Calcular o valor total dos débitos selecionados
      // Precisamos buscar os valores no banco para garantir segurança
      const placeholders = debitos_ids.map(() => '?').join(',');
      const [rows] = await connection.query(
        `SELECT id, valor, data_vencimento FROM debitos WHERE id IN (${placeholders})`, 
        debitos_ids
      );

      const valorTotal = rows.reduce((acc, debito) => acc + Number(debito.valor), 0);
      
      // Lista de datas para a nota (apenas visualização)
      const listaVencimentos = rows.map(d => new Date(d.data_vencimento).toLocaleDateString('pt-BR')).join(', ');

      // 2. Criar o Registro do Acordo
      const [acordo] = await connection.execute(
        'INSERT INTO acordos (unidade_id, usuario_id, valor_total, qtd_parcelas, observacao) VALUES (?, ?, ?, ?, ?)',
        [unidade_id, usuario_id, valorTotal, qtd_parcelas, observacao]
      );
      const acordoId = acordo.insertId;

      // 3. Atualizar os Débitos (Status = em_acordo e Vinculo com ID do acordo)
      await connection.query(
        `UPDATE debitos SET status = 'Em Acordo', acordo_id = ? WHERE id IN (${placeholders})`,
        [acordoId, ...debitos_ids]
      );

      // 4. Inserir Nota na Timeline (CRM)
      const textoNota = `
        <strong>ACORDO REALIZADO</strong><br/>
        <strong>Valor Total Renegociado:</strong> R$ ${valorTotal.toFixed(2)}<br/>
        <strong>Parcelamento:</strong> ${qtd_parcelas}x<br/>
        <strong>Débitos Originais:</strong> ${rows.length} faturas (${listaVencimentos})<br/>
        <strong>Obs:</strong> ${observacao || '-'}
      `;

      await connection.execute(
        'INSERT INTO notas_internas (unidade_id, usuario_id, texto) VALUES (?, ?, ?)',
        [unidade_id, usuario_id, textoNota]
      );

      await connection.commit();
      res.status(201).json({ mensagem: 'Acordo registrado com sucesso!' });

    } catch (error) {
      await connection.rollback();
      console.error("Erro ao criar acordo:", error);
      res.status(500).json({ mensagem: 'Erro ao registrar acordo.' });
    } finally {
      connection.release();
    }
  }
};

module.exports = acordoController;