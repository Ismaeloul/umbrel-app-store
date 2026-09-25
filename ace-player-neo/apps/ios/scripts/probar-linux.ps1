# Prueba el núcleo puro de la app (Package.swift «NucleoPuro») en Linux con Docker,
# igual que el trabajo nucleo-linux de la CI (b-arquitectura §1.13.2 y §4.5).
#
# Uso (desde ace-player-neo/ o desde cualquier sitio):
#   pwsh apps/ios/scripts/probar-linux.ps1                 # swift test
#   pwsh apps/ios/scripts/probar-linux.ps1 --filter Vectores
#
# Monta el monorepo entero (los tests leen packages/shared/fixtures) y deja la
# compilación en apps/ios/.build (ignorado por git), así la segunda vez tarda poco.
# tzdata hace falta para Europe/Madrid.

$ErrorActionPreference = 'Stop'
$monorepo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$imagen = 'swift:6.2-noble'
$argumentos = ($args | ForEach-Object { "'$_'" }) -join ' '

docker run --rm `
    -v "${monorepo}:/w" `
    -w /w/apps/ios `
    $imagen `
    bash -c "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tzdata >/dev/null && swift test $argumentos"
exit $LASTEXITCODE
