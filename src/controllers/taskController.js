// backend/src/controllers/taskController.js
const db = require('../config/database');
const path = require('path');

// Função Auxiliar para criar notificação
async function criarNotificacao(req, usuarioId, titulo, mensagem, link) {
  try {
    // Insere no banco
    const [res] = await db.query(
      'INSERT INTO notificacoes (usuario_id, titulo, mensagem, link, lida, tipo) VALUES (?, ?, ?, ?, 0, ?)',
      [usuarioId, titulo, mensagem, link, 'info']
    );
    
    if (req.io) {
      const novaNotif = {
        id: res.insertId,
        usuario_id: usuarioId,
        titulo,
        mensagem,
        link,
        lida: 0,
        tipo: 'info',
        data_criacao: new Date()
      };
      
      // Envia para a sala privada do usuário
      req.io.to(`user_${usuarioId}`).emit('nova_notificacao', novaNotif);
    }
  } catch (e) {
    console.error("Erro ao criar notificação:", e.message);
  }
}

const taskController = {

  // --- LISTAGEM COMPLETA ---
  listarTarefas: async (req, res) => {
    try {
      const { id: userId, perfil } = req.user;
      
      const [colunas] = await db.query('SELECT * FROM tarefas_colunas ORDER BY ordem ASC');

      let sql = `
        SELECT DISTINCT t.*, 
               u_resp.nome as resp_nome, u_resp.foto as resp_foto,
               u_cria.nome as cria_nome, u_cria.foto as cria_foto
        FROM tarefas t
        LEFT JOIN usuarios u_resp ON t.responsavel_id = u_resp.id
        LEFT JOIN usuarios u_cria ON t.criador_id = u_cria.id
        LEFT JOIN tarefas_usuarios tu ON t.id = tu.tarefa_id
      `;
      
      const params = [];
      if (perfil !== 'ceo') {
         sql += ` WHERE (t.responsavel_id = ? OR t.criador_id = ? OR tu.usuario_id = ?)`;
         params.push(userId, userId, userId);
      }
      
      const [tarefas] = await db.query(sql + ` ORDER BY t.prazo ASC`, params);

      for (let t of tarefas) {
          const [checks] = await db.query('SELECT * FROM tarefas_checklist WHERE tarefa_id = ? ORDER BY id ASC', [t.id]);
          t.checklist = checks.map(c => ({
              id: c.id,
              text: c.texto, 
              done: c.concluido === 1
          }));

          const [anexos] = await db.query('SELECT * FROM tarefas_anexos WHERE tarefa_id = ?', [t.id]);
          t.anexos = anexos;

          const [historico] = await db.query(`
            SELECT h.*, u.nome as usuario_nome 
            FROM tarefas_historico h 
            JOIN usuarios u ON h.usuario_id = u.id 
            WHERE h.tarefa_id = ? 
            ORDER BY h.data_registro DESC`, [t.id]);
          t.historico = historico;

          const [comentarios] = await db.query(`
            SELECT c.*, u.nome as usuario_nome, u.foto as usuario_foto
            FROM tarefas_comentarios c
            JOIN usuarios u ON c.usuario_id = u.id
            WHERE c.tarefa_id = ?
            ORDER BY c.data_envio DESC`, [t.id]);
          t.comentarios = comentarios;
          
          const [obs] = await db.query(`
             SELECT u.id, u.nome, u.foto 
             FROM tarefas_usuarios tu
             JOIN usuarios u ON tu.usuario_id = u.id
             WHERE tu.tarefa_id = ? AND tu.tipo = 'observador'
          `, [t.id]);
          t.observadores = obs;
      }

      res.json({ colunas, tarefas });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao listar tarefas' });
    }
  },

  // --- CRIAÇÃO ---
  criarTarefa: async (req, res) => {
    const { titulo, descricao, responsavel_id, prazo, checklist, observadores } = req.body;
    const criador_id = req.user.id;

    if (!titulo) return res.status(400).json({ error: 'Título obrigatório.' });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      let coluna_id = 1; 
      if (prazo) {
         const d = new Date(prazo);
         const hoje = new Date();
         const dDate = new Date(d.toDateString());
         const hojeDate = new Date(hoje.toDateString());
         if (dDate < hojeDate) coluna_id = 2;
         else if (dDate.getTime() === hojeDate.getTime()) coluna_id = 3;
         else coluna_id = 4;
      }

      const [result] = await conn.query('INSERT INTO tarefas SET ?', {
        titulo, descricao, responsavel_id, criador_id, prazo, coluna_id, status_tempo: 'parado'
      });
      const tarefaId = result.insertId;

      // Vínculos
      if (responsavel_id) {
         await conn.query('INSERT INTO tarefas_usuarios (tarefa_id, usuario_id, tipo) VALUES (?, ?, ?)', [tarefaId, responsavel_id, 'participante']);
         
         // CORREÇÃO: Comparação de strings para evitar que o criador receba notificação se ele mesmo for o responsável
         if (String(responsavel_id) !== String(criador_id)) {
             await criarNotificacao(req, responsavel_id, 'Nova Tarefa Atribuída', `Você é responsável por: ${titulo}`, '/tarefas');
         }
      }
      
      if (observadores && Array.isArray(observadores)) {
         for (let obsId of observadores) {
            // Evita adicionar responsável ou criador como observador duplicado no banco
            if (String(obsId) !== String(responsavel_id) && String(obsId) !== String(criador_id)) {
                await conn.query('INSERT INTO tarefas_usuarios (tarefa_id, usuario_id, tipo) VALUES (?, ?, ?)', [tarefaId, obsId, 'observador']);
                // NOTIFICAÇÃO OBSERVADOR
                await criarNotificacao(req, obsId, 'Nova Tarefa', `Você foi adicionado como observador em: ${titulo}`, `/tarefas`);
            }
         }
      }

      if (checklist && Array.isArray(checklist)) {
        for (let item of checklist) {
           await conn.query('INSERT INTO tarefas_checklist (tarefa_id, texto, concluido) VALUES (?, ?, ?)', 
             [tarefaId, item.text, item.done ? 1 : 0]);
        }
      }

      await conn.query('INSERT INTO tarefas_historico (tarefa_id, usuario_id, acao, descricao) VALUES (?, ?, ?, ?)', 
        [tarefaId, criador_id, 'criou', 'Criou a tarefa']);

      await conn.commit();
      
      const novaTarefa = { id: tarefaId, ...req.body, coluna_id, criador_id, status_tempo: 'parado' };
      req.io.emit('nova_tarefa', novaTarefa);
      res.status(201).json(novaTarefa);

    } catch (e) {
      await conn.rollback();
      res.status(500).json({ error: e.message });
    } finally {
      conn.release();
    }
  },

  // --- ATUALIZAÇÃO ---
  atualizarTarefa: async (req, res) => {
    const { id } = req.params;
    const dados = req.body;
    const usuarioId = req.user.id;

    try {
      const [atuais] = await db.query('SELECT * FROM tarefas WHERE id = ?', [id]);
      if (atuais.length === 0) return res.status(404).json({ error: 'Tarefa não encontrada' });
      const tarefaAtual = atuais[0];
      const isCreator = tarefaAtual.criador_id === usuarioId;

      if ((dados.titulo || dados.descricao || dados.prazo) && !isCreator) {
          return res.status(403).json({ error: 'Apenas o criador pode alterar dados principais.' });
      }

      if (dados.coluna_id && dados.coluna_id !== tarefaAtual.coluna_id) {
          if ([2, 7].includes(dados.coluna_id) && !dados.status_tempo) { 
             return res.status(400).json({ error: 'Movimento manual não permitido para esta coluna.' });
          }
          if (dados.coluna_id === 1) dados.prazo = null;
          if (dados.coluna_id === 3) { const d = new Date(); d.setHours(18,0,0,0); dados.prazo = d; }
          if (dados.coluna_id === 4) { const d = new Date(); d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7); d.setHours(18,0,0,0); dados.prazo = d; }
          if (dados.coluna_id === 5) { const d = new Date(); d.setDate(d.getDate() + (8 - d.getDay())); d.setHours(18,0,0,0); dados.prazo = d; }
      }

      if (dados.status_tempo) {
          if (dados.status_tempo === 'concluido') {
              dados.coluna_id = 7; 
          }
      }

      const updatePayload = { ...dados };
      delete updatePayload.checklist; delete updatePayload.anexos; delete updatePayload.historico; 
      delete updatePayload.responsavel; delete updatePayload.observadores; delete updatePayload.comentarios;

      if (Object.keys(updatePayload).length > 0) {
          await db.query('UPDATE tarefas SET ? WHERE id = ?', [updatePayload, id]);
      }

      let desc = 'Atualizou a tarefa';
      let notifMsg = `A tarefa "${tarefaAtual.titulo}" foi atualizada.`;
      
      if (dados.status_tempo === 'em_andamento' && tarefaAtual.status_tempo === 'parado') {
          desc = 'Iniciou a tarefa';
          notifMsg = `A tarefa "${tarefaAtual.titulo}" foi iniciada.`;
      }
      if (dados.status_tempo === 'parado' && tarefaAtual.status_tempo === 'em_andamento') {
          desc = 'Pausou a tarefa';
          notifMsg = `A tarefa "${tarefaAtual.titulo}" foi pausada.`;
      }
      if (dados.coluna_id === 7) {
          desc = 'Concluiu a tarefa';
          notifMsg = `A tarefa "${tarefaAtual.titulo}" foi concluída!`;
      }

      await db.query('INSERT INTO tarefas_historico (tarefa_id, usuario_id, acao, descricao) VALUES (?, ?, ?, ?)', 
        [id, usuarioId, 'editou', desc]);

      // --- DISPARO DE NOTIFICAÇÕES (MUDANÇA DE STATUS) ---
      if (dados.status_tempo || dados.coluna_id === 7) {
          // Busca observadores
          const [observadores] = await db.query('SELECT usuario_id FROM tarefas_usuarios WHERE tarefa_id = ? AND tipo = "observador"', [id]);
          
          // Usando Set para evitar duplicatas (mesmo usuário sendo responsável e criador)
          const destinatarios = new Set();

          // Adiciona Criador (se não for quem disparou a ação)
          if (String(tarefaAtual.criador_id) !== String(usuarioId)) {
              destinatarios.add(tarefaAtual.criador_id);
          }

          // Adiciona Responsável (se não for quem disparou a ação)
          if (tarefaAtual.responsavel_id && String(tarefaAtual.responsavel_id) !== String(usuarioId)) {
              destinatarios.add(tarefaAtual.responsavel_id);
          }

          // Adiciona Observadores (se não for quem disparou a ação)
          observadores.forEach(obs => {
              if (String(obs.usuario_id) !== String(usuarioId)) {
                  destinatarios.add(obs.usuario_id);
              }
          });

          // Envia notificações para a lista única
          for (let destId of destinatarios) {
              await criarNotificacao(req, destId, 'Atualização de Tarefa', notifMsg, '/tarefas');
          }
      }

      const [tNova] = await db.query('SELECT * FROM tarefas WHERE id = ?', [id]);
      req.io.emit('atualizacao_tarefa', tNova[0]);
      res.json(tNova[0]);

    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // --- CHECKLIST ---
  adicionarItemChecklist: async (req, res) => {
      const { id } = req.params;
      const { texto } = req.body;
      try {
          const [resIns] = await db.query('INSERT INTO tarefas_checklist (tarefa_id, texto, concluido) VALUES (?, ?, 0)', [id, texto]);
          res.json({ id: resIns.insertId, texto: texto, concluido: 0 }); 
      } catch (e) { res.status(500).json({ error: e.message }); }
  },

  removerItemChecklist: async (req, res) => {
      await db.query('DELETE FROM tarefas_checklist WHERE id = ?', [req.params.itemId]);
      res.json({ ok: true });
  },

  toggleChecklist: async (req, res) => {
      const { itemId } = req.params;
      const { concluido } = req.body; 
      await db.query('UPDATE tarefas_checklist SET concluido = ? WHERE id = ?', [concluido ? 1 : 0, itemId]);
      res.json({ ok: true });
  },

  // --- COMENTÁRIOS ---
  adicionarComentario: async (req, res) => {
      const { id } = req.params;
      const { texto } = req.body;
      const usuarioId = req.user.id;
      
      try {
          if (!texto) return res.status(400).json({ error: 'Texto obrigatório' });
          const [resIns] = await db.query('INSERT INTO tarefas_comentarios (tarefa_id, usuario_id, texto, tipo) VALUES (?, ?, ?, ?)', 
              [id, usuarioId, texto, 'texto']);
          
          const [comentario] = await db.query(`
              SELECT c.*, u.nome as usuario_nome, u.foto as usuario_foto
              FROM tarefas_comentarios c
              JOIN usuarios u ON c.usuario_id = u.id
              WHERE c.id = ?
          `, [resIns.insertId]);

          // --- NOTIFICAÇÕES DE COMENTÁRIO (SEM DUPLICATAS) ---
          const [tarefa] = await db.query('SELECT titulo, criador_id, responsavel_id FROM tarefas WHERE id = ?', [id]);
          if (tarefa.length > 0) {
              const t = tarefa[0];
              const msgNotif = `Novo comentário na tarefa "${t.titulo}"`;
              
              const [observadores] = await db.query('SELECT usuario_id FROM tarefas_usuarios WHERE tarefa_id = ? AND tipo = "observador"', [id]);
              
              const destinatarios = new Set();
              
              // Adiciona Criador e Responsável
              if (t.criador_id) destinatarios.add(t.criador_id);
              if (t.responsavel_id) destinatarios.add(t.responsavel_id);
              
              // Adiciona Observadores
              observadores.forEach(o => destinatarios.add(o.usuario_id));
              
              // Remove quem comentou (mesmo que seja criador/resp/obs)
              destinatarios.delete(usuarioId);

              for (let destId of destinatarios) {
                  await criarNotificacao(req, destId, 'Novo Comentário', msgNotif, '/tarefas');
              }
          }
          
          req.io.emit('novo_comentario', comentario[0]); // Emite objeto, não array
          res.json(comentario[0]);
      } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // --- UPLOAD ANEXO ---
  uploadAnexo: async (req, res) => {
      const { id } = req.params;
      try {
          if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Sem arquivos' });
          
          const uploads = [];
          for (let f of req.files) {
              const caminho = f.path.replace(/\\/g, '/');
              const [r] = await db.query('INSERT INTO tarefas_anexos (tarefa_id, nome_original, caminho, tipo) VALUES (?,?,?,?)', 
                [id, f.originalname, caminho, f.mimetype]);
              uploads.push({ id: r.insertId, nome_original: f.originalname, caminho, tipo: f.mimetype });
          }
          res.json(uploads);
      } catch (e) { 
          console.error(e);
          res.status(500).json({ error: e.message }); 
      }
  },

  excluirTarefa: async (req, res) => {
      const { id } = req.params;
      const usuarioId = req.user.id;
      const [t] = await db.query('SELECT criador_id FROM tarefas WHERE id = ?', [id]);
      if (t[0].criador_id !== usuarioId) return res.status(403).json({ error: 'Apenas o criador pode excluir.' });
      
      await db.query('DELETE FROM tarefas WHERE id = ?', [id]);
      req.io.emit('tarefa_excluida', id);
      res.json({ ok: true });
  }
};

module.exports = taskController;