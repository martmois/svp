// src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Define a rota para o método POST em /login
// Quando uma requisição POST chegar em /api/auth/login, ela executará authController.login
router.post('/login', authController.login);

module.exports = router;