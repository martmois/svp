// backend/src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./config/database');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require("socket.io");
const { initCron } = require('./services/taskCron');

// Importação das Rotas
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const condominioRoutes = require('./routes/condominioRoutes');
const unidadeRoutes = require('./routes/unidadeRoutes');
const debitoRoutes = require('./routes/debitoRoutes');
const emailRoutes = require('./routes/emailRoutes');
const comunicacaoRoutes = require('./routes/comunicacaoRoutes');
const anexoRoutes = require('./routes/anexoRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const relatorioRoutes = require('./routes/relatorioRoutes');
const assinaturaRoutes = require('./routes/assinaturaRoutes');
const eventoRoutes = require('./routes/eventoRoutes');
const crmRoutes = require('./routes/crmRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificacaoService = require('./services/notificacaoService');
const logRoutes = require('./routes/logRoutes');
const chatRoutes = require('./routes/chatRoutes');
const taskRoutes = require('./routes/taskRoutes');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;

// --- 1. CONFIGURAÇÃO DE IP LOCAL PARA CORS ---
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
};

// --- 1. CONFIGURAÇÃO DE ORIGENS PARA CORS ---
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_URL, // <--- URL que você vai ganhar na Vercel
  process.env.FRONTEND_URL_PROD // Opcional: Uma segunda URL de produção
].filter(Boolean); // Remove valores nulos ou indefinidos

const corsOptions = {
  origin: (origin, callback) => {
    // Permite requisições sem origem (como apps mobile)
    if (!origin) return callback(null, true);
    
    // Verifica se a origem está na lista ou se é localhost/IP local (desenvolvimento)
    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('192.168.');
    const isAllowed = allowedOrigins.indexOf(origin) !== -1;

    if (isAllowed || isLocal) {
      callback(null, true);
    } else {
      console.log('Bloqueado pelo CORS:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
};

// --- 2. MIDDLEWARES GLOBAIS (ORDEM É CRUCIAL) ---

// A) CORS (Deve ser o primeiro para permitir a conexão)
app.use(cors(corsOptions));

// B) BODY PARSER (JSON e URL Encoded)
// ESTES COMANDOS DEVEM VIR ANTES DAS ROTAS para que req.body funcione
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --- 3. CONFIGURAÇÃO DO SOCKET.IO ---
const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

notificacaoService.setSocket(io);

// Injeta o IO em todas as requisições
app.use((req, res, next) => {
  req.io = io;
  next();
});

// --- 4. ARQUIVOS ESTÁTICOS ---
const caminhoPublico = path.resolve(__dirname, '..', 'public');
const caminhoUploadsRaiz = path.resolve(__dirname, '..', 'uploads');

console.log('📂 Static Public:', caminhoPublico);
console.log('📂 Static Uploads:', caminhoUploadsRaiz);

app.use('/public', express.static(caminhoPublico));
app.use('/uploads', express.static(caminhoUploadsRaiz));

// --- 5. DEFINIÇÃO DAS ROTAS ---
// Agora que o body parser já foi configurado acima, as rotas funcionarão corretamente

app.use('/api/emails', emailRoutes); // Rota de e-mail (agora com req.body funcionando)
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/condominios', condominioRoutes);
app.use('/api/unidades', unidadeRoutes);
app.use('/api/debitos', debitoRoutes);
app.use('/api/comunicacoes', comunicacaoRoutes);
app.use('/api/anexos', anexoRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/relatorios', relatorioRoutes);
app.use('/api/assinaturas', assinaturaRoutes);
app.use('/api/eventos', eventoRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/processos', require('./routes/processoRoutes'));
app.use('/api/acordos', require('./routes/acordoRoutes'));
app.use('/api/upload', uploadRoutes);
app.use('/api/notificacoes', require('./routes/notificacaoRoutes'));
app.use('/api/logs', logRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tarefas', taskRoutes);

app.get('/', (req, res) => { res.send('API do SVP está funcionando!'); });
app.set('io', io);

// --- 6. EVENTOS DO SOCKET.IO ---
io.on('connection', (socket) => {
  console.log('✅ Socket conectado:', socket.id);

  // Salas de Conversa (E-mail)
  socket.on('join_conversation_room', (id) => socket.join(`conversa-${id}`));
  socket.on('leave_conversation_room', (id) => socket.leave(`conversa-${id}`));

  // Salas de Chat (Bate-Papo Interno)
  socket.on('join_chat_room', (roomId) => {
    socket.join(`chat-room-${roomId}`);
    console.log(`Socket ${socket.id} entrou no chat ${roomId}`);
  });
  
  socket.on('leave_chat_room', (roomId) => {
    socket.leave(`chat-room-${roomId}`);
  });

  socket.on('join_room', (room) => {
    socket.join(room);
    console.log(`✅ Socket ${socket.id} registrado na sala de notificações: ${room}`);
  });

  socket.on('disconnect', () => { /* console.log('Desconectou'); */ });
});

initCron(io);

// --- 7. INICIALIZAÇÃO DO SERVIDOR ---
server.listen(PORT, '0.0.0.0', async () => {
  const ip = getLocalIp();
  console.log('----------------------------------------------------------');
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📡 Acesso na Rede:   http://${ip}:${PORT}`);
  console.log('----------------------------------------------------------');
  try {
    const connection = await db.getConnection();
    console.log('✅ Banco conectado!');
    connection.release();
  } catch (e) { console.error('❌ Erro Banco:', e.message); }
});