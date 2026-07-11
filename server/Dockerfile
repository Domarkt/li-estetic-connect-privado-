# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
# Prisma en Alpine necesita openssl para generar/usar el query engine (musl-openssl-3.0.x).
RUN apk add --no-cache openssl
COPY package*.json ./
# El schema debe existir ANTES de npm ci, porque postinstall corre `prisma generate`.
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# openssl + libc6-compat: requeridos por el engine de Prisma en Alpine.
RUN apk add --no-cache openssl libc6-compat
# node_modules incluye el cliente Prisma ya generado
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
