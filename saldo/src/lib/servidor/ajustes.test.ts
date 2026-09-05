import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { dbEnMemoria } from './esquema';
import { correoConfigurado, guardarPreferencias, olvidarClave, preferencias } from './ajustes';

let conn: DatabaseSync;

beforeEach(() => {
  conn = dbEnMemoria();
});

describe('preferencias', () => {
  it('sin nada guardado, no hay correo configurado', () => {
    expect(correoConfigurado(preferencias(conn))).toBe(false);
  });

  it('lo que se guarda desde la pantalla manda', () => {
    guardarPreferencias(conn, {
      servidor: 'smtp.gmail.com',
      puerto: 587,
      seguro: false,
      usuario: 'yo@gmail.com',
      clave: 'abcd efgh ijkl mnop',
      de: 'Saldo <yo@gmail.com>',
      para: 'yo@gmail.com',
      avisoDias: 15
    });

    const p = preferencias(conn);
    expect(p.correo.servidor).toBe('smtp.gmail.com');
    expect(p.correo.puerto).toBe(587);
    expect(p.correo.para).toBe('yo@gmail.com');
    expect(p.avisoDias).toBe(15);
    expect(correoConfigurado(p)).toBe(true);
  });

  it('recorta los espacios de sobra al pegar una direccion', () => {
    guardarPreferencias(conn, { para: '  yo@gmail.com  ' });
    expect(preferencias(conn).correo.para).toBe('yo@gmail.com');
  });

  it('guardar con la clave vacia NO borra la que ya habia', () => {
    // Es lo que permite que el formulario no tenga que devolver la contrasena
    // a la pantalla solo para poder volver a guardarla.
    guardarPreferencias(conn, { clave: 'la-buena' });
    guardarPreferencias(conn, { servidor: 'smtp.otro.com', clave: '' });

    expect(preferencias(conn).correo.clave).toBe('la-buena');
    expect(preferencias(conn).correo.servidor).toBe('smtp.otro.com');
  });

  it('la clave se puede borrar a proposito', () => {
    guardarPreferencias(conn, { clave: 'la-buena' });
    olvidarClave(conn);
    expect(preferencias(conn).correo.clave).toBe('');
  });

  it('sin destinatario no se manda nada, aunque haya servidor', () => {
    guardarPreferencias(conn, { servidor: 'smtp.gmail.com' });
    expect(correoConfigurado(preferencias(conn))).toBe(false);
  });

  it('el modo seguro va y viene como booleano', () => {
    guardarPreferencias(conn, { seguro: true });
    expect(preferencias(conn).correo.seguro).toBe(true);
    guardarPreferencias(conn, { seguro: false });
    expect(preferencias(conn).correo.seguro).toBe(false);
  });
});

