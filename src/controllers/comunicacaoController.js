// backend/src/controllers/comunicacaoController.js
const db = require('../config/database');
const transporter = require('../config/mailer');

const comunicacaoController = {
  // Lista todas as conversas (Com filtro de Carteira)
  getAll: async (req, res) => {
    try {
      const { perfil, carteira } = req.user;
      
      let whereClause = '';
      const params = [];

      // SE FOR COLABORADOR: Filtra pela carteira
      if (perfil === 'colaborador') {
        if (!carteira) return res.json([]); // Sem carteira = não vê nada
        whereClause = ' WHERE c.carteira = ? ';
        params.push(carteira);
      }

      const query = `
        SELECT 
          com.id, com.assunto_inicial, com.data_inicio, com.status,
          u.numero_unidade, u.bloco, u.responsavel_nome,
          c.nome as nome_condominio,
          ce.email as email_contato
        FROM comunicacoes com
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        JOIN unidades u ON ce.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        ${whereClause}
        ORDER BY 
          CASE WHEN com.status = 'respondido' THEN 1 ELSE 2 END, -- Prioriza não lidas
          com.data_inicio DESC
      `;
      
      const [comunicacoes] = await db.query(query, params);
      res.json(comunicacoes);
    } catch (error) {
      console.error("Erro ao buscar comunicações:", error);
      res.status(500).json({ mensagem: 'Erro ao buscar comunicações.' });
    }
  },

  // Busca detalhes de uma conversa (Com segurança de acesso)
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const { perfil, carteira } = req.user;
      
      const [comunicacoes] = await db.query(`
        SELECT 
          com.*, 
          u.responsavel_nome, u.numero_unidade, u.bloco, u.condominio_id,
          c.nome AS nome_condominio,
          c.carteira, -- Trazemos a carteira para conferir
          ce.email AS email_contato
        FROM comunicacoes com
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        JOIN unidades u ON ce.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE com.id = ?
      `, [id]);

      if (comunicacoes.length === 0) {
        return res.status(404).json({ mensagem: 'Conversa não encontrada.' });
      }

      const conversa = comunicacoes[0];

      // SEGURANÇA: Verifica se o colaborador pode ver essa conversa
      if (perfil === 'colaborador') {
        if (conversa.carteira !== carteira) {
          return res.status(403).json({ mensagem: 'Acesso negado. Esta conversa pertence a outra carteira.' });
        }
      }

      const [mensagens] = await db.query('SELECT * FROM mensagens WHERE comunicacao_id = ? ORDER BY data_envio ASC', [id]);
      const [anexos] = await db.query(`
        SELECT a.* FROM anexos a JOIN mensagens m ON a.mensagem_id = m.id WHERE m.comunicacao_id = ?
      `, [id]);

      const mensagensComAnexos = mensagens.map(mensagem => ({
        ...mensagem,
        anexos: anexos.filter(anexo => anexo.mensagem_id === mensagem.id)
      }));
      
      res.json({ conversa, mensagens: mensagensComAnexos });
    } catch (error) {
      console.error("Erro ao buscar detalhes:", error);
      res.status(500).json({ mensagem: 'Erro ao buscar detalhes.' });
    }
  },

  // Conta mensagens não lidas (Com filtro de Carteira para o Badge)
  countRespondidas: async (req, res) => {
    try {
      const { perfil, carteira } = req.user;
      let query = "SELECT COUNT(*) as total FROM comunicacoes com";
      const params = [];

      // Precisamos fazer os joins para filtrar por carteira
      if (perfil === 'colaborador') {
        query += `
          JOIN contatos_email ce ON com.contato_email_id = ce.id
          JOIN unidades u ON ce.unidade_id = u.id
          JOIN condominios c ON u.condominio_id = c.id
          WHERE com.status = 'respondido' AND c.carteira = ?
        `;
        params.push(carteira);
      } else {
        query += " WHERE status = 'respondido'";
      }

      const [rows] = await db.query(query, params);
      res.json({ total: rows[0].total });
    } catch (error) {
      console.error("Erro ao contar não lidas:", error);
      res.status(500).json({ total: 0 });
    }
  },

  marcarComoLida: async (req, res) => {
    try {
      const { id } = req.params;
      await db.query(
        "UPDATE comunicacoes SET status = 'lida' WHERE id = ? AND status = 'respondido'",
        [id]
      );
      res.status(200).json({ mensagem: 'Conversa marcada como lida.' });
    } catch (error) {
      console.error("Erro ao marcar como lida:", error);
      res.status(500).json({ mensagem: 'Erro interno.' });
    }
  },
  
  responder: async (req, res) => {
    const { id } = req.params;
    const { textoResposta } = req.body;
    
    // Tratamento de anexos vindos do upload
    let anexos = req.files || [];
    
    // CORREÇÃO DE CODIFICAÇÃO PARA ARQUIVOS ENVIADOS
    anexos = anexos.map(file => {
      try {
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      } catch (e) {}
      return file;
    });

    const connection = await db.getConnection();

    try {
      if (!textoResposta.trim() && anexos.length === 0) {
        return res.status(400).json({ mensagem: 'A resposta precisa de um texto ou um anexo.' });
      }

      await connection.beginTransaction();

      const [comunicacoes] = await connection.query(`
        SELECT com.*, ce.email as email_destinatario
        FROM comunicacoes com
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        WHERE com.id = ?
      `, [id]);

      if (comunicacoes.length === 0) throw new Error('Comunicação não encontrada');
      const conversa = comunicacoes[0];

      const [ultimasMensagens] = await connection.query('SELECT message_id_externo FROM mensagens WHERE comunicacao_id = ? AND message_id_externo IS NOT NULL ORDER BY data_envio DESC LIMIT 1', [id]);
      const ultimaMensagem = ultimasMensagens[0] || {};

      let anexosParaEnvio = [];
      if (anexos.length > 0) {
        anexosParaEnvio = anexos.map(anexo => ({ 
            filename: anexo.originalname, // Nome correto com acento para o E-mail
            path: anexo.path 
        }));
      }

      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: conversa.email_destinatario,
        replyTo: `adm@martmois.com`,
        subject: `Re: ${conversa.assunto_inicial}`,
        html: textoResposta,
        attachments: anexosParaEnvio,
        inReplyTo: ultimaMensagem.message_id_externo ? `<${ultimaMensagem.message_id_externo}>` : undefined,
        references: ultimaMensagem.message_id_externo ? `<${ultimaMensagem.message_id_externo}>` : undefined,
      });

      const [msgResult] = await connection.query('INSERT INTO mensagens SET ?', {
        comunicacao_id: id,
        remetente: process.env.EMAIL_USER,
        destinatario: conversa.email_destinatario,
        corpo_html: textoResposta,
        tipo: 'enviado',
        message_id_externo: info.messageId.replace(/[<>]/g, '')
      });
      const mensagemId = msgResult.insertId;

      if (anexos.length > 0) {
        for (const anexo of anexos) {
          // Para salvar no banco, mantemos o original com acento
          // Para salvar no disco, o Multer já salvou com um nome hash/limpo (anexo.filename)
          await connection.query('INSERT INTO anexos SET ?', {
            mensagem_id: mensagemId,
            nome_arquivo_original: anexo.originalname, // Nome visual (UTF-8)
            nome_arquivo_armazenado: anexo.filename,   // Nome físico
            caminho_arquivo: anexo.path,
            tamanho_arquivo: anexo.size,
            tipo_mime: anexo.mimetype
          });
        }
      }

      await connection.query('UPDATE comunicacoes SET status = "aberto" WHERE id = ?', [id]);
      
      await connection.commit();
      
      const [mensagensSalvas] = await connection.query('SELECT * FROM mensagens WHERE id = ?', [mensagemId]);
      const [anexosSalvos] = await connection.query('SELECT * FROM anexos WHERE mensagem_id = ?', [mensagemId]);
      const mensagemCompleta = { ...mensagensSalvas[0], anexos: anexosSalvos };
      
      res.status(200).json({ mensagem: 'Resposta enviada com sucesso!', mensagemSalva: mensagemCompleta });

    } catch (error) {
      if (connection) await connection.rollback();
      console.error("Erro ao enviar resposta:", error);
      res.status(500).json({ mensagem: 'Erro ao enviar resposta.' });
    } finally {
      if (connection) connection.release();
    }
  },

  // --- NOVO MÉTODO: SOLICITAR AUTORIZAÇÃO (CORRIGIDO) ---
  solicitarAutorizacao: async (req, res) => {
    const { unidadeId, assunto, mensagem } = req.body;
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // 1. Busca dados do Condomínio e seus e-mails
      const [dados] = await connection.query(`
        SELECT c.id as condominio_id, c.nome as nome_condominio, c.sindico_email as email_condominio
        FROM unidades u
        JOIN condominios c ON u.condominio_id = c.id
        WHERE u.id = ?
      `, [unidadeId]);

      if (dados.length === 0) throw new Error("Unidade ou Condomínio não encontrados.");
      const condominio = dados[0];

      if (!condominio.email_condominio) {
        throw new Error("O condomínio não possui e-mail cadastrado (Coluna sindico_email vazia).");
      }

      const emailsCondominio = condominio.email_condominio.split(',').map(e => e.trim());
      const emailPrincipal = emailsCondominio[0];

      // 2. Garante que existe um 'contato_email' para a Administração
      let contatoId;
      const [contatoExistente] = await connection.query(
        'SELECT id FROM contatos_email WHERE unidade_id = ? AND email = ?',
        [unidadeId, emailPrincipal]
      );

      if (contatoExistente.length > 0) {
        contatoId = contatoExistente[0].id;
      } else {
        // CORREÇÃO: Inserção ajustada para a estrutura real da tabela (sem nome e tipo)
        const [novoContato] = await connection.query(
          'INSERT INTO contatos_email (unidade_id, email) VALUES (?, ?)',
          [unidadeId, emailPrincipal]
        );
        contatoId = novoContato.insertId;
      }

      // 3. Envia o E-mail
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: emailsCondominio,
        replyTo: `adm@martmois.com`,
        subject: assunto,
        html: mensagem
      });

      // 4. Cria a Comunicação
      const [resComunicacao] = await connection.query(
        'INSERT INTO comunicacoes (contato_email_id, assunto_inicial, status, data_inicio) VALUES (?, ?, ?, NOW())',
        [contatoId, assunto, 'aberto']
      );
      const comunicacaoId = resComunicacao.insertId;

      // 5. Registra a Mensagem
      await connection.query('INSERT INTO mensagens SET ?', {
        comunicacao_id: comunicacaoId,
        remetente: process.env.EMAIL_USER,
        destinatario: emailPrincipal,
        corpo_html: mensagem,
        tipo: 'enviado',
        message_id_externo: info.messageId.replace(/[<>]/g, '')
      });

      await connection.commit();
      res.status(200).json({ mensagem: 'Solicitação enviada com sucesso!' });

    } catch (error) {
      if (connection) await connection.rollback();
      console.error("Erro ao solicitar autorização:", error);
      res.status(500).json({ mensagem: error.message || 'Erro ao enviar solicitação.' });
    } finally {
      if (connection) connection.release();
    }
  }
};

module.exports = comunicacaoController;