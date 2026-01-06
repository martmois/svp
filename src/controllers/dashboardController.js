// backend/src/controllers/dashboardController.js
const db = require('../config/database');

const dashboardController = {
  obterDados: async (req, res) => {
    try {
      const { condominio_id } = req.query;
      const { perfil, carteira } = req.user; // <--- Pega dados do usuário
      
      let whereClause = '';
      const paramsBase = [];

      // 1. Filtro do Dropdown (Frontend)
      if (condominio_id && condominio_id !== 'undefined' && condominio_id !== '') {
        whereClause += ' AND u.condominio_id = ?';
        paramsBase.push(condominio_id);
      }

      // 2. Filtro de Segurança (Carteira do Colaborador)
      if (perfil === 'colaborador') {
        if (!carteira) return res.json(null); // Segurança: sem carteira, sem dados
        whereClause += ' AND c.carteira = ?';
        paramsBase.push(carteira);
      }

      // Prepara os arrays de parâmetros
      // A query de KPI usa a cláusula 2 vezes (na query principal e na subquery)
      const paramsKPI = [...paramsBase, ...paramsBase];
      const paramsGeral = [...paramsBase];

      // --- 1. KPIs ---
      // IMPORTANTE: Adicionado JOIN condominios c na subquery também
      const [kpis] = await db.query(`
        SELECT 
          SUM(CASE WHEN d.status = 'pendente' THEN d.valor ELSE 0 END) as total_pendente,
          SUM(CASE WHEN d.status = 'em_acordo' THEN d.valor ELSE 0 END) as total_acordo,
          SUM(CASE WHEN d.status = 'juridico' THEN d.valor ELSE 0 END) as total_juridico,
          COUNT(DISTINCT CASE WHEN d.status != 'pago' THEN d.unidade_id END) as unidades_devedoras,
          (
            SELECT COUNT(*) FROM unidades u 
            JOIN condominios c ON u.condominio_id = c.id 
            WHERE 1=1 ${whereClause}
          ) as total_unidades
        FROM debitos d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE 1=1 ${whereClause}
      `, paramsKPI);

      const dadosKPI = kpis[0];
      const taxaInadimplencia = dadosKPI.total_unidades > 0 
        ? ((dadosKPI.unidades_devedoras / dadosKPI.total_unidades) * 100).toFixed(1) 
        : 0;

      // --- 2. GRÁFICO EVOLUÇÃO ---
      const [graficoEvolucao] = await db.query(`
        SELECT 
          DATE_FORMAT(d.data_vencimento, '%Y-%m') as mes,
          SUM(CASE WHEN d.status = 'pago' THEN d.valor ELSE 0 END) as recebido,
          SUM(CASE WHEN d.status != 'pago' THEN d.valor ELSE 0 END) as pendente
        FROM debitos d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE d.data_vencimento >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        ${whereClause}
        GROUP BY mes
        ORDER BY mes ASC
      `, paramsGeral);

      // --- 3. GRÁFICO PIZZA ---
      const [graficoPizza] = await db.query(`
        SELECT status, SUM(valor) as total
        FROM debitos d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE d.status != 'pago' ${whereClause}
        GROUP BY status
      `, paramsGeral);

      // --- 4. TOP 5 DEVEDORES ---
      const [topDevedores] = await db.query(`
        SELECT 
          u.id, u.numero_unidade, u.bloco, u.responsavel_nome,
          SUM(d.valor) as total_divida
        FROM debitos d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE d.status != 'pago' ${whereClause}
        GROUP BY u.id
        ORDER BY total_divida DESC
        LIMIT 5
      `, paramsGeral);

      // --- 5. TOP CONDOMÍNIOS ---
      const [topCondominios] = await db.query(`
        SELECT 
          c.nome, 
          COUNT(DISTINCT CASE WHEN d.status != 'pago' THEN d.unidade_id END) as qtd_inadimplentes,
          SUM(CASE WHEN d.status != 'pago' THEN d.valor ELSE 0 END) as valor_total
        FROM debitos d
        JOIN unidades u ON d.unidade_id = u.id
        JOIN condominios c ON u.condominio_id = c.id
        WHERE d.status != 'pago' ${whereClause}
        GROUP BY c.id
        ORDER BY valor_total DESC
        LIMIT 5
      `, paramsGeral);

      res.json({
        kpis: {
          ...dadosKPI,
          taxaInadimplencia,
          total_divida: Number(dadosKPI.total_pendente) + Number(dadosKPI.total_acordo) + Number(dadosKPI.total_juridico)
        },
        graficos: {
          evolucao: graficoEvolucao,
          composicao: graficoPizza
        },
        topDevedores,
        topCondominios
      });

    } catch (error) {
      console.error("Erro no dashboard:", error);
      res.status(500).json({ mensagem: 'Erro ao carregar dashboard.' });
    }
  }
};

module.exports = dashboardController;