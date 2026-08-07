# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY backend/ .

# Build TypeScript and reject images with unloadable production migrations.
RUN npm run build && npm run verify:production-artifacts

# Stage 2: local development
# Keep the dependencies baked into the image. The development Compose file
# mounts only source files, never the whole application directory.
FROM builder AS development

RUN apk add --no-cache su-exec postgresql-client

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY assets /assets
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh

RUN mkdir -p uploads && \
    chown nodejs:nodejs uploads && \
    chmod +x /docker-entrypoint.sh

ENV NODE_ENV=development
ENV UPLOAD_DIR=/app/uploads

EXPOSE 3000

ENTRYPOINT ["sh", "/docker-entrypoint.sh"]

# Stage 3: Production
FROM node:24-alpine AS production-dependencies

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS production

# Install su-exec and postgresql-client
RUN apk add --no-cache su-exec postgresql-client

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built artifacts and necessary config
COPY --from=builder /app/dist ./dist
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts
COPY assets /assets

# Declaration files are useful to library consumers, but must not be present
# beside Knex migrations in the production runtime image.
RUN find ./dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' \) -delete && \
    node scripts/verifyProductionArtifacts.js

# Copy uploads directory
RUN mkdir -p uploads && chown nodejs:nodejs uploads

# Copy entrypoint script
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
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
