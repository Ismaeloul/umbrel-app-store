/* «Descargar fallos» (0.9.0): la redacción del texto libre y la
   clasificación «nuestro» / «de fuera» (src/domain/faults.ts). */

import { describe, expect, it } from 'vitest';
import {
  classifyCode,
  classifyLogLine,
  classifyWebEntry,
  DiagnosticsExportBodySchema,
  redactReportText,
  redactReportValue,
  REPORT_REDACTED,
  summarizeFaults,
  V1_ROUTES,
} from '../src/index.js';

describe('redactReportText: lo que nunca sale en el fichero', () => {
  const cases: Array<[string, string, string[]]> = [
    // [caso, texto, lo que NO puede quedar]
    [
      'Xtream con esquema',
      'abrir http://panel.example.com:8080/live/isma_2024/S3cr3t!/12345.ts falló',
      ['isma_2024', 'S3cr3t!'],
    ],
    [
      'Xtream sin esquema (en una frase)',
      'GET /movie/usuarioX/claveY/998.mkv → 403',
      ['usuarioX', 'claveY'],
    ],
    [
      'Xtream timeshift',
      'https://p.example/timeshift/u1/p1/60/2026-10-03:21-00/5.ts',
      ['u1', 'p1'],
    ],
    [
      'forma corta del panel',
      'http://1.example.net:80/pepe/pepe123/4567.ts',
      ['pepe/pepe123', 'pepe123'],
    ],
    [
      'query del panel',
      'http://panel.example/get.php?username=isma&password=hunter2&type=m3u_plus',
      ['isma', 'hunter2'],
    ],
    [
      'query codificada y en otro orden',
      'https://x.example/player_api.php?action=get_live&PASSWORD=p%40ss&User=yo',
      ['p%40ss', '=yo'],
    ],
    ['usuario:clave@ en la URL', 'ftp://admin:pa55@nas.example/lista.m3u', ['admin', 'pa55']],
    ['token de vídeo ?t=', '/api/v1/video/s_x/index.m3u8?t=abc.def.ghi', ['abc.def.ghi']],
    [
      'clave suelta en texto',
      'reintento con password=Hola123 y token=zzz999',
      ['Hola123', 'zzz999'],
    ],
    ['Authorization Bearer', 'Authorization: Bearer dev_iphone01.s3cretoLargo', ['s3cretoLargo']],
    ['Authorization en JSON', '{"authorization":"Basic dXNlcjpwYXNz"}', ['dXNlcjpwYXNz']],
    ['Bearer suelto', 'mandé Bearer eyJhbGciOiJIUzI1NiJ9xyz', ['eyJhbGciOiJIUzI1NiJ9xyz']],
    ['cookie', 'Cookie: umbrel_session=abc123; other=1', ['abc123']],
    ['set-cookie', 'set-cookie: sid=zz99; Path=/', ['zz99']],
    ['campo JSON con secreto', '{"username":"isma","password":"p\\"x","ok":1}', ['isma', 'p\\"x']],
    [
      'JWT',
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlMTIz',
      ['eyJzdWIiOiIxMjM0In0'],
    ],
    ['correo', 'cuenta isma.oul@gmail.com caducada', ['isma.oul@gmail.com']],
    ['IP pública', 'conecta con 81.45.123.9:8080 y 8.8.8.8.', ['81.45.123.9', '8.8.8.8']],
    ['IP pública en URL', 'http://203.0.113.7/live/a/b/1.ts', ['203.0.113.7']],
    ['IPv6 global', 'desde 2a01:4f8:c0c:1234::1 sin respuesta', ['2a01:4f8:c0c:1234::1']],
    [
      'usuario del sistema en una pila',
      'at C:\\Users\\IsmaOul\\app\\a.js:1 y at /home/ismaoul/app/b.js:2 y C:/Users/IsmaOul/c.js',
      ['IsmaOul', 'ismaoul'],
    ],
    ['ticket del relé', 'http://127.0.0.1:41234/r/AbCdEfGh12345678/in.ts', ['AbCdEfGh12345678']],
  ];

  for (const [name, text, banned] of cases) {
    it(name, () => {
      const out = redactReportText(text);
      for (const secret of banned) expect(out, out).not.toContain(secret);
    });
  }

  it('no toca lo que sirve para entender el fallo', () => {
    const keep = [
      'hash a1b2c3d4e5f60718293a4b5c6d7e8f9012345678 sin pares',
      'iptv:ip_Q2FzYTAx canal La 1',
      'a las 21:45:10 del 2026-10-03T19:45:10.000Z',
      'versión 0.9.0 y Chrome/120.0.0.0 Safari/537.36',
      'motor en 172.18.0.5:6878, NAS en 192.168.1.188, Tailscale 100.109.137.119, local 127.0.0.1',
      'http://acestream:6878/ace/getstream?id=a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
      'IPv6 local fe80::1 y ::1',
      'remux_died: ffmpeg terminó (1): Invalid data found when processing input',
      'errorCode=iptv_busy keyframe=si',
    ];
    for (const text of keep) expect(redactReportText(text)).toBe(text);
  });

  it('redactReportValue tapa por clave, recorre todo y cuenta lo tapado', () => {
    const counter = { replaced: 0 };
    const out = redactReportValue(
      {
        msg: 'abrir http://panel.example/live/u/p/1.ts',
        headers: { authorization: 'Bearer x', cookie: 'a=b' },
        iptv: { username: 'isma', password: 'clave', name: 'Casa' },
        list: ['sin nada', 'token=abc'],
        code: 'iptv_busy',
        n: 3,
        nada: null,
      },
      undefined,
      counter,
    ) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/isma|clave|Bearer x|a=b|abc|\/u\/p\//);
    expect(out.headers).toEqual({ authorization: REPORT_REDACTED, cookie: REPORT_REDACTED });
    expect((out.iptv as Record<string, unknown>).name).toBe('Casa');
    expect(out.code).toBe('iptv_busy');
    expect(out.n).toBe(3);
    expect(out.nada).toBeNull();
    expect(counter.replaced).toBe(6);
  });
});

describe('clasificación: nuestro o de fuera', () => {
  it('por código del catálogo y del registro de fallos', () => {
    expect(classifyCode('engine_unavailable')).toEqual({ side: 'nuestro', piece: 'motor' });
    expect(classifyCode('engine_stalled', 'engine')).toEqual({ side: 'nuestro', piece: 'motor' });
    expect(classifyCode('unsupported_codec', 'codec').piece).toBe('decodificacion');
    expect(classifyCode('remux_died', 'codec').piece).toBe('decodificacion');
    expect(classifyCode('remux_died', 'engine').piece).toBe('remux');
    expect(classifyCode('ffmpeg_missing').piece).toBe('remux');
    expect(classifyCode('iptv_dropped')).toEqual({ side: 'nuestro', piece: 'rele' });
    expect(classifyCode('state_unreadable', 'state').piece).toBe('datos');
    expect(classifyCode('source_no_peers', 'source')).toEqual({
      side: 'de_fuera',
      piece: 'fuente',
    });
    expect(classifyCode('player_source_failed', 'source').side).toBe('de_fuera');
    expect(classifyCode('iptv_auth_failed')).toEqual({ side: 'de_fuera', piece: 'proveedor' });
    expect(classifyCode('iptv_busy').piece).toBe('proveedor');
    expect(classifyCode('http_503', 'network')).toEqual({ side: 'de_fuera', piece: 'red' });
    expect(classifyCode('ipfs_unsupported_codec').piece).toBe('red');
    expect(classifyCode('crest_rate_limited', 'network').piece).toBe('terceros');
    expect(classifyCode('fltv_empty').piece).toBe('terceros');
  });

  it('sin código conocido, por la causa; métricas y autoplay no son fallos', () => {
    expect(classifyCode('algo_raro', 'engine').piece).toBe('motor');
    expect(classifyCode('algo_raro', 'source').piece).toBe('fuente');
    expect(classifyCode('hls_fatal', 'client', 'Vídeo que no se puede decodificar').piece).toBe(
      'decodificacion',
    );
    expect(classifyCode('hls_fatal', 'client').piece).toBe('reproductor');
    expect(classifyCode('algo_raro')).toEqual({ side: 'sin_clasificar', piece: 'otro' });
    expect(classifyCode('player_session', 'client').side).toBe('sin_clasificar');
    expect(classifyCode('autoplay_blocked', 'client').side).toBe('sin_clasificar');
  });

  it('líneas del log del servidor por código, módulo y frase', () => {
    expect(
      classifyLogLine({
        level: 'warn',
        module: 'playback',
        msg: 'IPTV: la salida no avanza; se reconecta el relé',
      }).piece,
    ).toBe('rele');
    expect(classifyLogLine({ level: 'warn', module: 'engine', msg: 'sondeo fallido' }).piece).toBe(
      'motor',
    );
    expect(
      classifyLogLine({
        level: 'warn',
        module: 'remux',
        errorCode: 'remux_died',
        msg: 'ffmpeg del remux ha terminado solo',
        error: 'codec not supported',
      }).piece,
    ).toBe('decodificacion');
    expect(
      classifyLogLine({
        level: 'warn',
        module: 'iptv',
        msg: 'IPTV: guía no descargada',
        errorCode: 'fetch_timeout',
      }).piece,
    ).toBe('red');
    expect(
      classifyLogLine({ level: 'warn', module: 'iptv', msg: 'no se pudo guardar el catálogo IPTV' })
        .piece,
    ).toBe('datos');
    expect(
      classifyLogLine({ level: 'warn', msg: 'agenda: ninguna fuente respondió a tiempo' }).piece,
    ).toBe('terceros');
    expect(classifyLogLine({ level: 'error', msg: 'algo inesperado' })).toEqual({
      side: 'nuestro',
      piece: 'servidor',
    });
    expect(classifyLogLine({ level: 'warn', msg: 'algo inesperado' }).side).toBe('sin_clasificar');
  });

  it('lo que apunta la web', () => {
    expect(classifyWebEntry({ kind: 'error', message: 'TypeError: x is undefined' })).toEqual({
      side: 'nuestro',
      piece: 'web',
    });
    expect(
      classifyWebEntry({ kind: 'console', message: '[vista] Ha fallado la agenda' }).piece,
    ).toBe('web');
    expect(classifyWebEntry({ kind: 'api', code: 'network', message: 'sin red' }).piece).toBe(
      'red',
    );
    expect(classifyWebEntry({ kind: 'api', code: 'http_502', message: '502' }).piece).toBe(
      'servidor',
    );
    expect(classifyWebEntry({ kind: 'api', code: 'internal_error', message: '500' }).piece).toBe(
      'servidor',
    );
    expect(
      classifyWebEntry({
        kind: 'player',
        message: 'Vídeo que no se puede decodificar: hls.js sigue',
      }).piece,
    ).toBe('decodificacion');
    expect(classifyWebEntry({ kind: 'player', code: 'source_no_peers', message: 'x' }).side).toBe(
      'de_fuera',
    );
    expect(classifyWebEntry({ kind: 'player', message: 'Hueco en el búfer' }).piece).toBe(
      'reproductor',
    );
  });

  it('el resumen cuenta por lado y por pieza y no cuenta lo informativo', () => {
    const summary = summarizeFaults([
      { side: 'nuestro', piece: 'rele', level: 'warn' },
      { side: 'nuestro', piece: 'rele', level: 'error' },
      { side: 'nuestro', piece: 'motor', level: 'error' },
      { side: 'de_fuera', piece: 'fuente', level: 'warn' },
      { side: 'sin_clasificar', piece: 'otro', level: 'info' },
    ]);
    expect(summary).toMatchObject({ nuestro: 3, deFuera: 1, sinClasificar: 0 });
    expect(summary.byPiece[0]).toEqual({ piece: 'rele', side: 'nuestro', count: 2 });
    expect(summary.lines[0]).toBe('Nuestro: 3 fallos (relé de la IPTV 2, motor AceStream 1).');
    expect(summary.lines[1]).toBe('De fuera: 1 fallo (fuentes que no van 1).');
    expect(summarizeFaults([]).lines).toEqual([
      'Sin fallos en lo que guardan el servidor y la web.',
    ]);
  });
});

describe('ruta y cuerpo', () => {
  it('solo web, con anti-CSRF y el anillo de la web acotado', () => {
    expect(V1_ROUTES.diagnosticsExport).toMatchObject({
      method: 'POST',
      path: '/api/v1/diagnostics/export',
      access: 'web',
      sideEffects: true,
      module: 'diagnostics',
    });
    const web = { userAgent: 'x', viewport: '390x844@3', log: [] };
    expect(DiagnosticsExportBodySchema.safeParse({ web }).success).toBe(true);
    const tooMany = Array.from({ length: 201 }, () => ({
      at: '2026-10-03T19:45:10.000Z',
      kind: 'error',
      level: 'error',
      message: 'x',
    }));
    expect(DiagnosticsExportBodySchema.safeParse({ web: { ...web, log: tooMany } }).success).toBe(
      false,
    );
    expect(DiagnosticsExportBodySchema.safeParse({ web, extra: 1 }).success).toBe(false);
  });
});
