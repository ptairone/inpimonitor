# Instalação na VPS (Ubuntu 24.04 - Hostinger)

## 1. Conectar à VPS via SSH

```bash
ssh root@IP_DA_VPS
```

## 2. Instalar Node.js 22 (LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node -v   # deve mostrar v22.x.x
```

## 3. Instalar PostgreSQL

```bash
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql
```

### Criar banco e usuário

```bash
sudo -u postgres psql <<EOF
CREATE USER inpi_user WITH PASSWORD 'TROQUE_ESTA_SENHA';
CREATE DATABASE inpi OWNER inpi_user;
GRANT ALL PRIVILEGES ON DATABASE inpi TO inpi_user;
EOF
```

## 4. Instalar PM2

```bash
npm install -g pm2
pm2 startup systemd -u root --hp /root   # habilita PM2 no boot
```

## 5. Instalar Nginx

```bash
apt install -y nginx
systemctl enable nginx
systemctl start nginx
```

## 6. Clonar o projeto

```bash
cd /var/www
git clone https://github.com/SEU_USUARIO/busca-inpi.git
cd busca-inpi
npm install
```

## 7. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Preencha o arquivo `.env`:

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=inpi
DB_USER=inpi_user
DB_PASSWORD=TROQUE_ESTA_SENHA
API_PORT=3000
DATA_PATH=./data/xmls
```

## 8. Criar pasta de dados

```bash
mkdir -p data/xmls
```

## 9. Executar migrations

```bash
npm run migrate
```

## 10. Iniciar o download das revistas

Este processo leva horas. Rode em background com nohup:

```bash
nohup npm run download > logs/download.log 2>&1 &
tail -f logs/download.log   # acompanhar progresso
```

Se o download for interrompido, basta rodar novamente — ele continua de onde parou.

## 11. Importar para o banco (pode rodar em paralelo ao download)

```bash
nohup npm run import > logs/import.log 2>&1 &
tail -f logs/import.log
```

## 12. Iniciar a API com PM2

```bash
pm2 start ecosystem.config.js
pm2 save   # salva para reiniciar no boot
```

## 13. Configurar Nginx como proxy reverso

```bash
nano /etc/nginx/sites-available/busca-inpi
```

Conteúdo:

```nginx
server {
    listen 80;
    server_name SEU_DOMINIO.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/busca-inpi /etc/nginx/sites-enabled/
nginx -t   # testa configuração
systemctl reload nginx
```

## 14. SSL com Let's Encrypt (opcional mas recomendado)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d SEU_DOMINIO.com
```

## Comandos úteis

```bash
pm2 status              # status da API
pm2 logs busca-inpi-api # logs em tempo real
pm2 restart busca-inpi-api

# ver quantas marcas foram importadas
psql -U inpi_user -d inpi -c "SELECT COUNT(*) FROM marcas;"

# ver progresso das revistas
psql -U inpi_user -d inpi -c "
  SELECT
    COUNT(*) FILTER (WHERE baixado) AS baixadas,
    COUNT(*) FILTER (WHERE importado) AS importadas
  FROM revistas_controle;
"
```

## Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /marcas/buscar?nome=X | Busca full-text por nome da marca |
| GET | /marcas/buscar?titular=X | Busca por titular |
| GET | /marcas/buscar?processo=X | Busca por número do processo |
| GET | /marcas/buscar?classe=X | Busca por classe Nice |
| GET | /marcas/buscar?status=X | Busca por status |
| GET | /marcas/:id | Detalhes de uma marca |
| GET | /status | Estatísticas do sistema |

Todos os endpoints aceitam `?page=1&limit=20`.
