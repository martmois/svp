// backend/src/controllers/relatorioController.js
const db = require('../config/database');
const PDFDocument = require('pdfkit');

// Funções de formatação
const formatarMoeda = (valor) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
const formatarData = (dataSQL) => { 
  if (!dataSQL) return 'N/A'; 
  const data = new Date(dataSQL); 
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(data); 
};
const formatarDataHora = (dataSQL) => {
  if (!dataSQL) return 'N/A';
  const data = new Date(dataSQL);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data);
};

// --- FUNÇÃO MELHORADA PARA LIMPAR HTML E ENTIDADES ---
const stripHtml = (html) => {
   if (!html) return '';
   
   // 1. Substitui tags <br> e <p> por quebras de linha reais para manter formatação básica
   let text = html
     .replace(/<br\s*\/?>/gi, '\n')
     .replace(/<\/p>/gi, '\n\n');

   // 2. Remove todas as outras tags HTML
   text = text.replace(/<[^>]*>?/gm, '');

   // 3. Decodifica Entidades HTML comuns (O Jodit salva assim, e o PDFKit não entende nativamente)
   const entities = {
     '&nbsp;': ' ',
     '&amp;': '&',
     '&quot;': '"',
     '&lt;': '<',
     '&gt;': '>',
     '&atilde;': 'ã', '&Atilde;': 'Ã',
     '&otilde;': 'õ', '&Otilde;': 'Õ',
     '&aacute;': 'á', '&Aacute;': 'Á',
     '&eacute;': 'é', '&Eacute;': 'É',
     '&iacute;': 'í', '&Iacute;': 'Í',
     '&oacute;': 'ó', '&Oacute;': 'Ó',
     '&uacute;': 'ú', '&Uacute;': 'Ú',
     '&ccedil;': 'ç', '&Ccedil;': 'Ç',
     '&ecirc;': 'ê', '&Ecirc;': 'Ê',
     '&ocirc;': 'ô', '&Ocirc;': 'Ô',
     '&agrave;': 'à', '&Agrave;': 'À'
   };

   text = text.replace(/&[a-zA-Z]+;/g, (match) => entities[match] || match);

   // 4. Remove excesso de espaços e quebras de linha repetidas
   return text.replace(/\n\s*\n/g, '\n\n').trim();
};

const relatorioController = {
  // RELATÓRIO 1: EXTRATO SIMPLES (Mantido com pequenos ajustes de segurança)
  gerarExtratoDebitos: async (req, res) => {
      try {
        const { unidadeId } = req.params;
        const [unidadeRes, debitosRes] = await Promise.all([
          db.query(`SELECT u.*, c.nome as nome_condominio, c.cnpj as cnpj_condominio FROM unidades u JOIN condominios c ON u.condominio_id = c.id WHERE u.id = ?`, [unidadeId]),
          db.query('SELECT * FROM debitos WHERE unidade_id = ? AND status = "pendente" ORDER BY data_vencimento ASC', [unidadeId])
        ]);
        if (unidadeRes[0].length === 0) return res.status(404).json({ mensagem: 'Unidade não encontrada.' });
        const unidade = unidadeRes[0][0];
        const debitos = debitosRes[0];
        
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const nomeArquivo = `extrato-debitos-${unidade.numero_unidade}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);
        doc.pipe(res);

        // Cabeçalho
        doc.fontSize(16).font('Helvetica-Bold').text(unidade.nome_condominio, { align: 'center' });
        doc.fontSize(10).font('Helvetica').text(`CNPJ: ${unidade.cnpj_condominio}`, { align: 'center' });
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(1);
        
        doc.fillColor('#000000').fontSize(14).font('Helvetica-Bold').text('Extrato de Débitos', { align: 'left' });
        doc.fontSize(9).font('Helvetica').text(`Emissão: ${new Date().toLocaleDateString('pt-BR')}`, { align: 'left' });
        doc.moveDown(1);
        
        // Dados da Unidade (Layout Simples)
        doc.rect(50, doc.y, 500, 45).fillAndStroke('#f3f4f6', '#e5e7eb');
        doc.fillColor('#000000');
        const startY = doc.y - 35; 
        
        doc.fontSize(9).font('Helvetica-Bold').text('UNIDADE:', 60, startY);
        doc.font('Helvetica').text(`${unidade.numero_unidade} ${unidade.bloco || ''}`, 110, startY);
        
        doc.font('Helvetica-Bold').text('RESPONSÁVEL:', 280, startY);
        doc.font('Helvetica').text(unidade.responsavel_nome, 360, startY);
        doc.moveDown(4);

        // Tabela
        doc.font('Helvetica-Bold').fontSize(9);
        const tableTop = doc.y;
        doc.text('VENCIMENTO', 50, tableTop);
        doc.text('DESCRIÇÃO', 130, tableTop);
        doc.text('VALOR', 450, tableTop, { align: 'right', width: 100 });
        doc.moveTo(50, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#000000').stroke();
        doc.moveDown(1.5);

        let total = 0;
        doc.font('Helvetica').fontSize(9);
        for(let d of debitos) {
            if(doc.y > 720) { doc.addPage(); doc.moveDown(2); }
            const y = doc.y;
            doc.text(formatarData(d.data_vencimento), 50, y);
            doc.text(d.descricao || 'Taxa Condominial', 130, y, { width: 300 });
            doc.text(formatarMoeda(d.valor), 450, y, { align: 'right', width: 100 });
            doc.moveDown(0.8);
            total += parseFloat(d.valor);
        }
        doc.moveDown(1);
        doc.font('Helvetica-Bold').text(`TOTAL: ${formatarMoeda(total)}`, { align: 'right' });
        doc.end();
      } catch (e) { console.error(e); res.status(500).send('Erro PDF'); }
  },

  // RELATÓRIO 2: APENAS HISTÓRICO
  gerarRelatorioHistorico: async (req, res) => {
    try {
      const { unidadeId } = req.params;
      const [unidadeRes] = await db.query(`SELECT u.*, c.nome as nome_condominio FROM unidades u JOIN condominios c ON u.condominio_id = c.id WHERE u.id = ?`, [unidadeId]);
      if (unidadeRes.length === 0) return res.status(404).send('Unidade não encontrada');
      const unidade = unidadeRes[0];

      const [historico] = await db.query(`
        SELECT h.*, u.nome as nome_usuario 
        FROM historico_cobranca h LEFT JOIN usuarios u ON h.usuario_id = u.id 
        WHERE h.unidade_id = ? ORDER BY h.data_contato DESC
      `, [unidadeId]);

      const doc = new PDFDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="historico-${unidade.numero_unidade}.pdf"`);
      doc.pipe(res);

      doc.fontSize(16).font('Helvetica-Bold').text('Histórico de Cobrança', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(`${unidade.nome_condominio} - Unidade ${unidade.numero_unidade}`, { align: 'center' });
      doc.moveDown(2);

      historico.forEach(h => {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(10).font('Helvetica-Bold').text(`${formatarDataHora(h.data_contato)} - ${h.tipo_contato.toUpperCase()}`);
        doc.font('Helvetica').text(`Resultado: ${h.resultado} | Por: ${h.nome_usuario || 'Sistema'}`);
        if (h.observacao) {
            doc.fontSize(9).font('Helvetica').text(stripHtml(h.observacao), { indent: 10, align: 'justify', width: 500 });
        }
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#eeeeee').stroke();
        doc.moveDown(1);
        doc.strokeColor('#000000');
      });
      doc.end();
    } catch (error) { res.status(500).send('Erro ao gerar relatório'); }
  },

  // RELATÓRIO 3: CRM COMPLETO (DOSSIÊ) - CORRIGIDO
  gerarRelatorioCRMCompleto: async (req, res) => {
    try {
      const { unidadeId } = req.params;

      // 1. Busca Dados
      const [unidadeRes] = await db.query(`SELECT u.*, c.nome as nome_condominio, c.cnpj as cnpj_condominio FROM unidades u JOIN condominios c ON u.condominio_id = c.id WHERE u.id = ?`, [unidadeId]);
      const unidade = unidadeRes[0];

      const [debitos] = await db.query('SELECT * FROM debitos WHERE unidade_id = ? AND status != "pago" ORDER BY data_vencimento ASC', [unidadeId]);
      const [historico] = await db.query(`SELECT h.*, u.nome as nome_usuario FROM historico_cobranca h LEFT JOIN usuarios u ON h.usuario_id = u.id WHERE h.unidade_id = ? ORDER BY h.data_contato DESC`, [unidadeId]);
      const [emails] = await db.query(`
        SELECT com.assunto_inicial, m.data_envio, m.corpo_html 
        FROM comunicacoes com 
        JOIN mensagens m ON m.comunicacao_id = com.id 
        JOIN contatos_email ce ON com.contato_email_id = ce.id
        WHERE ce.unidade_id = ? AND m.tipo = 'enviado' 
        ORDER BY m.data_envio DESC
      `, [unidadeId]);
      const [processos] = await db.query('SELECT * FROM processos WHERE unidade_id = ?', [unidadeId]);

      // 2. Configura PDF
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="dossie-${unidade.numero_unidade}.pdf"`);
      doc.pipe(res);

      // --- CAPA / CABEÇALHO (LAYOUT CORRIGIDO) ---
      // Título Centralizado
      doc.fontSize(18).font('Helvetica-Bold').text('DOSSIÊ DA UNIDADE', { align: 'center' });
      doc.fontSize(12).font('Helvetica').text(unidade.nome_condominio, { align: 'center' });
      doc.moveDown(1.5);
      
      // Caixa de Informações (Mais alta e organizada)
      const startBoxY = doc.y;
      doc.rect(50, startBoxY, 500, 70).fillAndStroke('#f8f9fa', '#cccccc');
      doc.fillColor('#000000');
      
      // Coluna 1: Unidade e Responsável
      doc.fontSize(10).font('Helvetica-Bold').text('UNIDADE:', 60, startBoxY + 10);
      doc.font('Helvetica').text(`${unidade.numero_unidade} ${unidade.bloco || ''}`, 60, startBoxY + 25);
      
      doc.font('Helvetica-Bold').text('RESPONSÁVEL:', 60, startBoxY + 45);
      doc.font('Helvetica').text(unidade.responsavel_nome, 140, startBoxY + 45);
      
      // Coluna 2: Condomínio e CNPJ (Alinhado à direita do box)
      doc.font('Helvetica-Bold').text('CONDOMÍNIO:', 300, startBoxY + 10);
      doc.font('Helvetica').text(unidade.nome_condominio, 300, startBoxY + 25, { width: 240 });
      
      doc.font('Helvetica-Bold').text('CNPJ:', 300, startBoxY + 45);
      doc.font('Helvetica').text(unidade.cnpj_condominio, 340, startBoxY + 45);
      
      doc.y = startBoxY + 90; // Move cursor para baixo da caixa

      // --- SEÇÃO 1: DÉBITOS ---
      doc.fontSize(12).font('Helvetica-Bold').text('1. PENDÊNCIAS FINANCEIRAS');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.8);
      
      let totalDebito = 0;
      if (debitos.length === 0) {
          doc.fontSize(10).font('Helvetica').text('Nenhuma pendência em aberto.');
      } else {
          debitos.forEach(d => {
              if (doc.y > 700) doc.addPage();
              doc.fontSize(9).font('Helvetica').text(`${formatarData(d.data_vencimento)}   -   ${d.descricao || 'Cota Condominial'}`, { continued: true });
              doc.text(formatarMoeda(d.valor), { align: 'right' });
              totalDebito += parseFloat(d.valor);
          });
          doc.moveDown(0.5);
          doc.font('Helvetica-Bold').text(`TOTAL: ${formatarMoeda(totalDebito)}`, { align: 'right' });
      }
      doc.moveDown(2);

      // --- SEÇÃO 2: PROCESSOS ---
      if (processos.length > 0) {
          if (doc.y > 650) doc.addPage();
          doc.fontSize(12).font('Helvetica-Bold').text('2. PROCESSOS JUDICIAIS');
          doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
          doc.moveDown(0.8);
          processos.forEach(p => {
              doc.fontSize(10).font('Helvetica-Bold').text(`Processo: ${p.numero_processo}`);
              doc.font('Helvetica').text(`Status: ${p.status} | Advogado: ${p.advogado_responsavel || '-'}`);
              doc.moveDown(0.5);
          });
          doc.moveDown(2);
      }

      // --- SEÇÃO 3: HISTÓRICO DE INTERAÇÕES ---
      if (doc.y > 650) doc.addPage();
      doc.fontSize(12).font('Helvetica-Bold').text('3. HISTÓRICO DE INTERAÇÕES');
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.8);
      
      if (historico.length === 0) doc.fontSize(10).font('Helvetica').text('Nenhum histórico registrado.');
      
      historico.forEach(h => {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(9).font('Helvetica-Bold').text(`${formatarDataHora(h.data_contato)} - ${h.tipo_contato}`);
        if (h.observacao) {
            // stripHtml garante limpeza de formatação quebrada
            doc.font('Helvetica').text(stripHtml(h.observacao), { indent: 15, align: 'justify', width: 480 });
        }
        doc.moveDown(0.8);
      });
      doc.moveDown(2);

      // --- SEÇÃO 4: E-MAILS ENVIADOS (CORRIGIDO) ---
      if (emails.length > 0) {
          doc.addPage();
          doc.fontSize(12).font('Helvetica-Bold').text('4. E-MAILS ENVIADOS (NOTIFICAÇÕES)');
          doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
          doc.moveDown(1);

          emails.forEach(e => {
              if (doc.y > 650) doc.addPage();
              
              // Cabeçalho do E-mail
              doc.rect(50, doc.y, 500, 20).fill('#e9ecef');
              doc.fillColor('#000000');
              doc.fontSize(8).font('Helvetica-Bold').text(`DATA: ${formatarDataHora(e.data_envio)} | ASSUNTO: ${e.assunto_inicial}`, 55, doc.y - 14, { width: 490, lineBreak: false, ellipsis: true });
              doc.moveDown(0.8);
              
              // CORPO DO E-MAIL SANITIZADO
              const textoLimpo = stripHtml(e.corpo_html);
              
              // Renderiza o texto com alinhamento à esquerda para evitar buracos e justificação forçada
              doc.fontSize(8).font('Helvetica').text(textoLimpo, 50, doc.y, { 
                  align: 'left', 
                  width: 500,
                  paragraphGap: 2 
              });
              
              doc.moveDown(1.5);
              doc.moveTo(50, doc.y).lineTo(550, doc.y).strokeColor('#dddddd').stroke();
              doc.strokeColor('#000000'); // Reset cor da linha
              doc.moveDown(1);
          });
      }

      doc.end();

    } catch (error) {
      console.error(error);
      res.status(500).send('Erro ao gerar dossiê');
    }
  }
};

module.exports = relatorioController;