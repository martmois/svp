// src/routes/logRoutes.js
const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');
const { protegerRota } = require('../middleware/authMiddleware');

router.use(protegerRota);

// Apenas GET para listar (ninguém edita ou apaga logs)
router.get('/', logController.listar);

module.exports = router;