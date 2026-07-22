import * as fs from 'fs';
import * as path from 'path';
import { PDF_DIR } from './config';
import { Resolucion } from './types';

/** Extrae el filename de un header Content-Disposition, o null si no viene. */
export function filenameDesdeHeader(cd: string | undefined): string | null {
  if (!cd) return null;
  const m = cd.match(/filename="?([^";]+)"?/i);
  return m ? m[1].trim() : null;
}

/** Reemplaza caracteres inválidos para nombres de archivo (Windows y Linux). */
export function sanitizar(nombre: string): string {
  return nombre
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // ilegales en Windows + caracteres de control
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nombre de archivo descriptivo Y único:
 *   <nro con ceros>_<nombre del servidor o el uuid>.pdf
 */
export function nombreArchivo(res: Resolucion, filenameServidor: string | null): string {
  const prefijo = String(res.nro).padStart(4, '0');
  let base = filenameServidor ? sanitizar(filenameServidor) : `doc_${res.pdfUuid}.pdf`;
  if (!base.toLowerCase().endsWith('.pdf')) base += '.pdf';
  return `${prefijo}_${base}`;
}

export function yaDescargado(res: Resolucion): boolean {
  if (!fs.existsSync(PDF_DIR)) return false;
  const prefijo = String(res.nro).padStart(4, '0') + '_';
  return fs.readdirSync(PDF_DIR).some((f) => f.startsWith(prefijo));
}

/** Guarda los bytes del PDF en la carpeta pdfs/. */
export function guardarPdf(nombre: string, bytes: Buffer): void {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  fs.writeFileSync(path.join(PDF_DIR, nombre), bytes);
}