FROM node:20 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Separate stage for production node_modules (pre-compiled native modules)
RUN rm -rf node_modules && npm ci --omit=dev

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Copy pre-compiled production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

RUN mkdir -p uploads

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "dist/index.js"]
