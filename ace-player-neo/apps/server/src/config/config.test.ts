/* Configuración: mismos defectos, acotaciones y saneados que la 0.6.59
   (backend-modulos §1; server.js:10-122 y 5158) más las variables nuevas y
   las claves derivadas con HKDF (arquitectura §5.3). */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULTS, clampedInt, loadConfig, sanitizeHost } from './index.js';
import { KEY_LABELS, MIN_SEED_LENGTH, deriveKey, deriveKeys } from './keys.js';

const SEED = 'una-semilla-de-prueba-larga';

describe('defectos (Compose vacío)', () => {
  const { config, warnings } = loadConfig({});

  it('rutas bajo /data', () => {
    expect(config.dataDir).toBe('/data');
    expect(config.paths.stateFile).toBe(path.join('/data', 'state.json'));
    expect(config.paths.stateBackupFile).toBe(`${path.join('/data', 'state.json')}.bak`);
    expect(config.paths.devicesFile).toBe(path.join('/data', 'v2', 'devices.json'));
    expect(config.paths.remuxDir).toBe(path.join('/data', 'remux'));
    expect(config.paths.teamsDir).toBe(path.join('/data', 'v2', 'teams'));
  });

  it('los mismos valores por defecto que server.js', () => {
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.engine).toMatchObject({
      host: DEFAULTS.acestreamHost,
      port: 6878,
      controlHost: DEFAULTS.engineControlHost,
      controlPort: 3001,
      controlToken: '',
    });
    expect(config.scanner).toMatchObject({
      host: '',
      enabled: false,
      port: 6878,
      probeTimeoutMs: 24_000,
      sampleBytes: 131_072,
      mediaProbeMs: 7000,
      retryDelayMs: 600_000,
      sustainMs: 12_000,
      jobTtlMs: 600_000 + 15 * 60 * 1000,
      badTtlMs: 600_000,
    });
    expect(config.sync).toMatchObject({
      autoSync: true,
      allowPrivateUrls: false,
      defaultWebSyncUrl: DEFAULTS.defaultWebSyncUrl,
      ipfsDelegatedRouting: 'https://delegated-ipfs.dev',
      ipfsTrustlessGateway: 'https://trustless-gateway.link',
    });
    expect(config.football).toEqual({
      apiKey: '123',
      country: 'Spain',
      days: 7,
      demoOnly: false,
      timezone: 'Europe/Madrid',
    });
    expect(config.teams).toEqual({ enabled: true });
    expect(config.ai).toEqual({
      ollamaBaseUrl: '',
      embedModel: 'embeddinggemma:300m-qat-q4_0',
      timeoutMs: 6500,
      enabled: false,
    });
    expect(config.playback.sameChannelPolicy).toBe('share');
    expect(config.logLevel).toBe('info');
    expect(config.appVersion).toBe('0.0.0-dev');
  });

  it('sin secreto: claves de este arranque y un aviso', () => {
    expect(config.security.seedSource).toBe('ephemeral');
    expect(config.security.keys.video).toHaveLength(32);
    expect(warnings.some((w) => w.includes('ACE_SEED'))).toBe(true);
  });

  it('queda congelada', () => {
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.scanner)).toBe(true);
  });
});

describe('acotaciones y saneados', () => {
  it('números fuera de rango se acotan y avisan; "0" y basura dan el defecto', () => {
    const { config, warnings } = loadConfig({
      ACE_SEED: SEED,
      FOOTBALL_DAYS: '99',
      ACESTREAM_SCANNER_TIMEOUT_MS: '1000',
      ACESTREAM_SCANNER_PORT: '0',
      OLLAMA_TIMEOUT_MS: 'rápido',
      ACESTREAM_SCANNER_RETRY_DELAY_MS: '120000',
    });
    expect(config.football.days).toBe(14);
    expect(config.scanner.probeTimeoutMs).toBe(6000);
    expect(config.scanner.port).toBe(6878);
    expect(config.ai.timeoutMs).toBe(6500);
    expect(config.scanner.retryDelayMs).toBe(120_000);
    expect(config.scanner.jobTtlMs).toBe(120_000 + 900_000);
    expect(warnings.filter((w) => /FOOTBALL_DAYS|TIMEOUT_MS|SCANNER_PORT/.test(w))).toHaveLength(4);
  });

  it('hosts: se quitan caracteres raros; vacío → defecto; el comprobador y engine_control también', () => {
    const { config } = loadConfig({
      ACE_SEED: SEED,
      ACESTREAM_HOST: ' motor;rm -rf / ',
      ACESTREAM_SCANNER_HOST: 'escaner$(x)',
      ENGINE_CONTROL_HOST: '###',
    });
    expect(config.engine.host).toBe('motorrm-rf');
    expect(config.scanner.host).toBe('escanerx');
    expect(config.scanner.enabled).toBe(true);
    expect(config.engine.controlHost).toBe(DEFAULTS.engineControlHost);
    expect(sanitizeHost('', 'x')).toBe('x');
    expect(sanitizeHost('a'.repeat(300), 'x')).toHaveLength(253);
  });

  it('clave de TheSportsDB, país, modelo de Ollama y token de engine_control', () => {
    const { config } = loadConfig({
      ACE_SEED: SEED,
      THESPORTSDB_API_KEY: ' clave!!',
      FOOTBALL_COUNTRY: 'España 2',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434///',
      OLLAMA_EMBED_MODEL: 'modelo raro:1b;',
      ENGINE_CONTROL_TOKEN: `  ${'t'.repeat(250)}  `,
    });
    expect(config.football.apiKey).toBe('clave');
    expect(config.football.country).toBe('Espaa');
    expect(config.ai.ollamaBaseUrl).toBe('http://host.docker.internal:11434');
    expect(config.ai.embedModel).toBe('modeloraro:1b');
    expect(config.ai.enabled).toBe(true);
    expect(config.engine.controlToken).toHaveLength(200);
  });

  it('Ollama con credenciales en la URL o sin http(s) queda apagado', () => {
    expect(
      loadConfig({ ACE_SEED: SEED, OLLAMA_BASE_URL: 'http://u:p@h:1' }).config.ai.enabled,
    ).toBe(false);
    expect(loadConfig({ ACE_SEED: SEED, OLLAMA_BASE_URL: 'ftp://h' }).config.ai.enabled).toBe(
      false,
    );
  });

  it('booleanos como la 0.6.59: solo "true" enciende y solo "false" apaga AUTO_SYNC', () => {
    const on = loadConfig({
      ACE_SEED: SEED,
      ALLOW_PRIVATE_SYNC_URLS: 'true',
      FOOTBALL_DEMO_ONLY: 'true',
      AUTO_SYNC: 'false',
    }).config;
    expect([on.sync.allowPrivateUrls, on.football.demoOnly, on.sync.autoSync]).toEqual([
      true,
      true,
      false,
    ]);
    const other = loadConfig({
      ACE_SEED: SEED,
      ALLOW_PRIVATE_SYNC_URLS: '1',
      AUTO_SYNC: 'no',
    }).config;
    expect([other.sync.allowPrivateUrls, other.sync.autoSync]).toEqual([false, true]);
  });

  it('PORT como server.js:5158 (Number() || 3000)', () => {
    expect(loadConfig({ ACE_SEED: SEED, PORT: '8080' }).config.port).toBe(8080);
    expect(loadConfig({ ACE_SEED: SEED, PORT: 'x' }).config.port).toBe(3000);
  });

  it('clampedInt reproduce el patrón de server.js', () => {
    expect(clampedInt(undefined, 1, 10, 5)).toBe(5);
    expect(clampedInt('0', 1, 10, 5)).toBe(5);
    expect(clampedInt('7.9', 1, 10, 5)).toBe(7);
    expect(clampedInt('-3', 1, 10, 5)).toBe(1);
  });
});

describe('variables nuevas', () => {
  it('ACE_SAME_CHANNEL_POLICY y ACE_LOG_LEVEL con defecto seguro', () => {
    const ok = loadConfig({
      ACE_SEED: SEED,
      ACE_SAME_CHANNEL_POLICY: 'HANDOFF',
      ACE_LOG_LEVEL: 'debug',
    });
    expect(ok.config.playback.sameChannelPolicy).toBe('handoff');
    expect(ok.config.logLevel).toBe('debug');
    const bad = loadConfig({
      ACE_SEED: SEED,
      ACE_SAME_CHANNEL_POLICY: 'todos',
      ACE_LOG_LEVEL: 'mucho',
    });
    expect(bad.config.playback.sameChannelPolicy).toBe('share');
    expect(bad.config.logLevel).toBe('info');
    expect(bad.warnings).toHaveLength(2);
  });

  it('APP_VERSION del entorno si el build no la inyecta', () => {
    expect(loadConfig({ ACE_SEED: SEED, APP_VERSION: '0.7.1' }).config.appVersion).toBe('0.7.1');
  });

  it('ACE_TEAM_CRESTS: solo "false" apaga los escudos; la demo también los apaga', () => {
    expect(loadConfig({ ACE_SEED: SEED }).config.teams.enabled).toBe(true);
    expect(loadConfig({ ACE_SEED: SEED, ACE_TEAM_CRESTS: 'no' }).config.teams.enabled).toBe(true);
    expect(loadConfig({ ACE_SEED: SEED, ACE_TEAM_CRESTS: 'false' }).config.teams.enabled).toBe(
      false,
    );
    expect(loadConfig({ ACE_SEED: SEED, FOOTBALL_DEMO_ONLY: 'true' }).config.teams.enabled).toBe(
      false,
    );
  });

  it('ACE_SEED manda; si falta, ENGINE_CONTROL_TOKEN (que en Compose ya es APP_SEED)', () => {
    const seeded = loadConfig({
      ACE_SEED: SEED,
      ENGINE_CONTROL_TOKEN: 'otro-token-de-control-largo',
    });
    expect(seeded.config.security.seedSource).toBe('ACE_SEED');
    expect(seeded.config.security.keys.video.equals(deriveKey(SEED, KEY_LABELS.video))).toBe(true);
    const token = 'token-de-control-bastante-largo';
    const fallback = loadConfig({ ENGINE_CONTROL_TOKEN: token });
    expect(fallback.config.security.seedSource).toBe('ENGINE_CONTROL_TOKEN');
    expect(fallback.config.security.keys.pairing.equals(deriveKey(token, KEY_LABELS.pairing))).toBe(
      true,
    );
  });

  it('un ACE_SEED demasiado corto hace fallar el arranque (seguridad)', () => {
    expect(() => loadConfig({ ACE_SEED: 'corto' })).toThrow(ConfigError);
    expect('x'.repeat(MIN_SEED_LENGTH)).toHaveLength(16);
  });
});

describe('HKDF-SHA256 (arquitectura §5.3)', () => {
  it('claves de 32 bytes, deterministas y distintas por etiqueta', () => {
    const a = deriveKeys(SEED);
    const b = deriveKeys(SEED);
    expect(a.video).toHaveLength(32);
    expect(a.video.equals(b.video)).toBe(true);
    expect(a.video.equals(a.pairing)).toBe(false);
    expect(deriveKeys('otra-semilla-cualquiera').video.equals(a.video)).toBe(false);
    expect(KEY_LABELS).toEqual({
      video: 'ace-video-v1',
      pairing: 'ace-pair-v1',
      iptvSecrets: 'ace-iptv-v1',
      iptvIds: 'ace-iptv-id-v1',
      iptvIdTag: 'ace-iptv-tag-v1',
    });
    /* Las tres de la IPTV (docs/iptv.md §2.3) son independientes entre sí y de las demás. */
    const iptv = [a.iptv.secrets, a.iptv.ids, a.iptv.idTag];
    expect(new Set([a.video, a.pairing, ...iptv].map((key) => key.toString('hex'))).size).toBe(5);
    expect(a.iptv.secrets.equals(deriveKey(SEED, KEY_LABELS.iptvSecrets))).toBe(true);
  });

  it('vector fijo: si cambia la derivación, todas las URLs firmadas dejan de valer', () => {
    expect(deriveKey('semilla-fija-de-prueba', 'ace-video-v1').toString('hex')).toBe(
      '9532f6618a2262f0a60106d52985de15fa390a6f89b98e7b828c29cdbd79a277',
    );
  });
});
