// backend/seedTemplates.js

require('dotenv').config();
const db = require('./src/config/database');

const templates = [
  {
    id: 1,
    nome_template: 'Pré-Cobrança (Amigável)',
    assunto: 'Lembrete Amigável de Vencimento - Condomínio {CONDOMÍNIO}',
    corpo: `
      <p>Olá, responsável pela unidade {UNIDADE},</p>
      <p>Esperamos que esteja tudo bem.</p>
      <p>Este é um lembrete amigável sobre as seguintes taxas condominiais em aberto:</p>
      {LISTAGEM DE TODOS OS VENCIMENTOS OU SEJA OS DÉBITOS DA UNIDADE}
      <p>Para sua conveniência, sugerimos que regularize a situação o quanto antes para evitar acréscimos. Se o pagamento já foi efetuado, por favor, desconsidere esta mensagem.</p>
      <p>Agradecemos a sua atenção e colaboração.</p>
      <p>Atenciosamente,<br>Administração do Condomínio {CONDOMÍNIO}</p>
    `
  },
  {
    id: 2,
    nome_template: 'Cobrança (30 dias)',
    assunto: 'Aviso de Débito em Aberto - Condomínio {CONDOMÍNIO}',
    corpo: `
      <p>Prezado(a) responsável pela unidade {UNIDADE},</p>
      <p>Verificamos em nosso sistema que a(s) seguinte(s) taxa(s) condominial(is) consta(m) em aberto há aproximadamente 30 dias:</p>
      {LISTAGEM DE TODOS OS VENCIMENTOS OU SEJA OS DÉBITOS DA UNIDADE}
      <p>O valor atualizado já inclui multa e juros conforme a convenção do condomínio. Solicitamos a regularização imediata para evitar novas penalidades e o início de medidas administrativas.</p>
      <p>Para negociar ou obter a segunda via do boleto, por favor, entre em contato.</p>
      <p>Atenciosamente,<br>Administração do Condomínio {CONDOMÍNIO}</p>
    `
  },
  {
    id: 3,
    nome_template: 'Notificação Extrajudicial (60 dias)',
    assunto: 'NOTIFICAÇÃO EXTRAJUDICIAL: Débitos Condominiais em Aberto',
    corpo: `
      <h3>NOTIFICAÇÃO EXTRAJUDICIAL</h3>
      <p><b>Notificado:</b> Responsável pela unidade {UNIDADE}</p>
      <p><b>Notificante:</b> Condomínio {CONDOMÍNIO}</p>
      <p>Prezado(a) senhor(a),</p>
      <p>A presente notificação tem o objetivo de formalizar a cobrança dos débitos condominiais listados abaixo, que se encontram em aberto por um período superior a 60 dias:</p>
      {LISTAGEM DE TODOS OS VENCIMENTOS OU SEJA OS DÉBITOS DA UNIDADE}
      <p>Conforme o Art. 1.336 do Código Civil, o não pagamento das taxas condominiais acarreta em penalidades legais. Concedemos o prazo de 48 horas a partir do recebimento desta para a quitação do débito ou formalização de um acordo.</p>
      <p>O não cumprimento implicará no encaminhamento do débito para protesto e posterior cobrança judicial.</p>
      <p>Atenciosamente,<br>Departamento Jurídico / Administração do Condomínio {CONDOMÍNIO}</p>
    `
  },
  // Adicionei os outros templates aqui para completar
  {
    id: 4,
    nome_template: 'Último Aviso (90 dias)',
    assunto: 'ÚLTIMO AVISO ANTES DE AÇÃO JUDICIAL - Condomínio {CONDOMÍNIO}',
    corpo: `
      <h3>ÚLTIMO AVISO ANTES DE AÇÃO JUDICIAL</h3>
      <p><b>Notificado:</b> Responsável pela unidade {UNIDADE}</p>
      <p>Apesar de nossas tentativas anteriores de contato, os seguintes débitos permanecem em aberto por mais de 90 dias:</p>
      {LISTAGEM DE TODOS OS VENCIMENTOS OU SEJA OS DÉBITOS DA UNIDADE}
      <p>Esta é a última oportunidade para regularização amigável. Caso o débito não seja quitado ou um acordo não seja firmado no prazo improrrogável de 24 horas, o caso será encaminhado para nosso departamento jurídico para o imediato ajuizamento da competente Ação de Execução de Título Extrajudicial.</p>
      <p>Atenciosamente,<br>Administração do Condomínio {CONDOMÍNIO}</p>
    `
  },
  {
    id: 5,
    nome_template: 'Proposta de Acordo',
    assunto: 'Temos uma Proposta de Acordo para Você - Condomínio {CONDOMÍNIO}',
    corpo: `
      <p>Prezado(a) responsável pela unidade {UNIDADE},</p>
      <p>Entendemos que imprevistos acontecem. Pensando nisso, a administração do Condomínio {CONDOMÍNIO} preparou uma proposta especial para que você possa regularizar seus débitos de forma facilitada.</p>
      <p>Seus débitos em aberto são:</p>
      {LISTAGEM DE TODOS OS VENCIMENTOS OU SEJA OS DÉBITOS DA UNIDADE}
      <p>Gostaríamos de convidá-lo(a) a entrar em contato conosco para conhecer as condições de parcelamento e descontos que podemos oferecer.</p>
      <p>Responda a este e-mail ou ligue para [Telefone da Administração] para iniciarmos uma negociação.</p>
      <p>Atenciosamente,<br>Administração do Condomínio {CONDOMÍNIO}</p>
    `
  },
  {
    id: 6,
    nome_template: 'Confirmação de Acordo',
    assunto: 'Confirmação do seu Acordo - Condomínio {CONDOMÍNIO}',
    corpo: `
      <p>Prezado(a) responsável pela unidade {UNIDADE},</p>
      <p>Este e-mail serve para formalizar e confirmar o acordo de parcelamento referente aos débitos condominiais, conforme negociado.</p>
      <p><b>Resumo do Acordo:</b></p>
      <p>[DETALHES DO ACORDO, EX: NÚMERO DE PARCELAS, VALORES, DATAS]</p>
      <p>Os boletos referentes às parcelas do acordo serão enviados para este e-mail. O não pagamento de qualquer uma das parcelas implicará no cancelamento automático do acordo e na retomada da cobrança do valor integral.</p>
      <p>Agradecemos por sua cooperação.</p>
      <p>Atenciosamente,<br>Administração do Condomínio {CONDOMÍNIO}</p>
    `
  }
];

async function seed() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    console.log('Iniciando o cadastro de templates...');
    
    for (const template of templates) {
      const { id, nome_template, assunto, corpo } = template;
      // "INSERT ... ON DUPLICATE KEY UPDATE" evita criar duplicatas se o script rodar de novo.
      const query = `
        INSERT INTO email_templates (id, nome_template, assunto, corpo) 
        VALUES (?, ?, ?, ?) 
        ON DUPLICATE KEY UPDATE 
          nome_template = VALUES(nome_template), 
          assunto = VALUES(assunto), 
          corpo = VALUES(corpo)
      `;
      await connection.execute(query, [id, nome_template, assunto, corpo.trim()]);
      console.log(`Template "${nome_template}" cadastrado/atualizado.`);
    }
    
    await connection.commit();
    console.log('✅ Todos os templates foram cadastrados com sucesso!');
  } catch (error) {
    await connection.rollback();
    console.error('❌ Erro ao cadastrar templates:', error);
  } finally {
    connection.release();
    await db.end();
  }
}

seed();