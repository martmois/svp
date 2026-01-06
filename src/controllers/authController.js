// src/controllers/authController.js

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logService = require('../services/logService');

const authController = {

  // Método de login
  login: async (req, res) => {
    try {
      // 1. Pega o email e a senha do corpo da requisição
      const { email, senha } = req.body;

      // Validação básica
      if (!email || !senha) {
        return res.status(400).json({ mensagem: 'Email e senha são obrigatórios.' });
      }

      // 2. Procura o usuário no banco de dados
      // CORREÇÃO: Usamos SELECT * para garantir que pegamos 'senha_hash', 'perfil' e 'carteira'
      const connection = await db.getConnection();
      const [rows] = await connection.execute('SELECT * FROM usuarios WHERE email = ?', [email]);
      connection.release();
      
      // 3. Verifica se o usuário foi encontrado
      if (rows.length === 0) {
        return res.status(404).json({ mensagem: 'Usuário não encontrado.' });
      }
      const usuario = rows[0];

      // 4. Compara a senha enviada com a senha_hash do banco
      // CORREÇÃO: Aqui usamos usuario.senha_hash (nome correto da coluna)
      const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
      
      if (!senhaValida) {
        return res.status(401).json({ mensagem: 'Senha inválida.' });
      }

      // 5. Gera o Token JWT incluindo o PERFIL e a CARTEIRA
      // Isso permite que o frontend saiba quem é o usuário sem consultar o banco toda hora
      const token = jwt.sign(
        { 
          id: usuario.id, 
          nome: usuario.nome, 
          email: usuario.email,
          perfil: usuario.perfil,    // <--- Novo campo para hierarquia
          carteira: usuario.carteira // <--- Novo campo para filtro de condomínios
        }, 
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
      );

      // Passamos 'req' para capturar o IP
      logService.registrar(usuario.id, 'LOGIN', 'Login realizado com sucesso', req);

      // 6. Envia o token e os dados do usuário de volta
      res.json({ 
        token,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          perfil: usuario.perfil,
          carteira: usuario.carteira,
          assinatura_padrao_id: usuario.assinatura_padrao_id
        }
      });

    } catch (error) {
      console.error('Erro no login:', error);
      res.status(500).json({ mensagem: 'Ocorreu um erro interno no servidor.' });
    }
  }

};

module.exports = authController;