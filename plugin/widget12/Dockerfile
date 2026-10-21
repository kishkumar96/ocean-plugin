# Production image for the El Niño story map (Next.js standalone output),
# served at /widget12/ behind the ocean-plugin nginx (nginx/sites/widget12.conf).

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependencies --------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Build ---------------------------------------------------------------
FROM base AS builder
WORKDIR /app
# Sub-path baked into the build (Next.js basePath + asset URLs).
ARG NEXT_PUBLIC_BASE_PATH=/widget12
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runtime -------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

# The standalone server plus the static assets it serves.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/widget12/ >/dev/null || exit 1

CMD ["node", "server.js"]
