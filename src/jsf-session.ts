import * as cheerio from 'cheerio';
import { HttpClient } from './http-client';
import { Resolucion } from './types';
import { DescargaError } from './errors';
import { parseRetryAfter } from './utils';
import {
  CONSULTA_TFA_PATH,
  FORM_ID,
  BTN_BUSCAR_ID,
  DATATABLE_ID,
  ROWS_PER_PAGE,
} from './config';

/**
 * Sesión JSF: encapsula el protocolo PrimeFaces/JSF sobre HTTP puro.
 */
export class JsfSession {
  /** Token de estado de la vista JSF. Se actualiza con cada respuesta. */
  private viewState = '';
  /** Campos del formulario (name, value), descubiertos de la página inicial. */
  private formFields = new Map<string, string>();

  constructor(private readonly http: HttpClient) {}

  /**
   * GET inicial: obtiene la sesión (cookie), el ViewState y los campos del form.
   * Debe llamarse una vez antes que cualquier otro método.
   */
  async init(): Promise<void> {
    const res = await this.http.get(CONSULTA_TFA_PATH);
    if (res.status !== 200) {
      throw new Error(`GET inicial: status inesperado ${res.status}`);
    }

    const $ = cheerio.load(res.data);

    const vs = $('input[name="javax.faces.ViewState"]').val();
    if (!vs) {
      throw new Error('GET inicial: no se encontró el ViewState en la página');
    }
    this.viewState = String(vs);

    // si el sitio agrega o renombra un filtro, el scraper lo envía igual.
    $(`form[id="${FORM_ID}"]`)
      .find('input[name], select[name]')
      .each((_, el) => {
        const name = $(el).attr('name')!;
        if (name === 'javax.faces.ViewState') return; // se maneja aparte
        this.formFields.set(name, $(el).val()?.toString() ?? '');
      });

    if (this.formFields.size === 0) {
      throw new Error(`GET inicial: no se encontraron campos del form "${FORM_ID}"`);
    }
  }

  /**
   * Ejecuta la búsqueda con los filtros vacíos (= todo el universo de resoluciones).
   * Devuelve el HTML del listado (contenido del update "pgLista").
   */
  async buscar(): Promise<string> {
    const body = this.buildBaseBody();
    // Estos cuatro parámetros replican el PrimeFaces.ab() del onclick del botón:
    body.set('javax.faces.partial.ajax', 'true');
    body.set('javax.faces.source', BTN_BUSCAR_ID);
    body.set('javax.faces.partial.execute', '@all');
    body.set('javax.faces.partial.render', `${FORM_ID}:pgLista ${FORM_ID}:txtNroexp`);
    body.set(BTN_BUSCAR_ID, BTN_BUSCAR_ID);

    const res = await this.http.postForm(CONSULTA_TFA_PATH, body, {
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
    });
    if (res.status !== 200) {
      throw new Error(`POST buscar: status inesperado ${res.status}`);
    }

    const updates = this.parsePartialResponse(res.data);
    const html = updates.get(`${FORM_ID}:pgLista`);
    if (!html) {
      throw new Error('POST buscar: la respuesta no incluyó el update de pgLista');
    }
    return html;
  }

    /**
   * Navega a una página del datatable y devuelve el HTML de sus filas.
   *
   * @param pagina Número de página.
   */
  async irAPagina(pagina: number): Promise<string> {
    const first = (pagina - 1) * ROWS_PER_PAGE;

    const body = this.buildBaseBody();
    body.set('javax.faces.partial.ajax', 'true');
    body.set('javax.faces.source', DATATABLE_ID);
    body.set('javax.faces.partial.execute', DATATABLE_ID);
    body.set('javax.faces.partial.render', DATATABLE_ID);
    body.set(DATATABLE_ID, DATATABLE_ID);
    body.set(`${DATATABLE_ID}_pagination`, 'true');
    body.set(`${DATATABLE_ID}_first`, String(first));
    body.set(`${DATATABLE_ID}_rows`, String(ROWS_PER_PAGE));
    body.set(`${DATATABLE_ID}_skipChildren`, 'true');
    body.set(`${DATATABLE_ID}_encodeFeature`, 'true');

    const res = await this.http.postForm(CONSULTA_TFA_PATH, body, {
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
    });
    if (res.status !== 200) {
      throw new Error(`POST paginación (página ${pagina}): status ${res.status}`);
    }

    const updates = this.parsePartialResponse(res.data);
    // En modo skipChildren, el update viene identificado con el id del datatable.
    const html = updates.get(DATATABLE_ID);
    if (html === undefined) {
      throw new Error(`Paginación página ${pagina}: la respuesta no trajo el update del datatable`);
    }
    return html;
  }

    /**
   * Descarga el PDF de una resolución. Replica el submit completo (no-AJAX)
   * el form entero + ViewState + la clave del componentede descarga y el UUID del documento.
   */
  async descargarPdf(res: Resolucion): Promise<{ bytes: Buffer; contentDisposition?: string }> {
    const body = this.buildBaseBody();
    body.set(res.pdfSourceId, res.pdfSourceId);
    body.set('param_uuid', res.pdfUuid);

    // binary=true; sin header Faces-Request (es un submit normal, no AJAX).
    const resp = await this.http.postForm(CONSULTA_TFA_PATH, body, {}, true);
    if (resp.status !== 200) {
      const retryAfterMs = parseRetryAfter(resp.headers['retry-after']);
      throw new DescargaError(res, `status HTTP ${resp.status}`, resp.status, retryAfterMs);
    }

    const bytes = Buffer.from(resp.data);
    // El servidor manda application/octet-stream, NO application/pdf. Validamos por "magic bytes": todo PDF arranca con "%PDF-". Si no, seguramente nos devolvió una página de error/HTML.
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new DescargaError(res, 'la respuesta no es un PDF (¿página de error o fila no cargada?)');
    }
    return { bytes, contentDisposition: resp.headers['content-disposition'] };
  }

  /** Body base que el POST JSF necesita: los campos del form + el ViewState vigente. */
  private buildBaseBody(): URLSearchParams {
    const body = new URLSearchParams();
    for (const [name, value] of this.formFields) {
      body.set(name, value);
    }
    body.set('javax.faces.ViewState', this.viewState);
    return body;
  }

  /**
   * Parsea una <partial-response> de JSF.
   * Devuelve un mapa id-del-update. contenido (el HTML que venía en CDATA)
   * y ENCADENA el ViewState: guarda el token nuevo para el próximo POST.
   */
  private parsePartialResponse(xml: string): Map<string, string> {
    const $ = cheerio.load(xml, { xmlMode: true });

    // JSF reporta problemas como <error> dentro del XML,
    // con status HTTP 200.
    const error = $('error');
    if (error.length > 0) {
      throw new Error(`JSF devolvió un error: ${error.text().trim()}`);
    }

    const updates = new Map<string, string>();
    $('update').each((_, el) => {
      updates.set($(el).attr('id') ?? '', $(el).text());
    });

    // El ViewState nuevo llega como un update más..
    let newViewState: string | undefined;
    for (const [id, content] of updates) {
      if (id.includes('javax.faces.ViewState')) {
        newViewState = content.trim();
        break;
      }
    }
    if (!newViewState) {
      throw new Error('partial-response sin ViewState (¿sesión expirada?)');
    }
    this.viewState = newViewState;

    return updates;
  }
}