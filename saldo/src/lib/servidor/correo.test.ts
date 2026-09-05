import { describe, expect, it } from 'vitest';
import { remitente } from './correo';
import type { Correo } from './ajustes';

const BASE: Correo = {
  servidor: 'smtp.gmail.com',
  puerto: 587,
  seguro: false,
  usuario: 'yo@gmail.com',
  clave: 'x',
  de: '',
  para: 'yo@gmail.com'
};

describe('remitente', () => {
  it('a una direccion suelta le pone el nombre de la app delante', () => {
    // Asi en la bandeja se lee «Saldo» y no la direccion pelada.
    expect(remitente({ ...BASE, de: 'yo@gmail.com' })).toBe('"Saldo" <yo@gmail.com>');
  });

  it('si ya trae nombre, no lo toca', () => {
    expect(remitente({ ...BASE, de: 'Mi Umbrel <yo@gmail.com>' })).toBe(
      'Mi Umbrel <yo@gmail.com>'
    );
  });

  it('sin remitente, tira de la cuenta que envia', () => {
    expect(remitente(BASE)).toBe('"Saldo" <yo@gmail.com>');
  });

  it('aguanta los espacios de sobra al pegar', () => {
    expect(remitente({ ...BASE, de: '  yo@gmail.com  ' })).toBe('"Saldo" <yo@gmail.com>');
  });

  it('sin nada de nada, devuelve vacio', () => {
    expect(remitente({ ...BASE, usuario: '', de: '' })).toBe('');
  });
});
