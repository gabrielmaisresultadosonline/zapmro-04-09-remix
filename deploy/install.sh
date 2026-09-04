#!/bin/bash

# =============================================================
# Script de Instalação Automática - I.A MRO
# Para Ubuntu LTS (VPS Hostinger)
# Repositório: https://github.com/gabrielmaisresultadosonline/zapmro-04-09-remix.git
# Domínio: zapmro.com.br
# =============================================================

set -e

echo "🚀 Iniciando instalação do I.A MRO..."

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Variáveis
APP_NAME="ia-mro"
APP_DIR="/var/www/$APP_NAME"
DOMAIN="${1:-zapmro.com.br}"
REPO_URL="https://github.com/gabrielmaisresultadosonline/zapmro-04-09-remix.git"

echo -e "${YELLOW}Atualizando sistema...${NC}"
sudo apt update && sudo apt upgrade -y

echo -e "${YELLOW}Instalando dependências do sistema...${NC}"
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Instalar Node.js 20 LTS
echo -e "${YELLOW}Instalando Node.js 20 LTS...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar versões
echo -e "${GREEN}Node.js: $(node -v)${NC}"
echo -e "${GREEN}NPM: $(npm -v)${NC}"

# Criar diretório da aplicação
echo -e "${YELLOW}Criando diretório da aplicação...${NC}"
sudo mkdir -p /var/www
cd /var/www

# Clonar ou atualizar repositório
echo -e "${YELLOW}Clonando/Atualizando repositório...${NC}"
if [ -d "$APP_NAME" ]; then
    cd $APP_NAME
    CURRENT_ORIGIN="$(git remote get-url origin 2>/dev/null || true)"
    if [ "$CURRENT_ORIGIN" != "$REPO_URL" ]; then
        echo -e "${YELLOW}Alterando origin para o novo repositório...${NC}"
        git remote set-url origin "$REPO_URL"
    fi
    echo -e "${GREEN}Origin atual: $(git remote get-url origin)${NC}"
    git fetch origin
    git reset --hard origin/main
else
    git clone $REPO_URL $APP_NAME
    cd $APP_NAME
fi

sudo chown -R $USER:$USER $APP_DIR

# ============= Limpar legado whatsapp-server (se existir) =============
if command -v pm2 >/dev/null 2>&1; then
    pm2 delete zapmro-cloud 2>/dev/null || true
    pm2 delete whatsapp-multi 2>/dev/null || true
    pm2 save || true
fi
rm -rf "$APP_DIR/whatsapp-server" 2>/dev/null || true

# ============= Frontend =============
echo -e "${YELLOW}Instalando dependências do frontend...${NC}"
npm install

echo -e "${YELLOW}Fazendo build do frontend...${NC}"
npm run build

# Configurar Nginx
echo -e "${YELLOW}Configurando Nginx...${NC}"
sudo tee /etc/nginx/sites-available/$APP_NAME > /dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    root $APP_DIR/dist;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private auth;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml application/javascript application/json;

    # Proxy para o Bridge (Transcoder de Áudio)
    location /bridge {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        
        # CORS Headers
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;
        
        if (\$request_method = 'OPTIONS') {
            add_header 'Access-Control-Max-Age' 1728000;
            add_header 'Content-Type' 'text/plain; charset=utf-8';
            add_header 'Content-Length' 0;
            return 204;
        }
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA routing
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
EOF

# Ativar site
sudo ln -sf /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Testar e reiniciar Nginx
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

echo ""
echo -e "${GREEN}✅ Instalação concluída!${NC}"
echo ""
echo -e "${YELLOW}📌 Configurando SSL com Let's Encrypt...${NC}"
sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || {
    echo -e "${YELLOW}⚠️  SSL não configurado automaticamente. Execute manualmente:${NC}"
    echo "   sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
}

echo ""
echo -e "${GREEN}✅ Tudo pronto!${NC}"
echo ""
echo "🌐 Frontend: https://$DOMAIN"
echo ""
echo "📝 Para atualizar futuramente, execute:"
echo "   cd $APP_DIR && bash deploy/update.sh"
echo ""
