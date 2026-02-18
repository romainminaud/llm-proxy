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
# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

# Install dumb-init for proper signal handling and build deps for better-sqlite3
RUN apk add --no-cache dumb-init python3 make g++

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Install production dependencies for server (includes native module compilation)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

# Remove build dependencies to reduce image size
RUN apk del python3 make g++

# Copy compiled server
COPY --from=server-build /app/server/dist ./server/dist

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create data directory with proper permissions
RUN mkdir -p /app/server/data && \
    chown -R nodejs:nodejs /app

# Install serve for frontend static files
RUN npm install -g serve

# Copy start script
COPY --chown=nodejs:nodejs scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Switch to non-root user
USER nodejs

# Environment variables
ENV PORT=8090
ENV NODE_ENV=production
ENV LOG_LEVEL=info

# Expose ports
EXPOSE 8090 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8090/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["/app/start.sh"]
