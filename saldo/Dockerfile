# Vite compila, Node sirve. Una sola imagen, un solo proceso, un solo puerto.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Los tests son criterio de aceptacion de la imagen: si fallan, no hay imagen.
RUN npm test
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV BODY_SIZE_LIMIT=1M
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
# Aqui vivira saldo.db. Es lo unico que habra que respaldar.
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "build"]
