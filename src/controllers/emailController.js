// src/controllers/emailController.js
const db = require('../config/database');
const transporter = require('../config/mailer');
const fs = require('fs/promises');
const path = require('path');
const notificacaoService = require('../services/notificacaoService');

// Função para formatar moeda
const formatarMoeda = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

// Função para formatar data
const formatarData = (dataSQL) => {
  if (!dataSQL) return 'N/A';
  const data = new Date(dataSQL);
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(data);
};


const emailController = {
  // Busca a lista de templates no banco
  listarTemplates: async (req, res) => {
    try {
      const [templates] = await db.query('SELECT id, nome_template, corpo FROM email_templates');
      res.json(templates);
    } catch (error) {
      res.status(500).json({ mensagem: 'Erro ao buscar templates.' });
    }
  },

  enviarEmailCobranca: async (req, res) => {
    const { unidadeId, corpoEmail, assuntoEmail } = req.body;
    
    if (!unidadeId || !corpoEmail || !assuntoEmail) {
      return res.status(400).json({ mensagem: 'Dados incompletos para envio.' });
    }

    const connection = await db.getConnection();

    try {
      const [contatosEmail] = await connection.query('SELECT * FROM contatos_email WHERE unidade_id = ?', [unidadeId]);
      
      if (contatosEmail.length === 0) {
        return res.status(404).json({ mensagem: `Nenhum e-mail de contato encontrado para a Unidade.` });
      }

      for (const contato of contatosEmail) {
        await connection.beginTransaction();

        try {
          const [comunicacaoResult] = await connection.query('INSERT INTO comunicacoes SET ?', {
            contato_email_id: contato.id,
            assunto_inicial: assuntoEmail,
            status: 'aberto'
          });
          const comunicacaoId = comunicacaoResult.insertId;

          const [msgResult] = await connection.query('INSERT INTO mensagens SET ?', {
            comunicacao_id: comunicacaoId,
            remetente: process.env.EMAIL_USER,
            destinatario: contato.email,
            corpo_html: corpoEmail,
            tipo: 'enviado',
          });
          const mensagemId = msgResult.insertId;

          const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: contato.email,
            replyTo: 'adm@martmois.com',
            subject: assuntoEmail,
            html: corpoEmail,
          });
          
          await connection.query('UPDATE mensagens SET message_id_externo = ?, sg_message_id = ? WHERE id = ?', [
            info.messageId.replace(/[<>]/g, ''),
            info.messageId,
            mensagemId
          ]);

          await connection.commit();
        } catch (innerError) {
          await connection.rollback();
          console.error(`Falha ao enviar e-mail para ${contato.email}:`, innerError);
        }
      }

      res.status(200).json({ mensagem: `Processo de envio finalizado.` });

    } catch (error) {
      console.error("Erro geral no envio de cobrança:", error);
      res.status(500).json({ mensagem: 'Falha ao processar envios.' });
    } finally {
      if (connection) connection.release();
    }
  },

  previewEmail: async (req, res) => {
    const { unidadeId, templateId } = req.params;
    try {
      const [unidadeRes, debitosRes, templateRes] = await Promise.all([
        db.query(`SELECT u.*, c.nome as nome_condominio FROM unidades u JOIN condominios c ON u.condominio_id = c.id WHERE u.id = ?`, [unidadeId]),
        db.query('SELECT * FROM debitos WHERE unidade_id = ? AND status = "pendente"', [unidadeId]),
        db.query('SELECT * FROM email_templates WHERE id = ?', [templateId])
      ]);

      const unidade = unidadeRes[0][0];
      const debitos = debitosRes[0];
      const template = templateRes[0][0];

      if (!unidade || !template) return res.status(404).json({ mensagem: 'Dados não encontrados.' });

      const usuarioLogado = req.user?.nome;

      let listaDebitosHtml = '<ul>';
      debitos.forEach(d => {
        listaDebitosHtml += `<strong>${formatarData(d.data_vencimento)}</strong>&nbsp; | &nbsp;`;
      });
      listaDebitosHtml += '</ul>';

      let corpoEmail = template.corpo
        .replace(/{CONDOMÍNIO}/g, unidade.nome_condominio)
        .replace(/{UNIDADE}/g, unidade.numero_unidade)
        .replace(/{DÉBITOS}/g, listaDebitosHtml)
        .replace(/{USUÁRIO}/g, usuarioLogado);
      
      let assuntoEmail = template.assunto
        .replace(/{CONDOMÍNIO}/g, unidade.nome_condominio)
        .replace(/{UNIDADE}/g, unidade.numero_unidade);

      res.json({ assunto: assuntoEmail, corpoHtml: corpoEmail });

    } catch (error) {
      console.error("Erro preview:", error);
      res.status(500).json({ mensagem: 'Erro no preview.' });
    }
  },

  handleReplyWebhook: async (req, res) => {
    const connection = await db.getConnection();
    const io = req.app.get('io');
    
    console.log("📨 [Webhook] Iniciando processamento...");

    try {
      const headersString = req.body.headers;
      let inReplyToId = null;
      let messageIdDaResposta = null;

      const inReplyToMatch = headersString.match(/In-Reply-To:\s*<(.*?)>/i);
      if (inReplyToMatch && inReplyToMatch[1]) inReplyToId = inReplyToMatch[1];
      
      const messageIdMatch = headersString.match(/Message-ID:\s*<(.*?)>/i);
      if (messageIdMatch && messageIdMatch[1]) messageIdDaResposta = messageIdMatch[1];

      if (!inReplyToId) {
        console.log("ℹ️ [Webhook] E-mail sem In-Reply-To ignorado.");
        return res.sendStatus(200);
      }
      
      const [mensagensAnteriores] = await connection.query('SELECT comunicacao_id FROM mensagens WHERE message_id_externo = ?', [inReplyToId]);
      if (mensagensAnteriores.length === 0) {
       console.log("ℹ️ [Webhook] Mensagem original não encontrada no sistema.");
        return res.sendStatus(200);
      }
      
      const comunicacaoId = mensagensAnteriores[0].comunicacao_id;
      const from = req.body.from;
      const body = req.body.text || '';

      await connection.beginTransaction();

      const [msgResult] = await connection.query('INSERT INTO mensagens SET ?', {
        comunicacao_id: comunicacaoId,
        remetente: from,
        destinatario: process.env.EMAIL_USER,
        corpo_html: body.replace(/\n/g, '<br>'),
        tipo: 'recebido',
        message_id_externo: messageIdDaResposta ? messageIdDaResposta.replace(/[<>]/g, '') : null
      });
      const mensagemId = msgResult.insertId;

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
             file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
          } catch(e) {}
          
          const nomeArquivoArmazenado = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const caminhoArquivo = path.join('uploads', nomeArquivoArmazenado);
          
          await fs.writeFile(caminhoArquivo, file.buffer);
          
          await connection.query('INSERT INTO anexos SET ?', {
            mensagem_id: mensagemId,
            nome_arquivo_original: file.originalname,
            nome_arquivo_armazenado: nomeArquivoArmazenado,
            caminho_arquivo: caminhoArquivo,
            tamanho_arquivo: file.size,
            tipo_mime: file.mimetype
          });
        }
      }
      
      await connection.query('UPDATE comunicacoes SET status = "respondido" WHERE id = ?', [comunicacaoId]);
      await connection.commit();
      
      // --- NOTIFICAÇÃO (AJUSTADA) ---

      // 1. Busca Unidade + CARTEIRA DO CONDOMÍNIO
      const [unidades] = await db.query(`
        SELECT u.numero_unidade, u.bloco, u.responsavel_nome, cond.carteira
        FROM comunicacoes com 
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        JOIN unidades u ON ce.unidade_id = u.id 
        JOIN condominios cond ON u.condominio_id = cond.id
        WHERE com.id = ?`, [comunicacaoId]);
      
      const unidadeInfo = unidades[0];
      // Garante que carteira seja null se undefined
      const carteira = (unidadeInfo && unidadeInfo.carteira) ? unidadeInfo.carteira : null; 

      console.log(`🔍 [Webhook] Buscando responsáveis. Carteira do condomínio: ${carteira}`);

      // 2. Busca Usuários que devem ser notificados
      const [usuariosParaNotificar] = await db.query(`
        SELECT id FROM usuarios 
        WHERE perfil IN ('ceo', 'supervisor') 
        OR (perfil = 'colaborador' AND carteira = ?)
      `, [carteira]);

      console.log(`👥 [Webhook] Usuários encontrados para notificar: ${usuariosParaNotificar.length}`);

      // 3. Envia Notificação Persistente
      for (const usuario of usuariosParaNotificar) {
        // Extração segura do ID (tenta id, ID ou Id)
        const userId = usuario.id || usuario.ID || usuario.Id;

        if (!userId) {
             console.error("❌ [Webhook] Usuário encontrado mas sem ID válido no objeto:", usuario);
             continue; // Pula este e tenta o próximo
        }

        console.log(`🔔 [Webhook] Notificando ID: ${userId}`);
        
        await notificacaoService.criar({
          usuario_id: userId,
          titulo: `Nova resposta de ${unidadeInfo.responsavel_nome}`,
          mensagem: `Unidade ${unidadeInfo.bloco || ''} ${unidadeInfo.numero_unidade}: ${body.substring(0, 50)}...`,
          link: `/historico`,
          tipo: 'info'
        });
      }

      // Envia evento em tempo real para a sala da conversa
      const [novaMensagem] = await db.query('SELECT * FROM mensagens WHERE id = ?', [mensagemId]);
      const [novosAnexos] = await db.query('SELECT * FROM anexos WHERE mensagem_id = ?', [mensagemId]);
      const mensagemCompleta = { ...novaMensagem[0], anexos: novosAnexos };
      
      io.to(`conversa-${comunicacaoId}`).emit('nova_mensagem_na_conversa', mensagemCompleta);

      res.sendStatus(200);

    } catch (error) {
      if (connection) await connection.rollback();
      console.error("❌ Erro no webhook de e-mail:", error);
      res.sendStatus(200);
    } finally {
      if (connection) connection.release();
    }
  },
};

module.exports = emailController;