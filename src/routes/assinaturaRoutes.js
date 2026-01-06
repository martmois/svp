// src/routes/assinaturaRoutes.js
const express = require('express');
const router = express.Router();
const assinaturaController = require('../controllers/assinaturaController');

// Importa o middleware atualizado
const { protegerRota } = require('../middleware/authMiddleware');

// Todas as rotas de assinatura exigem login
router.use(protegerRota);

router.get('/', assinaturaController.getAll);
router.post('/', assinaturaController.create);
router.put('/:id', assinaturaController.update);
router.delete('/:id', assinaturaController.delete);
router.post('/definir-padrao', assinaturaController.setDefault);

module.exports = router;