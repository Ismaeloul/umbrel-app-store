#!/bin/sh
# Construye la imagen de Saldo y la deja en el registro local del NAS, que es
# de donde umbreld sabe tirarla.
#
#   ./umbrel/publicar.sh [version] [registro]
#
# Ejecutalo desde la raiz de ismaeloul-saldo/. Si construyes en un equipo que
# no es el NAS, exporta REGISTRO con la direccion del registro (por ejemplo
# 192.168.1.188:5000) y asegurate de tenerlo en insecure-registries.
set -eu

VERSION="${1:-0.1.0}"
REGISTRO="${2:-${REGISTRO:-localhost:5000}}"
IMAGEN="${REGISTRO}/ismaeloul-saldo/saldo:${VERSION}"

echo "Construyendo ${IMAGEN}"
docker build --platform linux/amd64 -t "${IMAGEN}" .

echo "Comprobando que los tests pasan dentro de la imagen"
docker run --rm "${IMAGEN}" pytest -q

echo "Publicando en el registro"
docker push "${IMAGEN}"

echo
echo "Listo. Ahora, en el NAS:"
echo "  1. Copia umbrel/docker-compose.yml sobre el docker-compose.yml de la"
echo "     carpeta de la app, y comprueba que la version de la imagen es"
echo "     ${VERSION}."
echo "  2. Actualiza la app desde umbrelOS."
