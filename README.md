# Scraper — Resoluciones del Tribunal de Fiscalización Ambiental (OEFA)

Scraper en TypeScript que recorre el **Repositorio Digital de OEFA** (Perú), extrae el
catálogo completo de resoluciones del Tribunal de Fiscalización Ambiental (TFA) y descarga
los PDFs asociados.

Implementado **sin automatización de navegador**: únicamente peticiones HTTP (`axios`) y
parsing de HTML (`cheerio`).

- **Fuente:** https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml
- **Volumen:** 1753 registros distribuidos en 176 páginas de 10 filas.

> **Sobre el sitio objetivo del desafío:** el enunciado apunta a
> `jurisprudencia.pj.gob.pe`, que está bloqueado por geolocalización y requiere VPN a Perú.
> Este scraper se desarrolló contra OEFA, el sitio alternativo que el propio enunciado
> habilita. En [Sobre el sitio del Poder Judicial](#sobre-el-sitio-del-poder-judicial) está
> la evidencia del bloqueo y el análisis de qué habría que cambiar para soportarlo.

---

## Qué hace

- Recorre las 176 páginas de resultados y extrae los datos de cada resolución.
- Descarga los PDFs con nombre descriptivo en `pdfs/`.
- Detecta errores **429 (Too Many Requests)** y reintenta con **backoff exponencial**,
  respetando el header `Retry-After` cuando el servidor lo envía.
- Registra en `data/fallidos.json` los documentos que no pudo descargar.
- **Reanuda**: al volver a ejecutarlo, saltea los PDFs que ya están en disco.
- Valida el resultado con **sanity checks** antes de terminar.

## Requisitos

- Node.js 18 o superior (probado en Node 22).

## Instalación

```bash
git clone https://github.com/JoaquinBetes/oefascrapping_jb.git
cd oefascrapping_jb
npm install
```

## Uso

```bash
# Metadata de todas las páginas (sin descargar PDFs) — ~3 minutos
npm start

# Metadata de las primeras 3 páginas (prueba rápida)
npm start -- 3

# Metadata + descarga de los PDFs de las primeras 3 páginas
npm start -- 3 pdf

# Corrida completa: metadata + todos los PDFs
npm start -- 176 pdf
```

Verificar tipos (compilación):

```bash
npm run build
```

### Sobre descargar todo

Los PDFs pesan **~7 MB en promedio** (medido sobre 46 documentos: 319 MB). Con ~1610
documentos con archivo disponible, la descarga completa ronda los **11 GB y varias horas**.

El scraper está preparado para completarla si se lo deja corriendo: reanuda solo, saltea lo
ya descargado y reintenta lo que falló. Para evaluarlo alcanza con un subconjunto
(`npm start -- 5 pdf`).

## Salida

```
data/
  resoluciones.json   # todos los registros extraídos
  fallidos.json       # descargas fallidas tras agotar los reintentos
pdfs/
  0001_RTFA N° 264-2012.pdf
  0002_Res 007-2016-OEFA-TFA-SEPIM.pdf
  ...
```

Los PDFs se nombran `<nro con ceros>_<nombre sugerido por el servidor>.pdf`. El prefijo
numérico garantiza unicidad y orden; el resto viene del header `Content-Disposition`, lo que
los hace legibles.

Ejemplo de registro en `resoluciones.json`:

```json
{
  "nro": 1,
  "numeroExpediente": "891-08-PRODUCE/DIGSECOVI-Dsvs",
  "administrados": ["Corporación del Mar S.A.", "Austral Group S.A.A."],
  "unidadFiscalizable": "Planta Playa Lado Norte Puerto Malabrigo",
  "sector": "Pesquería",
  "nroResolucionApelacion": "264-2012-OEFA/TFA",
  "pdfUuid": "153a6d2a-cbed-40ef-b8ef-cd2272b19867",
  "pdfSourceId": "listarDetalleInfraccionRAAForm:dt:0:j_idt63",
  "pagina": 1
}
```

`administrados` es un array porque una misma resolución puede alcanzar a varias empresas
(la celda las separa por saltos de línea).

---

## Cómo funciona: el protocolo JSF

El sitio corre sobre **JSF (JavaServer Faces) + PrimeFaces 6.0**, lo que define toda la
estrategia del scraper.

### No hay URLs por página

En un sitio JSF no existe `?page=2`. **Toda** interacción es un `POST` a la misma URL, y el
servidor decide qué hacer según qué componente lo disparó. El estado se sostiene en dos
piezas que hay que encadenar en cada petición:

| Pieza | Dónde vive | Comportamiento |
|---|---|---|
| `JSESSIONID` | Cookie | Se obtiene en el primer GET y se reenvía siempre. |
| `javax.faces.ViewState` | Campo oculto del formulario | **Rota**: cada respuesta AJAX trae uno nuevo que debe usarse en el POST siguiente. |

Si el ViewState no se encadena, el segundo POST falla con un error críptico de JSF. Por eso
`JsfSession` centraliza ese estado y lo actualiza en cada respuesta.

### Los cuatro requests

| # | Acción | Tipo | Devuelve |
|---|---|---|---|
| 1 | GET inicial | HTML | `JSESSIONID` + ViewState + campos del formulario |
| 2 | Búsqueda (botón Buscar) | POST AJAX | XML con la tabla (página 1) y el total de registros |
| 3 | Paginación | POST AJAX | XML con las filas de la página pedida |
| 4 | Descarga de PDF | POST completo (no-AJAX) | El binario del PDF |

Las respuestas AJAX (`Faces-Request: partial/ajax`)  son XML
`<partial-response>` con el HTML incrustado en bloques `CDATA`, más un `<update>` con el
ViewState nuevo.

### Hallazgos

Estos puntos se descubrieron inspeccionando el tráfico con DevTools y verificando cada
hipótesis con peticiones reales:

1. **La búsqueda inicial viene vacía.** El GET devuelve la grilla con
   `Página 1 de 1 (0 registros)`. Hay que enviar el POST del botón "Buscar" con los filtros
   en blanco para obtener el universo completo.

2. **El `onclick` del HTML documenta el contrato del request.** PrimeFaces genera
   `PrimeFaces.ab({s:"…btnBuscar", u:"…pgLista …txtNroexp"})`, donde `s` es
   `javax.faces.source` y `u` es `javax.faces.partial.render`. Se puede leer del HTML qué
   POST construir, sin siquiera hacer clic.

3. **La paginación trabaja por offset, no por número de página.** Los parámetros son
   `dt_first` (fila inicial), `dt_rows` (10) y `dt_pagination=true`. Página N → `first = (N-1) × 10`.

4. **La paginación devuelve `<tr>` huérfanos y hay que envolverlos.** Con
   `dt_skipChildren=true`, PrimeFaces manda solo las filas, sin la `<table>` contenedora.
   El parser HTML5 por defecto de cheerio (parse5) **descarta** filas fuera de una tabla,
   devolviendo 0 resultados. El parser envuelve el fragmento en
   `<table><tbody>…</tbody></table>` cuando detecta que no trae tabla.

5. **La descarga exige que la fila esté en la página cargada.** El link de descarga dispara
   `mojarra.jsfcljs(...)` — un submit completo del formulario con dos parámetros extra:
   la clave del componente (`…:dt:14:j_idt63`) y `param_uuid`. Se verificó que pedir un
   documento de la página 2 estando en la página 1 **no devuelve el PDF sino el HTML de la
   página**: el `param_uuid` por sí solo no alcanza, el servidor necesita que la fila esté en
   la ventana activa del datatable.
   **Consecuencia de diseño:** el flujo es obligatoriamente intercalado —
   paginar → descargar los PDFs de esa página → paginar a la siguiente.

6. **El ViewState se reutiliza entre descargas.** Se comprobó que varias descargas
   consecutivas con el mismo token funcionan: descargar no lo consume ni lo rota.

7. **El PDF llega como `application/octet-stream`, no `application/pdf`.** No se puede
   confiar en el `Content-Type` para validar. El scraper verifica los **magic bytes**: todo
   PDF comienza con `%PDF-`. Si no coinciden, la respuesta se trata como fallo (suele ser una
   página de error).

8. **Hay resoluciones sin PDF.** Las marcadas como *"Información confidencial"* no tienen
   link de descarga. Se extraen igual (con `pdfUuid` vacío) y se contabilizan aparte.

---

## Arquitectura

```
src/
  config.ts          Constantes: URLs, IDs de componentes, delays, parámetros de reintento
  types.ts           Modelo de dominio (Resolucion)
  errors.ts          DescargaError (transporta status HTTP y Retry-After)
  utils.ts           delay() y parseo de Retry-After
  http-client.ts     Cliente HTTP con sesión: captura y reenvía cookies, headers comunes
  jsf-session.ts     Motor JSF: ViewState, armado de POSTs, parseo de <partial-response>
  parser.ts          cheerio: filas HTML → objetos tipados; lectura del paginador
  pdf-downloader.ts  Nombres de archivo, sanitización y escritura a disco
  retry.ts           Reintentos genéricos con backoff exponencial
  storage.ts         Persistencia de resultados y de fallidos
  index.ts           Orquestación y sanity checks
```

Dos decisiones que vale la pena señalar:

- **El motor JSF no sabe de OEFA.** `JsfSession` recibe los IDs de componentes desde
  `config.ts`; la lógica de sesión, ViewState y `partial-response` es genérica y reutilizable
  para cualquier sitio JSF/PrimeFaces.
- **Los campos del formulario se descubren del HTML, no se hardcodean.** `init()` recorre los
  `input`/`select` del formulario y los reenvía en cada POST. Si el sitio agrega o renombra un
  filtro, el scraper lo envía igual sin tocar código.

---

## Manejo de errores y resiliencia

### Errores 429 y reintentos

Cada descarga se envuelve en `conReintentos()`:

- **Hasta 5 intentos** por documento.
- **Backoff exponencial**: 1s → 2s → 4s → 8s (`base × 2^intento`), con techo de 30s.
- **Jitter** aleatorio, para no reintentar en intervalos exactos.
- **`Retry-After` tiene prioridad**: si el servidor indica cuánto esperar, se respeta en lugar
  de la fórmula propia.
- **Discrimina qué reintentar**: 429 y 5xx son transitorios (se reintentan); errores de red
  (timeout, conexión cortada) también. Un error de contenido ("la respuesta no es un PDF") no
  se reintenta, porque reintentar no lo arregla.

### Continuidad

La resiliencia opera en dos niveles:

1. **Dentro de la corrida:** un 429 puntual se absorbe con los reintentos. Si un documento
   agota los intentos, se registra en `data/fallidos.json` y **el scraper continúa con el
   siguiente** — un documento problemático nunca voltea la ejecución.
2. **Entre corridas:** como el loop recorre todas las páginas y `yaDescargado()` saltea lo que
   ya está en disco, **volver a ejecutar el scraper reintenta exactamente lo que faltó**. No
   hace falta ningún comando especial.

También se aplican pausas entre peticiones (500 ms entre páginas, 800 ms entre descargas) para
no sobrecargar el servidor.

---

## Validación: sanity checks

Antes de terminar, el scraper contrasta lo extraído contra la "verdad del servidor" y reporta:

- **Conteo total** — compara las filas extraídas contra los registros que declara el paginador
  (`Página 1 de 176 (1753 registros)`).
- **Cobertura de PDFs** — cuántas filas tienen documento y cuántas son confidenciales.
- **Unicidad** — cuenta UUIDs únicos para detectar duplicados, excluyendo las filas sin PDF
  (si no se excluyeran, los valores vacíos colapsarían en el `Set` y producirían falsos
  positivos).
- **Integridad por archivo** — validación de magic bytes `%PDF-` en cada descarga.
- **Fallidas** — cantidad de descargas que agotaron los reintentos.

Ejemplo de salida:

```
--- Resumen ---
Filas extraídas: 50
✓ Conteo: 1753 esperados, 1753 extraídos.
Filas con PDF: 46  |  confidenciales sin PDF: 4
UUIDs únicos (entre las que tienen PDF): 46
✓ Sin PDFs duplicados.
Descargas fallidas: 0.
```

---

## Sobre el sitio del Poder Judicial

El sitio principal del enunciado, `jurisprudencia.pj.gob.pe`, **está bloqueado por
geolocalización**. Verificado el 22/07/2026 desde Argentina:

```
$ curl -I https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml

HTTP/1.1 403 Forbidden
Server: rdwr
Content-Type: text/html
```

El cuerpo de la respuesta es una página de bloqueo con un identificador de transacción:

```html
<h2>403 Forbidden</h2>
<h2>Transaction ID:</h2> 0995014ff972e36a3a0440c5bc79f5a1571f672ee61751ff7005b8a4442f94a5
```

El header `Server: rdwr` corresponde a **Radware**, un WAF/anti-bot comercial. El bloqueo se
produce **antes** de llegar a la aplicación, por lo que sin una IP peruana el sitio no puede
siquiera explorarse. Por eso el desarrollo se hizo sobre OEFA, el sitio alternativo que el
propio enunciado habilita.

### Qué habría que cambiar para soportarlo

Ambos sitios comparten stack (`.xhtml` + `/faces/` = JSF), así que el motor —sesión,
encadenado de ViewState, `partial-response`, paginación por offset— es reutilizable. El
trabajo específico sería:

1. **Extraer una configuración por sitio.** Hoy `config.ts` tiene los IDs de OEFA. Habría que
   introducir una interfaz `SiteConfig` (URL, ID del formulario, ID del datatable, ID del botón
   de búsqueda, mapeo de columnas) y que `JsfSession` y `parser` la reciban por parámetro. El
   motor ya es agnóstico; solo falta parametrizar la configuración.

2. **Descubrir los IDs de componentes del PJ** con DevTools, igual que se hizo aquí: capturar
   el POST de búsqueda, el de paginación y el de descarga, y leer los `PrimeFaces.ab(...)` /
   `mojarra.jsfcljs(...)` del HTML.

3. **Adaptar el esquema de datos.** Las columnas del PJ (sala, materia, fecha, magistrado…)
   difieren de las de OEFA, así que haría falta un tipo propio y su mapeo de celdas. La
   normalización de fechas cobraría relevancia (OEFA no expone fechas en la grilla).

4. **Verificar el mecanismo de descarga.** Podría no ser un postback JSF sino un servlet con
   URL directa, lo que simplificaría el flujo y eliminaría la restricción de "fila en la página
   cargada".

5. **Contemplar el anti-bot.** Con Radware delante, además de la IP peruana probablemente haga
   falta cuidar el realismo de la sesión: headers completos de navegador, `Referer` coherente,
   cookies del WAF persistidas y un ritmo de peticiones conservador.

---

## Limitaciones conocidas

- **`Retry-After` en formato fecha**: solo se interpreta la forma numérica (segundos), que es
  la habitual. Si el servidor enviara una fecha HTTP, se ignora y se usa el backoff propio.
- **Deduplicación por UUID**: se detecta y reporta, pero la descarga usa el número de fila como
  clave de archivo. Si un mismo PDF apareciera en dos filas distintas, se descargaría dos veces
  con nombres distintos. En los datos observados no se detectaron duplicados reales.
- **La metadata se reconstruye completa en cada ejecución** (~3 minutos). Es una decisión
  deliberada: la extracción es rápida y determinística, y evita el riesgo de un checkpoint
  desactualizado. Lo costoso —las descargas— sí se reanuda.

## Stack

- TypeScript · Node.js
- [axios](https://axios-http.com/) — cliente HTTP
- [cheerio](https://cheerio.js.org/) — parsing de HTML
- [tsx](https://tsx.is/) — ejecución de TypeScript en desarrollo

Sin dependencias de automatización de navegador (Puppeteer, Playwright o Selenium), según lo
requerido por el enunciado.