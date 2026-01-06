// src/controllers/whatsappController.js
const db = require('../config/database');
const formatarMoeda = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
const formatarData = (dataSQL) => { if (!dataSQL) return 'N/A'; const data = new Date(dataSQL); return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(data); };

const whatsappController = {
  listarTemplates: async (req, res) => {
    try {
      const [templates] = await db.query('SELECT id, nome_template FROM whatsapp_templates');
      res.json(templates);
    } catch (error) {
      res.status(500).json({ mensagem: 'Erro ao buscar templates.' });
    }
  },

  previewMensagem: async (req, res) => {
    const { templateId, unidadeId } = req.params;
    try {
      const [unidadeRes, debitosRes, templateRes] = await Promise.all([
        db.query(`SELECT u.*, c.nome as nome_condominio FROM unidades u JOIN condominios c ON u.condominio_id = c.id WHERE u.id = ?`, [unidadeId]),
        db.query('SELECT * FROM debitos WHERE unidade_id = ? AND status = "pendente"', [unidadeId]),
        db.query('SELECT * FROM whatsapp_templates WHERE id = ?', [templateId])
      ]);
      const unidade = unidadeRes[0][0]; const debitos = debitosRes[0]; const template = templateRes[0][0];

      if (!unidade || !template) return res.status(404).json({ mensagem: 'Unidade ou template não encontrado.' });

      const usuarioLogado = req.user?.nome;
      
      const listaDebitosTexto = debitos
        .map(d => `*${formatarData(d.data_vencimento)}*`)
        .join('\n');
      
      const textoFinal = template.texto
        .replace(/{UNIDADE}/g, unidade.numero_unidade)
        .replace(/{CONDOMÍNIO}/g, unidade.nome_condominio)
        .replace(/{DÉBITOS}/g, listaDebitosTexto)
        .replace(/{USUÁRIO}/g, usuarioLogado);
        
      res.json({ texto: textoFinal });
    } catch (error) {
      res.status(500).json({ mensagem: 'Falha ao gerar preview.' });
    }
  },
};

module.exports = whatsappController;