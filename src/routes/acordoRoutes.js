const express = require('express');
const router = express.Router();
const acordoController = require('../controllers/acordoController');
const { protegerRota } = require('../middleware/authMiddleware');

router.use(protegerRota);
router.post('/', acordoController.criar);

module.exports = router;