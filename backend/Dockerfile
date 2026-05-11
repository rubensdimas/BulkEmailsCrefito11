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

# Install su-exec and postgresql-client
RUN apk add --no-cache su-exec postgresql-client

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built artifacts and necessary config
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/knexfile.ts ./
COPY --from=builder /app/src/migrations ./src/migrations

# Copy uploads directory
RUN mkdir -p uploads && chown nodejs:nodejs uploads

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Set environment
ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads

# Expose port
EXPOSE 3000

# Use sh to execute the entrypoint to be more resilient to CRLF issues
ENTRYPOINT ["sh", "/docker-entrypoint.sh"]

# Start application (executed via entrypoint as su-exec nodejs)
CMD ["node", "dist/app.js"]