// main.js - Orquestador Principal de Electron para Borboto POS
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const http = require('http');
const net = require('net');

let mainWindow;
let licenseWindow;
let expressServer;
let shutdownBackend;
let cierreIniciado = false;
let cierreCompletado = false;

// ─── ESTADO DEL ACTUALIZADOR AUTOMÁTICO ──────────────────────────────────────
const updateState = {
  status: 'idle', // idle | checking | available | not-available | downloading | downloaded | error | unavailable
  currentVersion: typeof app.getVersion === 'function' ? app.getVersion() : '0.0.0',
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  progress: null,
  message: null,
  detail: null,
  errorCode: null,
  statusCode: null,
};

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTicketHtml({ content, title = 'Ticket', anchoPapel = '80mm', fontSize = 'NORMAL', logoDataUrl }) {
  const width = anchoPapel === '58mm' ? 220 : 300;
  const fontPx = fontSize === 'DOBLE_ALTO' ? 17 : fontSize === 'DOBLE_ANCHO' || fontSize === 'DOBLE' ? 16 : 12;
  const logo = logoDataUrl
    ? `<img class="ticket-logo" src="${escapeHtml(logoDataUrl)}" alt="logo" />`
    : '';
  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(title)}</title>
      <style>
        html, body { margin: 0; padding: 0; background: #fff; }
        body { font-family: Consolas, 'Courier New', monospace; }
        .ticket { width: ${width}px; margin: 0; padding: 8px 10px; color: #000; white-space: pre-wrap; font-size: ${fontPx}px; line-height: 1.25; ${fontSize !== 'NORMAL' ? 'font-weight: 700;' : ''} }
        .ticket-logo { display: block; max-width: 90%; max-height: 130px; margin: 0 auto 8px; object-fit: contain; filter: grayscale(1) contrast(1.35); }
      </style>
    </head>
    <body>
      ${logo}
      <pre class="ticket">${escapeHtml(content)}</pre>
    </body>
  </html>`;
}

async function getSystemPrintersFromElectron() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('La ventana principal no está disponible para consultar impresoras.');
  }

  const printers = await mainWindow.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    description: printer.description || printer.options?.printerInfo || '',
    status: printer.status,
    isDefault: Boolean(printer.isDefault),
  }));
}

async function printTicketSilently({ printerName, content, title, anchoPapel, fontSize, logoDataUrl }) {
  const printWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    const html = buildTicketHtml({ content, title, anchoPapel, fontSize, logoDataUrl });
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    await new Promise((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: printerName,
        },
        (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Electron no pudo enviar el trabajo de impresión.'));
            return;
          }

          resolve(true);
        },
      );
    });

    return { ok: true };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

const isDev = process.env.NODE_ENV === 'development';
const licenseFilePath = path.join(app.getPath('userData'), 'borboto_license.lic');
const iconPath = path.join(__dirname, 'BORBOTOIcon.ico');

// ─── CARGA DE VARIABLES DE ENTORNO ──────────────────────────────────────────
const envPath = isDev
  ? path.join(__dirname, 'backend-borboto/.env')
  : path.join(process.resourcesPath, 'backend-borboto/.env');

if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const DB_USER = process.env.DB_USER || 'borboto_admin';
const DB_PASS = process.env.DB_PASSWORD || 'holamundo31';
const DB_PORT = parseInt(process.env.DB_PORT || '58432', 10);

const basePath = isDev
  ? path.join(__dirname, 'backend-borboto/postgres-bin')
  : path.join(process.resourcesPath, 'postgres-bin');

const binPath = path.join(basePath, 'bin');

const dataPath = isDev
  ? path.join(__dirname, 'backend-borboto/data-pg')
  : path.join(app.getPath('userData'), 'data-pg');

const logPath = path.join(dataPath, 'logfile');

// ─── RUTINAS DE POSTGRESQL PORTABLE ─────────────────────────────────────────
function setupAndStartPostgres() {
  try {
    if (!fs.existsSync(path.join(dataPath, 'PG_VERSION'))) {
      fs.mkdirSync(dataPath, { recursive: true });
      const pwDirectory = fs.mkdtempSync(path.join(app.getPath('temp'), 'borboto-pg-'));
      const pwFile = path.join(pwDirectory, 'pwfile.txt');
      const initdbPath = path.join(binPath, 'initdb.exe');
      try {
        fs.writeFileSync(pwFile, DB_PASS, { flag: 'wx', mode: 0o600 });
        execFileSync(initdbPath, [
          '-D', dataPath, '-U', DB_USER, `--pwfile=${pwFile}`, '-A', 'md5', '--encoding=UTF8',
        ], { stdio: 'pipe', windowsHide: true });
      } finally {
        fs.rmSync(pwDirectory, { recursive: true, force: true });
      }
    }

    const pgCtlPath = path.join(binPath, 'pg_ctl.exe');
    try {
      execFileSync(pgCtlPath, ['-D', dataPath, 'status'], { stdio: 'pipe', windowsHide: true });
      return;
    } catch (e) {}

    execFileSync(pgCtlPath, ['-D', dataPath, '-l', logPath, '-o', `-p ${DB_PORT}`, 'start'], {
      stdio: 'ignore', windowsHide: true,
    });
    console.log(`✅ [PG] DB iniciado exitosamente`);
    // console.log(`✅ [PG] PostgreSQL iniciado exitosamente en puerto ${DB_PORT}`);
  } catch (error) {
    console.error('❌ [PG] Error al gestionar DB:', error.message);
    throw error;
    // console.error('❌ [PG] Error al gestionar PostgreSQL:', error.message);
  }
}

function waitForPostgres(port, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const tryConnect = () => {
      const socket = new net.Socket();
      socket.connect(port, '127.0.0.1', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - startTime > timeoutMs) reject(new Error('Timeout PostgreSQL'));
        else setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

function stopPostgres() {
  try {
    if (fs.existsSync(dataPath)) {
      const pgCtlPath = path.join(binPath, 'pg_ctl.exe');
      execSync(`"${pgCtlPath}" -D "${dataPath}" stop -m fast`, { stdio: 'ignore' });
    }
  } catch (e) {}
}

async function startBackendServer() {
  if (!isDev) {
    try {
      const serverPath = path.join(__dirname, 'server.js');
      process.env.BORBOTO_UPLOADS_DIR = path.join(app.getPath('userData'), 'uploads');
      const serverModule = require(serverPath);
      shutdownBackend = serverModule.shutdownServer;
      expressServer =
        typeof serverModule.startServer === 'function'
          ? await serverModule.startServer()
          : serverModule.server || serverModule;
    } catch (e) {
      console.error('❌ Error al arrancar server.js:', e);
      throw e;
    }
  }
}

// ─── CONTROL DE LICENCIA Y HARDWARE ID ───────────────────────────────────────
function getHardwareId() {
  try {
    if (process.platform === 'win32') {
      const stdout = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const uuid = lines[1].trim();
        if (uuid && uuid !== '00000000-0000-0000-0000-000000000000') {
          return uuid;
        }
      }
    }
  } catch (e) {}
  const fallbackRaw = `${process.env.COMPUTERNAME || 'PC'}-${process.env.USERNAME || 'USER'}`;
  return crypto.createHash('md5').update(fallbackRaw).digest('hex').toUpperCase();
}

function getPublicKeyPath() {
  const possiblePaths = [
    path.join(__dirname, 'licencia_publica.pem'),
    path.join(__dirname, 'tools', 'licencia_publica.pem'),
    path.resolve(process.cwd(), 'licencia_publica.pem'),
  ];
  if (process.resourcesPath)
    possiblePaths.unshift(path.join(process.resourcesPath, 'licencia_publica.pem'));
  return possiblePaths.find((p) => fs.existsSync(p)) || null;
}

function validarLicencia(keyString) {
  try {
    const keyPath = getPublicKeyPath();
    if (!keyPath)
      return { valida: false, motivo: 'Falta el archivo de verificación (licencia_publica.pem)' };
    if (!keyString) return { valida: false, motivo: 'Sin licencia registrada' };

    const [payloadBase64, firmaBase64] = keyString.trim().split('.');
    if (!payloadBase64 || !firmaBase64)
      return { valida: false, motivo: 'Formato de licencia inválido' };

    const publicKey = fs.readFileSync(keyPath, 'utf8');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payloadBase64);

    if (!verifier.verify(publicKey, firmaBase64, 'base64')) {
      return { valida: false, motivo: 'La clave de licencia es inválida o fue alterada' };
    }

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        typeof payload.vencimiento !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.vencimiento)) {
      return { valida: false, motivo: 'Fecha de licencia invalida' };
    }
    const fechaVencimiento = new Date(payload.vencimiento + 'T00:00:00Z');
    if (Number.isNaN(fechaVencimiento.getTime()) || fechaVencimiento.toISOString().slice(0, 10) !== payload.vencimiento) {
      return { valida: false, motivo: 'Fecha de licencia invalida' };
    }
    if (
      payload.hardware_id &&
      payload.hardware_id.trim().toUpperCase() !== getHardwareId().toUpperCase()
    ) {
      return { valida: false, motivo: 'Esta licencia pertenece a otro equipo informático' };
    }

    if (new Date() > new Date(payload.vencimiento + 'T23:59:59')) {
      return {
        valida: false,
        vencida: true,
        motivo: `La licencia expiró el ${payload.vencimiento}`,
      };
    }

    return { valida: true, payload };
  } catch (err) {
    return { valida: false, motivo: 'Error procesando la licencia' };
  }
}

// ─── HANDLERS IPC DE LICENCIA PARA EL FRONTEND ────────────────────────────────
ipcMain.handle('get-hardware-id', async () => getHardwareId());

ipcMain.handle('get-license-status', async () => {
  try {
    if (!fs.existsSync(licenseFilePath)) {
      return { valida: false, motivo: 'Sin archivo de licencia' };
    }
    const keyString = fs.readFileSync(licenseFilePath, 'utf8').trim();
    const resultado = validarLicencia(keyString);
    if (!resultado.valida) return resultado;

    const payload = resultado.payload;
    const fVencimiento = new Date(payload.vencimiento + 'T23:59:59');
    const diffMs = fVencimiento.getTime() - Date.now();
    const diffDias = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    return {
      valida: true,
      cliente: payload.cliente,
      vencimiento: payload.vencimiento,
      diasRestantes: diffDias,
    };
  } catch (error) {
    return { valida: false, motivo: 'Error al consultar estado de licencia' };
  }
});

ipcMain.handle('get-system-printers', async () => getSystemPrintersFromElectron());

ipcMain.handle('print-ticket-silent', async (_event, payload) => {
  const { printerName, content, title, anchoPapel, fontSize, logoDataUrl } = payload || {};

  if (!printerName || !content) {
    throw new Error('Faltan datos para imprimir de forma silenciosa.');
  }

  return printTicketSilently({ printerName, content, title, anchoPapel, fontSize, logoDataUrl });
});

// ─── ACTUALIZACIONES AUTOMÁTICAS ─────────────────────────────────────────────
const UPDATER_LOG_PREFIX = '[UPDATER]';

function logUpdater(level, message, extra) {
  const text = `${UPDATER_LOG_PREFIX} ${message}`;
  const logger =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (extra === undefined) {
    logger(text);
    return;
  }

  logger(text, extra);
}

function getUpdaterEnvironment() {
  const configPath = process.resourcesPath
    ? path.join(process.resourcesPath, 'app-update.yml')
    : null;

  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    nodeEnv: process.env.NODE_ENV || null,
    platform: process.platform,
    configPath,
    configExists: configPath ? fs.existsSync(configPath) : false,
  };
}

function sendUpdateEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function snapshotUpdateState(extra = {}) {
  return {
    ...updateState,
    progress: updateState.progress ? { ...updateState.progress } : null,
    ...extra,
  };
}

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  return snapshotUpdateState();
}

function normalizeReleaseNotes(releaseNotes) {
  if (!releaseNotes) return null;
  if (typeof releaseNotes === 'string') return releaseNotes.slice(0, 20000);
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((item) => (typeof item === 'string' ? item : item?.note || ''))
      .join('\n')
      .slice(0, 20000);
  }
  return null;
}

function describeUpdaterError(error, context = 'check') {
  const rawMessage = error?.message || (error ? String(error) : 'Error desconocido');
  const inferredStatus = /\b(?:HTTP|HttpError:)\s*(\d{3})\b/i.exec(rawMessage);
  const statusCode =
    Number(error?.statusCode ?? error?.status ?? 0) ||
    (inferredStatus ? Number(inferredStatus[1]) : null);
  const code = error?.code || null;
  const name = error?.name || 'Error';

  let message = 'No se pudo verificar la conexión con el servidor de actualizaciones.';
  if (statusCode === 401) {
    message =
      'El repositorio de actualizaciones requiere autenticación (HTTP 401). Verifica que el repositorio sea público o configura un token.';
  } else if (statusCode === 403) {
    message =
      'GitHub rechazó la consulta (HTTP 403). Puede ser un límite de peticiones o un problema de permisos del repositorio.';
  } else if (statusCode === 404) {
    message =
      'No se encontró la release o el archivo latest.yml en GitHub (HTTP 404). Verifica el tag publicado y el nombre del repositorio.';
  } else if (statusCode === 429) {
    message =
      'GitHub limitó temporalmente las consultas (HTTP 429). Intenta de nuevo más tarde.';
  } else if (code === 'ERR_UPDATER_INVALID_UPDATE_INFO') {
    message = 'El archivo latest.yml publicado no tiene un formato válido.';
  } else if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') {
    message = 'No se encontró una versión publicada en GitHub.';
  } else if (code === 'ERR_UPDATER_INVALID_RELEASE_FEED') {
    message = 'No se pudo interpretar la lista de releases de GitHub.';
  } else if (code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS') {
    message = 'El repositorio no tiene releases publicadas.';
  } else if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') {
    message = 'La release publicada no incluye el archivo latest.yml requerido.';
  } else if (context === 'download') {
    message = 'No se pudo descargar la actualización. Revisa la conexión a internet.';
  } else if (context === 'install') {
    message = 'No se pudo iniciar el instalador de la actualización.';
  }

  const detail = [
    `contexto=${context}`,
    `name=${name}`,
    code ? `code=${code}` : null,
    statusCode ? `statusCode=${statusCode}` : null,
    `message=${rawMessage}`,
  ]
    .filter(Boolean)
    .join(' | ');

  return { name, code, statusCode, rawMessage, message, detail };
}

function markUpdateError(error, context = 'check') {
  // Los fallos de red se registran de forma discreta: nunca se abre un diálogo
  // ni se interrumpe al usuario con una notificación global.
  const description = describeUpdaterError(error, context);
  logUpdater('error', `Fallo en actualización (${context})`, {
    name: description.name,
    code: description.code,
    statusCode: description.statusCode,
    message: description.rawMessage,
    stack: error?.stack || null,
  });

  const state = setUpdateState({
    status: 'error',
    message: description.message,
    detail: description.detail,
    errorCode: description.code,
    statusCode: description.statusCode,
  });

  sendUpdateEvent('update-error', {
    message: state.message,
    detail: state.detail,
    code: state.errorCode,
    statusCode: state.statusCode,
    state,
  });

  return state;
}

function notPackagedUpdateResult() {
  const environment = getUpdaterEnvironment();
  const detail = `app.isPackaged=${environment.packaged} | NODE_ENV=${environment.nodeEnv || 'no definido'}`;
  logUpdater('warn', 'Solicitud de actualización ignorada: la aplicación no está empaquetada', {
    packaged: environment.packaged,
    nodeEnv: environment.nodeEnv,
  });

  const state = setUpdateState({
    status: 'unavailable',
    message: 'Las actualizaciones solo están disponibles en la versión instalada.',
    detail,
    errorCode: null,
    statusCode: null,
  });

  return {
    ok: false,
    reason: 'not-packaged',
    message: state.message,
    detail: state.detail,
    state,
  };
}

function applyUpdateCheckResult(result) {
  if (!result) {
    return null;
  }

  // Si los eventos de electron-updater ya actualizaron el estado, no se duplica.
  if (updateState.status !== 'checking') {
    return snapshotUpdateState();
  }

  const info = result.updateInfo;

  if (result.isUpdateAvailable) {
    const state = setUpdateState({
      status: 'available',
      availableVersion: info?.version || null,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      releaseDate: info?.releaseDate || null,
      message: null,
      detail: null,
      errorCode: null,
      statusCode: null,
    });
    sendUpdateEvent('update-available', {
      version: state.availableVersion,
      releaseNotes: state.releaseNotes,
      releaseDate: state.releaseDate,
      state,
    });
    return state;
  }

  const state = setUpdateState({
    status: 'not-available',
    availableVersion: null,
    releaseNotes: null,
    releaseDate: null,
    progress: null,
    message: 'La versión instalada está actualizada.',
    detail: null,
    errorCode: null,
    statusCode: null,
  });
  sendUpdateEvent('update-not-available', {
    version: info?.version || null,
    state,
  });
  return state;
}

async function runUpdateCheck(origin) {
  logUpdater('info', `Iniciando verificación de actualizaciones (${origin})`, {
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
  });

  setUpdateState({
    status: 'checking',
    message: null,
    detail: null,
    errorCode: null,
    statusCode: null,
  });

  const result = await autoUpdater.checkForUpdates();

  logUpdater('info', `Resultado de checkForUpdates (${origin})`, {
    available: Boolean(result?.isUpdateAvailable),
    latestVersion: result?.updateInfo?.version || null,
    currentVersion: app.getVersion(),
  });

  if (!result) {
    const state = setUpdateState({
      status: 'error',
      message: 'El actualizador no está activo en esta instalación.',
      detail: `checkForUpdates devolvió null | app.isPackaged=${app.isPackaged}`,
      errorCode: 'ERR_UPDATER_INACTIVE',
      statusCode: null,
    });
    logUpdater('warn', 'El actualizador no está activo; no se emitió verificación', {
      packaged: app.isPackaged,
    });
    sendUpdateEvent('update-error', {
      message: state.message,
      detail: state.detail,
      code: state.errorCode,
      statusCode: state.statusCode,
      state,
    });
    return { ok: false, message: state.message, detail: state.detail, state };
  }

  applyUpdateCheckResult(result);

  return {
    ok: true,
    isUpdateAvailable: Boolean(result.isUpdateAvailable),
    version: result.updateInfo?.version || null,
    state: snapshotUpdateState(),
  };
}

function configureAutoUpdater() {
  const environment = getUpdaterEnvironment();
  logUpdater('info', 'Inicializando actualizador automático', environment);

  autoUpdater.logger = {
    info: (value) => logUpdater('info', formatConsoleArgs([value])),
    warn: (value) => logUpdater('warn', formatConsoleArgs([value])),
    error: (value) => logUpdater('error', formatConsoleArgs([value])),
    debug: (value) => logUpdater('debug', formatConsoleArgs([value])),
  };

  // La disponibilidad se decide por el empaquetado real, no por NODE_ENV:
  // una instalación puede heredar NODE_ENV=development y aun así ser actualizable.
  if (!app.isPackaged) {
    updateState.status = 'unavailable';
    updateState.message = 'Las actualizaciones solo están disponibles en la versión instalada.';
    updateState.detail = `app.isPackaged=false | NODE_ENV=${process.env.NODE_ENV || 'no definido'}`;
    logUpdater(
      'warn',
      'Actualizador deshabilitado: la aplicación no está empaquetada. Ejecuta la versión instalada para probar actualizaciones.',
      { packaged: app.isPackaged, nodeEnv: process.env.NODE_ENV || null },
    );
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.forceDevUpdateConfig = false;

  logUpdater('info', 'Configuración del actualizador aplicada', {
    autoDownload: autoUpdater.autoDownload,
    autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit,
    allowPrerelease: autoUpdater.allowPrerelease,
    configExists: environment.configExists,
    configPath: environment.configPath,
  });

  let lastProgressPercent = -10;

  autoUpdater.on('checking-for-update', () => {
    logUpdater('info', 'Evento checking-for-update recibido');
    setUpdateState({ status: 'checking', message: null, detail: null });
  });

  autoUpdater.on('update-available', (info) => {
    logUpdater('info', 'Evento update-available recibido', {
      version: info?.version || null,
      releaseDate: info?.releaseDate || null,
    });

    const state = setUpdateState({
      status: 'available',
      availableVersion: info?.version || null,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      releaseDate: info?.releaseDate || null,
      message: null,
      detail: null,
      errorCode: null,
      statusCode: null,
    });
    sendUpdateEvent('update-available', {
      version: state.availableVersion,
      releaseNotes: state.releaseNotes,
      releaseDate: state.releaseDate,
      state,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    logUpdater('info', 'Evento update-not-available recibido', {
      currentVersion: app.getVersion(),
      latestVersion: info?.version || null,
    });

    const state = setUpdateState({
      status: 'not-available',
      availableVersion: null,
      releaseNotes: null,
      releaseDate: null,
      progress: null,
      message: 'La versión instalada está actualizada.',
      detail: null,
      errorCode: null,
      statusCode: null,
    });
    sendUpdateEvent('update-not-available', {
      version: info?.version || null,
      state,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    const payload = {
      percent: Number(progress?.percent) || 0,
      bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
      transferred: Number(progress?.transferred) || 0,
      total: Number(progress?.total) || 0,
    };

    if (payload.percent >= 100 || payload.percent - lastProgressPercent >= 10) {
      lastProgressPercent = payload.percent;
      logUpdater('info', `Progreso de descarga: ${payload.percent.toFixed(1)}%`, {
        transferred: payload.transferred,
        total: payload.total,
        bytesPerSecond: payload.bytesPerSecond,
      });
    }

    const state = setUpdateState({ status: 'downloading', progress: payload, message: null });
    sendUpdateEvent('download-progress', { ...payload, state });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logUpdater('info', 'Evento update-downloaded recibido', {
      version: info?.version || null,
    });

    const state = setUpdateState({
      status: 'downloaded',
      availableVersion: info?.version || updateState.availableVersion,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes) || updateState.releaseNotes,
      releaseDate: info?.releaseDate || updateState.releaseDate,
      progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
      message: 'La actualización está lista para instalarse.',
      detail: null,
      errorCode: null,
      statusCode: null,
    });
    sendUpdateEvent('update-downloaded', {
      version: state.availableVersion,
      state,
    });
  });

  autoUpdater.on('error', (error) => {
    markUpdateError(error, 'evento');
  });
}

let automaticUpdateCheckScheduled = false;

function scheduleAutomaticUpdateCheck() {
  if (!app.isPackaged || automaticUpdateCheckScheduled) {
    logUpdater('info', 'Verificación automática omitida', {
      packaged: app.isPackaged,
      alreadyScheduled: automaticUpdateCheckScheduled,
    });
    return;
  }

  automaticUpdateCheckScheduled = true;
  const delayMs = 8000;
  logUpdater('info', `Verificación automática programada en ${delayMs} ms`);

  const timer = setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      logUpdater('warn', 'Verificación automática cancelada: la ventana principal no está disponible');
      return;
    }

    try {
      await runUpdateCheck('automatica');
    } catch (error) {
      markUpdateError(error, 'automatica');
    }
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-update-state', () => snapshotUpdateState());

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return notPackagedUpdateResult();
  }

  try {
    return await runUpdateCheck('manual');
  } catch (error) {
    const state = markUpdateError(error, 'check');
    return {
      ok: false,
      message: state.message,
      detail: state.detail,
      code: state.errorCode,
      statusCode: state.statusCode,
      state,
    };
  }
});

ipcMain.handle('download-update', async () => {
  if (!app.isPackaged) {
    return notPackagedUpdateResult();
  }

  if (updateState.status !== 'available' && updateState.status !== 'downloaded') {
    logUpdater('warn', 'Descarga rechazada: no hay una actualización disponible', {
      status: updateState.status,
    });
    return {
      ok: false,
      message: 'No hay una actualización disponible para descargar.',
      state: snapshotUpdateState(),
    };
  }

  try {
    logUpdater('info', 'Iniciando descarga de actualización', {
      version: updateState.availableVersion,
    });
    setUpdateState({
      status: 'downloading',
      message: null,
      detail: null,
      errorCode: null,
      statusCode: null,
      progress: null,
    });
    await autoUpdater.downloadUpdate();

    if (updateState.status === 'downloading') {
      const state = setUpdateState({
        status: 'downloaded',
        progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
        message: 'La actualización está lista para instalarse.',
      });
      sendUpdateEvent('update-downloaded', {
        version: state.availableVersion,
        state,
      });
    }

    logUpdater('info', 'Descarga de actualización completada', {
      version: updateState.availableVersion,
    });
    return { ok: true, state: snapshotUpdateState() };
  } catch (error) {
    const state = markUpdateError(error, 'download');
    return {
      ok: false,
      message: state.message,
      detail: state.detail,
      code: state.errorCode,
      statusCode: state.statusCode,
      state,
    };
  }
});

ipcMain.handle('quit-and-install', async () => {
  if (!app.isPackaged) {
    return notPackagedUpdateResult();
  }

  logUpdater('info', 'Solicitud de reinicio e instalación', {
    status: updateState.status,
    version: updateState.availableVersion,
  });

  if (updateState.status !== 'downloaded') {
    logUpdater('warn', 'Instalación rechazada: no hay una actualización descargada', {
      status: updateState.status,
    });
    return {
      ok: false,
      message: 'Aún no hay una actualización descargada lista para instalarse.',
      state: snapshotUpdateState(),
    };
  }

  try {
    await detenerServiciosAplicacion();
  } catch (error) {
    logUpdater('warn', 'Cierre previo incompleto antes de actualizar', {
      message: error?.message || String(error),
    });
  } finally {
    cierreIniciado = true;
    cierreCompletado = true;
    setImmediate(() => {
      try {
        logUpdater('info', 'Ejecutando quitAndInstall');
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        logUpdater('error', 'No se pudo iniciar el instalador', {
          message: error?.message || String(error),
          stack: error?.stack || null,
        });
      }
    });
  }

  return { ok: true };
});

function emitUiNotification(level, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-notification', { level, message });
  }
}

function formatConsoleArgs(args) {
  return args
    .map((value) => {
      if (value instanceof Error) {
        return value.message;
      }

      if (typeof value === 'string') {
        return value;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(' ')
    .trim();
}

function installMainConsoleBridge() {
  if (global.__borbotoConsoleBridgeInstalled) {
    return;
  }

  global.__borbotoConsoleBridgeInstalled = true;
  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const recentMessages = new Map();

  const shouldEmit = (level, message) => {
    const key = `${level}:${message}`;
    const now = Date.now();
    const lastSeen = recentMessages.get(key) || 0;

    if (!message || now - lastSeen < 2500) {
      return false;
    }

    recentMessages.set(key, now);
    return true;
  };

  const forward = (level, args) => {
    const message = formatConsoleArgs(args).slice(0, 220);
    const isDebug = message.includes('[PRINT]') || message.includes('[DEBUG]') || message.includes('[UPDATER]');
    if (!shouldEmit(level, message) || isDebug || level === 'info') {
      return;
    }

    emitUiNotification(level, message);
  };

  console.log = (...args) => {
    originalLog(...args);
    forward('info', args);
  };

  console.warn = (...args) => {
    originalWarn(...args);
    forward('warning', args);
  };

  console.error = (...args) => {
    originalError(...args);
    forward('error', args);
  };
}

function installMainProcessErrorHandlers() {
  process.on('uncaughtException', (error) => {
    console.error('Excepción no controlada en proceso principal:', error);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Promesa rechazada sin manejo en proceso principal:', reason);
  });

  app.on('render-process-gone', (_event, webContents, details) => {
    console.error(
      'El proceso de render se cerró inesperadamente:',
      details?.reason || 'sin motivo',
    );
    if (webContents === mainWindow?.webContents) {
      emitUiNotification(
        'error',
        `El proceso visual de la aplicación se cerró: ${details?.reason || 'desconocido'}.`,
      );
    }
  });

  app.on('child-process-gone', (_event, details) => {
    console.warn(
      'Un subproceso de Electron finalizó:',
      details?.type || 'desconocido',
      details?.reason || 'sin motivo',
    );
  });
}

installMainConsoleBridge();
installMainProcessErrorHandlers();

function solicitarLicencia(mensajeError = '') {
  const hardwareId = getHardwareId();

  licenseWindow = new BrowserWindow({
    width: 500,
    height: 520,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    title: 'Borboto POS - Licencia Requerida',
    icon: iconPath,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });

  licenseWindow.setMenuBarVisibility(false);
  licenseWindow.loadFile(path.join(__dirname, 'license.html'));

  licenseWindow.webContents.on('did-finish-load', () => {
    licenseWindow.webContents.send('init-license-view', {
      hardwareId: hardwareId,
      error: mensajeError,
    });
  });
}

ipcMain.on('submit-license-key', async (event, keyInput) => {
  const resultado = validarLicencia(keyInput);
  if (resultado.valida) {
    fs.writeFileSync(licenseFilePath, keyInput.trim(), 'utf8');
    event.reply('submit-license-key-response', { success: true });

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
      return;
    }

    if (licenseWindow && !licenseWindow.isDestroyed()) licenseWindow.close();
    await iniciarSistemaCompleto();
  } else {
    event.reply('submit-license-key-response', { success: false, error: resultado.motivo });
  }
});

// ─── VENTANAS PRINCIPALES Y CICLO DE VIDA ─────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Borboto POS',
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--borboto-port=${Number(process.env.PORT) || 3000}`],
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // 💡 1. RUTA DE CARGA INICIAL
  const loadApp = () => {
    if (isDev) {
      const url = 'http://127.0.0.1:4200';
      const inicio = Date.now();
      const checkReady = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (Date.now() - inicio >= 30000) {
          mainWindow.loadURL('data:text/html,<h1>Servidor de desarrollo no disponible</h1>');
          return;
        }
        const request = http.get(url, response => {
          response.resume();
          if (response.statusCode === 200) mainWindow.loadURL(url);
          else setTimeout(checkReady, 500);
        }).on('error', () => setTimeout(checkReady, 500));
        request.setTimeout(1000, () => request.destroy());
      };
      checkReady();
    } else {
      const possibleIndexPaths = [
        path.join(__dirname, 'dist/borboto/browser/index.html'),
        path.join(__dirname, 'dist/browser/index.html'),
        path.join(__dirname, 'dist/borboto/index.html'),
        path.join(__dirname, 'dist/index.html'),
      ];

      let targetIndex = possibleIndexPaths.find((p) => fs.existsSync(p));
      if (targetIndex) {
        mainWindow.loadFile(targetIndex);
      } else {
        console.error('❌ No se encontró el indeXx compilado.');
        // console.error('❌ No se encontró el index.html compilado.');
      }
    }
  };

  loadApp();

  // 💡 Verificación automática de actualizaciones al terminar de cargar la ventana.
  mainWindow.webContents.once('did-finish-load', () => {
    scheduleAutomaticUpdateCheck();
  });

  // 💡 2. REDIRECCIÓN EN CASO DE ERROR DE RECARGA (EVITA PANTALLA EN BLANCO)
  mainWindow.webContents.on('did-fail-load', () => {
    console.warn('⚠️ Carga fallida detectada. Redirigiendo a la raíz index...');
    // console.warn('⚠️ Carga fallida detectada. Redirigiendo a la raíz index.html...');
    loadApp();
  });

  // 💡 3. BLOQUEO DE F5 / CTRL+R EN PRODUCCIÓN (PARA PUNTOS DE VENTA TÁCTILES)
  if (!isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase();
      const isCtrlOrCmd = input.control || input.meta;

      // 💡 Bloquea Ctrl+R, Ctrl+Shift+R, Cmd+R y Cmd+Shift+R
      if (isCtrlOrCmd && key === 'r') {
        event.preventDefault();
      }

      // 💡 Bloquea la tecla F5
      if (input.key === 'F5') {
        event.preventDefault();
      }
    });
  }
}

async function iniciarSistemaCompleto() {
  try {
    setupAndStartPostgres();
    await waitForPostgres(DB_PORT);
    await startBackendServer();
    createMainWindow();
  } catch (err) {
    console.error('Error de inicio de la aplicación:', err.message);
    dialog.showErrorBox('Borboto POS - Error de inicio', `${err.message}\n\nRegistro de PostgreSQL: ${logPath}`);
    emitUiNotification('error', `Error de inicio: ${err.message}`);
    if (expressServer && typeof expressServer.close === 'function') expressServer.close();
    stopPostgres();
    app.quit();
  }
}

async function detenerServiciosAplicacion() {
  let timer;
  try {
    await Promise.race([
      typeof shutdownBackend === 'function' ? shutdownBackend() : Promise.resolve(),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Timeout de cierre')), 30000); }),
    ]);
  } catch (error) {
    console.warn('Cierre incompleto del backend:', error.message);
  } finally {
    clearTimeout(timer);
    stopPostgres();
  }
}

app.whenReady().then(async () => {
  configureAutoUpdater();

  let claveGuardada = fs.existsSync(licenseFilePath)
    ? fs.readFileSync(licenseFilePath, 'utf8').trim()
    : '';
  const estadoLicencia = validarLicencia(claveGuardada);

  if (estadoLicencia.valida) {
    await iniciarSistemaCompleto();
  } else {
    solicitarLicencia(estadoLicencia.motivo);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async event => {
  if (cierreCompletado) return;
  event.preventDefault();
  if (cierreIniciado) return;
  cierreIniciado = true;
  await detenerServiciosAplicacion();
  cierreCompletado = true;
  app.quit();
});
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
