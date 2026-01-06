// src/controllers/crmController.js
const db = require('../config/database');

const crmController = {
  getDadosCRM: async (req, res) => {
    try {
      const { unidadeId } = req.params;

      // 1. Dados da Unidade
      const [unidade] = await db.query(`
        SELECT u.*, c.nome as nome_condominio 
        FROM unidades u 
        JOIN condominios c ON u.condominio_id = c.id 
        WHERE u.id = ?
      `, [unidadeId]);

      if (unidade.length === 0) return res.status(404).json({ message: 'Unidade não encontrada' });

      // 2. Buscar Contatos Extras
      const [emails] = await db.query('SELECT email FROM contatos_email WHERE unidade_id = ?', [unidadeId]);
      const [telefones] = await db.query('SELECT telefone FROM contatos_telefone WHERE unidade_id = ?', [unidadeId]);

      // 3. Débitos
      const [debitos] = await db.query('SELECT * FROM debitos WHERE unidade_id = ? AND status != "pago" ORDER BY data_vencimento ASC', [unidadeId]);

      // 4. Histórico de Cobrança (CRM)
      const [historico] = await db.query(`
        SELECT h.*, u.nome as nome_usuario 
        FROM historico_cobranca h
        LEFT JOIN usuarios u ON h.usuario_id = u.id
        WHERE h.unidade_id = ?
        ORDER BY h.data_contato DESC
      `, [unidadeId]);

      // 5. Histórico de E-mails Enviados
      // ALTERAÇÃO AQUI: Adicionado 'm.corpo_html' no SELECT
      const [emailsEnviados] = await db.query(`
        SELECT com.*, m.data_envio, com.assunto_inicial as assunto, m.corpo_html
        FROM comunicacoes com
        JOIN mensagens m ON m.comunicacao_id = com.id
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        WHERE ce.unidade_id = ? AND m.tipo = 'enviado'
        ORDER BY m.data_envio DESC
      `, [unidadeId]);

      // 6. Acordos e Processos
      const [acordos] = await db.query('SELECT * FROM acordos WHERE unidade_id = ?', [unidadeId]);
      const [processos] = await db.query('SELECT * FROM processos WHERE unidade_id = ?', [unidadeId]);

      res.json({
        unidade: { 
          ...unidade[0], 
          lista_emails: emails.map(e => e.email), 
          lista_telefones: telefones.map(t => t.telefone) 
        },
        debitos,
        historico,
        emailsEnviados,
        acordos,
        processos
      });

    } catch (error) {
      console.error("Erro CRM:", error);
      res.status(500).json({ message: 'Erro ao carregar CRM.' });
    }
  },

  registrarInteracao: async (req, res) => {
    try {
      const { unidadeId } = req.params;
      const { tipo_contato, resultado, motivo_inadimplencia, observacao, data_contato, hora_contato } = req.body;
      const usuarioId = req.user.id;
      
      let arquivoPath = null;
      let arquivoNome = null;
      
      if (req.file) {
        arquivoPath = req.file.path.replace(/\\/g, '/');
        arquivoNome = req.file.originalname;
      }

      let dataFinal = new Date();
      if (data_contato && hora_contato) {
        dataFinal = `${data_contato} ${hora_contato}:00`;
      }

      await db.execute(`
        INSERT INTO historico_cobranca 
        (unidade_id, usuario_id, tipo_contato, resultado, motivo_inadimplencia, observacao, data_contato, arquivo_path, arquivo_nome)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [unidadeId, usuarioId, tipo_contato, resultado, motivo_inadimplencia, observacao, dataFinal, arquivoPath, arquivoNome]);

      res.status(201).json({ message: 'Interação registrada!' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao salvar interação.' });
    }
  }
};

module.exports = crmController;