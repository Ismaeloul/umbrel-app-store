#!/usr/bin/env bash
# Genera la IPA SIN FIRMAR de Ace Neo, igual que la CI (.github/workflows/ios.yml),
# para hacerlo en un Mac con Xcode. Se firma después con la herramienta de Isma
# (IPA Station): ver apps/ios/README.md.
#
# Uso (desde cualquier sitio):
#   ace-player-neo/apps/ios/scripts/build-ipa.sh [AJUSTE=valor ...]
# Ejemplos:
#   scripts/build-ipa.sh
#   scripts/build-ipa.sh ACE_BUNDLE_ID=com.otro.aceneo MARKETING_VERSION=0.7.1 CURRENT_PROJECT_VERSION=42
#
# Deja build/AceNeo-unsigned-<versión>.ipa y escribe su ruta en la última línea.

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Hace falta Xcode (xcodebuild) en un Mac." >&2
  exit 1
fi
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Hace falta XcodeGen: brew install xcodegen" >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  node scripts/generar-catalogo-errores.mjs --check
fi

xcodegen generate --quiet

SALIDA=build
ARCHIVO="$SALIDA/AceNeo.xcarchive"
rm -rf "$ARCHIVO" "$SALIDA/ipa"
mkdir -p "$SALIDA"

# Release sin firma: la firma (y los entitlements) los pone quien instala la IPA.
xcodebuild archive \
  -project AceNeo.xcodeproj \
  -scheme AceNeo \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVO" \
  -quiet \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  "$@"

APP="$ARCHIVO/Products/Applications/AceNeo.app"
if [ ! -d "$APP" ]; then
  echo "No encuentro $APP en el archivo." >&2
  exit 1
fi

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist")
COMPILACION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Info.plist")
IPA="$SALIDA/AceNeo-unsigned-$VERSION.ipa"

mkdir -p "$SALIDA/ipa/Payload"
cp -R "$APP" "$SALIDA/ipa/Payload/"
rm -f "$IPA"
(cd "$SALIDA/ipa" && zip -qry "../$(basename "$IPA")" Payload)
rm -rf "$SALIDA/ipa"

echo "Ace Neo $VERSION ($COMPILACION), sin firmar: $(du -h "$IPA" | cut -f1)"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version=$VERSION"
    echo "build=$COMPILACION"
    echo "ipa=$IPA"
  } >> "$GITHUB_OUTPUT"
fi
echo "$IPA"
