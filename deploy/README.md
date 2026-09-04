# Deploy I.A MRO - Ubuntu VPS (Hostinger)

## 🚀 Instalação Rápida (1 comando)

Conecte via SSH na sua VPS e execute:

```bash
# 1. Baixe e execute o script de instalação
curl -fsSL https://raw.githubusercontent.com/gabrielmaisresultadosonline/zapmro-crm-whatsapp-profissional/main/deploy/install.sh | bash -s zapmro.com.br
```

## 📋 Instalação Manual Passo a Passo

### 1. Conectar na VPS via SSH

```bash
ssh root@SEU_IP_HOSTINGER
```

### 2. Atualizar sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### 3. Instalar dependências

```bash
# Git, Nginx, Certbot
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 4. Clonar repositório

```bash
cd /var/www
git clone https://github.com/gabrielmaisresultadosonline/zapmro-04-09-remix.git ia-mro
cd ia-mro
```

### 5. Instalar e fazer build

```bash
npm install
npm run build
```

### 6. Configurar Nginx

```bash
sudo nano /etc/nginx/sites-available/ia-mro
```

Cole esta configuração:

```nginx
server {
    listen 80;
    server_name zapmro.com.br;
    root /var/www/ia-mro/dist;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 7. Ativar site

```bash
sudo ln -sf /etc/nginx/sites-available/ia-mro /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 8. SSL Gratuito (Let's Encrypt)

```bash
sudo certbot --nginx -d zapmro.com.br
```

## 🔄 Atualizar Aplicação

```bash
cd /var/www/ia-mro
git pull origin main
npm install
npm run build
```

Ou execute o script:

```bash
bash /var/www/ia-mro/deploy/update.sh
```

## 🔧 Comandos Úteis

```bash
# Ver status do Nginx
sudo systemctl status nginx

# Ver logs de erro
sudo tail -f /var/log/nginx/error.log

# Reiniciar Nginx
sudo systemctl restart nginx

# Testar configuração Nginx
sudo nginx -t
```

## 📝 Variáveis de Ambiente

Se precisar de variáveis de ambiente, crie um arquivo `.env` na raiz:

```bash
cd /var/www/ia-mro
nano .env
```

Adicione suas variáveis (exemplo):
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJxxx
```

Depois refaça o build:
```bash
npm run build
```

## ❓ Problemas Comuns

### Erro 502 Bad Gateway
```bash
sudo systemctl restart nginx
```

### Página em branco
Verifique se o build foi feito corretamente:
```bash
ls -la /var/www/ia-mro/dist
```

### Rotas não funcionam
Certifique-se que o `try_files` está configurado no Nginx para redirecionar para `index.html`.

---

**Desenvolvido com ❤️ por MRO - Mais Resultados Online**

## migrar-tudo.sh — backup COMPLETO para migrar depois (offline)

Gera um pacote datado com TUDO que dá para salvar por terminal, num comando só:

```
chmod +x deploy/migrar-tudo.sh
./deploy/migrar-tudo.sh           # --dry só testa conexões
```

Variáveis (ambiente ou `~/.zapmro-migracao.conf`):
`SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `DB_URL` **ou** `POSTGRES_PASSWORD` (ou
rode em ambiente com `PGHOST/PGPASSWORD`). Opcional: `SUPABASE_SERVICE_ROLE_KEY`
(habilita auth.users/identities e baixar binários do Storage diretamente) e/ou
`ADMIN_EMAIL`/`ADMIN_PASSWORD` (fallback via Edge Function crm-central-admin).

Pacote gerado em `migracao-zapmro-<data>/`:
- `01_banco_public.sql` — tabelas, dados, funções, triggers, RLS, índices, FKs, grants, views
- `02_auth.sql` — `auth.users` + `auth.identities` (com hashes; testar login no destino)
- `03_storage_inventario.sql` — buckets + inventário de arquivos
- `04_extras.sql` — `CREATE EXTENSION` + jobs do `pg_cron`
- `05_edge-functions.zip` — código das ~118 Edge Functions + `config.toml`
- `06_storage/` — binários baixados (se `SUPABASE_SERVICE_ROLE_KEY` fornecida)
- `salvar-storage.mjs` / `restaurar-storage.mjs` — baixar/restaurar binários
- `restaurar.sh` — carrega o pacote no novo banco com `psql`
- `07_MANIFESTO.md` — secrets (nomes), webhooks, redirects, OAuth, buckets, cron
- `08_CHECKLIST.md` — o que NÃO entra e precisa ser refeito à mão (30–60 min)

> O que **não** dá para salvar em arquivo (vive em plataformas externas / segredos
> criptografados): valores dos secrets, assinatura `subscribed_apps` da Meta,
> config do app OAuth (Google Cloud / Facebook) e webhooks do InfinitePay/Z-API.
> Esses estão documentados no `08_CHECKLIST.md` para reconfiguração manual.
