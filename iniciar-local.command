#!/bin/zsh
# Script de 1 clic para levantar FácilRepuestos 2.0 en modo 100% Local (con base de datos local .local-db.json)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "🚀 Iniciando FácilRepuestos 2.0 (Versión Local)..."
lsof -ti:3001,5173 | xargs kill -9 2>/dev/null || true

(cd "$DIR/server" && npm run dev) &
SERVER_PID=$!

(cd "$DIR/client" && npm run dev -- --host) &
CLIENT_PID=$!

sleep 2
open "http://localhost:5173/repuestin"

echo "✅ Backend corriendo en:  http://localhost:3001"
echo "✅ Chat Repuestín Local:  http://localhost:5173/repuestin"
echo "✅ Laboratorio Traza IA:  http://localhost:5173/chat-cliente"
echo "✅ ERP / Admin Local:     http://localhost:5173"
echo ""
echo "Presiona Ctrl+C para detener ambos servidores."
wait $SERVER_PID $CLIENT_PID
