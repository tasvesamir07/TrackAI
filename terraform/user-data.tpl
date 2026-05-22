#!/bin/bash
# user-data.tpl - EC2 instance bootstrap script

set -e

echo "Starting bootstrap for ${project_name} (${environment})"

# Update and install prerequisites
apt-get update
apt-get upgrade -y
apt-get install -y \
    curl \
    wget \
    git \
    docker.io \
    docker-compose \
    nginx \
    certbot \
    python3-certbot-nginx

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Add current user to docker group
usermod -aG docker $USER

# Configure firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Create application directory
mkdir -p /opt/${project_name}
cd /opt/${project_name}

# Clone repository (configure your repo URL)
# git clone <your-repo-url> .

# Create docker-compose.yml from template
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-trackai}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    networks:
      - app-network

  server:
    build: ./server
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD}@db:5432/${DB_NAME:-trackai}
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
    depends_on:
      - db
      - redis
    networks:
      - app-network

  client:
    build: ./client
    ports:
      - "80:80"
    depends_on:
      - server
    networks:
      - app-network

networks:
  app-network:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
EOF

# Create environment file
cat > .env << EOF
DB_NAME=trackai
DB_USER=postgres
DB_PASSWORD=${DB_PASSWORD:-changeme}
JWT_SECRET=${JWT_SECRET:-changeme}
SENTRY_DSN=${SENTRY_DSN:-}
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-}
SMTP_USER=${SMTP_USER:-}
SMTP_PASS=${SMTP_PASS:-}
EOF

# Setup Nginx with SSL
cat > /etc/nginx/sites-available/${project_name} << 'EOF'
server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://localhost:80;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/${project_name} /etc/nginx/sites-enabled/
nginx -t

# Enable and start services
systemctl enable nginx
systemctl restart nginx

# Setup logrotate
cat > /etc/logrotate.d/${project_name} << 'EOF'
/opt/${project_name}/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root root
    sharedscripts
}
EOF

# Pull latest images (if using pre-built)
# docker-compose pull

echo "Bootstrap complete!"
echo "Next steps:"
echo "1. Configure your repository in /opt/${project_name}"
echo "2. Update .env with your actual values"
echo "3. Run: cd /opt/${project_name} && docker-compose up -d"