// main.js - Orquestador Principal de Electron para Borboto POS
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const http = require('http');
const net = require('net');

let mainWindow;
let licenseWindow;
let expressServer;

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
    try {
      execSync('taskkill /F /IM postgres.exe /T', { stdio: 'ignore' });
    } catch (e) {}

    if (!fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
      const pwFile = path.join(basePath, 'pwfile.txt');
      fs.writeFileSync(pwFile, DB_PASS);
      const initdbPath = path.join(binPath, 'initdb.exe');
      execSync(`"${initdbPath}" -D "${dataPath}" -U ${DB_USER} --pwfile="${pwFile}" -A md5 --encoding=UTF8`, { stdio: 'ignore' });
      if (fs.existsSync(pwFile)) fs.unlinkSync(pwFile);
    }

    const pidPath = path.join(dataPath, 'postmaster.pid');
    if (fs.existsSync(pidPath)) {
      try { fs.unlinkSync(pidPath); } catch (e) {}
    }

    const pgCtlPath = path.join(binPath, 'pg_ctl.exe');
    try {
      execSync(`"${pgCtlPath}" -D "${dataPath}" stop -m fast`, { stdio: 'ignore' });
    } catch (e) {}

    execSync(`"${pgCtlPath}" -D "${dataPath}" -l "${logPath}" -o "-p ${DB_PORT}" start`, { stdio: 'ignore' });
    console.log(`✅ [PG] PostgreSQL iniciado exitosamente en puerto ${DB_PORT}`);
  } catch (error) {
    console.error('❌ [PG] Error al gestionar PostgreSQL:', error.message);
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
      const serverModule = require(serverPath);
      expressServer = typeof serverModule.startServer === 'function'
        ? await serverModule.startServer()
        : (serverModule.server || serverModule);
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
    path.resolve(process.cwd(), 'licencia_publica.pem')
  ];
  if (process.resourcesPath) possiblePaths.unshift(path.join(process.resourcesPath, 'licencia_publica.pem'));
  return possiblePaths.find(p => fs.existsSync(p)) || null;
}

function validarLicencia(keyString) {
  try {
    const keyPath = getPublicKeyPath();
    if (!keyPath) return { valida: false, motivo: 'Falta el archivo de verificación (licencia_publica.pem)' };
    if (!keyString) return { valida: false, motivo: 'Sin licencia registrada' };

    const [payloadBase64, firmaBase64] = keyString.trim().split('.');
    if (!payloadBase64 || !firmaBase64) return { valida: false, motivo: 'Formato de licencia inválido' };

    const publicKey = fs.readFileSync(keyPath, 'utf8');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(payloadBase64);

    if (!verifier.verify(publicKey, firmaBase64, 'base64')) {
      return { valida: false, motivo: 'La clave de licencia es inválida o fue alterada' };
    }

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    if (payload.hardware_id && payload.hardware_id.trim().toUpperCase() !== getHardwareId().toUpperCase()) {
      return { valida: false, motivo: 'Esta licencia pertenece a otro equipo informático' };
    }

    if (new Date() > new Date(payload.vencimiento + 'T23:59:59')) {
      return { valida: false, vencida: true, motivo: `La licencia expiró el ${payload.vencimiento}` };
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
      diasRestantes: diffDias
    };
  } catch (error) {
    return { valida: false, motivo: 'Error al consultar estado de licencia' };
  }
});

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
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  licenseWindow.setMenuBarVisibility(false);
  licenseWindow.loadFile(path.join(__dirname, 'license.html'));

  licenseWindow.webContents.on('did-finish-load', () => {
    licenseWindow.webContents.send('init-license-view', {
      hardwareId: hardwareId,
      error: mensajeError
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
      contextIsolation: false,
      nodeIntegration: true
    }
  });
  mainWindow.setMenuBarVisibility(false);

  // 💡 1. RUTA DE CARGA INICIAL
  const loadApp = () => {
    if (isDev) {
      const url = 'http://127.0.0.1:4200';
      const checkReady = () => {
        http.get(url, () => mainWindow.loadURL(url)).on('error', () => setTimeout(checkReady, 500));
      };
      checkReady();
    } else {
      const possibleIndexPaths = [
        path.join(__dirname, 'dist/borboto/browser/index.html'),
        path.join(__dirname, 'dist/browser/index.html'),
        path.join(__dirname, 'dist/borboto/index.html'),
        path.join(__dirname, 'dist/index.html')
      ];

      let targetIndex = possibleIndexPaths.find(p => fs.existsSync(p));
      if (targetIndex) {
        mainWindow.loadFile(targetIndex);
      } else {
        console.error('❌ No se encontró el index.html compilado.');
      }
    }
  };

  loadApp();

  // 💡 2. REDIRECCIÓN EN CASO DE ERROR DE RECARGA (EVITA PANTALLA EN BLANCO)
  mainWindow.webContents.on('did-fail-load', () => {
    console.warn('⚠️ Carga fallida detectada. Redirigiendo a la raíz index.html...');
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
    dialog.showErrorBox('Error de Inicio', err.message);
    if (expressServer && typeof expressServer.close === 'function') expressServer.close();
    stopPostgres();
    app.quit();
  }
}

app.whenReady().then(async () => {
  let claveGuardada = fs.existsSync(licenseFilePath) ? fs.readFileSync(licenseFilePath, 'utf8').trim() : '';
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

app.on('will-quit', () => {
  if (expressServer && typeof expressServer.close === 'function') expressServer.close();
  stopPostgres();
});