// El icono de la app, en PNG de 96 px y en base64.
//
// Va incrustado en el codigo y no leido del disco a proposito: el correo sale
// de una tarea de fondo, y no quiero que un aviso se quede sin mandar porque
// una ruta de ficheros cambie al empaquetar. Son 3,5 KB.
//
// Se regenera con:
//   rsvg-convert -w 96 -h 96 static/icono.svg -o logo96.png && base64 -w0 logo96.png

export const LOGO_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAABmJLR0QA/wD/AP+gvaeTAAAN3ElEQVR4nO2de3Bc1XnAf+fe' +
    'fWp3JVuyHrbsmBTj94uUuNNSAwY6tJ22oWlcEh5pKNCWZEhnUjMknaY4MDV13aETe9o0FJeGCAhuSimd1qVMHQbigdoT4hcC' +
    'bBljYyHtSmt5n3d37+P0D5BrtJJ1nys58u8/7Z5zvk/n23se3/m+cwUeKBQGVqiWej1CrAO5BFgINAFJL+1OY4pAGeR7oLyD' +
    'lPtNxdyTSs19022DwrEGxUyXKsU9Uso7gCvcCv4Z46gQfN8U8h+Syc60k4q2DVAoDLSrlvoggruAmGMVZwYagscNaTzU3Dxv' +
    '2E4FWwYo5YfuFlhbQbR602+mIM8IxP3x5o5/nKzkBQ0gs9lmLWzuBD7nm24zCcmz8Zq4R7S3FyYqMqEBisVMl2KyG8HaYLSb' +
    'GQg4IkPKrzY1zemf4Pt6SqWhucKUrwCLAtVu5tBnKaxPJjsGx36hjP1AZrPNwpS7udT5frJIMdkth4ZSY7+oM4AWMf4eWNMQ' +
    'tWYSgrVaVO4c+/HHDFDKD92NFF9onFYzjo1aPnPn+R+cmwPy+dNtISJvA3MartaMQp4xMJeM7hPOPQEhGfkWlzq/AYjWkAj9' +
    '2bm/AIrFdKdiiRNAfMr0mllUpCp+LpFoHwgBqFL5A4mc/p0vJZa0kNKkduYM2ok+pGkgYnFCySThRIpY+1xEODzVmk5GTDHl' +
    'ncAWAVDOZ94GlkytTmOQEtPUMfQqhlFDmgamZWJkh0k/9STFwz8FKeuqCVUl3N5ObN4CEosW07Lq50ktWYkIhabgn7ggR5ua' +
    'O5aIQmFwpSqVw1OtDYCUElOvUquWMPQqckwH6+lBTm59GLOQd9SuEouRWrWWtmtupG3d+mnzhKgoy0KqpWxw7pT2F8syqWlF' +
    'arUy0rLGLyQlAzu/67jzAaxKhdz+18ntf52TyRSz12+g++YvEG3v9Ki5NwxhXh9CiE9D/aPcCCzLpKoV0Kul8UaTj6EdP4Z2' +
    'os+zTLNYYHj3Cwz/93/Sun4D3bf8HvHOeZ7bdYUU6xSQSxsvWFKrFCmOpKlVJu98AO1d753/MUyDMy+/xJGv/j4nex7DrFb9' +
    'bd8GApYowCcaKdTQqxRyGbRSDungyZO1WiD6SL1G+rkfcPiP7+TsoTcCkXEBFioI6hxEQVHVipTyWSzTcFw33NEVgEb/Ty0z' +
    'yLGH7ufU0ztBTjAP+U9KQQa/+ZLSolQYplLO4Xa+Sa5egxoPVlVpSQZ/+BS9D34No+h8sndBQsHFwbwTpGVSzA9j1LyNsUos' +
    'TvvG23zS6sIUjxzizT+9j+qwo/N1N4g6d7SfWKZBMTeEZei+tNey/lo6Pn8HqMFvqqqn36f3G/eh9Z8KVI4o5zOBrEEty6SU' +
    'G8KyTJ9bFphnz5Dbu5fqqROY5RKWpmEU8xgjWaTl778TbpvDir/cQaQtmD1DIAaQ0qKYH8IynE+2dQiFcDhGKBxBDUdQlBBC' +
    'jD9qWrqO1n+S/JGD5N88QOHgG1gVzbMK0fkLWLFlB6Fks+e2xhKIAUoF72N+KBwlEk0QisQm7PDJMCtVsq/tIfPiv1M++rYn' +
    'fZIrV7P8W4/6Pmr7boBKOU9VmzAKY1JC4QjRphZCoYiPWsHZQ29wuucxyn1HXbfR+bnbWHjrXT5q5bMBDL1KKZ/FzVJTCIVY' +
    'ooVItMkvdeqRksEX/43+nscxy2XH1YUiuOLPtzFr9ad8U8k3A0gJpVwa08UmSw1FaEq1oiiqH6pMijbQT99fb0Y7cdxx3Ujn' +
    'XFZ9+wnUiD9PqG8DWq1ScNX54UgTyeY5Det8gPjcbpY/8re0rPtFx3Vr6QFO//D7vuniiwFGvZpOicQSNKVmg8tJ1gtqJMKS' +
    'Bx6m9bpfcVw388IutPS4gW6O8cUAVa1Qd3gyGeFoE/HELD/Eu0coLLrvAcdPgqzp9O960hcVPBvAskz0aslRHTUUmfrOH0Uo' +
    'LPrag8Q/ebmjaiOvvkx1yLurwrMBalrRlj9/FCEUmlKzXa/tg0CNRFh0/2bUJvsrMGno9D//jGfZ3gwgJbWas+VcLNGCoky7' +
    'A3LiXd103363ozojP/4RUvfm5/JkAF2vTnyGOw6hcCTYdb5Hum76LeKX28+6MgsFsvv3epLpzQAOx/5ovMWLuOARCvNvc7bT' +
    'zb7ykieR7g0gJYZu398TCkcJhf11LwTB7LXriF+x2Hb5wqEDSA9OR9cGME3d0dIzEk24FdVwOm/6jO2yVkWjcKzXtSzXBtAd' +
    '/PoRCqHIxZNY2Xb1BpSY/ePP3MGfuJbl/gkw7EcphMPuXcpTgRqNkVptPzWudNy9q9u1AaQDv8/FMPaPJbXSvgGq/e7dEu4M' +
    'ICWmg6NG9SI0QMsy+waoDaVdT8SuDGBJc9zI5PER03LjNRmx+QsRir1hU5omlaG6BEhbuDKAdBC4pKjqRTX+j6JGI4Rmt9ku' +
    'r7sIGga3BnAQeSCCjXwJFDVhP2jQ1JxtSkdxPQfY5WL89Y+ixOwvna1yIw1wCd9wZwAHv2qnBzXTCScxRUqTu52+KwPYXR0A' +
    'jryl0w2zZH9YUeONNICDidWyzIvyKTCrNfQzWdvlwyl3UXOuDKAI1cEwJLEsH0IUG0zl9En7eQJqiJjL/AXXc4DqIIzE1IPJ' +
    'bgmSXO9PbZeNtncgXEZsu14FORFoOHDcTRcKRw7YLhvt7nYtx7UBnMRuGrXKRTUPmNUKhcMHbZdPXL7MtSz3BghHbZeV0sKo' +
    'VdyKajjZvXscLUFb1riPFXVtAFUNO9rl1qpFt6IaTvrFF2yXVWJxUouXu5blficsBKGw/a26odcwLoLJeOTAPrRj9kPYU2uu' +
    'dD0Bg0dXhNMQk6qW8yIueKTF6Z66W8UuyJxrbvQk0pMBQuEoQrHfhKHXqFWdx+U3isHdz6O9e8x2eTWVovWqqz3J9OaME4JI' +
    'xNkWvFLKBZC45x1t4DT9Tzn79c9ef73nm1c8e0Mj8YSj6HIpLcqF7LRalpo1nb5tmzE1+ysfEQoz/7c/71m257NCRVEJRxPU' +
    'Khd2XGnH3qF89C2sSpVIewfWVb9A84JFBJwnPjnSou/RzWjvveuoWuu1N/iSuupLipJlmRTPpsf9VetDGQZ2fgft+MdvOxGh' +
    'MO2/+Vkuu/2eoPPFJ0Za9O3YypmXnYUXikiEVdv/ybX/53x8+c8VRSUSqz++M3I5Tm37i7rOhw/DuzP/+izvbP0mZkA3oVwI' +
    's6bzztZvOu58gK6bN/rS+eDjiVg0nkQdsx4e+pcfYIycuWC93L7X6P3GV9AG/Un5sYM28D69D9xLbt9rjutGurqY99kv+qaL' +
    'bwYQQhBLzGJ0TLeqVQr7/9dWXe3EcXo3/SGD//V8sFfFSIuB3c/Ru+mP0E46G/MBhKJw2b2bUCP+3Tnna8BOKBwl2pSiWs6j' +
    'Dw4gHVzSYZbLnHpsO0P/s5v5t93F7LXr/FSNkQP7ON2z09E6fyxdG29l1ir/coTBZwMAxOIpLL1K1cGx5flox49x7KGvE79i' +
    'MZ03fYa2qzegRt0F9pq1Ctkf7yH94guO3AvjkVx1JQt+90ue2hiPYG5LkRb54QGOfvVuLI93sSmxOKnVa0mtXEvLsrXEFiyc' +
    'MEnarOlo758g33uAwpEDFA4f9OWyjtiChSzfsp2QgzghuwR2XY20TPr+7q8Y2eMtg6QOoRCaPZtwquVc3I5VqaAXchgjI77P' +
    'IeE57ax4ZAeRtg5f2x0lMAMA6Pmz9H79K1QHB4ISESjhOe0s3byN+Lzg7jUMdAcUbp7FsocfJTp/QZBiAiG2YCHLH9kRaOfD' +
    'hwYI1CkTaetkxZYdJFeuDlKMryRXXcmKLduJBjTsnIcU5UKmhCT43FFpceqZJ0g/97Tv14r5hVAUujbe+uFqpzHukaIo5zMD' +
    'QLCXcp7H2UM/4b3vPEotPb3mhUhXF5d9eROzVvq7zp+EAVHOZ/YBn26kVKnrDPzHP/PBrh6sytQe1otImI7f+B3mb/wSarTh' +
    'mTyvi3J+6EmQdzRaMoCW7qd/15OMvPqyo12zH4hQmNZrb6B74xd9c6w5RcL3RDmXuQ/B9inR4COqQ2n6n3+GkVd/hFl0f9+c' +
    'HdRUitZrbqD75lsCu4rSLlLIL4tCYWCFKtUjU6rJR0hdJ7t/L9lXXqJw6IAvu1j4aDe95krmXHMjrVddPW1e4KAglk7bV5hI' +
    '06Bw9C1yh/ZT6jtK9YP3qWUySPPC58lCVYm0dxLtnk/i8qW0rPkUqcXLPYWOBIGEtxLNHctDAELQIyUPT7VS5yPUEM3LVtG8' +
    'bNW5z6RhUBkaQC/mMUtFrI/OcJV4HDWRJJxsIdbeNR3fF1OHAj1w6TVWU4OgbGJ9MpXqyigAyWRnGsHjU63XjEHK76ZSXRm4' +
    '9CrDqSBrYCyte5Vhc/P8rIAHpk6vmYGAPzn/ffN1x1blQroHKRrzpoSZhmRXU0vHLed/VOdxileUe5HYTw+5hD0Eb8Sr1N2H' +
    'VmcA0d5esFR+DfD5vVEzmmOWkL8uOjrqkiTG9bkmkx2DliJ/GYn9TLVLjIuAw1IV1yWTnePe8jqh0zuZ7EzHDfU6JM8Gp97P' +
    'OEI+HavwS4lE+wcTFrHTjpbP3ClhG2D//paZzbCATfHmju9NVtDWsU+8ueMJg9oSBN9GMH0zLKYaQRnk3+gyusRO539YxSGF' +
    'wmBHCOUeKbkdaPx7KKchEt5SoMcQ1uOjO1y7eArOr+aHlxrCvB4p1gnEUpCfAFJA0ku705giUABxSiLfRsh9IanuiTbPcX1t' +
    '4v8BXsFLXf4OojgAAAAASUVORK5CYII=';
