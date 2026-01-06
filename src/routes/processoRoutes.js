// src/routes/processoRoutes.js
const express = require('express');
const router = express.Router();
const processoController = require('../controllers/processoController');
const { protegerRota } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// Configuração básica do Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

router.use(protegerRota);

router.post('/', processoController.criar);

// Rotas
router.put('/:id', processoController.update);
router.get('/:id', processoController.getDetalhes);
router.post('/:id/vincular', processoController.vincularDebitos);
router.post('/:id/historico', processoController.adicionarHistorico);
router.post('/:id/arquivo', upload.single('arquivo'), processoController.uploadArquivo);

module.exports = router;