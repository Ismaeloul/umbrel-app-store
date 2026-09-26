/* Abreviaturas, apodos y alias del buscador «como Google» (docs/iptv.md §20).
   Es una TABLA DE DATOS: se puede editar a mano y tiene sus pruebas
   (packages/shared/test/search-aliases.test.ts).

   Cada grupo junta nombres que una persona usa para lo MISMO. El primero es
   el nombre de siempre (el que se manda al motor AceStream si se escribe un
   alias: «t5» → «Telecinco»). Todos se comparan sin tildes ni mayúsculas y
   con la misma limpieza que el buscador (`searchFold`): «Barça» = «barca»,
   «M+» = «Movistar», «LaLiga» = «La Liga».

   Dos clases de nombre:
   - «de verdad» (sin marca): como sale escrito en una lista, en la agenda o
     en un canal («Real Madrid», «Liga de Campeones», «Telecinco»). Un texto
     que lo lleva ES eso;
   - «~» delante: solo lo escribe una persona al buscar (códigos de 3 letras,
     apodos, palabras sueltas: «~RMA», «~Madrid», «~la Roja», «~T5»). Buscar
     «~Madrid» encuentra el Real Madrid, pero un texto que dice «Madrid»
     (el Atlético de Madrid, el Madrid CFF) no pasa a ser el Real Madrid.

   Solo sirven para BUSCAR. El emparejado automático de canales (partido →
   IPTV/AceStream, `channelSpelling`, `normalizeChannelKey`, `sameChannel`…)
   no importa esta tabla y sigue con sus reglas estrictas: un alias nunca
   decide qué canal suena solo.

   Reglas para añadir filas:
   - Un nombre corto y ambiguo NO va (p. ej. «copa», «bar», «liga», «real»):
     traería de todo. Los códigos de 3 letras de las pastillas de escudo sí
     (ING, ESP, RMA, FCB, ATM…), con «~», porque la app ya los enseña.
   - Nunca juntar dos cosas distintas: «Liga F» no es «LaLiga», «Hypermotion»
     (Segunda) no es «Primera», «Real Madrid» no es «Real Sociedad», «DAZN 1»
     no es «DAZN 2». Un nombre no puede estar en dos grupos (hay prueba).
   - «Madrid» va con el Real Madrid: sale primero y el Atlético después (el
     Atlético casa igual por la palabra «Madrid»). */

/** Qué es lo que nombra un grupo (para las pruebas y para ordenar). */
export type SearchAliasKind = 'team' | 'national' | 'competition' | 'channel' | 'sport';

export interface SearchAliasGroup {
  /** Identificador estable (pruebas). */
  readonly id: string;
  readonly kind: SearchAliasKind;
  /** El primero es el nombre de siempre; el resto, sus alias («~» delante: solo de la consulta). */
  readonly names: readonly string[];
}

const group =
  (kind: SearchAliasKind) =>
  (id: string, ...names: string[]): SearchAliasGroup => ({ id, kind, names });
const national = group('national');
const team = group('team');
const competition = group('competition');
const channel = group('channel');
const sport = group('sport');

/**
 * La tabla. Los códigos de 3 letras son los de las pastillas de escudo
 * (`teamShort` de la web: los de TheSportsDB o las iniciales del nombre).
 */
// prettier-ignore
export const SEARCH_ALIASES: readonly SearchAliasGroup[] = [
  /* --- Selecciones --- */
  national('espana', 'España', 'Spain', 'Selección Española', '~ESP', '~la Roja', '~Selección'),
  national('inglaterra', 'Inglaterra', 'England', '~ING', '~ENG'),
  national('francia', 'Francia', 'France', '~FRA'),
  national('italia', 'Italia', 'Italy', '~ITA', '~la Azzurra'),
  national('alemania', 'Alemania', 'Germany', 'Deutschland', '~ALE', '~GER'),
  national('portugal', 'Portugal', '~POR'),
  national('paises-bajos', 'Países Bajos', 'Holanda', 'Netherlands', '~HOL', '~NED'),
  national('belgica', 'Bélgica', 'Belgium', '~BEL'),
  national('croacia', 'Croacia', 'Croatia', '~CRO'),
  national('marruecos', 'Marruecos', 'Morocco', '~MAR'),
  national('noruega', 'Noruega', 'Norway', '~NOR'),
  national('argentina', 'Argentina', '~ARG', '~la Albiceleste'),
  national('brasil', 'Brasil', 'Brazil', '~BRA', '~la Canarinha'),
  national('estados-unidos', 'Estados Unidos', '~EEUU', '~USA'),
  national('suiza', 'Suiza', 'Switzerland', '~SUI'),
  national('escocia', 'Escocia', 'Scotland', '~SCO'),
  national('gales', 'Gales', 'Wales', '~WAL'),

  /* --- Clubes de España (apodos y códigos) --- */
  team('real-madrid', 'Real Madrid', 'Real Madrid CF', '~Madrid', '~RMA', '~los Blancos', '~Merengues'),
  team('barcelona', 'Barcelona', 'FC Barcelona', 'Barça', '~Barsa', '~FCB', '~Blaugrana', '~Culés'),
  team('atletico-madrid', 'Atlético de Madrid', 'Atlético Madrid', 'Atleti', '~ATM', '~Atlético', '~Colchoneros'),
  team('betis', 'Real Betis', 'Betis', '~BET', '~RBB', '~Béticos'),
  team('real-sociedad', 'Real Sociedad', '~la Real', '~RSO', '~Txuri-urdin'),
  team('villarreal', 'Villarreal', '~el Submarino', '~Submarino Amarillo', '~VIL'),
  team('athletic', 'Athletic Club', 'Athletic Bilbao', 'Athletic', '~ATH', '~los Leones'),
  team('sevilla', 'Sevilla', 'Sevilla FC', '~SEV'),
  team('valencia', 'Valencia', 'Valencia CF', '~VAL', '~el Che'),
  team('celta', 'Celta de Vigo', 'Celta', 'RC Celta', '~CEL'),
  team('deportivo', 'Deportivo de La Coruña', 'Deportivo La Coruña', '~Depor', '~Deportivo', '~DEP'),
  team('espanyol', 'Espanyol', 'RCD Espanyol', '~Español', '~Periquitos'),
  team('rayo', 'Rayo Vallecano', 'Rayo', '~RAY'),
  team('osasuna', 'Osasuna', 'CA Osasuna', '~OSA'),
  team('getafe', 'Getafe', 'Getafe CF', '~GET'),
  team('girona', 'Girona', 'Girona FC', 'Gerona', '~GIR'),
  team('mallorca', 'Mallorca', 'RCD Mallorca', '~MLL'),
  team('alaves', 'Alavés', 'Deportivo Alavés', '~ALA', '~el Glorioso'),
  team('las-palmas', 'Las Palmas', 'UD Las Palmas', '~LPA'),
  team('leganes', 'Leganés', 'CD Leganés', '~Lega', '~LEG'),
  team('valladolid', 'Valladolid', 'Real Valladolid', '~Pucela', '~VLL'),
  team('oviedo', 'Real Oviedo', 'Oviedo', '~OVI'),
  team('sporting', 'Sporting de Gijón', 'Sporting Gijón', '~Sporting', '~SPG'),
  team('racing', 'Racing de Santander', 'Racing Santander', '~Racing', '~RAC'),
  team('zaragoza', 'Real Zaragoza', 'Zaragoza', '~ZAR'),
  team('elche', 'Elche', 'Elche CF', '~ELC'),
  team('levante', 'Levante', 'Levante UD', '~LEV'),

  /* --- Clubes de fuera que se escriben de muchas formas --- */
  team('manchester-city', 'Manchester City', 'Man City', '~City', '~MCI'),
  team('manchester-united', 'Manchester United', 'Man United', 'Man Utd', '~MUN'),
  team('psg', 'Paris Saint-Germain', 'PSG', 'París SG', 'Paris SG'),
  team('bayern', 'Bayern de Múnich', 'Bayern Múnich', 'Bayern München', 'Bayern'),
  team('inter', 'Inter de Milán', 'Inter', 'Internazionale'),
  team('milan', 'AC Milan', '~Milan', '~MIL'),
  team('juventus', 'Juventus', '~Juve', '~JUV'),

  /* --- Competiciones --- */
  competition('ucl', 'Liga de Campeones', 'Champions League', 'UEFA Champions League', 'Champions', '~UCL', '~Copa de Europa'),
  competition('uel', 'Europa League', 'UEFA Europa League', 'Liga Europa', '~UEL'),
  competition('uecl', 'Conference League', 'UEFA Conference League', '~Conference', '~UECL', '~Liga Conferencia'),
  competition('laliga', 'LaLiga', 'LaLiga EA Sports', 'Liga EA Sports', '~Primera', '~Primera División', '~Liga Española'),
  competition('hypermotion', 'LaLiga Hypermotion', 'Hypermotion', 'LaLiga TV Hypermotion', 'LaLiga SmartBank', 'Segunda División', '~Segunda', '~LaLiga 2', '~SmartBank'),
  competition('primera-federacion', 'Primera Federación', '1 Federación', 'Primera RFEF', '~1 RFEF', '~1ª Federación'),
  competition('segunda-federacion', 'Segunda Federación', '2 Federación', 'Segunda RFEF', '~2 RFEF', '~2ª Federación'),
  competition('liga-f', 'Liga F', 'Liga F Moeve', 'Primera División Femenina', '~Liga Femenina'),
  competition('copa-del-rey', 'Copa del Rey', 'Copa de SM el Rey'),
  competition('supercopa', 'Supercopa de España', 'Supercopa'),
  competition('unl', 'Nations League', 'UEFA Nations League', 'Liga de Naciones', '~UNL'),
  competition('mundial', 'Mundial', 'Copa del Mundo', 'World Cup', 'Copa Mundial'),
  competition('eurocopa', 'Eurocopa', 'UEFA Euro', 'Campeonato de Europa', '~Euro'),
  competition('premier', 'Premier League', '~Premier', '~Liga Inglesa', '~EPL'),
  competition('serie-a', 'Serie A', '~Calcio', '~Liga Italiana'),
  competition('bundesliga', 'Bundesliga', '~Liga Alemana'),
  competition('ligue-1', 'Ligue 1', '~Liga Francesa'),
  competition('libertadores', 'Copa Libertadores', 'Libertadores'),
  competition('mundial-clubes', 'Mundial de Clubes', 'Club World Cup'),

  /* --- Canales --- */
  channel('movistar', 'Movistar', '~Movistar Plus+', '~M+', '~M.', '~Mov'),
  channel('telecinco', 'Telecinco', '~Tele 5', '~T5'),
  channel('lasexta', 'laSexta', '~La 6', '~Sexta'),
  channel('teledeporte', 'Teledeporte', '~TDP', '~TVE Deportes'),
  channel('rmtv', 'Real Madrid TV', '~RMTV'),
  channel('antena3', 'Antena 3', '~A3', '~Antena Tres'),
  channel('la1', 'La 1', 'TVE La 1', '~TVE 1', '~La Uno'),
  channel('la2', 'La 2', 'TVE La 2', '~TVE 2', '~La Dos'),
  channel('cuatro', 'Cuatro', '~Canal Cuatro'),
  channel('gol', 'Gol', 'Gol Play'),
  channel('bein', 'beIN Sports', 'beIN', '~Bein Sport', '~Be In Sports'),
  channel('eurosport', 'Eurosport', '~Euro Sport'),
  channel('barca-tv', 'Barça TV', 'Barça One'),
  channel('tvg', 'TVG', 'TV Galicia', 'Televisión de Galicia'),
  channel('etb', 'ETB', 'Euskal Telebista'),

  /* --- Deportes --- */
  sport('baloncesto', 'Baloncesto', 'Basket', 'Basketball', '~Básquet'),
  sport('f1', 'Fórmula 1', 'F1', 'Formula One', '~Fórmula Uno'),
  sport('motogp', 'MotoGP', '~Motociclismo'),
  sport('futbol', 'Fútbol', 'Football', 'Soccer'),
  sport('tenis', 'Tenis', 'Tennis'),
  sport('balonmano', 'Balonmano', 'Handball'),
  sport('ciclismo', 'Ciclismo', 'Cycling'),
];
