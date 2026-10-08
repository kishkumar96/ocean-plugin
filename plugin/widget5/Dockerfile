# Multi-stage build: Build with Node.js, serve with nginx
# Node 22 LTS (supported through 2027-04) -- 18 and 20 are both past their own EOL.
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies from the lockfile only -- a reproducible build must fail loudly if
# package.json and package-lock.json ever drift apart, not silently fall back to whatever
# npm install resolves on the day of the build. Not --omit=dev: @craco/craco (needed to run
# `npm run build` below) is a devDependency, and this builder stage's node_modules never ship
# in the final image anyway (only /app/build, the static output, is copied to the nginx
# stage below) -- so omitting dev deps here would only break the build for no benefit.
# --legacy-peer-deps: deck.gl 9.4's own peer-range metadata rejects an already-satisfying
# @loaders.gl/core version (a known upstream npm-resolver quirk, not a real incompatibility --
# verified locally against this exact lockfile).
RUN npm ci --legacy-peer-deps

# Copy all source files
COPY . .

# Build the React application. No CI=false, no DISABLE_ESLINT_PLUGIN: the build must fail on
# real lint errors and warnings, not ship them silently.
RUN CI=true npm run build

# Production stage: Use nginx to serve the built files
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/build /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]