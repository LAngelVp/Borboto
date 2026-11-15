// main.js - Orquestador Principal de Electron para Borboto POS
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
    const isDebug = message.includes('[PRINT]') || message.includes('[DEBUG]');
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

app.whenReady().then(async () => {
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
    cierreCompletado = true;
    app.quit();
  }
});
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
