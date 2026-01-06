// src/controllers/chatController.js
const db = require('../config/database');
const cryptoService = require('../services/cryptoService');

const chatController = {
  
  // 1. Listar conversas (CORRIGIDO: Volta a usar JSON_CONTAINS para verificar leitura)
  getMyChats: async (req, res) => {
    try {
      const userId = req.user.id;
      
      const [chats] = await db.query(`
        SELECT r.id, r.tipo, r.nome, r.foto, r.visibilidade, r.descricao, r.criador_id,
               (SELECT mensagem_texto FROM chat_messages WHERE chat_room_id = r.id ORDER BY id DESC LIMIT 1) as ultima_msg,
               (SELECT data_envio FROM chat_messages WHERE chat_room_id = r.id ORDER BY id DESC LIMIT 1) as data_ultima_msg,
               (SELECT COUNT(*) FROM chat_messages 
                WHERE chat_room_id = r.id 
                AND usuario_id != ? 
                AND (lida_por IS NULL OR NOT JSON_CONTAINS(lida_por, CAST(? AS CHAR), '$'))) as nao_lidas
        FROM chat_rooms r
        JOIN chat_participants cp ON cp.chat_room_id = r.id
        WHERE cp.usuario_id = ?
        ORDER BY data_ultima_msg DESC
      `, [userId, userId, userId]);

      for (let chat of chats) {
        if (chat.tipo === 'privado') {
           const [other] = await db.query('SELECT u.nome, u.foto FROM chat_participants cp JOIN usuarios u ON cp.usuario_id = u.id WHERE cp.chat_room_id = ? AND cp.usuario_id != ?', [chat.id, userId]);
           if(other.length) { chat.nome = other[0].nome; chat.foto = other[0].foto; }
        }
        if (chat.ultima_msg) chat.ultima_msg = cryptoService.decrypt(chat.ultima_msg);
      }
      res.json(chats);
    } catch (error) { 
      console.error(error);
      res.status(500).json({ message: 'Erro ao listar.' }); 
    }
  },

  // 2. Atualizar Grupo
  updateGroup: async (req, res) => {
    try {
      const { roomId } = req.params;
      const { nome, visibilidade, descricao } = req.body;
      const userId = req.user.id;

      const [isAdmin] = await db.query('SELECT 1 FROM chat_participants WHERE chat_room_id = ? AND usuario_id = ? AND is_admin = 1', [roomId, userId]);
      
      if (isAdmin.length === 0) return res.status(403).json({ message: 'Apenas admins podem editar.' });

      await db.query(
        'UPDATE chat_rooms SET nome = ?, visibilidade = ?, descricao = ? WHERE id = ?',
        [nome, visibilidade, descricao, roomId]
      );

      res.json({ message: 'Grupo atualizado.' });
    } catch (error) {
      res.status(500).json({ message: 'Erro ao atualizar.' });
    }
  },

  // 3. Excluir Grupo
  deleteRoom: async (req, res) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;

      const [room] = await db.query('SELECT criador_id FROM chat_rooms WHERE id = ?', [roomId]);
      if (room.length === 0) return res.status(404).json({ message: 'Grupo não encontrado.' });
      if (room[0].criador_id !== userId) return res.status(403).json({ message: 'Apenas o dono pode excluir.' });

      await db.query('DELETE FROM chat_rooms WHERE id = ?', [roomId]);
      res.json({ message: 'Grupo excluído.' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao excluir.' });
    }
  },

  // 4. Contar Não Lidas (CORRIGIDO: Volta a usar JSON_CONTAINS)
  getUnreadCount: async (req, res) => {
    try {
      const userId = req.user.id;
      const [rows] = await db.query(`
        SELECT COUNT(*) as total FROM chat_messages m
        JOIN chat_participants cp ON cp.chat_room_id = m.chat_room_id
        WHERE cp.usuario_id = ? AND m.usuario_id != ?
        AND (m.lida_por IS NULL OR NOT JSON_CONTAINS(m.lida_por, CAST(? AS CHAR), '$'))
      `, [userId, userId, userId]);
      res.json({ total: rows[0].total });
    } catch (error) { res.status(500).json({ total: 0 }); }
  },

  // 5. Marcar como Lida (CORRIGIDO: Volta a usar JSON_CONTAINS)
  markAsRead: async (req, res) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;
      const [msgs] = await db.query(`
        SELECT id, lida_por FROM chat_messages 
        WHERE chat_room_id = ? AND usuario_id != ? 
        AND (lida_por IS NULL OR NOT JSON_CONTAINS(lida_por, CAST(? AS CHAR), '$'))
      `, [roomId, userId, userId]);

      for (const msg of msgs) {
        let lidos = msg.lida_por ? JSON.parse(msg.lida_por) : [];
        if (!lidos.includes(parseInt(userId))) {
          lidos.push(parseInt(userId));
          await db.query('UPDATE chat_messages SET lida_por = ? WHERE id = ?', [JSON.stringify(lidos), msg.id]);
        }
      }
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Erro ao ler' }); }
  },

  // 6. Histórico de Mensagens (MANTIDO O FIX MANUAL PARA EVITAR JSON_ARRAYAGG)
  getMessages: async (req, res) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;

      const [participante] = await db.query('SELECT 1 FROM chat_participants WHERE chat_room_id = ? AND usuario_id = ?', [roomId, userId]);
      if (participante.length === 0) return res.status(403).json({ message: 'Acesso negado.' });

      // Passo A: Busca as mensagens
      const [messages] = await db.query(`
        SELECT 
          m.*, 
          u.nome as sender_name, 
          u.foto as sender_foto,
          parent.mensagem_texto as reply_text,
          parent.tipo_arquivo as reply_type,
          parent_u.nome as reply_sender
        FROM chat_messages m
        JOIN usuarios u ON m.usuario_id = u.id
        LEFT JOIN chat_messages parent ON m.reply_to_id = parent.id
        LEFT JOIN usuarios parent_u ON parent.usuario_id = parent_u.id
        WHERE m.chat_room_id = ?
        ORDER BY m.data_envio ASC
      `, [roomId]);

      // Passo B: Busca as reações e agrupa via JS
      if (messages.length > 0) {
        const messageIds = messages.map(m => m.id);
        const [reactionsRows] = await db.query(`
          SELECT cr.message_id, cr.emoji, cr.usuario_id, ru.nome as user_nome
          FROM chat_reactions cr
          JOIN usuarios ru ON cr.usuario_id = ru.id
          WHERE cr.message_id IN (?)
        `, [messageIds]);

        const reactionsMap = {};
        reactionsRows.forEach(r => {
          if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
          reactionsMap[r.message_id].push({ emoji: r.emoji, usuario_id: r.usuario_id, user_nome: r.user_nome });
        });

        for (let msg of messages) {
          msg.reacoes = reactionsMap[msg.id] || [];
        }
      }

      // Passo C: Descriptografa
      const decryptedMessages = messages.map(msg => ({
        ...msg,
        reacoes: msg.reacoes || [],
        mensagem_texto: cryptoService.decrypt(msg.mensagem_texto),
        reply_text: msg.reply_text ? cryptoService.decrypt(msg.reply_text) : null
      }));

      res.json(decryptedMessages);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao buscar mensagens.' });
    }
  },

  // 7. Enviar Mensagem
  sendMessage: async (req, res) => {
    try {
      const { roomId } = req.params;
      const { texto, replyToId } = req.body;
      const userId = req.user.id;

      const textoCriptografado = cryptoService.encrypt(texto);

      const [result] = await db.execute(
        'INSERT INTO chat_messages (chat_room_id, usuario_id, mensagem_texto, lida_por, reply_to_id) VALUES (?, ?, ?, ?, ?)',
        [roomId, userId, textoCriptografado, JSON.stringify([userId]), replyToId || null]
      );

      const [newMsgRows] = await db.query(`
        SELECT m.*, u.nome as sender_name, u.foto as sender_foto,
               parent.mensagem_texto as reply_text, parent.tipo_arquivo as reply_type, parent_u.nome as reply_sender
        FROM chat_messages m
        JOIN usuarios u ON m.usuario_id = u.id
        LEFT JOIN chat_messages parent ON m.reply_to_id = parent.id
        LEFT JOIN usuarios parent_u ON parent.usuario_id = parent_u.id
        WHERE m.id = ?
      `, [result.insertId]);
      
      const newMsg = newMsgRows[0];
      
      const messageData = {
        ...newMsg,
        mensagem_texto: texto,
        reply_text: newMsg.reply_text ? cryptoService.decrypt(newMsg.reply_text) : null,
        reacoes: []
      };

      if (req.io) req.io.emit('receive_message', messageData);
      res.json(messageData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao enviar.' });
    }
  },

  // 8. Upload Anexo
  uploadAttachment: async (req, res) => {
    try {
      const { roomId } = req.params;
      const userId = req.user.id;
      const file = req.file;
      const texto = req.body.texto || ''; 

      if (!file) return res.status(400).json({ message: 'Nenhum arquivo enviado.' });

      let tipoArquivo = 'arquivo';
      if (file.mimetype.startsWith('image/')) tipoArquivo = 'imagem';
      else if (file.mimetype.startsWith('audio/')) tipoArquivo = 'audio';
      else if (file.mimetype.startsWith('video/')) tipoArquivo = 'video';

      const caminhoArquivo = file.path.replace(/\\/g, '/');
      const textoCriptografado = texto ? cryptoService.encrypt(texto) : null;

      const [result] = await db.execute(
        'INSERT INTO chat_messages (chat_room_id, usuario_id, mensagem_texto, arquivo_url, tipo_arquivo, lida_por) VALUES (?, ?, ?, ?, ?, ?)',
        [roomId, userId, textoCriptografado, caminhoArquivo, tipoArquivo, JSON.stringify([userId])]
      );

      const [userRows] = await db.query('SELECT nome, foto FROM usuarios WHERE id = ?', [userId]);
      const sender = userRows[0];

      const messageData = {
        id: result.insertId,
        chat_room_id: parseInt(roomId),
        usuario_id: userId,
        mensagem_texto: texto,
        arquivo_url: caminhoArquivo,
        tipo_arquivo: tipoArquivo,
        data_envio: new Date().toISOString(),
        sender_name: sender.nome,
        sender_foto: sender.foto,
        reacoes: []
      };

      if (req.io) req.io.emit('receive_message', messageData);
      res.json(messageData);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao enviar anexo.' });
    }
  },

  // 9. Alternar Reação
  toggleReaction: async (req, res) => {
    try {
      const { messageId } = req.params;
      const { emoji } = req.body;
      const userId = req.user.id;

      const [existing] = await db.query('SELECT id FROM chat_reactions WHERE message_id = ? AND usuario_id = ?', [messageId, userId]);

      if (existing.length > 0) {
        await db.query('DELETE FROM chat_reactions WHERE id = ?', [existing[0].id]);
      } else {
        await db.query('INSERT INTO chat_reactions (message_id, usuario_id, emoji) VALUES (?, ?, ?)', [messageId, userId, emoji]);
      }

      const [msgInfo] = await db.query('SELECT chat_room_id FROM chat_messages WHERE id = ?', [messageId]);
      if (req.io && msgInfo.length > 0) {
        const [reactions] = await db.query(`SELECT cr.emoji, cr.usuario_id, u.nome as user_nome FROM chat_reactions cr JOIN usuarios u ON cr.usuario_id = u.id WHERE cr.message_id = ?`, [messageId]);
        req.io.emit('message_reaction_update', { message_id: parseInt(messageId), chat_room_id: msgInfo[0].chat_room_id, reacoes: reactions });
      }
      res.json({ success: true });
    } catch (error) { console.error(error); res.status(500).json({ message: 'Erro na reação.' }); }
  },

  // Funções Auxiliares de Grupo (createRoom, getGroupDetails, etc.) permanecem iguais ao que você já tem
  createRoom: async (req, res) => {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const { tipo, nome, participantesIds, visibilidade, descricao } = req.body; 
      const criadorId = req.user.id;

      if (tipo === 'privado' && participantesIds.length === 1) {
        const targetId = participantesIds[0];
        const [existing] = await connection.query(`SELECT r.id FROM chat_rooms r JOIN chat_participants p1 ON p1.chat_room_id = r.id AND p1.usuario_id = ? JOIN chat_participants p2 ON p2.chat_room_id = r.id AND p2.usuario_id = ? WHERE r.tipo = 'privado'`, [criadorId, targetId]);
        if (existing.length > 0) { await connection.rollback(); return res.json({ id: existing[0].id, existing: true }); }
      }

      const [roomResult] = await connection.query('INSERT INTO chat_rooms (tipo, nome, criador_id, visibilidade, descricao) VALUES (?, ?, ?, ?, ?)', [tipo, nome, criadorId, visibilidade || 'privado', descricao || '']);
      const roomId = roomResult.insertId;

      await connection.query('INSERT INTO chat_participants (chat_room_id, usuario_id, is_admin) VALUES (?, ?, ?)', [roomId, criadorId, true]);
      for (const uid of participantesIds) { await connection.query('INSERT INTO chat_participants (chat_room_id, usuario_id, is_admin) VALUES (?, ?, ?)', [roomId, uid, false]); }

      await connection.commit();
      res.json({ id: roomId, nome, tipo, new: true });
    } catch (error) { await connection.rollback(); res.status(500).json({ message: 'Erro ao criar sala.' }); } finally { connection.release(); }
  },

  // --- NOVA: Excluir Mensagem ---
  deleteMessage: async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.user.id;

      // 1. Verifica se a mensagem existe e é do usuário
      const [msg] = await db.query('SELECT chat_room_id FROM chat_messages WHERE id = ? AND usuario_id = ?', [messageId, userId]);
      
      if (msg.length === 0) {
        return res.status(403).json({ message: 'Não permitido ou mensagem não encontrada.' });
      }

      // 2. Deleta
      await db.query('DELETE FROM chat_messages WHERE id = ?', [messageId]);

      // 3. Emite socket para todos removerem da tela
      if (req.io) {
        req.io.emit('message_deleted', { 
          messageId: parseInt(messageId), 
          chatRoomId: msg[0].chat_room_id 
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao excluir.' });
    }
  },

  // --- NOVA: Editar Mensagem ---
  editMessage: async (req, res) => {
    try {
      const { messageId } = req.params;
      const { novoTexto } = req.body;
      const userId = req.user.id;

      // 1. Verifica autoria
      const [msg] = await db.query('SELECT chat_room_id, tipo_arquivo FROM chat_messages WHERE id = ? AND usuario_id = ?', [messageId, userId]);
      
      if (msg.length === 0) return res.status(403).json({ message: 'Erro ao editar.' });
      
      // (Opcional) Bloquear edição de arquivos, permitir apenas texto
      // if (msg[0].tipo_arquivo !== 'texto' && msg[0].tipo_arquivo !== null) ...

      const textoCriptografado = cryptoService.encrypt(novoTexto);

      // 2. Atualiza e marca como editado
      await db.query(
        'UPDATE chat_messages SET mensagem_texto = ?, editado = TRUE WHERE id = ?',
        [textoCriptografado, messageId]
      );

      // 3. Emite socket com o novo texto
      if (req.io) {
        req.io.emit('message_edited', { 
          id: parseInt(messageId), 
          chat_room_id: msg[0].chat_room_id,
          mensagem_texto: novoTexto,
          editado: true
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Erro ao editar.' });
    }
  },

  getGroupDetails: async (req, res) => { try { const { roomId } = req.params; const [room] = await db.query('SELECT * FROM chat_rooms WHERE id = ?', [roomId]); if (room.length === 0) return res.status(404).json({ message: 'Sala não encontrada' }); const [participants] = await db.query(`SELECT cp.*, u.nome, u.email, u.foto FROM chat_participants cp JOIN usuarios u ON cp.usuario_id = u.id WHERE cp.chat_room_id = ?`, [roomId]); res.json({ ...room[0], participantes: participants }); } catch (error) { res.status(500).json({ message: 'Erro ao buscar detalhes.' }); } },
  addParticipant: async (req, res) => { try { const { roomId } = req.params; const { userId } = req.body; const [exists] = await db.query('SELECT id FROM chat_participants WHERE chat_room_id = ? AND usuario_id = ?', [roomId, userId]); if (exists.length > 0) return res.status(400).json({ message: 'Já participa.' }); await db.query('INSERT INTO chat_participants (chat_room_id, usuario_id) VALUES (?, ?)', [roomId, userId]); res.json({ success: true }); } catch (error) { res.status(500).json({ message: 'Erro ao adicionar.' }); } },
  removeParticipant: async (req, res) => { try { const { roomId, userId } = req.params; await db.query('DELETE FROM chat_participants WHERE chat_room_id = ? AND usuario_id = ?', [roomId, userId]); res.json({ success: true }); } catch (error) { res.status(500).json({ message: 'Erro ao remover.' }); } },
  uploadGroupPhoto: async (req, res) => { try { const { roomId } = req.params; if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo.' }); const caminhoFoto = req.file.path.replace(/\\/g, '/'); await db.query('UPDATE chat_rooms SET foto = ? WHERE id = ?', [caminhoFoto, roomId]); res.json({ foto: caminhoFoto }); } catch (error) { res.status(500).json({ message: 'Erro no upload.' }); } }
};

module.exports = chatController;