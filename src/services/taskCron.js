// backend/src/services/taskCron.js
const cron = require('node-cron');
const db = require('../config/database');

// Função auxiliar de notificação
async function notificarUsuario(io, usuarioId, titulo, mensagem, link) {
    try {
        if (!usuarioId) return;
        
        // Insere no banco
        const [res] = await db.query(
            'INSERT INTO notificacoes (usuario_id, titulo, mensagem, link, lida, tipo) VALUES (?, ?, ?, ?, 0, ?)',
            [usuarioId, titulo, mensagem, link, 'alert'] 
        );

        // Envia via Socket
        if (io) {
            const novaNotif = {
                id: res.insertId,
                usuario_id: usuarioId,
                titulo,
                mensagem,
                link,
                lida: 0,
                tipo: 'alert',
                data_criacao: new Date()
            };
            // Envia para a sala privada do usuário
            io.to(`user_${usuarioId}`).emit('nova_notificacao', novaNotif); 
        }
    } catch (e) {
        console.error("Erro ao enviar notificação cron:", e.message);
    }
}

const initCron = (io) => {
    console.log("⏰ Serviço de Cron de Tarefas Iniciado.");

    // Roda a cada minuto para garantir precisão nos testes e na operação
    cron.schedule('* * * * *', async () => {
        // console.log(`[cron] Verificando tarefas...`); 
        
        const conn = await db.getConnection();
        try {
            
            // =================================================================
            // 1. ALERTA DE 24 HORAS (Apenas para o Responsável)
            // =================================================================
            // Regra: Não está concluída, não está na coluna 7, tem prazo definido
            const [tarefas24h] = await conn.query(`
                SELECT t.id, t.titulo, t.responsavel_id
                FROM tarefas t
                WHERE t.status_tempo != 'concluido'
                AND t.coluna_id != 7 
                AND t.prazo IS NOT NULL
                AND t.prazo BETWEEN DATE_ADD(NOW(), INTERVAL 24 HOUR) AND DATE_ADD(NOW(), INTERVAL 25 HOUR)
            `);

            for (let t of tarefas24h) {
                // Aqui não precisa de Set pois é apenas para o responsável
                await notificarUsuario(
                    io, 
                    t.responsavel_id, 
                    'Prazo Próximo', 
                    `A tarefa "${t.titulo}" vence em 24 horas.`, 
                    '/tarefas'
                );
            }

            // =================================================================
            // 2. PROCESSAR ATRASOS (Move para Coluna 2 e Notifica Todos)
            // =================================================================
            // Regra: Prazo venceu (comparando com fuso Brasil -3h), não concluída, não está em Vencido/Concluído
            const [tarefasAtrasadas] = await conn.query(`
                SELECT t.id, t.titulo, t.criador_id, t.responsavel_id
                FROM tarefas t
                WHERE t.prazo < DATE_SUB(NOW(), INTERVAL 3 HOUR)
                AND t.status_tempo != 'concluido'
                AND t.coluna_id NOT IN (2, 7)
            `);

            for (let t of tarefasAtrasadas) {
                // 2.1 Move para Coluna Vencido (ID 2)
                await conn.query('UPDATE tarefas SET coluna_id = 2 WHERE id = ?', [t.id]);
                
                // 2.2 Registra Histórico
                await conn.query('INSERT INTO tarefas_historico (tarefa_id, usuario_id, acao, descricao) VALUES (?, ?, ?, ?)', 
                    [t.id, t.criador_id, 'sistema', 'Tarefa marcada como Vencida automaticamente']);

                // 2.3 Coleta Destinatários Únicos (Evita Duplicatas)
                const destinatarios = new Set();

                // Adiciona Criador
                if (t.criador_id) destinatarios.add(t.criador_id);
                
                // Adiciona Responsável
                if (t.responsavel_id) destinatarios.add(t.responsavel_id);

                // Adiciona Observadores
                const [observadores] = await conn.query('SELECT usuario_id FROM tarefas_usuarios WHERE tarefa_id = ? AND tipo = "observador"', [t.id]);
                observadores.forEach(obs => destinatarios.add(obs.usuario_id));

                // 2.4 Dispara notificações para a lista única
                for (let userId of destinatarios) {
                    await notificarUsuario(
                        io, 
                        userId, 
                        'Tarefa Atrasada', 
                        `A tarefa "${t.titulo}" expirou.`, 
                        '/tarefas'
                    );
                }

                // 2.5 Emite atualização para o Kanban (Tempo Real)
                const [tAtualizada] = await conn.query(`
                    SELECT t.*, 
                           u_resp.nome as resp_nome, u_resp.foto as resp_foto,
                           u_cria.nome as cria_nome, u_cria.foto as cria_foto
                    FROM tarefas t
                    LEFT JOIN usuarios u_resp ON t.responsavel_id = u_resp.id
                    LEFT JOIN usuarios u_cria ON t.criador_id = u_cria.id
                    WHERE t.id = ?`, [t.id]);
                
                if (tAtualizada[0] && io) {
                    io.emit('atualizacao_tarefa', tAtualizada[0]);
                }
            }

        } catch (e) {
            console.error("Erro no Cron de Tarefas:", e);
        } finally {
            conn.release();
        }
    });
};

module.exports = { initCron };