// src/routes/chatRoutes.js
const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { protegerRota } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// Configuração de Upload (Geral para Chat)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Garanta que essa pasta exista: public/uploads/chat
    // Se não quiser criar pasta separada, use apenas 'public/uploads/'
    cb(null, 'public/uploads/'); 
  },
  filename: (req, file, cb) => {
    // Nome único: chat-TIMESTAMP-NOMEORIGINAL
    const uniqueName = `chat-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB (opcional)
});

router.use(protegerRota);

// Rotas existentes...
router.get('/', chatController.getMyChats);
router.get('/unread-count', chatController.getUnreadCount);
router.post('/', chatController.createRoom);
router.put('/:roomId', chatController.updateGroup);
router.delete('/:roomId', chatController.deleteRoom);

router.get('/:roomId/messages', chatController.getMessages);
router.post('/:roomId/messages', chatController.sendMessage);
router.post('/message/:messageId/react', chatController.toggleReaction);
router.delete('/message/:messageId', chatController.deleteMessage); // <--- DELETAR
router.put('/message/:messageId', chatController.editMessage);
router.post('/:roomId/read', chatController.markAsRead);

// --- NOVA ROTA DE ANEXO (CHAT) ---
router.post('/:roomId/attachment', upload.single('file'), chatController.uploadAttachment); 

// Rotas de Grupo (Foto, Participantes...)
router.get('/:roomId/details', chatController.getGroupDetails);
router.post('/:roomId/participants', chatController.addParticipant);
router.delete('/:roomId/participants/:userId', chatController.removeParticipant);
router.post('/:roomId/photo', upload.single('foto'), chatController.uploadGroupPhoto);

module.exports = router;