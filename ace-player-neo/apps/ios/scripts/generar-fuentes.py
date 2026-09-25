#!/usr/bin/env python3
"""Genera las fuentes de la app desde los MISMOS woff2 que carga la web.

GENERA (apps/ios/Resources/Fuentes):
  - PalcoSans-Variable.ttf   Mona Sans con la caja de 1 em centrada: hhea y OS/2 con
                             ascendente 0,885 em, descendente -0,115 em, sin interlineado,
                             y USE_TYPO_METRICS. Es la que usan los Text (Mona, variante palco).
                             OFL: «Mona» es nombre reservado, así que la versión MODIFICADA
                             se llama «Palco Sans» (PostScript «PalcoSans-ExtraLight»),
                             b-arquitectura §6 riesgo 8.
  - MonaSans-Variable.ttf    el woff2 de la web descomprimido tal cual (PostScript
                             «MonaSans-ExtraLight»; solo para TextField).
  - MartianMono-Variable.ttf el woff2 de la web descomprimido tal cual (PostScript
                             «MartianMono-SemiExpandedRegular»).
  - OFL.txt                  licencias de las dos familias (se enseñan en Acerca de).
  - ORIGEN.json              sha-256 de cada woff2 de @fontsource, parámetros aplicados,
                             nombres PostScript y sha-256 de lo generado.

Origen: apps/web/node_modules/@fontsource-variable/{mona-sans,martian-mono}/files/*-latin-wdth-normal.woff2
(los que tienen los dos ejes, wdth y wght; a1 §3.7). Hace falta `pnpm install` antes.

Uso (desde ace-player-neo/):
  python3 apps/ios/scripts/generar-fuentes.py           # escribe
  python3 apps/ios/scripts/generar-fuentes.py --check   # falla si ORIGEN.json o los TTF no están al día

En el PC de Isma no hay Python: con Docker,
  docker run --rm -v "${PWD}:/w" -w /w python:3.12-slim sh -c "pip install -q fonttools brotli && python apps/ios/scripts/generar-fuentes.py"

--check NO regenera (el resultado byte a byte depende de la versión de fontTools): comprueba que los
woff2 de node_modules y los parámetros son los de ORIGEN.json y que los ficheros de Resources/Fuentes
tienen el sha-256 que ORIGEN.json apunta (nadie los ha tocado a mano).
"""

from __future__ import annotations

import glob
import hashlib
import io
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
IOS = os.path.dirname(AQUI)
MONOREPO = os.path.dirname(os.path.dirname(IOS))
DESTINO = os.path.join(IOS, "Resources", "Fuentes")

VERSION_GENERADOR = 1

# Caja de 1 em centrada (b-arquitectura §1.2 y §2.2.3): proporciones del em.
ASCENDENTE_EM = 0.885
DESCENDENTE_EM = -0.115

FAMILIAS = {
    "mona": {"paquete": "mona-sans", "fichero": "mona-sans-latin-wdth-normal.woff2"},
    "martian": {"paquete": "martian-mono", "fichero": "martian-mono-latin-wdth-normal.woff2"},
}

NOMBRE_PALCO_FAMILIA = "Palco Sans"
NOMBRE_PALCO_POSTSCRIPT = "PalcoSans"


def carpeta_paquete(paquete: str) -> str:
    """La carpeta del paquete de @fontsource-variable (pnpm enlaza; en Docker el enlace de Windows no vale)."""
    candidatas = [
        os.path.join(MONOREPO, "apps", "web", "node_modules", "@fontsource-variable", paquete),
        os.path.join(MONOREPO, "node_modules", "@fontsource-variable", paquete),
    ]
    candidatas += sorted(
        glob.glob(
            os.path.join(
                MONOREPO, "node_modules", ".pnpm", f"@fontsource-variable+{paquete}@*",
                "node_modules", "@fontsource-variable", paquete,
            )
        )
    )
    for carpeta in candidatas:
        if os.path.isfile(os.path.join(carpeta, "package.json")):
            return carpeta
    sys.exit(f"No encuentro @fontsource-variable/{paquete}: ejecuta «corepack pnpm@10.18.2 install» antes.")


def sha256(datos: bytes) -> str:
    return hashlib.sha256(datos).hexdigest()


def leer(ruta: str) -> bytes:
    with open(ruta, "rb") as f:
        return f.read()


def origenes() -> dict:
    """Lo que entra: versión del paquete, sha-256 del woff2 y de la licencia."""
    datos = {}
    for clave, familia in FAMILIAS.items():
        carpeta = carpeta_paquete(familia["paquete"])
        with open(os.path.join(carpeta, "package.json"), encoding="utf-8") as f:
            version = json.load(f)["version"]
        woff2 = os.path.join(carpeta, "files", familia["fichero"])
        licencia = os.path.join(carpeta, "LICENSE")
        datos[clave] = {
            "paquete": f"@fontsource-variable/{familia['paquete']}@{version}",
            "fichero": familia["fichero"],
            "sha256": sha256(leer(woff2)),
            "licenciaSha256": sha256(leer(licencia).replace(b"\r\n", b"\n")),
            "_woff2": woff2,
            "_licencia": licencia,
        }
    return datos


def parametros() -> dict:
    return {
        "version": VERSION_GENERADOR,
        "palco": {
            "familia": NOMBRE_PALCO_FAMILIA,
            "postscript": NOMBRE_PALCO_POSTSCRIPT + "-ExtraLight",
            "ascendenteEm": ASCENDENTE_EM,
            "descendenteEm": DESCENDENTE_EM,
            "interlineado": 0,
            "useTypoMetrics": True,
        },
    }


def ttf_desde_woff2(ruta: str):
    from fontTools.ttLib import TTFont

    fuente = TTFont(ruta, recalcTimestamp=False)
    fuente.flavor = None
    return fuente


def guardar(fuente) -> bytes:
    salida = io.BytesIO()
    fuente.save(salida, reorderTables=True)
    return salida.getvalue()


def postscript(fuente) -> str:
    return str(fuente["name"].getDebugName(6))


def hacer_palco(fuente):
    """Métricas de caja de 1 em centrada y nombre propio (la licencia reserva «Mona»)."""
    upm = fuente["head"].unitsPerEm
    ascendente = round(ASCENDENTE_EM * upm)
    descendente = round(DESCENDENTE_EM * upm)
    hhea = fuente["hhea"]
    hhea.ascent, hhea.descent, hhea.lineGap = ascendente, descendente, 0
    os2 = fuente["OS/2"]
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascendente, descendente, 0
    os2.usWinAscent, os2.usWinDescent = ascendente, -descendente
    os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    if os2.version < 4:
        os2.version = 4

    tabla = fuente["name"]
    for registro in tabla.names:
        texto = registro.toUnicode()
        nuevo = texto.replace("MonaSans", NOMBRE_PALCO_POSTSCRIPT).replace("Mona Sans", NOMBRE_PALCO_FAMILIA)
        if nuevo != texto:
            registro.string = nuevo
    # Ningún nombre puede seguir diciendo «Mona» (nombre reservado de la OFL), salvo el copyright
    # (0), la licencia (13, 14) y la descripción/fabricante que citan el proyecto original.
    for registro in tabla.names:
        if registro.nameID in (0, 7, 8, 9, 10, 11, 12, 13, 14):
            continue
        if "Mona" in registro.toUnicode():
            sys.exit(f"El nombre {registro.nameID} sigue diciendo «Mona»: {registro.toUnicode()!r}")
    return fuente


def generar() -> dict:
    fuentes_ok = origenes()
    salida = {}

    mona = ttf_desde_woff2(fuentes_ok["mona"]["_woff2"])
    salida["MonaSans-Variable.ttf"] = (guardar(mona), postscript(mona))

    palco = hacer_palco(ttf_desde_woff2(fuentes_ok["mona"]["_woff2"]))
    salida["PalcoSans-Variable.ttf"] = (guardar(palco), postscript(palco))

    martian = ttf_desde_woff2(fuentes_ok["martian"]["_woff2"])
    salida["MartianMono-Variable.ttf"] = (guardar(martian), postscript(martian))

    ofl = (
        "Mona Sans (Resources/Fuentes/MonaSans-Variable.ttf y, modificada, PalcoSans-Variable.ttf)\n"
        "=========================================================================================\n\n"
        + leer(fuentes_ok["mona"]["_licencia"]).decode("utf-8").replace("\r\n", "\n").strip()
        + "\n\n\nMartian Mono (Resources/Fuentes/MartianMono-Variable.ttf)\n"
        "=========================================================\n\n"
        + leer(fuentes_ok["martian"]["_licencia"]).decode("utf-8").replace("\r\n", "\n").strip()
        + "\n"
    ).encode("utf-8")

    os.makedirs(DESTINO, exist_ok=True)
    for nombre, (datos, _) in salida.items():
        with open(os.path.join(DESTINO, nombre), "wb") as f:
            f.write(datos)
    with open(os.path.join(DESTINO, "OFL.txt"), "wb") as f:
        f.write(ofl)

    import fontTools

    origen = {
        "generador": "apps/ios/scripts/generar-fuentes.py",
        "fontTools": fontTools.version,
        "parametros": parametros(),
        "origenes": {k: {c: v for c, v in d.items() if not c.startswith("_")} for k, d in fuentes_ok.items()},
        "generados": {
            nombre: {"postscript": ps, "sha256": sha256(datos)} for nombre, (datos, ps) in sorted(salida.items())
        },
    }
    origen["generados"]["OFL.txt"] = {"sha256": sha256(ofl)}
    with open(os.path.join(DESTINO, "ORIGEN.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(origen, f, ensure_ascii=False, indent=2)
        f.write("\n")
    for nombre, (datos, ps) in sorted(salida.items()):
        print(f"{nombre}: {len(datos)} B, PostScript «{ps}»")
    return origen


def comprobar() -> int:
    ruta = os.path.join(DESTINO, "ORIGEN.json")
    try:
        with open(ruta, encoding="utf-8") as f:
            guardado = json.load(f)
    except FileNotFoundError:
        print("Falta Resources/Fuentes/ORIGEN.json. Ejecuta: python3 apps/ios/scripts/generar-fuentes.py")
        return 1
    errores = []
    actuales = {k: {c: v for c, v in d.items() if not c.startswith("_")} for k, d in origenes().items()}
    if guardado.get("origenes") != actuales:
        errores.append("los woff2 o las licencias de @fontsource ya no son los de ORIGEN.json")
    if guardado.get("parametros") != parametros():
        errores.append("los parámetros del generador han cambiado")
    for nombre, info in guardado.get("generados", {}).items():
        fichero = os.path.join(DESTINO, nombre)
        if not os.path.isfile(fichero):
            errores.append(f"falta {nombre}")
        elif sha256(leer(fichero)) != info["sha256"]:
            errores.append(f"{nombre} no es el que se generó (sha-256 distinto)")
    if errores:
        print("Las fuentes de Resources/Fuentes no están al día:")
        for e in errores:
            print(f"  - {e}")
        print("Ejecuta: python3 apps/ios/scripts/generar-fuentes.py (o con Docker, ver la cabecera)")
        return 1
    print("Fuentes al día (" + ", ".join(sorted(guardado["generados"])) + ").")
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv[1:]:
        sys.exit(comprobar())
    generar()
