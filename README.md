# 🎯 Prever Bot — MVP

Mercado de prognóstico no Telegram. Jogo social de prever o futuro.

---

## 🚀 Instalação rápida

### 1. Instalar Node.js
Acesse https://nodejs.org e instale a versão LTS (20.x)

### 2. Criar bot no Telegram
- Abra o Telegram e fale com @BotFather
- Envie: /newbot
- Escolha um nome: ex. "Prever Bot"
- Escolha um username: ex. "prever_mvp_bot"
- Copie o TOKEN que ele te dá

### 3. Descobrir seu Telegram ID (para ser admin)
- Fale com @userinfobot no Telegram
- Ele te mostra seu ID numérico

### 4. Configurar o projeto
```bash
# Clonar / baixar os arquivos na pasta prever/
cd prever

# Instalar dependências
npm install

# Criar arquivo de configuração
cp .env.example .env

# Editar .env com seu token e ID
# TELEGRAM_TOKEN=1234567890:ABCdef...
# ADMIN_ID=987654321
```

### 5. Rodar localmente
```bash
node index.js
```

Se aparecer `🚀 Prever bot iniciado!` — funcionou!

---

## 📋 Comandos do usuário
- `/start` — cadastro + saldo inicial (1000 pts)
- `/saldo` — ver saldo e posições abertas
- `/mercados` — ver mercados ativos
- `/ranking` — leaderboard

## 💬 Como apostar
Responda qualquer mensagem com:
```
10 sim
5 nao
```

## 🔧 Comandos do admin
- `/admin` — listar todos os mercados com IDs
- `/resolver 1 sim` — resolve mercado #1 com resultado SIM
- `/novo Dólar passa de 6 reais essa semana? 0.35` — cria novo mercado

---

## 🌐 Deploy no Railway (recomendado)
1. Crie conta em railway.app
2. Novo projeto → Deploy from GitHub (ou upload pasta)
3. Adicione variáveis de ambiente: TELEGRAM_TOKEN e ADMIN_ID
4. Deploy automático!

Custo: gratuito até $5/mês de uso (suficiente para MVP)

---

## 📁 Estrutura de arquivos
```
prever/
├── index.js        # código principal do bot
├── package.json    # dependências
├── .env.example    # modelo de configuração
├── .env            # sua configuração (não compartilhe!)
└── prever.db       # banco SQLite (criado automaticamente)
```
