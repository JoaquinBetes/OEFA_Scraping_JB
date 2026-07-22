
/** Máximo de intentos por descarga (el original + reintentos). */
export const MAX_INTENTOS = 5;

/** Demora base del backoff exponencial. */
export const BACKOFF_BASE_MS = 1000;

/** Techo de la demora del backoff. */
export const BACKOFF_MAX_MS = 30_000;

/** URL base del sitio. Los paths de abajo se resuelven contra esta. */
export const BASE_URL = 'https://publico.oefa.gob.pe';

/** Página de consulta de Resoluciones del Tribunal de Fiscalización Ambiental. */
export const CONSULTA_TFA_PATH = '/repdig/consulta/consultaTfa.xhtml';

/** ID del formulario JSF principal de la página (descubierto en la exploración). */
export const FORM_ID = 'listarDetalleInfraccionRAAForm';

/** ID del componente datatable (la grilla de resultados). */
export const DATATABLE_ID = `${FORM_ID}:dt`;

/** ID del botón "Buscar". */
export const BTN_BUSCAR_ID = `${FORM_ID}:btnBuscar`;

/** Registros por página que devuelve el sitio (fijo en 10 según el paginador). */
export const ROWS_PER_PAGE = 10;

/** Pausa mínima entre requests, en milisegundos, para no sobrecargar el servidor. */
export const DELAY_MS = 500;

/** User-Agent de navegador real: algunos sitios rechazan clientes "desconocidos". */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

  /** Carpeta donde se guardan los PDFs descargados. */
export const PDF_DIR = 'pdfs';

/** Pausa entre descargas (más larga que entre páginas: los PDFs son pesados y propensos a 429). */
export const DOWNLOAD_DELAY_MS = 800;