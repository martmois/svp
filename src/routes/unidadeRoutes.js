// src/routes/unidadeRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const unidadeController = require('../controllers/unidadeController');
const { protegerRota, autorizar } = require('../middleware/authMiddleware');

// Configuração do Multer para receber o arquivo em memória
const upload = multer({ storage: multer.memoryStorage() });

router.use(protegerRota);

// Rota para importação. Recebe o 'file' do formulário.
router.post(
  '/import/:condominioId', 
  autorizar('ceo', 'supervisor'), 
  upload.single('file'), // Middleware do multer
  unidadeController.importFromCSV
);

router.get('/por-condominio/:condominioId', unidadeController.getByCondominioId);
router.get('/:id', unidadeController.getById);
router.put('/:id', autorizar('ceo', 'supervisor'), unidadeController.update);
router.get('/:unidadeId/telefones', protegerRota, unidadeController.getTelefonesByUnidadeId);

module.exports = router;