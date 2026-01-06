// src/routes/crmRoutes.js
const express = require('express');
const router = express.Router();
const crmController = require('../controllers/crmController');
const { protegerRota } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// Configuração do Multer para salvar provas
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/'); // Certifique-se que essa pasta existe
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

router.use(protegerRota);

router.get('/unidade/:unidadeId', crmController.getDadosCRM);

// Rota POST com upload.single('prova')
router.post('/unidade/:unidadeId/interacao', upload.single('prova'), crmController.registrarInteracao);

module.exports = router;