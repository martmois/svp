// backend/src/controllers/webhookController.js
const db = require('../config/database');
const notificacaoService = require('../services/notificacaoService');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.APP_URL || 'http://192.168.0.139:3001';

const webhookController = {
  handleInbound: async (req, res) => {
    try {
      console.log('📨 [Webhook] Iniciando processamento...');
      
      req.body = req.body || {};

      if (Object.keys(req.body).length === 0 && (!req.files || req.files.length === 0)) {
        console.error('❌ Erro: Payload vazio.');
        return res.status(200).send('Empty Payload');
      }

      // --- 1. Extração e Tratamento de ID (Idempotência) ---
      let messageId = req.body['Message-Id'] || req.body['message-id'];
      if (messageId) messageId = messageId.replace(/^<|>$/g, '');

      const { sender, subject, 'body-html': bodyHtml, 'body-plain': bodyPlain } = req.body;
      
      let emailRemetente = sender || req.body.from || '';
      if (emailRemetente && emailRemetente.includes('<')) {
         const match = emailRemetente.match(/<(.+)>/);
         if (match) emailRemetente = match[1];
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // [IDEMPOTÊNCIA] Verifica se essa mensagem JÁ existe no banco antes de prosseguir
        if (messageId) {
            const [duplicada] = await connection.query(
                'SELECT id FROM mensagens WHERE message_id_externo = ? LIMIT 1', 
                [messageId]
            );
            if (duplicada.length > 0) {
                console.log(`🛑 [Webhook] Mensagem ${messageId} já processada. Ignorando duplicata.`);
                await connection.rollback();
                return res.status(200).send('OK');
            }
        }

        // --- 2. Processamento de Anexos ---
        const attachments = req.files || [];
        console.log(`📎 Anexos recebidos: ${attachments.length}`);

        let html = bodyHtml || bodyPlain || '<p>Sem conteúdo</p>';
        const anexosParaBanco = [];
        const uploadDir = path.resolve(__dirname, '..', '..', 'uploads');

        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        let contentIdMap = {};
        try {
          if (req.body['content-id-map']) contentIdMap = JSON.parse(req.body['content-id-map']);
        } catch (e) {}

        if (attachments.length > 0) {
          for (const file of attachments) {
            try {
               file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
            } catch (errEncoding) {}

            const extensao = path.extname(file.originalname);
            const nomeBase = path.basename(file.originalname, extensao).replace(/[^a-zA-Z0-9]/g, '_');
            const nomeArquivoSalvo = `${Date.now()}_${nomeBase}${extensao}`;
            const caminhoCompleto = path.join(uploadDir, nomeArquivoSalvo);

            try {
              if (file.buffer) await fs.promises.writeFile(caminhoCompleto, file.buffer);
              else if (file.path) await fs.promises.rename(file.path, caminhoCompleto);

              const urlPublica = `${BACKEND_URL}/uploads/${nomeArquivoSalvo}`;
              const cidNome = `cid:${file.originalname}`;
              if (html.includes(cidNome)) html = html.split(cidNome).join(urlPublica);

              for (const [cidKey, attachmentName] of Object.entries(contentIdMap)) {
                if (attachmentName === file.fieldname) {
                    const cleanCid = cidKey.replace(/^<|>$/g, ''); 
                    const cidPattern = `cid:${cleanCid}`;
                    if (html.includes(cidPattern)) html = html.split(cidPattern).join(urlPublica);
                }
              }

              anexosParaBanco.push({
                nome_original: file.originalname,
                nome_armazenado: nomeArquivoSalvo,
                caminho_arquivo: `uploads/${nomeArquivoSalvo}`,
                tamanho_arquivo: file.size,
                tipo_mime: file.mimetype
              });

            } catch (err) {
              console.error(`❌ Erro ao salvar arquivo:`, err);
            }
          }
        }

        html = html.replace(/http:\/\/email.mailgun/g, 'https://email.mailgun');

        // --- 3. Lógica de Negócio ---
        const [contatos] = await connection.query('SELECT id FROM contatos_email WHERE email = ?', [emailRemetente]);
        if (contatos.length === 0) {
            await connection.rollback();
            console.log(`⚠️ Remetente desconhecido: ${emailRemetente}`);
            return res.status(200).send('OK'); 
        }
        const contatoId = contatos[0].id;

        const [comunicacoes] = await connection.query("SELECT id FROM comunicacoes WHERE contato_email_id = ? AND status != 'fechado' LIMIT 1", [contatoId]);
        
        let comunicacaoId;
        if (comunicacoes.length > 0) {
          comunicacaoId = comunicacoes[0].id;
          await connection.query("UPDATE comunicacoes SET status = 'respondido' WHERE id = ?", [comunicacaoId]);
        } else {
          const [nova] = await connection.query("INSERT INTO comunicacoes (contato_email_id, assunto_inicial, status) VALUES (?, ?, 'respondido')", [contatoId, subject || 'Nova Mensagem']);
          comunicacaoId = nova.insertId;
        }

        const [msgResult] = await connection.query(
          "INSERT INTO mensagens (comunicacao_id, remetente, destinatario, corpo_html, tipo, data_envio, message_id_externo) VALUES (?, ?, 'Sistema', ?, 'recebido', NOW(), ?)",
          [comunicacaoId, emailRemetente, html, messageId] 
        );
        const novaMensagemId = msgResult.insertId;

        if (anexosParaBanco.length > 0) {
          for (let i = 0; i < anexosParaBanco.length; i++) {
            const anexo = anexosParaBanco[i];
            const [resAnexo] = await connection.query('INSERT INTO anexos SET ?', {
              mensagem_id: novaMensagemId,
              nome_arquivo_original: anexo.nome_original,
              nome_arquivo_armazenado: anexo.nome_armazenado,
              caminho_arquivo: anexo.caminho_arquivo,
              tamanho_arquivo: anexo.tamanho_arquivo,
              tipo_mime: anexo.tipo_mime
            });
            anexosParaBanco[i].id = resAnexo.insertId;
          }
        }

        await connection.commit();

        // --- 4. Notificações e Socket ---
        
        const io = req.app.get('io');
        if (io) {
          const payload = {
            id: novaMensagemId,
            comunicacao_id: comunicacaoId,
            remetente: emailRemetente,
            destinatario: 'Sistema',
            corpo_html: html,
            tipo: 'recebido',
            data_envio: new Date(),
            anexos: anexosParaBanco
          };
          io.to(`conversa-${comunicacaoId}`).emit('nova_mensagem_na_conversa', payload);
        }
        
        if (notificacaoService?.criar) {
            // Busca dados da unidade e carteira
            const [dados] = await connection.query(`
              SELECT u.numero_unidade, u.bloco, u.responsavel_nome, cond.carteira
              FROM comunicacoes com
              JOIN contatos_email ce ON com.contato_email_id = ce.id
              JOIN unidades u ON ce.unidade_id = u.id
              JOIN condominios cond ON u.condominio_id = cond.id
              WHERE com.id = ?
            `, [comunicacaoId]);

            if (dados.length > 0) {
                const info = dados[0];
                const carteira = info.carteira || null;

                const [usuariosDestino] = await connection.query(`
                  SELECT id FROM usuarios 
                  WHERE perfil IN ('ceo', 'supervisor') 
                  OR (perfil = 'colaborador' AND carteira = ?)
                `, [carteira]);

                console.log(`🔔 [Webhook] Notificando ${usuariosDestino.length} usuários.`);

                for (const user of usuariosDestino) {
                    await notificacaoService.criar({
                      usuario_id: user.id, 
                      titulo: `Resposta de ${info.responsavel_nome}`,
                      mensagem: `Unidade ${info.numero_unidade}: ${subject || 'Nova mensagem'}`,
                      // CORREÇÃO: Link ajustado para ativar o contador no frontend
                      link: `/comunicacao/${comunicacaoId}`, 
                      tipo: 'info'
                    });
                }
            }
        }

        res.status(200).send('OK');

      } catch (errDb) {
        await connection.rollback();
        console.error('❌ Erro BD:', errDb);
        res.status(500).send('DB Error');
      } finally {
        connection.release();
      }

    } catch (error) {
      console.error('❌ Erro Crítico Webhook:', error);
      res.status(500).send('Server Error');
    }
  },

  handleEvents: async (req, res) => {
    // Mantido igual
    try {
      const eventData = req.body['event-data'];
      if (!eventData) return res.status(200).send('No data');

      const { event, recipient } = eventData;
      let originalMessageId = null;
      
      if (eventData.message && eventData.message.headers && eventData.message.headers['message-id']) {
        originalMessageId = eventData.message.headers['message-id'];
      } else {
        originalMessageId = eventData.id;
      }

      if (originalMessageId) originalMessageId = originalMessageId.replace(/^<|>$/g, '');

      const statusMap = { 'accepted': 'Processado', 'delivered': 'Entregue', 'opened': 'Aberto', 'failed': 'Erro', 'complained': 'Erro', 'unsubscribed': 'Erro' };
      const statusSistema = statusMap[event] || event;

      await db.query(
        "INSERT INTO email_eventos (message_id_externo, destinatario, evento, data_evento, payload_json) VALUES (?, ?, ?, NOW(), ?)",
        [originalMessageId, recipient, statusSistema, JSON.stringify(eventData)]
      );

      res.status(200).send('OK');
    } catch (error) {
      console.error('❌ [Events Erro]:', error);
      res.status(200).send('OK'); 
    }
  }
};

module.exports = webhookController;