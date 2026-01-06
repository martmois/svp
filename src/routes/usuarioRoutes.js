// src/routes/usuarioRoutes.js
const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuarioController');
const { protegerRota, autorizar } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// Configuração de Upload (Salva em public/uploads/)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    // Nome único: id_usuario-timestamp.extensão
    const ext = path.extname(file.originalname);
    cb(null, `avatar-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

router.use(protegerRota);

// --- NOVA ROTA DE FOTO ---
router.post('/me/foto', upload.single('foto'), usuarioController.uploadFoto);

// --- ADICIONE ESTA ROTA ---
// Retorna os dados do próprio usuário logado
router.get('/me', usuarioController.obterDadosLogado);
router.get('/', usuarioController.listar);
router.get('/:id', usuarioController.obterPorId);
router.post('/', autorizar('ceo', 'supervisor'), usuarioController.criar);
router.put('/:id', usuarioController.atualizar);
router.delete('/:id', autorizar('ceo', 'supervisor'), usuarioController.remover);

module.exports = router;