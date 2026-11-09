# Stage 1: Compilar el Frontend Web (incluye el Agente Conversacional para Clientes)
FROM node:20-alpine AS client-builder
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
ARG VITE_API_URL=""
ARG VITE_PUBLIC_AGENT_ONLY="true"
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_PUBLIC_AGENT_ONLY=${VITE_PUBLIC_AGENT_ONLY}
RUN npm run build

# Stage 2: Servidor Express + Frontend Estático Embebido para Cloud Run
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client-builder /build/client/dist ./public

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
