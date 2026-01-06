// src/controllers/anexoController.js
const db = require('../config/database');
const path = require('path');
const fs = require('fs');

const anexoController = {
  download: async (req, res) => {
    try {
      const { id } = req.params;

      // 1. Busca o anexo no banco de dados
      const [anexos] = await db.query('SELECT * FROM anexos WHERE id = ?', [id]);
      if (anexos.length === 0) {
        return res.status(404).json({ mensagem: 'Anexo não encontrado.' });
      }
      const anexo = anexos[0];

      // 2. Monta o caminho absoluto para o arquivo no servidor
      // Isso é mais seguro do que usar caminhos relativos.
      const caminhoAbsoluto = path.resolve(anexo.caminho_arquivo);

      // 3. Verifica se o arquivo realmente existe no disco
      if (!fs.existsSync(caminhoAbsoluto)) {
        return res.status(404).json({ mensagem: 'Arquivo não encontrado no servidor.' });
      }

      // 4. Envia o arquivo para o navegador.
      // res.download força o download. Para preview, res.sendFile é melhor.
      // Ele define o Content-Type automaticamente com base na extensão do arquivo.
      res.sendFile(caminhoAbsoluto);

    } catch (error) {
      console.error("Erro ao baixar anexo:", error);
      res.status(500).json({ mensagem: 'Erro interno no servidor.' });
    }
  },
};

module.exports = anexoController;