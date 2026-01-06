// backend/src/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const uploadController = require('../controllers/uploadController');
const { protegerRota } = require('../middleware/authMiddleware');

// Configuração do Multer para salvar em disco
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    // Cria um nome único: timestamp + extensão
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

router.use(protegerRota);

// Rota para upload de imagem da assinatura (campo 'image')
router.post('/', upload.single('image'), uploadController.uploadImage);

module.exports = router;