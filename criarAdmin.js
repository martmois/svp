
// 1. Carrega as variáveis de ambiente PRIMEIRO!
require('dotenv').config();

// 2. Agora importa os outros módulos
const bcrypt = require('bcryptjs');
const db = require('./src/config/database'); // Agora ele encontrará as variáveis carregadas

async function criarAdmin() {
  const email = 'admin@condoflow.com';
  const senhaPlana = 'senha123';
  const perfil = 'administrador';

  try {
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senhaPlana, salt);
    
    const connection = await db.getConnection();
    const query = 'INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, ?)';
    await connection.execute(query, ['Administrador do Sistema', email, senhaHash, perfil]);
    connection.release();

    console.log(`✅ Usuário '${email}' com perfil '${perfil}' criado com sucesso!`);
    console.log('Use a senha: "senha123" para fazer o login.');

  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      console.error(`❌ Erro: O email '${email}' já existe no banco de dados.`);
    } else {
      console.error('❌ Erro ao criar usuário administrador:', error.message);
    }
  } finally {
    // Garante que a conexão com o banco será fechada
    await db.end();
  }
}

criarAdmin();