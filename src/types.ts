/**
 * Tipos de dominio del scraper.
 * Modelan una fila de la grilla de resoluciones del TFA.
 */

/** Una resolución del Tribunal de Fiscalización Ambiental (una fila de la grilla). */
export interface Resolucion {
  /** Número de orden global en la grilla (columna "Nro."). */
  nro: number;
  /** Columna "Número de expediente". Puede contener más de un expediente. */
  numeroExpediente: string;
  /** Columna "Administrado". Array porque una celda puede listar varias empresas. */
  administrados: string[];
  /** Columna "Unidad fiscalizable". */
  unidadFiscalizable: string;
  /** Columna "Sector" (Minería, Pesquería, etc.). */
  sector: string;
  /** Columna "Nro. Resolución de Apelación". */
  nroResolucionApelacion: string;
  /** UUID del documento, extraído del onclick del link de descarga. */
  pdfUuid: string;
  /** Clave del componente de descarga (ej: "...:dt:14:j_idt63"), tal cual va en el POST de descarga. */
  pdfSourceId: string;
  /** Página (1-based) de la que se extrajo la fila. */
  pagina: number;
}