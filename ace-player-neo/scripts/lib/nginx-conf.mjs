// Lector mínimo de la sintaxis de nginx para los tests de empaquetado.
//
// Por qué no basta con expresiones regulares sobre el texto: lo que hay que
// comprobar es por bloque ("toda location que llega a storage pone
// X-Ace-Origin"), y un grep no sabe en qué location está cada línea. Esto
// reproduce lo justo del lector de nginx (ngx_conf_read_token): palabras,
// comillas, comentarios, ";" y bloques con llaves, con las mismas reglas de
// escape que nginx aplica ANTES de compilar una expresión regular.

/**
 * @typedef {object} Token
 * @property {string} value
 * @property {boolean} quoted
 * @property {number} line
 */

/**
 * @typedef {object} Directive
 * @property {string} name
 * @property {string[]} args
 * @property {Directive[] | null} block  null si la directiva acaba en ";"
 * @property {number} line
 */

/**
 * Escapes de nginx: \" \' y \\ quitan la barra; \t \r \n son los caracteres
 * de control; cualquier otra barra se queda tal cual (por eso "\." llega
 * intacto a PCRE y "\\" se convierte en una sola barra).
 * @param {string} raw
 */
function unescapeNginx(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (ch === '\\' && next !== undefined) {
      if (next === '"' || next === "'" || next === '\\') {
        out += next;
        i += 1;
        continue;
      }
      if (next === 't' || next === 'r' || next === 'n') {
        out += next === 't' ? '\t' : next === 'r' ? '\r' : '\n';
        i += 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  let line = 1;
  while (i < text.length) {
    const ch = /** @type {string} */ (text[i]);
    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '{' || ch === '}' || ch === ';') {
      tokens.push({ value: ch, quoted: false, line });
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const startLine = line;
      let rawValue = '';
      i += 1;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\' && i + 1 < text.length) {
          rawValue += text.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (text[i] === '\n') line += 1;
        rawValue += text[i];
        i += 1;
      }
      if (i >= text.length)
        throw new Error(`nginx.conf: comillas sin cerrar en la línea ${startLine}`);
      i += 1;
      tokens.push({ value: unescapeNginx(rawValue), quoted: true, line: startLine });
      continue;
    }
    let rawValue = '';
    while (i < text.length && !/[\s{};]/.test(/** @type {string} */ (text[i]))) {
      if (text[i] === '\\' && i + 1 < text.length) {
        rawValue += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      rawValue += text[i];
      i += 1;
    }
    tokens.push({ value: unescapeNginx(rawValue), quoted: false, line });
  }
  return tokens;
}

/**
 * @param {string} text
 * @returns {Directive[]}
 */
export function parseNginx(text) {
  const tokens = tokenize(text);
  let pos = 0;

  /**
   * @param {number} depth
   * @returns {Directive[]}
   */
  const parseBlock = (depth) => {
    /** @type {Directive[]} */
    const out = [];
    /** @type {Token[]} */
    let words = [];
    while (pos < tokens.length) {
      const token = /** @type {Token} */ (tokens[pos]);
      pos += 1;
      const isPunct = !token.quoted;
      if (isPunct && token.value === ';') {
        const [head, ...rest] = words;
        if (!head) throw new Error(`nginx.conf: ";" suelto en la línea ${token.line}`);
        out.push({
          name: head.value,
          args: rest.map((w) => w.value),
          block: null,
          line: head.line,
        });
        words = [];
        continue;
      }
      if (isPunct && token.value === '{') {
        const [head, ...rest] = words;
        if (!head) throw new Error(`nginx.conf: bloque sin nombre en la línea ${token.line}`);
        const block = parseBlock(depth + 1);
        out.push({ name: head.value, args: rest.map((w) => w.value), block, line: head.line });
        words = [];
        continue;
      }
      if (isPunct && token.value === '}') {
        if (depth === 0) throw new Error(`nginx.conf: "}" de más en la línea ${token.line}`);
        if (words.length > 0) {
          throw new Error(`nginx.conf: falta ";" antes de la línea ${token.line}`);
        }
        return out;
      }
      words.push(token);
    }
    if (depth > 0) throw new Error('nginx.conf: falta cerrar una llave');
    if (words.length > 0) throw new Error('nginx.conf: la última directiva no acaba en ";"');
    return out;
  };

  return parseBlock(0);
}

/**
 * Todas las directivas con ese nombre, a cualquier profundidad (también dentro
 * de los "if").
 * @param {Directive[]} directives
 * @param {string} name
 * @returns {Directive[]}
 */
export function findAll(directives, name) {
  /** @type {Directive[]} */
  const found = [];
  for (const directive of directives) {
    if (directive.name === name) found.push(directive);
    if (directive.block) found.push(...findAll(directive.block, name));
  }
  return found;
}

/**
 * El único bloque server de la configuración.
 * @param {Directive[]} tree
 */
export function serverBlock(tree) {
  const servers = tree.filter((directive) => directive.name === 'server');
  if (servers.length !== 1 || !servers[0]?.block) {
    throw new Error(`nginx.conf: se esperaba un único server{} y hay ${servers.length}`);
  }
  return servers[0].block;
}

/**
 * Las location del server, con su patrón tal cual ("/api/", "= /sw.js").
 * @param {Directive[]} tree
 * @returns {{ match: string, block: Directive[], line: number }[]}
 */
export function locations(tree) {
  return serverBlock(tree)
    .filter((directive) => directive.name === 'location' && directive.block)
    .map((directive) => ({
      match: directive.args.join(' '),
      block: /** @type {Directive[]} */ (directive.block),
      line: directive.line,
    }));
}

/**
 * @param {Directive[]} tree
 * @param {string} match  patrón exacto de la location, p. ej. "/api/" o "= /sw.js"
 */
export function location(tree, match) {
  const found = locations(tree).find((candidate) => candidate.match === match);
  if (!found) throw new Error(`nginx.conf: no hay location ${match}`);
  return found.block;
}

/**
 * Valores de una directiva dentro de un bloque (sin bajar a los if).
 * @param {Directive[]} block
 * @param {string} name
 */
export function directiveArgs(block, name) {
  return block.filter((directive) => directive.name === name).map((directive) => directive.args);
}

/**
 * Cabeceras que un bloque manda al upstream: nombre en minúsculas → valor.
 * @param {Directive[]} block
 */
export function proxyHeaders(block) {
  /** @type {Map<string, string>} */
  const headers = new Map();
  for (const [name, value] of directiveArgs(block, 'proxy_set_header')) {
    if (name) headers.set(name.toLowerCase(), value ?? '');
  }
  return headers;
}

/**
 * Traduce un map de nginx a una función. Mismo orden que nginx: primero las
 * cadenas exactas, luego las expresiones regulares en el orden en que
 * aparecen ("~" distingue mayúsculas, "~*" no) y al final default.
 * Las expresiones de esta configuración son compatibles con las de JavaScript.
 * @param {Directive[]} tree
 * @param {string} variable  p. ej. "$ace_origin"
 * @returns {(value: string) => string}
 */
export function mapFunction(tree, variable) {
  const map = tree.find((directive) => directive.name === 'map' && directive.args[1] === variable);
  if (!map?.block) throw new Error(`nginx.conf: no hay map para ${variable}`);
  /** @type {Map<string, string>} */
  const exact = new Map();
  /** @type {{ regex: RegExp, value: string }[]} */
  const regexes = [];
  let fallback = '';
  for (const entry of map.block) {
    const value = entry.args[0] ?? '';
    if (entry.name === 'default') fallback = value;
    else if (entry.name.startsWith('~*')) {
      regexes.push({ regex: new RegExp(entry.name.slice(2), 'i'), value });
    } else if (entry.name.startsWith('~')) {
      regexes.push({ regex: new RegExp(entry.name.slice(1)), value });
    } else exact.set(entry.name, value);
  }
  return (input) => {
    const direct = exact.get(input);
    if (direct !== undefined) return direct;
    for (const { regex, value } of regexes) if (regex.test(input)) return value;
    return fallback;
  };
}
