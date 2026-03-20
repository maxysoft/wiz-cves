# Deployment Guide

This guide covers various deployment options for the Wiz CVE Scraper application.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Docker Deployment](#docker-deployment)
- [Production Deployment](#production-deployment)
- [Cloud Deployment](#cloud-deployment)
- [Monitoring and Logging](#monitoring-and-logging)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Node.js**: Version 24.x (24.14.0 recommended — see `.nvmrc`)
- **Memory**: Minimum 2GB RAM (4GB+ recommended for production)
- **Storage**: At least 1GB free space for output files
- **Network**: Stable internet connection

### Dependencies

```bash
# Install Node.js dependencies
npm install

# For Docker deployment
docker --version
docker-compose --version
```

## Local Development

### Quick Start

```bash
# Clone and setup
git clone <repository-url>
cd wiz-cve-scraper
npm install

# Copy environment configuration
cp .env.example .env

# Edit configuration as needed
nano .env

# Run development server
npm run dev
```

### Development Commands

```bash
# Start development server with auto-reload
npm run dev

# Run tests
npm test

# Run linting
npm run lint

# Start scraping (CLI)
npm run scrape -- --max-cves 10

# Start API server
npm run api
```

## Docker Deployment

### Basic Docker Setup

```bash
# Build the image
docker build -t wiz-cve-scraper .

# Run container
docker run -d \
  --name wiz-cve-scraper \
  -p 3000:3000 \
  -v $(pwd)/output:/usr/src/app/output \
  -v $(pwd)/logs:/usr/src/app/logs \
  -e NODE_ENV=production \
  wiz-cve-scraper
```

### Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f wiz-cve-scraper

# Stop services
docker-compose down

# Start with monitoring (optional)
docker-compose --profile monitoring up -d

# Start with production proxy (optional)
docker-compose --profile production up -d
```

### Docker Environment Variables

```bash
# Create docker.env file
cat > docker.env << EOF
NODE_ENV=production
BROWSER_HEADLESS=true
SCRAPING_MAX_CONCURRENCY=3
SCRAPING_DELAY_BETWEEN_REQUESTS=1000
API_PORT=3000
API_HOST=0.0.0.0
LOG_LEVEL=info
OUTPUT_ENABLE_CHECKPOINTS=true
EOF

# Use with docker run
docker run --env-file docker.env wiz-cve-scraper
```

## Production Deployment

### Server Setup

#### Ubuntu/Debian

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Install dependencies for Puppeteer
sudo apt-get install -y \
  gconf-service libasound2 libatk1.0-0 libc6 libcairo2 \
  libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 \
  libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 \
  libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
  libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 \
  libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation \
  libappindicator1 libnss3 lsb-release xdg-utils wget
```

#### CentOS/RHEL

```bash
# Update system
sudo yum update -y

# Install Node.js
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo yum install -y nodejs

# Install PM2
sudo npm install -g pm2

# Install Puppeteer dependencies
sudo yum install -y \
  pango.x86_64 libXcomposite.x86_64 libXcursor.x86_64 \
  libXdamage.x86_64 libXext.x86_64 libXi.x86_64 libXtst.x86_64 \
  cups-libs.x86_64 libXScrnSaver.x86_64 libXrandr.x86_64 \
  GConf2.x86_64 alsa-lib.x86_64 atk.x86_64 gtk3.x86_64 \
  ipa-gothic-fonts xorg-x11-fonts-100dpi xorg-x11-fonts-75dpi \
  xorg-x11-utils xorg-x11-fonts-cyrillic xorg-x11-fonts-Type1 \
  xorg-x11-fonts-misc
```

### Application Deployment

```bash
# Create application directory
sudo mkdir -p /opt/wiz-cve-scraper
sudo chown $USER:$USER /opt/wiz-cve-scraper

# Deploy application
cd /opt/wiz-cve-scraper
git clone <repository-url> .
npm ci --production

# Create production environment file
cp .env.example .env.production
# Edit .env.production with production settings

# Create directories
mkdir -p output logs checkpoints

# Set up PM2 ecosystem
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'wiz-cve-scraper-api',
    script: 'src/api.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    max_memory_restart: '1G',
    restart_delay: 4000
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Nginx Reverse Proxy

```bash
# Install Nginx
sudo apt install nginx  # Ubuntu/Debian
# sudo yum install nginx  # CentOS/RHEL

# Create Nginx configuration
sudo tee /etc/nginx/sites-available/wiz-cve-scraper << EOF
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Configuration
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    
    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/m;
    
    location / {
        limit_req zone=api burst=5 nodelay;
        
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Static files
    location /output/ {
        alias /opt/wiz-cve-scraper/output/;
        autoindex on;
        auth_basic "Restricted Access";
        auth_basic_user_file /etc/nginx/.htpasswd;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/wiz-cve-scraper /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Cloud Deployment

### AWS EC2

```bash
# Launch EC2 instance (t3.medium or larger recommended)
# Security Group: Allow ports 22 (SSH), 80 (HTTP), 443 (HTTPS)

# Connect and setup
ssh -i your-key.pem ubuntu@your-ec2-ip

# Follow Ubuntu deployment steps above

# Optional: Use AWS Application Load Balancer
# Optional: Use AWS RDS for data storage
# Optional: Use AWS S3 for output file storage
```

### Google Cloud Platform

```bash
# Create Compute Engine instance
gcloud compute instances create wiz-cve-scraper \
  --zone=us-central1-a \
  --machine-type=e2-medium \
  --image-family=ubuntu-2004-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB

# Connect and setup
gcloud compute ssh wiz-cve-scraper --zone=us-central1-a

# Follow Ubuntu deployment steps above
```

### Azure

```bash
# Create VM
az vm create \
  --resource-group myResourceGroup \
  --name wiz-cve-scraper \
  --image UbuntuLTS \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys

# Connect and setup
ssh azureuser@your-vm-ip

# Follow Ubuntu deployment steps above
```

### Kubernetes

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: wiz-cve-scraper
spec:
  replicas: 1
  selector:
    matchLabels:
      app: wiz-cve-scraper
  template:
    metadata:
      labels:
        app: wiz-cve-scraper
    spec:
      containers:
      - name: wiz-cve-scraper
        image: wiz-cve-scraper:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: BROWSER_HEADLESS
          value: "true"
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        volumeMounts:
        - name: output-volume
          mountPath: /usr/src/app/output
      volumes:
      - name: output-volume
        persistentVolumeClaim:
          claimName: wiz-cve-scraper-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: wiz-cve-scraper-service
spec:
  selector:
    app: wiz-cve-scraper
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

## Monitoring and Logging

### Application Monitoring

```bash
# PM2 monitoring
pm2 monit
pm2 logs
pm2 status

# System monitoring
top
htop
df -h
free -m
```

### Log Management

```bash
# Rotate logs
sudo tee /etc/logrotate.d/wiz-cve-scraper << EOF
/opt/wiz-cve-scraper/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 $USER $USER
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
```

### Health Checks

```bash
# Create health check script
cat > /opt/wiz-cve-scraper/health-check.sh << 'EOF'
#!/bin/bash
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ $response -eq 200 ]; then
    echo "Service is healthy"
    exit 0
else
    echo "Service is unhealthy (HTTP $response)"
    exit 1
fi
EOF

chmod +x /opt/wiz-cve-scraper/health-check.sh

# Add to crontab for monitoring
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/wiz-cve-scraper/health-check.sh") | crontab -
```

## Security Considerations

### Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw deny 3000  # Block direct access to app port

# iptables (CentOS/RHEL)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### SSL/TLS Setup

```bash
# Using Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### Environment Security

```bash
# Secure environment file
chmod 600 .env.production

# Use secrets management in production
# - AWS Secrets Manager
# - Azure Key Vault
# - Google Secret Manager
# - HashiCorp Vault
```

## Troubleshooting

### Common Issues

#### Puppeteer Issues

```bash
# Missing dependencies
sudo apt-get install -y libgbm-dev

# Chrome sandbox issues
export CHROME_ARGS="--no-sandbox --disable-setuid-sandbox"

# Memory issues
export NODE_OPTIONS="--max-old-space-size=4096"
```

#### Performance Issues

```bash
# Monitor resource usage
top -p $(pgrep -f "node.*wiz-cve-scraper")

# Check memory usage
ps aux | grep node

# Monitor disk space
df -h /opt/wiz-cve-scraper/output
```

#### Network Issues

```bash
# Test connectivity
curl -I https://www.wiz.io/cve-database

# Check DNS resolution
nslookup www.wiz.io

# Test from container
docker exec -it wiz-cve-scraper curl -I https://www.wiz.io/cve-database
```

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=debug
export DEBUG=puppeteer:*

# Run with verbose output
node src/app.js scrape --max-cves 1 --verbose
```

### Recovery Procedures

```bash
# Restart application
pm2 restart wiz-cve-scraper-api

# Clear cache and restart
pm2 delete wiz-cve-scraper-api
npm cache clean --force
pm2 start ecosystem.config.js

# Emergency stop
pm2 stop all
pkill -f node
```

## Backup and Recovery

```bash
# Backup script
cat > /opt/wiz-cve-scraper/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/wiz-cve-scraper"

mkdir -p $BACKUP_DIR

# Backup output files
tar -czf $BACKUP_DIR/output_$DATE.tar.gz output/

# Backup logs
tar -czf $BACKUP_DIR/logs_$DATE.tar.gz logs/

# Backup configuration
cp .env.production $BACKUP_DIR/env_$DATE

# Clean old backups (keep 30 days)
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
find $BACKUP_DIR -name "env_*" -mtime +30 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /opt/wiz-cve-scraper/backup.sh

# Schedule daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/wiz-cve-scraper/backup.sh") | crontab -
```

## Performance Tuning

### Node.js Optimization

```bash
# Increase memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Enable V8 optimizations
export NODE_OPTIONS="--optimize-for-size --max-old-space-size=4096"
```

### System Optimization

```bash
# Increase file descriptor limits
echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf

# Optimize TCP settings
echo "net.core.somaxconn = 65536" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65536" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

For additional support or questions, please refer to the main README.md or create an issue in the repository.