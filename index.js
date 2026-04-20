const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0');

const bot = new TelegramBot(TOKEN, { polling: true });

const usuarios = {};
const mercados = [
  { id:1, pergunta:'Dólar fecha acima de R$5,80 hoje?', sim:62, nao:38, status:'aberto' },
  { id:2, pergunta:'Vai chover em São Paulo amanhã?', sim:45, nao:55, status:'aberto' },
  { id:3, pergunta:'Bitcoin sobe acima de $90k esta semana?', sim:38, nao:62, status:'aberto' },
];
const posicoes = [];

function getUser(id, nome) {
  if (!usuarios[id]) usuarios[id] = { nome, saldo: 1000 };
  return usuarios[id];
}

bot.onText(/\/start/, msg => {
  const u = getUser(msg.from.id, msg.from.first_name);
  bot.sendMessage(msg.chat.id, `🎯 Bem-vindo ao Prever Bot, ${u.nome}!\nSaldo: ${u.saldo} pts\n\nUse /mercados para ver apostas abertas.\n\nPara apostar: _#1 10 sim_ ou _#2 50 nao_`, { parse_mode: 'Markdown' });
});

bot.onText(/\/saldo/, msg => {
  const u = getUser(msg.from.id, msg.from.first_name);
  bot.sendMessage(msg.chat.id, `💰 Seu saldo: ${u.saldo} pts`);
});

bot.onText(/\/mercados/, msg => {
  const abertos = mercados.filter(m => m.status === 'aberto');
  if (!abertos.length) return bot.sendMessage(msg.chat.id, 'Nenhum mercado aberto.');
  let txt = '📊 *Mercados abertos:*\n\n';
  abertos.forEach(m => { txt += `#${m.id} ${m.pergunta}\n✅ SIM: ${m.sim}% | ❌ NÃO: ${m.nao}%\nAposte: _#${m.id} 10 sim_ ou _#${m.id} 10 nao_\n\n`; });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: 'Markdown' });
});

bot.onText(/\/ranking/, msg => {
  const top = Object.values(usuarios).sort((a,b) => b.saldo - a.saldo).slice(0,10);
  let txt = '🏆 *Ranking:*\n';
  top.forEach((u,i) => { txt += `${i+1}. ${u.nome}: ${u.saldo} pts\n`; });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: 'Markdown' });
});

bot.onText(/^#(\d+)\s+(\d+)\s+(sim|nao)$/i, (msg, match) => {
  const u = getUser(msg.from.id, msg.from.first_name);
  const mercadoId = parseInt(match[1]);
  const valor = parseInt(match[2]);
  const lado = match[3].toLowerCase();
  const m = mercados.find(m => m.id === mercadoId && m.status === 'aberto');
  if (!m) return bot.sendMessage(msg.chat.id, `❌ Mercado #${mercadoId} não encontrado ou já encerrado.`);
  if (u.saldo < valor) return bot.sendMessage(msg.chat.id, `❌ Saldo insuficiente. Você tem ${u.saldo} pts.`);
  u.saldo -= valor;
  posicoes.push({ userId: msg.from.id, mercadoId, lado, valor });
  bot.sendMessage(msg.chat.id, `✅ Aposta de ${valor} pts em *${lado.toUpperCase()}* no mercado #${mercadoId}!\n📋 ${m.pergunta}\n\n💰 Saldo restante: *${u.saldo} pts*`, { parse_mode: 'Markdown' });
});

console.log('🚀 Prever bot iniciado!');
