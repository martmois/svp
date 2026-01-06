// src/routes/comunicacaoRoutes.js
const express = require('express');
const router = express.Router();
const comunicacaoController = require('../controllers/comunicacaoController');
const { protegerRota } = require('../middleware/authMiddleware');
const upload = require('../config/upload'); 

router.use(protegerRota);

router.get('/', comunicacaoController.getAll);
router.get('/count-respondidas', comunicacaoController.countRespondidas); // Rota do Badge
router.patch('/:id/ler', comunicacaoController.marcarComoLida); // Rota de Marcar como Lida
router.get('/:id', comunicacaoController.getById);
router.post('/:id/responder', upload.array('anexos', 5), comunicacaoController.responder);

router.post('/autorizacao', comunicacaoController.solicitarAutorizacao);

module.exports = router;