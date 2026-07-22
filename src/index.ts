import { HttpClient } from './http-client';
import { JsfSession } from './jsf-session';
import { parseFilas, parsePaginador } from './parser';
import { guardarResultados, guardarFallidos, Fallido } from './storage';
import { DELAY_MS, DOWNLOAD_DELAY_MS, MAX_INTENTOS, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from './config';
import { delay } from './utils';
import { Resolucion } from './types';
import { conReintentos } from './retry';
import { DescargaError } from './errors';
import { nombreArchivo, filenameDesdeHeader, guardarPdf, yaDescargado } from './pdf-downloader';

/**
 * Descarga los PDFs de las filas de la página cargada ahora mismo.
 * Debe llamarse JUSTO tras parsear esa página: el servidor solo resuelve la
 * descarga de filas que están en la ventana actual del datatable.
 */
async function descargarPdfsDe(
  session: JsfSession,
  filas: Resolucion[],
  fallidos: Fallido[],
): Promise<void> {
  for (const res of filas) {
    if (!res.pdfUuid) continue; // confidencial: no hay PDF
    if (yaDescargado(res)) {
      console.log(`  · nro ${res.nro}: ya descargado, salteo.`);
      continue;
    }

    try {
      const { bytes, contentDisposition } = await conReintentos(
        () => session.descargarPdf(res),
        {
          intentosMax: MAX_INTENTOS,
          baseMs: BACKOFF_BASE_MS,
          maxMs: BACKOFF_MAX_MS,
          esReintentable: esReintentableDescarga,
          retryAfterMs: (err) => (err instanceof DescargaError ? err.retryAfterMs ?? null : null),
          onReintento: (intento, esperaMs, err) => {
            const m = err instanceof Error ? err.message : String(err);
            console.warn(`    ↻ nro ${res.nro}: intento ${intento} falló (${m}); reintento en ${Math.round(esperaMs)}ms`);
          },
        },
      );
      const nombre = nombreArchivo(res, filenameDesdeHeader(contentDisposition));
      guardarPdf(nombre, bytes);
      console.log(`  ✓ nro ${res.nro}: ${nombre} (${(bytes.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      // Se agotaron los reintentos (o el error no era reintentable): registrar y seguir.
      const motivo = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ nro ${res.nro}: FALLÓ tras reintentos (${motivo}). Registrado.`);
      fallidos.push({
        nro: res.nro,
        pdfUuid: res.pdfUuid,
        pdfSourceId: res.pdfSourceId,
        pagina: res.pagina,
        motivo,
        fecha: new Date().toISOString(),
      });
    }

    await delay(DOWNLOAD_DELAY_MS);
  }
}
/** Un error de descarga se reintenta si es transitorio (429/5xx o red). */
function esReintentableDescarga(err: unknown): boolean {
  if (err instanceof DescargaError) {
    return err.httpStatus === 429 || (err.httpStatus ?? 0) >= 500;
  }
  return true;
}

/**
 * Uso:
 *   npm start              -> metadata de todas las páginas
 *   npm start -- 3         -> metadata de las primeras 3 páginas
 *   npm start -- 3 pdf     -> metadata + descarga de PDFs de las primeras 3
 */
async function main(): Promise<void> {
  const maxArg = process.argv[2];
  const descargar = process.argv[3] === 'pdf';

  const http = new HttpClient();
  const session = new JsfSession(http);

  console.log('Iniciando sesión JSF...');
  await session.init();
  await delay(DELAY_MS);

  console.log('Ejecutando búsqueda...');
  const primeraPaginaHtml = await session.buscar();
  const { totalPaginas, totalRegistros } = parsePaginador(primeraPaginaHtml);
  console.log(`El servidor reporta ${totalRegistros} registros en ${totalPaginas} páginas.`);
  if (descargar) console.log('Descarga de PDFs: ACTIVADA.');

  const maxPaginas = maxArg ? Math.min(Number(maxArg), totalPaginas) : totalPaginas;

  // La metadata se reconstruye fresca en cada corrida (rápida y determinística).
  // La reanudación de descargas la maneja yaDescargado() mirando el disco.
  const todas: Resolucion[] = [];
  const fallidos: Fallido[] = [];

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    // La página 1 ya vino en la búsqueda; el resto se pide con irAPagina.
    let html: string;
    if (pagina === 1) {
      html = primeraPaginaHtml;
    } else {
      await delay(DELAY_MS);
      html = await session.irAPagina(pagina);
    }

    const filas = parseFilas(html, pagina);
    todas.push(...filas);
    console.log(`Página ${pagina}/${totalPaginas}: ${filas.length} filas (acumulado: ${todas.length}).`);

    if (descargar) await descargarPdfsDe(session, filas, fallidos);

    if (pagina % 10 === 0 || pagina === maxPaginas) {
      guardarResultados(todas);
      if (descargar) guardarFallidos(fallidos);
    }
  }

    guardarResultados(todas);
  if (descargar) {
    guardarFallidos(fallidos);
    console.log(`\nDescargas fallidas: ${fallidos.length}` +
      (fallidos.length > 0 ? ' (ver data/fallidos.json — se reintentan al volver a correr).' : '.'));
  }

  // --- Sanity checks finales ---
  console.log('\n--- Resumen ---');
  console.log(`Filas extraídas: ${todas.length}`);
  if (maxPaginas === totalPaginas) {
    const ok = todas.length === totalRegistros;
    console.log(`${ok ? '✓' : '✗'} Conteo: ${totalRegistros} esperados, ${todas.length} extraídos.`);
  }
  const conPdf = todas.filter((r) => r.pdfUuid !== '');
  const sinPdf = todas.length - conPdf.length;
  const uuidsUnicos = new Set(conPdf.map((r) => r.pdfUuid)).size;
  const duplicados = conPdf.length - uuidsUnicos;
  console.log(`Filas con PDF: ${conPdf.length}  |  confidenciales sin PDF: ${sinPdf}`);
  console.log(`UUIDs únicos (entre las que tienen PDF): ${uuidsUnicos}`);
  console.log(duplicados > 0 ? `⚠ ${duplicados} PDF(s) referenciados por más de una fila.` : '✓ Sin PDFs duplicados.');
  console.log('Resultados guardados en data/resoluciones.json');
}

main().catch((err) => {
  console.error('Error fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});