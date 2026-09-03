#!/bin/bash

# =============================================================
# Script de Atualização - I.A MRO
# Para Ubuntu LTS 22.04 (VPS Hostinger)
# Nota: Removido proxy_pass Lovable (flock.js) e configurado SSL 443.
# =============================================================

set -e

echo "🔄 Atualizando I.A MRO..."

APP_NAME="ia-mro"
APP_DIR="/var/www/$APP_NAME"
NGINX_SITE="/etc/nginx/sites-available/$APP_NAME"
DOMAIN="maisresultadosonline.com.br"
WPP_BOT_DIR="$APP_DIR/whatsapp-bot"
REPO_URL="https://github.com/gabrielmaisresultadosonline/zapmro-remix-03-09-2026.git"

# Sudo helper (permite rodar como root ou usuário normal)
SUDO=""
if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  SUDO="sudo"
fi

cd "$APP_DIR"

echo "📥 Baixando atualizações do GitHub..."
CURRENT_ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
if [ "$CURRENT_ORIGIN" != "$REPO_URL" ]; then
    echo "🔁 Alterando origin para o novo repositório..."
    git remote set-url origin "$REPO_URL"
fi
echo "📍 Origin atual: $(git remote get-url origin)"
git fetch origin
git reset --hard origin/main

# Garantir permissão de execução nos scripts deploy
chmod +x "$APP_DIR/deploy/"*.sh 2>/dev/null || true

# ============= Limpar legado whatsapp-server (se existir) =============
if command -v pm2 >/dev/null 2>&1; then
    pm2 delete zapmro-cloud 2>/dev/null || true
    pm2 delete whatsapp-multi 2>/dev/null || true
    pm2 save || true
fi
rm -rf "$APP_DIR/whatsapp-server" 2>/dev/null || true

echo "📦 Instalando dependências do frontend..."
npm install

echo "🔨 Fazendo build do frontend..."
# Limpa o dist antigo para garantir que não fiquem arquivos velhos (cache buster)
rm -rf dist
npm run build


# ============= Bot WhatsApp (whatsapp-web.js) =============
echo ""
echo "🤖 Configurando Bot WhatsApp..."

# Instalar Chromium, FFmpeg e libs necessárias para o Puppeteer/whatsapp-web.js
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v google-chrome >/dev/null 2>&1; then
  echo "🌐 Instalando Chromium, FFmpeg e dependências..."
  $SUDO apt-get update
  $SUDO apt-get install -y \
    chromium-browser ffmpeg \
    ca-certificates fonts-liberation libappindicator3-1 libasound2 \
    libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    lsb-release wget xdg-utils --no-install-recommends 2>/dev/null || true
fi

# Instalar PM2 globalmente se não existir
if ! command -v pm2 >/dev/null 2>&1; then
  echo "📦 Instalando PM2..."
  $SUDO npm install -g pm2
fi

# Se a pasta do bot existir no repo, instalar dependências e iniciar
# Se a pasta do bot existir no repo, instalar dependências e iniciar
if [ -d "$WPP_BOT_DIR" ]; then
  echo "📦 Instalando dependências do bot WhatsApp..."
  cd "$WPP_BOT_DIR"

  # Preserva WPP_BOT_TOKEN existente (se já configurado em .env anterior)
  EXISTING_TOKEN=""
  if [ -f .env ]; then
    EXISTING_TOKEN=$(grep -E '^WPP_BOT_TOKEN=' .env | head -1 | cut -d= -f2- || true)
  fi
  # Token: prioriza variável de ambiente WPP_BOT_TOKEN; depois o já existente em .env
  BOT_TOKEN="${WPP_BOT_TOKEN:-$EXISTING_TOKEN}"

  if [ -z "$BOT_TOKEN" ] || [ "$BOT_TOKEN" = "wpp-bot-default-token-change-me" ]; then
    echo ""
    echo "❌ ERRO: WPP_BOT_TOKEN não configurado!"
    echo ""
    echo "   O token DEVE ser idêntico ao secret WPP_BOT_TOKEN configurado"
    echo "   em Lovable Cloud → Secrets."
    echo ""
    echo "   Execute novamente assim (substitua pelo valor real do secret):"
    echo "     WPP_BOT_TOKEN='seu-token-aqui' ./deploy/update.sh"
    echo ""
    exit 1
  fi

  echo "📝 Criando/atualizando .env do bot..."
  cat > .env <<ENVEOF
SUPABASE_URL=https://adljdeekwifwcdcgbpit.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkbGpkZWVrd2lmd2NkY2dicGl0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxMjk0MDMsImV4cCI6MjA4MDcwNTQwM30.odKBOAuEEW0WJEburLRTL9Qj1EbitETmhxqNoE_F_g4
WPP_BOT_TOKEN=${BOT_TOKEN}
POLL_INTERVAL=5
ENVEOF
  echo "✅ .env atualizado em $WPP_BOT_DIR/.env (token: ${BOT_TOKEN:0:10}...)"

  npm install --omit=dev

  # Forçar delete + start para garantir código novo carregado
  pm2 delete wpp-bot-mro 2>/dev/null || true
  echo "🚀 Iniciando bot WhatsApp..."
  pm2 start index.js --name wpp-bot-mro --time --cwd "$WPP_BOT_DIR"

  pm2 save
  $SUDO pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

  cd "$APP_DIR"
else
  echo "⚠️  Pasta whatsapp-bot/ não encontrada — pulando instalação do bot."
fi

# ============= Limpeza de Processos Antigos =============
if [ -d "$WPP_BOT_DIR" ]; then
  echo "🧹 Limpando processos antigos na porta 3000..."
  # Tenta matar qualquer processo rodando na porta 3000 (bridge antigo ou bot travado)
  $SUDO fuser -k 3000/tcp 2>/dev/null || true
  
  # Garante que processos PM2 antigos sejam removidos
  pm2 delete wpp-bridge-mro 2>/dev/null || true
  pm2 delete wpp-bot 2>/dev/null || true
  pm2 save
fi

# ============= Nginx =============
echo ""
echo "🧩 Verificando conflitos de Nginx..."

# 🚨 RESOLVER CONFLITO: Remove ou altera o whatsapp-bridge se ele usar o mesmo domínio
# Agora que o ia-mro já tem o proxy para /bridge na porta 3000, não precisamos do config antigo.
WPP_BRIDGE_NGINX="/etc/nginx/sites-enabled/whatsapp-bridge"
if [ -f "$WPP_BRIDGE_NGINX" ]; then
    echo "⚠️  Removendo configuração conflitante em $WPP_BRIDGE_NGINX..."
    $SUDO rm -f "$WPP_BRIDGE_NGINX"
fi

# Remove também qualquer resquício de default ou configs duplicadas que possam conflitar
$SUDO rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true


# SÓ atualiza Nginx se o usuário permitir ou se for necessário para o /bridge
echo "🛠️  Configurando Nginx para servir o build LOCAL (Sem Proxys Lovable)..."

# Garante que NENHUM outro arquivo na sites-enabled aponte para o domínio
# Isso evita que o antigo 'prompt-mro' ou 'prompts-mro' (proxys) voltem à vida
$SUDO find /etc/nginx/sites-enabled/ -type l -exec grep -l "$DOMAIN" {} + | xargs -r $SUDO rm -f
$SUDO rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Cria a configuração limpa e direta
$SUDO tee "$NGINX_SITE" > /dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root $APP_DIR/dist;
    index index.html;

    # SEGURANÇA: NUNCA adicionar proxy_pass para lovable aqui
    
    # Bridge para Áudio (Porta 3000)
    location /bridge/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # SPA Routing (O coração do funcionamento local)
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
EOF

# Ativa a configuração
$SUDO ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/$APP_NAME"

echo "🔄 Reiniciando Nginx..."
$SUDO nginx -t && $SUDO systemctl restart nginx


echo ""
echo "✨ Verificação Final:"
echo "📂 Pasta dist: $(ls -ld $APP_DIR/dist/index.html 2>/dev/null || echo '❌ dist não encontrada')"
echo "🔍 Conteúdo do index (primeiras linhas):"
head -n 20 $APP_DIR/dist/index.html | grep -E "assets/index" || echo "⚠️  Nomes fixos não encontrados no index.html local"

echo ""
echo "🧪 Teste de Conectividade Local:"
# Testa se o nginx está servindo o arquivo certo sem o proxy do Lovable
curl -s http://localhost | grep -q "flock" && echo "❌ ERRO: Conteúdo Lovable detectado!" || echo "✅ OK: Conteúdo Lovable removido."
curl -s http://localhost | grep -q "assets/index.js" && echo "✅ OK: Assets corretos detectados." || echo "❌ ERRO: Assets não encontrados no HTML servido."

echo ""
echo "✅ Atualização concluída!"
echo "🌐 Site: https://$DOMAIN"
echo ""
echo "🚀 IMPORTANTE: Se o site ainda mostrar a página branca ou erro 404:"
echo "   1. No painel da CLOUDFLARE: Cache -> Purge Everything (Limpar tudo)"
echo "   2. No seu NAVEGADOR: Pressione CTRL + SHIFT + R (Hard Refresh)"
echo ""
echo "🤖 Bot WhatsApp:"
echo "   Status:  pm2 status wpp-bot-mro"
echo "   Logs:    pm2 logs wpp-bot-mro"

echo ""
