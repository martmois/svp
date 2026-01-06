// src/routes/dashboardRoutes.js

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { protegerRota, autorizar } = require('../middleware/authMiddleware');

// Aplica os middlewares a esta rota.
// 1º -> protegerRota: verifica se está logado.
// 2º -> autorizar(...): permite CEO, Supervisor e Colaborador acessarem a rota.
router.get('/', protegerRota, autorizar('ceo', 'supervisor', 'colaborador'), dashboardController.obterDados);

module.exports = router;