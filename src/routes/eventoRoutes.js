const express = require('express');
const router = express.Router();
const eventoController = require('../controllers/eventoController');
const { protegerRota } = require('../middleware/authMiddleware');

// Protege a rota (apenas usuários logados podem ver o histórico)
router.use(protegerRota);

// Rota para buscar o histórico de e-mails
// O controller foi definido como 'getAll', então chamamos ele aqui.
// Usamos GET pois estamos buscando dados (e o controller lê req.query)
router.get('/', eventoController.getAll);

module.exports = router;