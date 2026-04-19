const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const path = require('path');

const TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID || '0');
const SALDO_INICIAL = 1000;

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new Database(path.join(__dirname, 'prever.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    nome TEXT,
    saldo REAL DEFAULT ${SALDO_INICIAL}
  );
  CREATE TABLE IF NOT EXISTS mercados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pergunta TEXT NOT NULL,
    preco_sim REAL DEFAULT 0.50,
    preco_nao REAL DEFAULT 0.50,
    status TEXT DEFAULT 'aberto',
    resultado TEXT
  );
  CREATE TABLE IF NOT EXISTS posicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    mercado_id INTEGER,
    lado TEXT,
    cotas REAL,
    custo REAL,
    pago INTEGER DEFAULT 0
  );
`);

function getUsuario(id, nome) {
  let u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id);
  if (!u) { db.prepare('INSERT INTO usuarios(id,nome) VALUES(?,?)').run(id, nome); u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id); }
  return u;
}

bot.onText(/\/start/, msg => {
  const u = getUsuario(msg.from.id, msg.from.first_name);
  bot.sendMessage(msg.chat.id, `🎯 Bem-vindo ao Prever Bot, ${u.nome}!\nSaldo: ${u.saldo} pts\n\nUse /mercados para ver apostas abertas.`);
});

bot.onText(/\/saldo/, msg => {
  const u = getUsuario(msg.from.id, msg.from.first_name);
  bot.sendMessage(msg.chat.id, `💰 Seu saldo: ${u.saldo} pts`);
});

bot.onText(/\/mercados/, msg => {
  const mercados = db.prepare("SELECT * FROM mercados WHERE status='aberto'").all();
  if (!mercados.length) return bot.sendMessage(msg.chat.id, 'Nenhum mercado aberto.');
  let txt = '📊 *Mercados abertos:*\n\n';
  mercados.forEach(m => { txt += `#${m.id} ${m.pergunta}\n✅ SIM: ${(m.preco_sim*100).toFixed(0)}% | ❌ NÃO: ${(m.preco_nao*100).toFixed(0)}%\nResponda: _10 sim_ ou _10 nao_\n\n`; });
  bot.sendMessage(msg.chat.id, txt, {parse_mode:'Markdown'});
});

bot.onText(/\/ranking/, msg => {
  const top = db.prepare('SELECT nome, saldo FROM usuarios ORDER BY saldo DESC LIMIT 10').all();
  let txt = '🏆 *Ranking:*\n';
  top.forEach((u,i) => { txt += `${i+1}. ${u.nome}: ${u.saldo} pts\n`; });
  bot.sendMessage(msg.chat.id, txt, {parse_mode:'Markdown'});
});

bot.onText(/^(\d+)\s+(sim|nao)$/i, (msg, match) => {
  const u = getUsuario(msg.from.id, msg.from.first_name);
  const valor = parseInt(match[1]);
  const lado = match[2].toLowerCase();
  const mercados = db.prepare("SELECT * FROM mercados WHERE status='aberto'").all();
  if (!mercados.length) return bot.sendMessage(msg.chat.id, 'Nenhum mercado aberto.');
  const m = mercados[0];
  if (u.saldo < valor) return bot.sendMessage(msg.chat.id, '❌ Saldo insuficiente.');
  db.prepare('UPDATE usuarios SET saldo=saldo-? WHERE id=?').run(valor, u.id);
  db.prepare('INSERT INTO posicoes(usuario_id,mercado_id,lado,cotas,custo) VALUES(?,?,?,?,?)').run(u.id, m.id, lado, valor, valor);
  bot.sendMessage(msg.chat.id, `✅ Aposta de ${valor} pts em *${lado.toUpperCase()}* no mercado #${m.id}!`, {parse_mode:'Markdown'});
});

bot.onText(/\/admin/, msg => {
  if (msg.from.id !== ADMIN_ID) return;
  const mercados = db.prepare('SELECT * FROM mercados').all();
  let txt = '🔧 *Admin — Mercados:*\n\n';
  mercados.forEach(m => { txt += `#${m.id} [${m.status}] ${m.pergunta}\n`; });
  txt += '\n_/resolver <id> <sim|nao>_\n_/novo Pergunta? 0.62_';
  bot.sendMessage(msg.from.id, txt, {parse_mode:'Markdown'});
});

bot.onText(/\/resolver (\d+) (sim|nao)/i, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const id = parseInt(match[1]);
  const resultado = match[2].toLowerCase();
  db.prepare("UPDATE mercados SET status='resolvido', resultado=? WHERE id=?").run(resultado, id);
  const vencedores = db.prepare("SELECT * FROM posicoes WHERE mercado_id=? AND lado=? AND pago=0").all(id, resultado);
  vencedores.forEach(p => { db.prepare('UPDATE usuarios SET saldo=saldo+? WHERE id=?').run(p.custo * 1.8, p.usuario_id); db.prepare('UPDATE posicoes SET pago=1 WHERE id=?').run(p.id); });
  bot.sendMessage(msg.from.id, `✅ Mercado #${id} resolvido: ${resultado.toUpperCase()}. ${vencedores.length} vencedores pagos.`);
});

bot.onText(/\/novo (.+) ([\d.]+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const pergunta = match[1];
  const preco = parseFloat(match[2]);
  db.prepare('INSERT INTO mercados(pergunta,preco_sim,preco_nao) VALUES(?,?,?)').run(pergunta, preco, 1-preco);
  bot.sendMessage(msg.from.id, `✅ Mercado criado: ${pergunta}`);
});

console.log('🚀 Prever bot iniciado!');
