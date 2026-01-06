// src/routes/whatsappRoutes.js
const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const { protegerRota } = require('../middleware/authMiddleware');

router.use(protegerRota);

router.get('/templates', whatsappController.listarTemplates);
router.get('/preview/template/:templateId/unidade/:unidadeId', whatsappController.previewMensagem);

module.exports = router;