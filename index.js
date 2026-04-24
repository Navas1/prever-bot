const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const SALDO_INICIAL = 1000;

if (!TOKEN) { console.error('❌ TELEGRAM_TOKEN não definido!'); process.exit(1); }
if (!ADMIN_ID) { console.error('❌ ADMIN_ID não definido!'); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });

// ── BANCO EM MEMÓRIA ──────────────────────────────────────
let usuarios = {};   // { telegramId: { nome, saldo, posicoes: [{mercadoId, lado, valor, odd}] } }
let mercados = {};   // { id: { pergunta, preco_sim, preco_nao, resultado, criado_em } }
let nextMercado = 1;
let apostas = [];    // [{userId, mercadoId, lado, valor, odd, resolvida}]

// ── HELPERS ───────────────────────────────────────────────
function getUser(id, nome) {
  if (!usuarios[id]) {
    usuarios[id] = { nome: nome || 'Usuário', saldo: SALDO_INICIAL, posicoes: [] };
  }
  return usuarios[id];
}

function formatMercado(id, m) {
  const abertas = apostas.filter(a => a.mercadoId === id && !a.resolvida);
  const totalSim = abertas.filter(a => a.lado === 'sim').reduce((s, a) => s + a.valor, 0);
  const totalNao = abertas.filter(a => a.lado === 'nao').reduce((s, a) => s + a.valor, 0);
  const status = m.resultado ? `✅ Encerrado: *${m.resultado.toUpperCase()}*` : '🟢 Aberto';
  return `*#${id}* — ${m.pergunta}\n` +
    `SIM ${Math.round(m.preco_sim * 100)}¢ · NÃO ${Math.round(m.preco_nao * 100)}¢\n` +
    `Pool: 💚${totalSim}pts · ❤️${totalNao}pts · ${status}`;
}

// ── /start ────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const u = getUser(msg.from.id, msg.from.first_name);
  bot.sendMessage(msg.chat.id,
    `🎯 *Bem-vindo ao Prever!*\n\n` +
    `Olá, *${u.nome}*! Você tem *${u.saldo} pontos* para apostar.\n\n` +
    `📋 */mercados* — ver mercados abertos\n` +
    `💰 */saldo* — seu saldo e posições\n` +
    `🏆 */ranking* — leaderboard\n\n` +
    `_Para apostar, responda a mensagem de um mercado com:_\n` +
    `\`10 sim\` ou \`10 nao\``,
    { parse_mode: 'Markdown' }
  );
});

// ── /saldo ────────────────────────────────────────────────
bot.onText(/\/saldo/, (msg) => {
  const u = getUser(msg.from.id, msg.from.first_name);
  const abertas = apostas.filter(a => a.userId === msg.from.id && !a.resolvida);
  let txt = `💰 *Seu saldo:* ${u.saldo} pts\n\n`;
  if (abertas.length === 0) {
    txt += '_Nenhuma posição aberta._';
  } else {
    txt += `*Posições abertas (${abertas.length}):*\n`;
    abertas.forEach(a => {
      const m = mercados[a.mercadoId];
      txt += `• #${a.mercadoId} ${m?.pergunta?.slice(0,30)}... → *${a.lado.toUpperCase()}* ${a.valor}pts @ ${Math.round(a.odd * 100)}¢\n`;
    });
  }
  bot.sendMessage(msg.chat.id, txt, { parse_mode: 'Markdown' });
});

// ── /mercados ─────────────────────────────────────────────
bot.onText(/\/mercados/, (msg) => {
  const abertos = Object.entries(mercados).filter(([, m]) => !m.resultado);
  if (abertos.length === 0) {
    bot.sendMessage(msg.chat.id, '📭 Nenhum mercado aberto no momento. Volte em breve!');
    return;
  }
  abertos.forEach(([id, m]) => {
    bot.sendMessage(msg.chat.id,
      `📊 ${formatMercado(id, m)}\n\n_Responda esta mensagem com:_ \`10 sim\` _ou_ \`10 nao\``,
      { parse_mode: 'Markdown', reply_markup: {
        inline_keyboard: [
          [{ text: `✅ SIM — ${Math.round(m.preco_sim * 100)}¢`, callback_data: `apostar_${id}_sim` },
           { text: `❌ NÃO — ${Math.round(m.preco_nao * 100)}¢`, callback_data: `apostar_${id}_nao` }]
        ]
      }}
    );
  });
});

// ── /ranking ──────────────────────────────────────────────
bot.onText(/\/ranking/, (msg) => {
  const lista = Object.entries(usuarios)
    .sort(([, a], [, b]) => b.saldo - a.saldo)
    .slice(0, 10);
  if (lista.length === 0) {
    bot.sendMessage(msg.chat.id, '🏆 Ranking vazio ainda!');
    return;
  }
  const emojis = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  let txt = `🏆 *Ranking Prever*\n\n`;
  lista.forEach(([, u], i) => {
    txt += `${emojis[i]} *${u.nome}* — ${u.saldo} pts\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: 'Markdown' });
});

// ── APOSTAR via reply de texto ────────────────────────────
bot.on('message', (msg) => {
  if (!msg.reply_to_message || !msg.text) return;
  const match = msg.text.trim().match(/^(\d+)\s+(sim|nao|não|s|n)$/i);
  if (!match) return;

  const valor = parseInt(match[1]);
  const lado = match[2].toLowerCase().replace('não','nao').replace('s','sim').replace('n','nao');

  // Descobrir mercadoId da mensagem respondida
  const textoOriginal = msg.reply_to_message.text || '';
  const idMatch = textoOriginal.match(/#(\d+)/);
  if (!idMatch) return;
  const mercadoId = parseInt(idMatch[1]);
  const m = mercados[mercadoId];
  if (!m || m.resultado) {
    bot.sendMessage(msg.chat.id, '⚠️ Este mercado já foi encerrado.');
    return;
  }

  const u = getUser(msg.from.id, msg.from.first_name);
  if (u.saldo < valor) {
    bot.sendMessage(msg.chat.id, `❌ Saldo insuficiente! Você tem *${u.saldo} pts*.`, { parse_mode: 'Markdown' });
    return;
  }
  if (valor < 1) {
    bot.sendMessage(msg.chat.id, '❌ Aposta mínima: 1 ponto.');
    return;
  }

  const odd = lado === 'sim' ? m.preco_sim : m.preco_nao;
  u.saldo -= valor;
  apostas.push({ userId: msg.from.id, mercadoId, lado, valor, odd, resolvida: false });

  bot.sendMessage(msg.chat.id,
    `✅ *Aposta registrada!*\n\n` +
    `📊 #${mercadoId} — ${lado.toUpperCase()}\n` +
    `💰 ${valor} pts @ ${Math.round(odd * 100)}¢\n` +
    `🏦 Saldo restante: ${u.saldo} pts`,
    { parse_mode: 'Markdown' }
  );
});

// ── APOSTAR via botão inline ──────────────────────────────
bot.on('callback_query', (cb) => {
  const [, id, lado] = cb.data.split('_');
  const mercadoId = parseInt(id);
  const m = mercados[mercadoId];
  if (!m || m.resultado) {
    bot.answerCallbackQuery(cb.id, { text: 'Mercado encerrado!' });
    return;
  }
  bot.answerCallbackQuery(cb.id);
  bot.sendMessage(cb.from.id,
    `Quanto quer apostar em *${lado.toUpperCase()}* no mercado #${mercadoId}?\n\nResponda com o valor: ex. \`50\``,
    { parse_mode: 'Markdown' }
  );
  // Aguarda próxima mensagem como valor
  bot.once('message', (msg) => {
    if (msg.from.id !== cb.from.id) return;
    const valor = parseInt(msg.text);
    if (!valor || valor < 1) { bot.sendMessage(msg.chat.id, '❌ Valor inválido.'); return; }
    const u = getUser(msg.from.id, msg.from.first_name);
    if (u.saldo < valor) {
      bot.sendMessage(msg.chat.id, `❌ Saldo insuficiente! Você tem *${u.saldo} pts*.`, { parse_mode: 'Markdown' });
      return;
    }
    const odd = lado === 'sim' ? m.preco_sim : m.preco_nao;
    u.saldo -= valor;
    apostas.push({ userId: msg.from.id, mercadoId, lado, valor, odd, resolvida: false });
    bot.sendMessage(msg.chat.id,
      `✅ *Aposta registrada!*\n📊 #${mercadoId} — ${lado.toUpperCase()}\n💰 ${valor} pts @ ${Math.round(odd * 100)}¢\n🏦 Saldo: ${u.saldo} pts`,
      { parse_mode: 'Markdown' }
    );
  });
});

// ── /admin ────────────────────────────────────────────────
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const todos = Object.entries(mercados);
  if (todos.length === 0) {
    bot.sendMessage(msg.chat.id, '📭 Nenhum mercado criado ainda.\n\n_Use /novo Pergunta? 0.62_', { parse_mode: 'Markdown' });
    return;
  }
  let txt = `🔧 *Painel Admin*\n\n`;
  todos.forEach(([id, m]) => {
    const status = m.resultado ? `✅ ${m.resultado}` : '🟢 aberto';
    txt += `*#${id}* ${status}\n${m.pergunta}\n`;
    txt += `_/resolver ${id} sim_ ou _/resolver ${id} nao_\n\n`;
  });
  txt += `_/novo Pergunta? 0.62_ para criar mercado`;
  bot.sendMessage(msg.chat.id, txt, { parse_mode: 'Markdown' });
});

// ── /novo ─────────────────────────────────────────────────
bot.onText(/\/novo (.+?) ([\d.]+)$/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const pergunta = match[1].trim();
  const preco_sim = parseFloat(match[2]);
  if (preco_sim <= 0 || preco_sim >= 1) {
    bot.sendMessage(msg.chat.id, '❌ Preço deve ser entre 0.01 e 0.99\nEx: /novo Dólar passa de R$6? 0.35');
    return;
  }
  const id = nextMercado++;
  mercados[id] = { pergunta, preco_sim, preco_nao: parseFloat((1 - preco_sim).toFixed(2)), resultado: null, criado_em: new Date() };
  bot.sendMessage(msg.chat.id,
    `✅ *Mercado #${id} criado!*\n\n${pergunta}\nSIM: ${Math.round(preco_sim * 100)}¢ · NÃO: ${Math.round((1 - preco_sim) * 100)}¢`,
    { parse_mode: 'Markdown' }
  );
});

// ── /resolver ─────────────────────────────────────────────
bot.onText(/\/resolver (\d+) (sim|nao|não)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const id = parseInt(match[1]);
  const resultado = match[2].replace('não','nao');
  const m = mercados[id];
  if (!m) { bot.sendMessage(msg.chat.id, `❌ Mercado #${id} não encontrado.`); return; }
  if (m.resultado) { bot.sendMessage(msg.chat.id, `⚠️ Mercado #${id} já foi resolvido: ${m.resultado}`); return; }

  m.resultado = resultado;
  let vencedores = 0, pagos = 0;

  apostas.forEach(a => {
    if (a.mercadoId !== id || a.resolvida) return;
    a.resolvida = true;
    if (a.lado === resultado) {
      const ganho = Math.round(a.valor / a.odd);
      const u = usuarios[a.userId];
      if (u) { u.saldo += ganho; vencedores++; pagos += ganho; }
    }
  });

  bot.sendMessage(msg.chat.id,
    `✅ *Mercado #${id} resolvido: ${resultado.toUpperCase()}*\n\n` +
    `🏆 ${vencedores} vencedor(es) · 💰 ${pagos} pts distribuídos`,
    { parse_mode: 'Markdown' }
  );
});

// ── ERRO HANDLING ─────────────────────────────────────────
bot.on('polling_error', (err) => console.error('Polling error:', err.message));

console.log('🚀 Prever bot iniciado! Admin ID:', ADMIN_ID);
