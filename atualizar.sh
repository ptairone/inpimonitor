#!/bin/bash
set -e

if [ -z "$1" ]; then
  echo "Uso: ./atualizar.sh <numero_revista>"
  echo "Exemplo: ./atualizar.sh 2888"
  exit 1
fi

NUMERO=$1
DIR=/var/www/inpimonitor

echo "=== Atualizando para revista RM${NUMERO} ==="

sed -i "s/TOTAL_REVISTAS = [0-9]*/TOTAL_REVISTAS = ${NUMERO}/" ${DIR}/src/scripts/download.js
echo "[1/2] Baixando RM${NUMERO}..."
cd ${DIR} && node src/scripts/download.js

echo "[2/2] Importando..."
node src/scripts/import.js

echo "=== Concluido! RM${NUMERO} importada ==="
