// src/routes/anexoRoutes.js
const express = require('express');
const router = express.Router();
const anexoController = require('../controllers/anexoController');
const { protegerRota } = require('../middleware/authMiddleware');

// Aplica o middleware de autenticação a todas as rotas de anexo.
// Só usuários logados poderão tentar baixar arquivos.
router.get('/:id', protegerRota, anexoController.download);

module.exports = router;