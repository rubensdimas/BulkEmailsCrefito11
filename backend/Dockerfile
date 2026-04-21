# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:18-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy uploads directory (owned by root initially)
RUN mkdir -p uploads

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set environment
ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Use entrypoint to fix permissions before starting
ENTRYPOINT ["/docker-entrypoint.sh"]

# Start application
CMD ["node", "dist/app.js"]