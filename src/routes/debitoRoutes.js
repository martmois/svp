// src/routes/debitoRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const debitoController = require('../controllers/debitoController');
const { protegerRota, autorizar } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

router.post(
  '/import/:condominioId',
  protegerRota,
  autorizar('ceo', 'supervisor'),
  upload.single('file'),
  debitoController.importFromSheet
);

router.get('/por-unidade/:unidadeId', debitoController.getByUnidadeId);
router.post('/', protegerRota, autorizar('ceo', 'supervisor'), debitoController.create);
router.delete('/:id', protegerRota, autorizar('ceo', 'supervisor'), debitoController.delete);
router.patch('/status-em-massa', protegerRota, debitoController.alterarStatusEmMassa);
router.post('/baixa-em-massa', protegerRota, debitoController.baixarDebitos);


module.exports = router;