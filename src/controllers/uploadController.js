// backend/src/controllers/uploadController.js
const uploadController = {
  uploadImage: (req, res) => {
    if (!req.file) {
      return res.status(400).json({ mensagem: 'Nenhuma imagem enviada.' });
    }
    // Retorna a URL completa da imagem para ser usada no frontend
    // Ajuste o protocolo e host conforme seu ambiente (http://localhost:3001)
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    
    res.json({ url: imageUrl });
  }
};

module.exports = uploadController;