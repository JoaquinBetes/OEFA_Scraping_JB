import * as cheerio from 'cheerio';
import { Resolucion } from './types';

/**
 * Parsea el HTML de la grilla de resoluciones y devuelve las filas como objetos.
 *
 * Funciona tanto con el HTML completo del listado (respuesta de "buscar") como
 * con el fragmento de solo-filas que devuelve la paginación (dt_skipChildren=true),
 * porque ancla en `tr[data-ri]`, presente en ambos casos.
 *
 * @param html    HTML de la tabla (contenido del update de JSF).
 * @param pagina  Número de página.
 */
export function parseFilas(html: string, pagina: number): Resolucion[] {
  // La paginación (dt_skipChildren) devuelve <tr> sueltos, sin <table>.
  // El parser HTML5 por defecto (parse5) descarta filas huérfanas, así que
  // si no viene una tabla, envolvemos el fragmento para darle estructura válida.
  const fragmento = /<table/i.test(html)
    ? html
    : `<table><tbody>${html}</tbody></table>`;
  const $ = cheerio.load(fragmento);
  const filas: Resolucion[] = [];

  // Solo las filas de datos tienen el atributo data-ri. La fila vacía("sin registros") y la cabecera no lo tienen, así que quedan afuera.
  $('tr[data-ri]').each((_, tr) => {
    const celdas = $(tr).find('> td');
    if (celdas.length < 7) return; // fila con forma inesperada: la salteamos

    // El link de descarga trae, en su onclick, los dos datos que necesita
    // el POST de descarga: la clave del componente y el UUID del documento.
    const onclick = $(celdas[6]).find('a[onclick]').attr('onclick') ?? '';
    const pdfSourceId = onclick.match(/'([^']*:dt:\d+:[^']*)'/)?.[1] ?? '';
    const pdfUuid = onclick.match(/param_uuid'\s*:\s*'([^']+)'/)?.[1] ?? '';

    filas.push({
      nro: Number(limpiar($(celdas[0]).text())),
      numeroExpediente: splitMultilinea($(celdas[1]).text()).join(' / '),
      administrados: splitMultilinea($(celdas[2]).text()),
      unidadFiscalizable: limpiar($(celdas[3]).text()),
      sector: limpiar($(celdas[4]).text()),
      nroResolucionApelacion: limpiar($(celdas[5]).text()),
      pdfUuid,
      pdfSourceId,
      pagina,
    });
  });

  return filas;
}

/** Colapsa espacios/saltos internos y recorta los extremos. */
function limpiar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * Parte una celda multivalor (varios ítems separados por saltos de línea) en un array limpio, descartando líneas vacías.
 */
function splitMultilinea(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((s) => limpiar(s))
    .filter((s) => s.length > 0);
}

/**
 * Lee el texto del paginador ("Página 1 de 176 (1753 registros)") y devuelve los totales.
 */
export function parsePaginador(html: string): { totalPaginas: number; totalRegistros: number } {
  const $ = cheerio.load(html);
  const texto = $('.ui-paginator-current').first().text();
  const m = texto.match(/Página \d+ de (\d+) \((\d+) registros\)/);
  if (!m) {
    throw new Error(`No pude interpretar el paginador. Texto recibido: "${texto}"`);
  }
  return { totalPaginas: Number(m[1]), totalRegistros: Number(m[2]) };
}