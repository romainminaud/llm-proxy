# Deployment Guide

This guide covers deploying LLM Proxy to production environments.

## Table of Contents

- [Docker Deployment](#docker-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Cloud Platform Deployment](#cloud-platform-deployment)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Database Management](#database-management)
- [Monitoring](#monitoring)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

## Docker Deployment

### Basic Deployment

```bash
# Build and start
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f llm-proxy

# Stop
docker compose down
```

### Production Deployment

Use the production override file for resource limits and optimized settings:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Custom Configuration

Create a `.env` file in the project root:

```bash
# Copy example
cp .env.example .env

# Edit configuration
nano .env
```

Example `.env`:

```bash
PORT=8090
NODE_ENV=production
LOG_LEVEL=warn
TRUST_PROXY=true
CORS_ORIGIN=https://your-domain.com
RATE_LIMIT_MAX_REQUESTS=500
```

### Data Persistence

Data is stored in a Docker volume by default. For host-mounted storage:

```yaml
# docker-compose.override.yml
services:
  llm-proxy:
    volumes:
      - ./data:/app/server/data
```

### Building for Production

```bash
# Build with no cache
docker compose build --no-cache

# Build for specific platform
docker build --platform linux/amd64 -t llm-proxy:latest .
```

## Kubernetes Deployment

### Basic Manifests

**Deployment:**

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llm-proxy
  labels:
    app: llm-proxy
spec:
  replicas: 1
  selector:
    matchLabels:
      app: llm-proxy
  template:
    metadata:
      labels:
        app: llm-proxy
    spec:
      containers:
        - name: llm-proxy
          image: llm-proxy:latest
          ports:
            - containerPort: 8090
              name: api
            - containerPort: 3000
              name: frontend
          env:
            - name: NODE_ENV
              value: "production"
            - name: LOG_LEVEL
              value: "info"
            - name: TRUST_PROXY
              value: "true"
          volumeMounts:
            - name: data
              mountPath: /app/server/data
          livenessProbe:
            httpGet:
              path: /health
              port: 8090
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 8090
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "1Gi"
              cpu: "500m"
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: llm-proxy-data
```

**Service:**

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: llm-proxy
spec:
  selector:
    app: llm-proxy
  ports:
    - name: api
      port: 8090
      targetPort: 8090
    - name: frontend
      port: 3000
      targetPort: 3000
  type: ClusterIP
```

**PersistentVolumeClaim:**

```yaml
# k8s/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: llm-proxy-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

**Ingress:**

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: llm-proxy
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
spec:
  rules:
    - host: llm-proxy.your-domain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: llm-proxy
                port:
                  number: 3000
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: llm-proxy
                port:
                  number: 8090
          - path: /v1
            pathType: Prefix
            backend:
              service:
                name: llm-proxy
                port:
                  number: 8090
          - path: /anthropic
            pathType: Prefix
            backend:
              service:
                name: llm-proxy
                port:
                  number: 8090
          - path: /gemini
            pathType: Prefix
            backend:
              service:
                name: llm-proxy
                port:
                  number: 8090
```

### Deploy to Kubernetes

```bash
kubectl apply -f k8s/
```

## Cloud Platform Deployment

### DigitalOcean (Recommended for simplicity)

#### One-Click Deploy to App Platform

[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/YOUR_USERNAME/proxy/tree/main)

This uses the `.do/app.yaml` spec in the repo. It provisions the app with a persistent volume for the SQLite database automatically.

> Replace `YOUR_USERNAME` in the button URL with your GitHub username after forking the repo.

---

DigitalOcean Droplets are the easiest way to get LLM Proxy running on a VPS with full control.

#### 1. Create a Droplet

- Choose **Ubuntu 24.04 LTS**
- Size: **Basic, 1 GB RAM / 1 vCPU** is enough to start ($6/month)
- Enable **SSH key** authentication

#### 2. Install Docker

```bash
# SSH into your droplet
ssh root@YOUR_DROPLET_IP

# Install Docker
curl -fsSL https://get.docker.com | sh

# Add your user to the docker group (if not root)
usermod -aG docker $USER
```

#### 3. Clone and Configure

```bash
git clone https://github.com/YOUR_USERNAME/proxy.git
cd proxy

cp .env.example .env
nano .env
```

Minimal `.env` for production:

```bash
NODE_ENV=production
LOG_LEVEL=warn
TRUST_PROXY=true
CORS_ORIGIN=https://your-domain.com
```

#### 4. Start with Docker Compose

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The app is now running on ports `8090` (API) and `3000` (frontend).

#### 5. Set Up a Domain and HTTPS with Caddy

Caddy automatically handles TLS certificates via Let's Encrypt.

```bash
apt install -y caddy
```

Create `/etc/caddy/Caddyfile`:

```caddyfile
your-domain.com {
    handle /v1/* { reverse_proxy localhost:8090 }
    handle /anthropic/* { reverse_proxy localhost:8090 }
    handle /gemini/* { reverse_proxy localhost:8090 }
    handle /api/* { reverse_proxy localhost:8090 }
    handle /health { reverse_proxy localhost:8090 }
    handle /ready { reverse_proxy localhost:8090 }
    handle { reverse_proxy localhost:3000 }
}
```

```bash
systemctl reload caddy
```

Your proxy is now live at `https://your-domain.com`.

#### 6. Open Firewall Ports

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

#### Enable Auto-restart on Reboot

```bash
# Create a systemd service
cat > /etc/systemd/system/llm-proxy.service << 'EOF'
[Unit]
Description=LLM Proxy
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=/root/proxy
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.prod.yml up
ExecStop=/usr/bin/docker compose down
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl enable llm-proxy
systemctl start llm-proxy
```

#### DigitalOcean App Platform (Alternative)

For a fully managed option with no server maintenance:

1. Push your repo to GitHub
2. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
3. Connect your repo and select the `Dockerfile`
4. Set environment variables (`NODE_ENV=production`, etc.)
5. Add a **persistent storage** volume mounted at `/app/server/data`
6. Deploy

Note: App Platform is stateless by default — the persistent volume is required to retain the SQLite database across deploys.

### AWS ECS

1. Push image to ECR:
```bash
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com
docker tag llm-proxy:latest YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/llm-proxy:latest
docker push YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/llm-proxy:latest
```

2. Create ECS task definition with:
   - Container ports: 8090, 3000
   - EFS volume for `/app/server/data`
   - Health check: `GET /health`

### Google Cloud Run

```bash
# Build and push
gcloud builds submit --tag gcr.io/PROJECT_ID/llm-proxy

# Deploy
gcloud run deploy llm-proxy \
  --image gcr.io/PROJECT_ID/llm-proxy \
  --port 8090 \
  --memory 1Gi \
  --set-env-vars NODE_ENV=production,LOG_LEVEL=info
```

Note: Cloud Run is stateless. Use Cloud SQL or external storage for persistence.

### Azure Container Apps

```bash
az containerapp create \
  --name llm-proxy \
  --resource-group myResourceGroup \
  --environment myEnvironment \
  --image llm-proxy:latest \
  --target-port 8090 \
  --ingress external \
  --env-vars NODE_ENV=production LOG_LEVEL=info
```

## Reverse Proxy Setup

### Nginx

```nginx
upstream llm_proxy_api {
    server 127.0.0.1:8090;
}

upstream llm_proxy_frontend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name llm-proxy.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name llm-proxy.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/llm-proxy.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/llm-proxy.your-domain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Large body size for LLM requests
    client_max_body_size 50M;

    # API routes
    location ~ ^/(v1|anthropic|gemini|api|health|ready) {
        proxy_pass http://llm_proxy_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Streaming support
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Frontend
    location / {
        proxy_pass http://llm_proxy_frontend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```caddyfile
llm-proxy.your-domain.com {
    # API routes
    handle /v1/* {
        reverse_proxy localhost:8090
    }
    handle /anthropic/* {
        reverse_proxy localhost:8090
    }
    handle /gemini/* {
        reverse_proxy localhost:8090
    }
    handle /api/* {
        reverse_proxy localhost:8090
    }
    handle /health {
        reverse_proxy localhost:8090
    }
    handle /ready {
        reverse_proxy localhost:8090
    }

    # Frontend
    handle {
        reverse_proxy localhost:3000
    }
}
```

When using a reverse proxy, set `TRUST_PROXY=true` so the app correctly reads client IPs from `X-Forwarded-For` headers.

## Database Management

### Backup

```bash
# Docker
docker compose exec llm-proxy cp /app/server/data/llm-proxy.db /app/server/data/backup-$(date +%Y%m%d).db

# Copy to host
docker compose cp llm-proxy:/app/server/data/llm-proxy.db ./backup-$(date +%Y%m%d).db
```

### Restore

```bash
# Stop the service
docker compose stop llm-proxy

# Copy backup
docker compose cp ./backup.db llm-proxy:/app/server/data/llm-proxy.db

# Start the service
docker compose start llm-proxy
```

### Database Location

- Docker: `/app/server/data/llm-proxy.db`
- Local: `./data/llm-proxy.db` (or `LLM_PROXY_DATABASE_PATH`)

### SQLite Best Practices

1. **WAL Mode**: Enabled by default for better concurrent access
2. **Regular Backups**: Database is a single file - back it up regularly
3. **Disk Space**: Monitor disk usage as the database grows
4. **Vacuuming**: Periodically run `VACUUM` to reclaim space after deletes

## Monitoring

### Health Checks

```bash
# Liveness
curl http://localhost:8090/health
# {"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}

# Readiness
curl http://localhost:8090/ready
# {"status":"ready","timestamp":"2024-01-15T10:30:00.000Z"}
```

### Logs

```bash
# Docker Compose
docker compose logs -f llm-proxy

# Filter by level
docker compose logs llm-proxy 2>&1 | grep ERROR

# JSON logs for parsing
docker compose logs llm-proxy --no-log-prefix | jq .
```

### Metrics Endpoints

Statistics are available via the API:

```bash
curl http://localhost:8090/api/stats
```

Returns:
```json
{
  "totalRequests": 1234,
  "totalCost": 45.67,
  "totalInputTokens": 500000,
  "totalOutputTokens": 250000,
  "byModel": [
    {"model": "gpt-4o", "count": 500, "input_tokens": 200000, "output_tokens": 100000, "total_cost": 20.00}
  ]
}
```

## Security

### Production Checklist

- [ ] Use HTTPS (TLS termination at reverse proxy)
- [ ] Set `NODE_ENV=production`
- [ ] Set `TRUST_PROXY=true` if behind a reverse proxy
- [ ] Restrict `CORS_ORIGIN` to your domains
- [ ] Configure rate limiting appropriately
- [ ] Use Docker non-root user (default)
- [ ] Mount data volume with proper permissions
- [ ] Regularly update dependencies
- [ ] Back up database regularly

### API Key Security

API keys are forwarded to upstream providers and not stored. They are included in request logs - ensure:

1. Access to the dashboard is restricted
2. Database backups are encrypted
3. Log access is controlled

### Network Security

```yaml
# docker-compose.override.yml - Restrict to internal network
services:
  llm-proxy:
    networks:
      - internal
    # Only expose through reverse proxy
    ports: []

networks:
  internal:
    internal: true
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs llm-proxy

# Check container status
docker compose ps

# Enter container for debugging
docker compose exec llm-proxy sh
```

### Database errors

```bash
# Check database file exists and is readable
docker compose exec llm-proxy ls -la /app/server/data/

# Check SQLite integrity
docker compose exec llm-proxy sqlite3 /app/server/data/llm-proxy.db "PRAGMA integrity_check;"
```

### Permission issues

```bash
# Fix volume permissions
sudo chown -R 1001:1001 ./data
```

### High memory usage

- Reduce `client_max_body_size` in nginx
- Add resource limits in docker-compose.prod.yml
- Consider pagination for large result sets

### Slow responses

- Check database size: `ls -lh data/llm-proxy.db`
- Run `VACUUM` if database has grown after many deletes
- Check disk I/O performance
- Consider adding indexes for common query patterns

### Connection refused

```bash
# Verify ports are exposed
docker compose port llm-proxy 8090

# Check firewall rules
sudo ufw status

# Test internal connectivity
docker compose exec llm-proxy wget -qO- http://localhost:8090/health
```
