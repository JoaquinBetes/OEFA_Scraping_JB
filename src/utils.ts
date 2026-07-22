/**
 * Uso: await delay(500);
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convierte el header Retry-After a milisegundos.
 */
export function parseRetryAfter(valor: string | undefined): number | undefined {
  if (!valor) return undefined;
  const segundos = Number(valor);
  return Number.isFinite(segundos) ? segundos * 1000 : undefined;
}