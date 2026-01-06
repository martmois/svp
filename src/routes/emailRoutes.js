// backend/src/routes/emailRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const emailController = require("../controllers/emailController");
const webhookController = require('../controllers/webhookController');
const { protegerRota, autorizar } = require('../middleware/authMiddleware');

// --- 1. CONFIGURAÇÃO MULTER (Para Anexos) ---
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
    fieldSize: 50 * 1024 * 1024 // Importante para HTML grande
  }
});

// Wrapper para evitar crash no upload
const uploadMiddleware = (req, res, next) => {
  const uploader = upload.any();
  uploader(req, res, function (err) {
    if (err) {
      console.error('❌ Erro Multer:', err.message);
      // Continua mesmo com erro, para tentar ler o body via urlencoded se falhar o multipart
      return next(); 
    }
    next();
  });
};

// --- 2. CONFIGURAÇÃO URLENCODED (Para Texto Simples) ---
// Necessário porque removemos o global do server.js para esta rota
const urlEncodedMiddleware = express.urlencoded({ extended: true, limit: '50mb' });

// --- 3. MIDDLEWARE HÍBRIDO (O SEGREDO) ---
// Executa um, depois o outro. Garante que req.body seja preenchido sempre.
const processadoresDeEntrada = [uploadMiddleware, urlEncodedMiddleware];

// LOG
router.use((req, res, next) => {
  if (req.originalUrl.includes('webhook')) {
    console.log(`📡 [Webhook Request] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// ==============================================================================
//  ROTAS WEBHOOK (Mailgun)
// ==============================================================================
// Aceita tanto Multipart (Anexo) quanto UrlEncoded (Sem anexo)
router.post('/webhook/mailgun', processadoresDeEntrada, webhookController.handleInbound);
router.post('/webhook/inbound', processadoresDeEntrada, webhookController.handleInbound);
router.post('/webhook/reply', processadoresDeEntrada, webhookController.handleInbound); // Adicionando a rota sugerida no guia

// Eventos (JSON)
router.post('/webhook/events', express.json(), webhookController.handleEvents);

// ==============================================================================
//  ROTAS SISTEMA
// ==============================================================================
router.use(protegerRota); 
router.get('/templates', emailController.listarTemplates);
router.get('/preview/template/:templateId/unidade/:unidadeId', emailController.previewEmail);
router.post('/enviar', autorizar('colaborador', 'ceo', 'supervisor'), emailController.enviarEmailCobranca);

module.exports = router;