const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

if (!TOKEN) throw new Error('TELEGRAM_TOKEN não definido');
if (!ADMIN_ID) console.warn('⚠️ ADMIN_ID não definido – comandos de admin ficarão restritos a todos');

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new Database(path.join(__dirname, 'prever.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    saldo INTEGER DEFAULT 1000,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS mercados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pergunta TEXT NOT NULL,
    sim_pts INTEGER DEFAULT 0,
    nao_pts INTEGER DEFAULT 0,
    total_apostadores INTEGER DEFAULT 0,
    status TEXT DEFAULT 'aberto',
    resultado TEXT,
    encerra_em DATETIME NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS posicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    mercado_id INTEGER NOT NULL,
    lado TEXT CHECK(lado IN ('sim', 'nao')) NOT NULL,
    valor INTEGER NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    pago INTEGER DEFAULT 0,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY(mercado_id) REFERENCES mercados(id)
  );
  CREATE INDEX IF NOT EXISTS idx_posicoes_mercado ON posicoes(mercado_id);
  CREATE INDEX IF NOT EXISTS idx_posicoes_usuario ON posicoes(usuario_id);
`);

function getUserOrCreate(chatId, nome = 'Previsor') {
  let user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(chatId);
  if (!user) {
    db.prepare('INSERT INTO usuarios (id, nome, saldo) VALUES (?, ?, 1000)').run(chatId, nome);
    user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(chatId);
  }
  return user;
}

function barra(pts, total, tamanho = 10) {
  if (total === 0) return '░'.repeat(tamanho);
  const cheios = Math.round((pts / total) * tamanho);
  return '█'.repeat(cheios) + '░'.repeat(tamanho - cheios);
}

function tempoRestante(encerraEm) {
  const diff = new Date(encerraEm) - new Date();
  if (diff <= 0) return '🔴 Encerrado';
  const horas = Math.floor(diff / 3600000);
  const minutos = Math.floor((diff % 3600000) / 60000);
  if (horas > 0) return `⏳ ${horas}h ${minutos}min`;
  return `⏳ ${minutos}min`;
}

function formatarMercado(mercado) {
  const total = mercado.sim_pts + mercado.nao_pts;
  const simPct = total ? ((mercado.sim_pts / total) * 100).toFixed(0) : 0;
  const naoPct = total ? ((mercado.nao_pts / total) * 100).toFixed(0) : 0;
  return `
*#${mercado.id} ${mercado.pergunta}*
🟢 SIM  ${barra(mercado.sim_pts, total)}  ${simPct}% (${mercado.sim_pts} pts)
🔴 NÃO  ${barra(mercado.nao_pts, total)}  ${naoPct}% (${mercado.nao_pts} pts)
👥 ${mercado.total_apostadores || 0} previsores · 💰 ${total} pts em jogo
${tempoRestante(mercado.encerra_em)}
`;
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const nome = msg.from.first_name || 'Previsor';
  const user = getUserOrCreate(chatId, nome);
  let resposta = `👋 Bem-vindo ao Prever, ${user.nome}!\n\n💰 Seu saldo: *${user.saldo} pts*\nUse /mercados para ver os prognósticos abertos.\nFormato de aposta: *#1 10 sim* ou *#2 50 nao*\n/ajuda para mais informações.`;
  if (user.saldo < 100) {
    db.prepare('UPDATE usuarios SET saldo = saldo + 200 WHERE id = ?').run(chatId);
    resposta += `\n\n🎁 *Você recebeu 200 pts de recarga!* Continue prevendo!`;
  }
  bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });
});

bot.onText(/\/saldo/, (msg) => {
  const chatId = msg.chat.id;
  const user = getUserOrCreate(chatId);
  bot.sendMessage(chatId, `💰 Seu saldo atual: *${user.saldo} pts*`, { parse_mode: 'Markdown' });
});

bot.onText(/\/mercados/, (msg) => {
  const chatId = msg.chat.id;
  const mercados = db.prepare(`
    SELECT * FROM mercados
    WHERE status = 'aberto' AND datetime(encerra_em) > datetime('now')
    ORDER BY criado_em DESC
  `).all();
  if (mercados.length === 0) return bot.sendMessage(chatId, '📭 Nenhum mercado aberto no momento.');
  const resposta = mercados.map(m => formatarMercado(m)).join('\n');
  bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });
});

bot.onText(/\/minhas/, (msg) => {
  const chatId = msg.chat.id;
  const user = getUserOrCreate(chatId);
  const posicoes = db.prepare(`
    SELECT p.*, m.pergunta, m.status
    FROM posicoes p
    JOIN mercados m ON p.mercado_id = m.id
    WHERE p.usuario_id = ? AND m.status = 'aberto'
  `).all(chatId);
  if (posicoes.length === 0) return bot.sendMessage(chatId, '📭 Você não tem apostas abertas no momento.');
  let texto = '📋 *SUAS APOSTAS ABERTAS:*\n';
  posicoes.forEach(p => { texto += `#${p.mercado_id} ${p.pergunta} → ${p.lado.toUpperCase()} (${p.valor} pts)\n`; });
  texto += `💰 Saldo atual: ${user.saldo} pts`;
  bot.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
});

bot.onText(/\/historico/, (msg) => {
  const chatId = msg.chat.id;
  const mercados = db.prepare(`SELECT * FROM mercados WHERE status = 'encerrado' ORDER BY criado_em DESC LIMIT 10`).all();
  if (mercados.length === 0) return bot.sendMessage(chatId, '📭 Nenhum mercado encerrado ainda.');
  let resposta = '📚 *HISTÓRICO:*\n';
  mercados.forEach(m => {
    const emoji = m.resultado === 'sim' ? '✅' : '❌';
    resposta += `#${m.id} ${m.pergunta} → ${emoji} ${m.resultado?.toUpperCase()} (encerrado ${new Date(m.criado_em).toLocaleDateString()})\n`;
  });
  bot.sendMessage(chatId, resposta, { parse_mode: 'Markdown' });
});

bot.onText(/\/ranking/, (msg) => {
  const ranking = db.prepare(`SELECT id, nome, saldo FROM usuarios ORDER BY saldo DESC LIMIT 10`).all();
  let resposta = '🏆 *RANKING DOS PREVISORES*\n';
  ranking.forEach((u, i) => { resposta += `${i+1}. ${u.nome || 'Anônimo'} – ${u.saldo} pts\n`; });
  bot.sendMessage(msg.chat.id, resposta, { parse_mode: 'Markdown' });
});

bot.onText(/\/ajuda/, (msg) => {
  const ajuda = `🎯 *COMO FUNCIONA O PREVER:*
1️⃣ Use /mercados para ver os prognósticos abertos
2️⃣ Para opinar: *#1 10 sim* ou *#1 10 nao*
3️⃣ Se acertar, você ganha *1.8x* o valor apostado
4️⃣ Use /saldo para ver seus pontos
5️⃣ Use /ranking para ver os melhores
⚡ Cada acerto multiplica seus pontos
🎁 Você começa com 1000 pts grátis`;
  bot.sendMessage(msg.chat.id, ajuda, { parse_mode: 'Markdown' });
});

bot.onText(/^#(\d+)\s+(\d+)\s+(sim|nao)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const mercadoId = parseInt(match[1]);
  const valor = parseInt(match[2]);
  const lado = match[3].toLowerCase();
  if (valor <= 0) return bot.sendMessage(chatId, '❌ O valor da aposta deve ser positivo.');
  const user = getUserOrCreate(chatId);
  if (user.saldo < valor) return bot.sendMessage(chatId, `❌ Saldo insuficiente. Seu saldo: ${user.saldo} pts.`);
  const mercado = db.prepare(`SELECT * FROM mercados WHERE id = ? AND status = 'aberto' AND datetime(encerra_em) > datetime('now')`).get(mercadoId);
  if (!mercado) return bot.sendMessage(chatId, '❌ Mercado não encontrado, já encerrado ou expirado.');
  const existente = db.prepare('SELECT id FROM posicoes WHERE usuario_id = ? AND mercado_id = ?').get(chatId, mercadoId);
  if (existente) return bot.sendMessage(chatId, '❌ Você já apostou neste mercado.');
  const updateUser = db.prepare('UPDATE usuarios SET saldo = saldo - ? WHERE id = ?');
  const insertPosicao = db.prepare(`INSERT INTO posicoes (usuario_id, mercado_id, lado, valor) VALUES (?, ?, ?, ?)`);
  const updateMercado = db.prepare(`UPDATE mercados SET ${lado}_pts = ${lado}_pts + ?, total_apostadores = total_apostadores + 1 WHERE id = ?`);
  db.transaction(() => {
    updateUser.run(valor, chatId);
    insertPosicao.run(chatId, mercadoId, lado, valor);
    updateMercado.run(valor, mercadoId);
  })();
  const mercadoAtualizado = db.prepare('SELECT * FROM mercados WHERE id = ?').get(mercadoId);
  const confirmacao = `✅ *Aposta registrada!*\n#${mercadoId} ${mercadoAtualizado.pergunta}\nVocê apostou *${valor} pts* em *${lado.toUpperCase()}*\n${formatarMercado(mercadoAtualizado)}`;
  bot.sendMessage(chatId, confirmacao, { parse_mode: 'Markdown' });
});

bot.onText(/\/criar (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId !== ADMIN_ID) return bot.sendMessage(chatId, '⛔ Comando restrito ao administrador.');
  const args = match[1].split('|').map(s => s.trim());
  if (args.length < 2) return bot.sendMessage(chatId, '❌ Formato: `/criar Pergunta? | AAAA-MM-DD HH:MM`', { parse_mode: 'Markdown' });
  const pergunta = args[0];
  const encerraEm = args[1];
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(encerraEm)) return bot.sendMessage(chatId, '❌ Data inválida. Use: `AAAA-MM-DD HH:MM`');
  const info = db.prepare('INSERT INTO mercados (pergunta, encerra_em) VALUES (?, ?)').run(pergunta, encerraEm);
  bot.sendMessage(chatId, `✅ Mercado #${info.lastInsertRowid} criado com sucesso!\nPergunta: ${pergunta}\nEncerra em: ${encerraEm}`);
});

bot.onText(/\/resolver (\d+) (sim|nao)/i, (msg, match) => {
  const chatId = msg.chat.id;
  if (chatId !== ADMIN_ID) return bot.sendMessage(chatId, '⛔ Comando restrito ao administrador.');
  const mercadoId = parseInt(match[1]);
  const resultado = match[2].toLowerCase();
  const mercado = db.prepare('SELECT * FROM mercados WHERE id = ?').get(mercadoId);
  if (!mercado) return bot.sendMessage(chatId, '❌ Mercado não encontrado.');
  if (mercado.status === 'encerrado') return bot.sendMessage(chatId, '❌ Mercado já foi encerrado.');
  db.prepare('UPDATE mercados SET status = ?, resultado = ? WHERE id = ?').run('encerrado', resultado, mercadoId);
  const posicoes = db.prepare('SELECT * FROM posicoes WHERE mercado_id = ?').all(mercadoId);
  const updateSaldo = db.prepare('UPDATE usuarios SET saldo = saldo + ? WHERE id = ?');
  const marcarPago = db.prepare('UPDATE posicoes SET pago = 1 WHERE id = ?');
  db.transaction(() => {
    for (const pos of posicoes) {
      const acertou = pos.lado === resultado;
      let mensagem = '';
      if (acertou) {
        const ganho = Math.floor(pos.valor * 1.8);
        updateSaldo.run(ganho, pos.usuario_id);
        mensagem = `🎉 Você *ACERTOU* no mercado #${mercadoId} (${mercado.pergunta})!\n+${ganho} pts adicionados à sua conta.`;
      } else {
        mensagem = `😔 Você *ERROU* no mercado #${mercadoId} (${mercado.pergunta}).\nTente nos próximos prognósticos!`;
      }
      marcarPago.run(pos.id);
      bot.sendMessage(pos.usuario_id, mensagem, { parse_mode: 'Markdown' }).catch(e => console.error(`Falha ao notificar ${pos.usuario_id}:`, e.message));
    }
  })();
  bot.sendMessage(chatId, `✅ Mercado #${mercadoId} resolvido como *${resultado.toUpperCase()}*. Todos os apostadores foram notificados.`, { parse_mode: 'Markdown' });
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const texto = msg.text;
  if (texto && texto.startsWith('/')) return;
  if (texto && /^#\d+/.test(texto)) return bot.sendMessage(chatId, '❓ Formato de aposta incorreto. Use: `#1 10 sim` ou `#2 50 nao`', { parse_mode: 'Markdown' });
  bot.sendMessage(chatId, `❓ Não entendi. Para apostar use o formato:\n*#1 10 sim* ou *#2 50 nao*\n\nUse /mercados para ver os prognósticos abertos.`, { parse_mode: 'Markdown' });
});

console.log('🤖 Bot Prever v2.0 iniciado com SQLite.');

