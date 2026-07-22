import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { BASE_URL, USER_AGENT } from './config';

/**
 * Cliente HTTP con manejo de sesión.
 *
 * Axios no persiste cookies entre requests (no es un navegador), y este sitio
 * depende de la cookie JSESSIONID para asociar cada request a la sesión JSF.
 * Esta clase captura los Set-Cookie de cada respuesta y los reenvía
 * automáticamente en los requests siguientes.
 */
export class HttpClient {
  private readonly axios: AxiosInstance;
  /** Cookies de la sesión actual, en formato "nombre=valor; nombre2=valor2". */
  private cookies = '';

  constructor() {
    this.axios = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
      // No lanzar excepción ante status != 2xx: los errores HTTP (429, 500)
      validateStatus: () => true,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
      },
    });

    // Interceptor de respuestas: si el servidor manda Set-Cookie, lo guardamos.
    this.axios.interceptors.response.use((response) => {
      const setCookies = response.headers['set-cookie'];
      if (setCookies?.length) {
        // "JSESSIONID=ABC123; Path=/repdig/; Secure; HttpOnly" -> "JSESSIONID=ABC123"
        this.cookies = setCookies.map((c) => c.split(';')[0]).join('; ');
      }
      return response;
    });
  }

  /** GET que devuelve el body como texto (HTML). */
  async get(path: string): Promise<AxiosResponse<string>> {
    return this.axios.get<string>(path, {
      responseType: 'text',
      headers: { Cookie: this.cookies },
    });
  }

  /**
   * POST de formulario (application/x-www-form-urlencoded).
   * @param binary si es true, la respuesta se recibe como Buffer (para PDFs).
   */
  async postForm(
    path: string,
    body: URLSearchParams,
    extraHeaders: Record<string, string> = {},
    binary = false,
  ): Promise<AxiosResponse> {
    return this.axios.post(path, body.toString(), {
      responseType: binary ? 'arraybuffer' : 'text',
      headers: {
        Cookie: this.cookies,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: BASE_URL,
        Referer: `${BASE_URL}/repdig/consulta/consultaTfa.xhtml`,
        ...extraHeaders,
      },
    });
  }

  /** Expone las cookies actuales (útil para logging/debug). */
  getCookies(): string {
    return this.cookies;
  }
}