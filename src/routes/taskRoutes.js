// backend/src/routes/taskRoutes.js
const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { protegerRota } = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');

// --- Configuração Multer (Padrão Chat/CRM) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/'); // Pasta existe na raiz
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `task-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});
const upload = multer({ storage: storage });

router.use(protegerRota);

// Rotas CRUD
router.get('/', taskController.listarTarefas);
router.post('/', taskController.criarTarefa);
router.put('/:id', taskController.atualizarTarefa); 
router.delete('/:id', taskController.excluirTarefa);

// Rota de Upload (Array de arquivos)
router.post('/:id/anexos', upload.array('anexos'), taskController.uploadAnexo);

// Checklist
router.post('/:id/checklist', taskController.adicionarItemChecklist);
router.delete('/checklist/:itemId', taskController.removerItemChecklist);
router.put('/checklist/:itemId', taskController.toggleChecklist);

// Comentários
router.post('/:id/comentarios', taskController.adicionarComentario);

module.exports = router;