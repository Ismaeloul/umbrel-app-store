import nodemailer from 'nodemailer';
import type { Correo } from './ajustes';
import type { Aviso } from './avisos';

// Un solo correo al dia como mucho, con todo junto. Nada de un mensaje por
// cada cosa: eso se acaba ignorando.

function transporte(c: Correo) {
  return nodemailer.createTransport({
    host: c.servidor,
    port: c.puerto,
    secure: c.seguro,
    auth: c.usuario ? { user: c.usuario, pass: c.clave } : undefined
  });
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

function cuerpoHtml(avisos: Aviso[]): string {
  const items = avisos
    .map(
      (a) => `<li style="margin:0 0 18px">
        <strong style="display:block;font-size:15px;color:#1F1B16">${escapar(a.titulo)}</strong>
        <span style="font-size:14px;color:#564F45">${escapar(a.detalle)}</span>
      </li>`
    )
    .join('');

  return `<div style="background:#F6F2EA;padding:24px;font-family:Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E7DFCF;border-radius:16px;padding:24px">
      <div style="font-size:18px;font-weight:700;letter-spacing:-0.02em;color:#1F1B16;margin-bottom:18px">Saldo</div>
      <ul style="list-style:none;margin:0;padding:0">${items}</ul>
    </div>
  </div>`;
}

/**
 * Manda el resumen. Si el envio falla, lanza: quien llama decide. La tarea
 * diaria se encarga de que un correo caido no tumbe la materializacion.
 */
export async function enviarResumen(avisos: Aviso[], c: Correo): Promise<void> {
  const asunto =
    avisos.length === 1 ? avisos[0].titulo : `Saldo: ${avisos.length} cosas que mirar`;

  await transporte(c).sendMail({
    from: c.de || c.usuario,
    to: c.para,
    subject: asunto,
    text: cuerpoTexto(avisos),
    html: cuerpoHtml(avisos)
  });
}

/** Un correo de verdad, para comprobar desde la pantalla de ajustes que va. */
export async function enviarPrueba(c: Correo): Promise<void> {
  await transporte(c).sendMail({
    from: c.de || c.usuario,
    to: c.para,
    subject: 'Saldo: la prueba ha llegado',
    text: 'Si estás leyendo esto, los avisos de Saldo te van a llegar bien.\n\n—\nSaldo, en tu Umbrel.',
    html: cuerpoHtml([
      {
        clave: 'prueba',
        prioridad: 0,
        repetirCada: null,
        titulo: 'La prueba ha llegado',
        detalle: 'Si estás leyendo esto, los avisos de Saldo te van a llegar bien.'
      }
    ])
  });
}
