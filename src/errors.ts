import { Resolucion } from './types';

/**
 * Error al descargar un PDF. Lleva consigo la resolución que falló y, si el fallo fue HTTP, el status code.
 */
export class DescargaError extends Error {
  constructor(
    public readonly resolucion: Resolucion,
    mensaje: string,
    public readonly httpStatus?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(mensaje);
    this.name = 'DescargaError';
  }
}