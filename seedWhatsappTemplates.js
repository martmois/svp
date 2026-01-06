// backend/seedWhatsappTemplates.js

require('dotenv').config();
const db = require('./src/config/database');

// Placeholders disponíveis: {RESPONSAVEL}, {UNIDADE}, {CONDOMINIO}, {LISTA_DEBITOS}
const templates = [
  {
    id: 1,
    nome_template: 'Lembrete Amigável',
    texto: `Olá, {RESPONSAVEL}. Este é um lembrete amigável do Condomínio {CONDOMINIO} referente aos débitos em aberto para a unidade {UNIDADE}.\n\n{LISTA_DEBITOS}\n\nPor favor, entre em contato para regularização.\nAgradecemos a atenção!`,
  },
  {
    id: 2,
    nome_template: 'Aviso de Cobrança (Formal)',
    texto: `Prezado(a) {RESPONSAVEL}, responsável pela unidade {UNIDADE} do Condomínio {CONDOMINIO}.\n\nVerificamos em nosso sistema os seguintes débitos pendentes de pagamento:\n{LISTA_DEBITOS}\n\nSolicitamos que a situação seja regularizada o mais breve possível para evitar a incidência de multas e juros, conforme previsto na convenção.\n\nAtenciosamente,\nA Administração.`,
  },
];

async function seed() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    console.log('Iniciando o cadastro de templates de WhatsApp...');
    
    for (const template of templates) {
      const { id, nome_template, texto } = template;
      const query = `
        INSERT INTO whatsapp_templates (id, nome_template, texto) 
        VALUES (?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
          nome_template = VALUES(nome_template), 
          texto = VALUES(texto)
      `;
      await connection.execute(query, [id, nome_template, texto.trim()]);
      console.log(`Template WhatsApp "${nome_template}" cadastrado/atualizado.`);
    }
    
    await connection.commit();
    console.log('✅ Todos os templates de WhatsApp foram cadastrados com sucesso!');
  } catch (error) {
    await connection.rollback();
    console.error('❌ Erro ao cadastrar templates de WhatsApp:', error);
  } finally {
    connection.release();
    await db.end();
  }
}

seed();