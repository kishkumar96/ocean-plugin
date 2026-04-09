# Multi-stage build: Build with Node.js, serve with nginx
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app/widget11

# Copy package files first (for better caching)
COPY widget11/package*.json ./
COPY platform ../platform

# Install dependencies (prefer npm ci if lock present, fallback to npm install)
RUN if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then \
      echo "Using npm ci (lock file detected)" && npm ci --omit=dev; \
    else \
      echo "No lock file found; using npm install (non-reproducible)" && npm install --omit=dev; \
    fi

# Copy all source files
COPY widget11 .

# Build the React application (allow warnings)
RUN CI=false DISABLE_ESLINT_PLUGIN=true npm run build

# Production stage: Use nginx to serve the built files
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/widget11/build /usr/share/nginx/html

# Copy nginx configuration
COPY widget11/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
