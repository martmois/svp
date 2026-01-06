// src/routes/relatorioRoutes.js
const express = require('express');
const router = express.Router();
const relatorioController = require('../controllers/relatorioController');
const { protegerRota } = require('../middleware/authMiddleware');

router.get('/extrato-debitos/:unidadeId', protegerRota, relatorioController.gerarExtratoDebitos);

router.get('/historico/:unidadeId', protegerRota, relatorioController.gerarRelatorioHistorico);
router.get('/crm-completo/:unidadeId', protegerRota, relatorioController.gerarRelatorioCRMCompleto);

module.exports = router;