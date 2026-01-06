// backend/src/services/notificacaoService.js
const db = require('../config/database');
let ioInstance;

const notificacaoService = {
  setSocket: (io) => { 
    ioInstance = io; 
    console.log('✅ [Service] Socket configurado com sucesso.');
  },

  criar: async ({ usuario_id, titulo, mensagem, link, tipo = 'info' }) => {
    console.log('🔔 [Service] Criando notificação para User:', usuario_id);
    
    try {
      // VALIDAÇÃO DEFENSIVA: Converte undefined para null ou valores padrão
      if (!usuario_id) {
        console.error("⚠️ [Service] Tentativa de criar notificação sem usuario_id.");
        return;
      }

      const params = [
        usuario_id,
        titulo || 'Nova Notificação',
        mensagem || '',
        link || null, // Se link for undefined, envia null para o SQL
        tipo || 'info'
      ];

      const connection = await db.getConnection();
      
      const [result] = await connection.execute(
        'INSERT INTO notificacoes (usuario_id, titulo, mensagem, link, tipo, lida) VALUES (?, ?, ?, ?, ?, 0)',
        params
      );
      
      const novaNotificacao = {
        id: result.insertId,
        usuario_id,
        titulo,
        mensagem,
        link,
        lida: 0,
        tipo,
        data_criacao: new Date()
      };

      connection.release();

      if (ioInstance) {
        ioInstance.to(`user_${usuario_id}`).emit('nova_notificacao', novaNotificacao);
        
        if (link && link.includes('/comunicacao/')) {
           ioInstance.to(`user_${usuario_id}`).emit('nova_resposta', { ...novaNotificacao, comunicacaoId: link.split('/').pop() });
        }
      }

      return novaNotificacao;
    } catch (error) {
      console.error("❌ [Service] Erro fatal ao criar notificação:", error.message);
    }
  }
};

module.exports = notificacaoService;