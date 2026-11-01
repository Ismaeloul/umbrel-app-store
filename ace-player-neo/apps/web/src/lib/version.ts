/* Versión de esta web (la de apps/web/package.json, la misma que sube cada
   release). La del servidor llega en el bootstrap; las dos coinciden salvo
   con una pestaña vieja abierta tras actualizar, o en el modo demo, que no
   tiene servidor. Solo se importa el campo: el resto del package.json no
   entra en el paquete. */
export { version as WEB_VERSION } from '../../package.json';
