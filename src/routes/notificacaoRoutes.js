const express = require('express');
const router = express.Router();
const notificacaoController = require('../controllers/notificacaoController');
const { protegerRota } = require('../middleware/authMiddleware');

router.use(protegerRota);

router.get('/', notificacaoController.listar);
router.patch('/:id/lida', notificacaoController.marcarLida);
router.patch('/todas-lidas', notificacaoController.marcarTodasLidas);

module.exports = router;