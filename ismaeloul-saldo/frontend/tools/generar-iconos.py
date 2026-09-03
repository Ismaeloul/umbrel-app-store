"""Genera los PNG del icono de la app a partir de la misma geometria del SVG.

El icono es un medidor: un anillo con el arco relleno hasta el 70%. Dice de un
vistazo lo que hace la app, que es saber cuanto saldo te queda.

    python tools/generar-iconos.py

Solo hay que volver a ejecutarlo si se cambia el diseno del icono. Necesita
Pillow, que NO es dependencia de la app: es una herramienta de autor.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

FONDO = (10, 12, 15, 255)  # #0A0C0F
PISTA = (37, 44, 53, 255)  # #252C35
MENTA = (79, 224, 160, 255)  # #4FE0A0

# Fraccion del anillo que va rellena.
RELLENO = 0.70
# Supermuestreo: se dibuja grande y se reduce, que es lo que da el borde liso.
ESCALA = 8

DESTINO = Path(__file__).resolve().parent.parent / "public"


def dibujar(tamano: int, margen: float, con_fondo_redondeado: bool) -> Image.Image:
    lado = tamano * ESCALA
    lienzo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    pincel = ImageDraw.Draw(lienzo)

    if con_fondo_redondeado:
        pincel.rounded_rectangle(
            (0, 0, lado - 1, lado - 1), radius=int(lado * 0.22), fill=FONDO
        )
    else:
        # Maskable: el sistema recorta la forma que quiera, asi que el fondo
        # tiene que llegar hasta el borde.
        pincel.rectangle((0, 0, lado - 1, lado - 1), fill=FONDO)

    radio = lado * (0.5 - margen)
    grosor = int(lado * 0.115)
    centro = lado / 2
    caja = (
        centro - radio,
        centro - radio,
        centro + radio,
        centro + radio,
    )

    pincel.arc(caja, start=0, end=360, fill=PISTA, width=grosor)
    # Empieza arriba y va en el sentido del reloj, como un deposito que baja.
    pincel.arc(
        caja,
        start=-90,
        end=-90 + 360 * RELLENO,
        fill=MENTA,
        width=grosor,
    )

    return lienzo.resize((tamano, tamano), Image.LANCZOS)


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    salidas = {
        "icono-192.png": dibujar(192, margen=0.20, con_fondo_redondeado=True),
        "icono-512.png": dibujar(512, margen=0.20, con_fondo_redondeado=True),
        "icono-180.png": dibujar(180, margen=0.20, con_fondo_redondeado=True),
        # Zona segura del maskable: el dibujo se queda en el 80% central.
        "icono-maskable-512.png": dibujar(
            512, margen=0.28, con_fondo_redondeado=False
        ),
    }
    for nombre, imagen in salidas.items():
        imagen.save(DESTINO / nombre, format="PNG", optimize=True)
        print(f"escrito {DESTINO / nombre}")


if __name__ == "__main__":
    main()
