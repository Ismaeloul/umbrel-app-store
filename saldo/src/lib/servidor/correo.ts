import nodemailer from 'nodemailer';
import type { Correo } from './ajustes';
import type { Aviso } from './avisos';
import { LOGO_PNG_BASE64 } from './logo';

// Un solo correo al dia como mucho, con todo junto. Nada de un mensaje por
// cada cosa: eso se acaba ignorando.

const CID_LOGO = 'saldo-logo';

function transporte(c: Correo) {
  return nodemailer.createTransport({
    host: c.servidor,
    port: c.puerto,
    secure: c.seguro,
    auth: c.usuario ? { user: c.usuario, pass: c.clave } : undefined
  });
}

/**
 * El remitente, siempre con nombre.
 *
 * Si solo hay una direccion suelta se le pone «Saldo» delante, para que en la
 * bandeja se lea el nombre de la app y no una direccion a secas. Si ya viene
 * con nombre (`Saldo <yo@…>`), se respeta tal cual.
 */
export function remitente(c: Correo): string {
  const bruto = (c.de || c.usuario).trim();
  if (bruto === '') return '';
  if (bruto.includes('<')) return bruto;
  return `"Saldo" <${bruto}>`;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cuerpoTexto(avisos: Aviso[]): string {
  const lineas = avisos.map((a) => `• ${a.titulo}\n  ${a.detalle}`);
  return `${lineas.join('\n\n')}\n\n—\nSaldo, en tu Umbrel.`;
}

/**
 * El HTML del correo.
 *
 * Va con tablas y estilos en linea porque los clientes de correo no entienden
 * mucho mas: ni hojas de estilo, ni flexbox, ni variables CSS. El logo viaja
 * adjunto y se referencia con `cid:`, que es lo unico que Gmail enseña sin
 * pedir permiso para «mostrar imagenes».
 */
function cuerpoHtml(avisos: Aviso[]): string {
  const filas = avisos
    .map((a) => {
      const color = a.prioridad === 0 ? '#C0442C' : '#B07A16';
      return `
      <tr>
        <td style="padding: 0 0 10px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background: #FFFFFF; border: 1px solid #E7DFCF; border-radius: 14px">
            <tr>
              <td style="width: 4px; background: ${color};
                         border-radius: 14px 0 0 14px">&nbsp;</td>
              <td style="padding: 16px 18px">
                <div style="margin: 0 0 5px; font-size: 15px; font-weight: 700;
                            color: #1F1B16; line-height: 1.35">${escapar(a.titulo)}</div>
                <div style="font-size: 13.5px; color: #564F45;
                            line-height: 1.5">${escapar(a.detalle)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="es">
<body style="margin: 0; padding: 0; background: #F6F2EA">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background: #F6F2EA">
    <tr>
      <td align="center" style="padding: 28px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="max-width: 520px; font-family: Roboto, Helvetica, Arial, sans-serif">

          <tr>
            <td style="padding: 0 2px 18px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right: 11px">
                    <img src="cid:${CID_LOGO}" width="34" height="34" alt=""
                         style="display: block; border: 0; border-radius: 9px" />
                  </td>
                  <td style="font-size: 19px; font-weight: 700; color: #1F1B16;
                             letter-spacing: -0.02em">Saldo</td>
                </tr>
              </table>
            </td>
          </tr>

          ${filas}

          <tr>
            <td style="padding: 12px 2px 0; font-size: 11.5px; color: #9A8F80;
                       line-height: 1.5">
              Te lo manda tu Umbrel. Los días de aviso se cambian en Ajustes.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function adjuntos() {
  return [
    {
      filename: 'saldo.png',
      content: Buffer.from(LOGO_PNG_BASE64, 'base64'),
      contentType: 'image/png',
      cid: CID_LOGO
    }
  ];
}

/**
 * Manda el resumen. Si el envio falla, lanza: quien llama decide. La tarea
 * diaria se encarga de que un correo caido no tumbe la materializacion.
 */
export async function enviarResumen(avisos: Aviso[], c: Correo): Promise<void> {
  const asunto =
    avisos.length === 1 ? avisos[0].titulo : `Saldo: ${avisos.length} cosas que mirar`;

  await transporte(c).sendMail({
    from: remitente(c),
    to: c.para,
    subject: asunto,
    text: cuerpoTexto(avisos),
    html: cuerpoHtml(avisos),
    attachments: adjuntos()
  });
}

/** Un correo de verdad, para comprobar desde la pantalla de ajustes que va. */
export async function enviarPrueba(c: Correo): Promise<void> {
  const aviso: Aviso = {
    clave: 'prueba',
    prioridad: 1,
    repetirCada: null,
    titulo: 'La prueba ha llegado',
    detalle:
      'Si estás leyendo esto, los avisos de Saldo te van a llegar bien. A partir de ahora te escribe solo cuando haya algo que mirar.'
  };

  await transporte(c).sendMail({
    from: remitente(c),
    to: c.para,
    subject: 'Saldo: la prueba ha llegado',
    text: cuerpoTexto([aviso]),
    html: cuerpoHtml([aviso]),
    attachments: adjuntos()
  });
}
