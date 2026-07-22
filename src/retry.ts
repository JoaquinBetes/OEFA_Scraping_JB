import { delay } from './utils';

/** Configuración de una política de reintentos. */
export interface OpcionesReintento {
  /** Cantidad total de intentos (el primero + los reintentos). */
  intentosMax: number;
  /** Demora base del backoff. */
  baseMs: number;
  /** Techo de la demora. */
  maxMs: number;

  esReintentable: (err: unknown) => boolean;
  /** Si el error trae un Retry-After, cuántos ms esperar. */
  retryAfterMs?: (err: unknown) => number | null;
  /** Callback para loguear cada reintento. */
  onReintento?: (intento: number, esperaMs: number, err: unknown) => void;
}

/**
 * Ejecuta `op`, reintentando ante errores transitorios con backoff exponencial.
 * Devuelve el resultado si algún intento tiene éxito; si se agotan, relanza el último error.
 */
export async function conReintentos<T>(op: () => Promise<T>, opts: OpcionesReintento): Promise<T> {
  let ultimoError: unknown;

  for (let intento = 1; intento <= opts.intentosMax; intento++) {
    try {
      return await op();
    } catch (err) {
      ultimoError = err;

      if (intento === opts.intentosMax || !opts.esReintentable(err)) {
        throw err;
      }

      //backoff exponencial (base × 2^(intento-1), con techo) + jitter.
      const sugerido = opts.retryAfterMs ? opts.retryAfterMs(err) : null;
      const backoff = Math.min(opts.baseMs * 2 ** (intento - 1), opts.maxMs);
      const esperaMs = sugerido ?? backoff + Math.random() * opts.baseMs;

      if (opts.onReintento) opts.onReintento(intento, esperaMs, err);
      await delay(esperaMs);
    }
  }

  throw ultimoError;
}