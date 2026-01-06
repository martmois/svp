// src/routes/condominioRoutes.js
const express = require('express');
const router = express.Router();
const condominioController = require('../controllers/condominioController');
const { protegerRota, autorizar } = require('../middleware/authMiddleware');

// Rotas protegidas. Todas exigem que o usuário esteja logado.
router.use(protegerRota);

// Rotas de Leitura (Todos podem acessar, mas o Controller filtra os dados do Colaborador)
router.get('/', condominioController.getAll);
router.get('/:id', condominioController.getById);

// Rotas de Escrita (Apenas CEO e Supervisor podem criar/editar/excluir)
// Colaborador NÃO tem acesso a essas rotas
router.post('/', autorizar('ceo', 'supervisor'), condominioController.create);
router.put('/:id', autorizar('ceo', 'supervisor'), condominioController.update);
router.delete('/:id', autorizar('ceo', 'supervisor'), condominioController.delete);

module.exports = router;