import * as fs from 'fs';
import * as path from 'path';
import { Resolucion } from './types';

const DATA_DIR = 'data';
const RESULTADOS_FILE = path.join(DATA_DIR, 'resoluciones.json');
const FALLIDOS_FILE = path.join(DATA_DIR, 'fallidos.json');

/** Un documento cuya descarga falló tras agotar todos los reintentos. */
export interface Fallido {
  nro: number;
  pdfUuid: string;
  pdfSourceId: string;
  pagina: number;
  motivo: string;
  fecha: string;
}

export function guardarFallidos(fallidos: Fallido[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FALLIDOS_FILE, JSON.stringify(fallidos, null, 2), 'utf-8');
}

export function guardarResultados(resoluciones: Resolucion[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RESULTADOS_FILE, JSON.stringify(resoluciones, null, 2), 'utf-8');
}