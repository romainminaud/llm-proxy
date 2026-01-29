# Build stage for frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build stage for server
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

# Install production dependencies for server
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server/src ./server/src
COPY server/tsconfig.json ./server/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Install serve for frontend static files
RUN npm install -g serve

# Create data directory
RUN mkdir -p /app/server/data/requests

# Environment variables
ENV PORT=8090
ENV NODE_ENV=production

# Expose ports
EXPOSE 8090 3000

# Start script
COPY <<EOF /app/start.sh
#!/bin/sh
cd /app/server && npx tsx src/server.ts &
serve -s /app/frontend/dist -l 3000 &
wait
EOF
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
