// main.js - Orquestador Principal de Electron para Borboto POS (Con Licenciamiento RSA)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, execFile, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

// ─── CARGAR VARIABLES DE ENTORNO ANTES DE CUALQUIER OPERACIÓN ───────────────
const backendPath = path.join(__dirname, 'backend-borboto');
const envPath = path.join(backendPath, '.env');
const licenseFilePath = path.join(app.getPath('userData'), 'borboto_license.lic');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

let mainWindow;
let licenseWindow;
let backendProcess;
let pgProcess;

// Variables de entorno con fallbacks seguros a 127.0.0.1
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '58432';
const DB_USER = process.env.DB_USER || 'borboto_admin';
const DB_PASSWORD = process.env.DB_PASSWORD || 'BorbotoPass2026!';
const DB_NAME = process.env.DB_NAME || 'borboto_pos';
const PORT = process.env.PORT || '3000';

// Rutas absolutas a binarios de Postgres Portable
const pgBinPath = path.join(backendPath, 'postgres-bin', 'bin');
const pgDataPath = path.join(backendPath, 'data-pg');

const initdbExe = path.join(pgBinPath, 'initdb.exe');
const postgresExe = path.join(pgBinPath, 'postgres.exe');
const createdbExe = path.join(pgBinPath, 'createdb.exe');
const psqlExe = path.join(pgBinPath, 'psql.exe');

// ─── 🆔 OBTENER HARDWARE ID ÚNICO DE LA TARJETA MADRE ────────────────────────
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
  } catch (e) {
    console.error('⚠️ Error al consultar UUID por WMIC:', e.message);
  }
  const fallbackRaw = `${process.env.COMPUTERNAME || 'PC'}-${process.env.USERNAME || 'USER'}`;
  return crypto.createHash('md5').update(fallbackRaw).digest('hex').toUpperCase();
}

function getPublicKeyPath() {
  const possiblePaths = [
    path.join(__dirname, 'licencia_publica.pem'),
    path.join(__dirname, 'tools', 'licencia_publica.pem'),
    path.resolve(process.cwd(), 'licencia_publica.pem')
  ];
  if (process.resourcesPath) {
    possiblePaths.unshift(path.join(process.resourcesPath, 'licencia_publica.pem'));
  }
  return possiblePaths.find(p => fs.existsSync(p)) || null;
}

// ─── 🔐 VALIDACIÓN DE LA CLAVE DE LICENCIA ─────────────────────────────────
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

    // Validar coincidencia de Hardware ID
    const currentHwId = getHardwareId();
    if (payload.hardware_id && payload.hardware_id.trim().toUpperCase() !== currentHwId.toUpperCase()) {
      return { valida: false, motivo: 'Esta licencia pertenece a otro equipo informático' };
    }

    // Validar Fecha de Expiración
    if (new Date() > new Date(payload.vencimiento + 'T23:59:59')) {
      return { valida: false, vencida: true, motivo: `La licencia expiró el ${payload.vencimiento}` };
    }

    return { valida: true, payload };
  } catch (err) {
    return { valida: false, motivo: 'Error interno al procesar la licencia' };
  }
}

// ─── 📡 IPC HANDLERS PARA INTERFAZ Y LICENCIA ────────────────────────────────
ipcMain.handle('get-hardware-id', async () => getHardwareId());

// 💡 CORREGIDO: Handler necesario para que Ajustes lea el estado y días restantes
ipcMain.handle('get-license-status', async () => {
  try {
    if (!fs.existsSync(licenseFilePath)) {
      return { valida: false, motivo: 'Sin archivo de licencia' };
    }
    const keyString = fs.readFileSync(licenseFilePath, 'utf8').trim();
    const resultado = validarLicencia(keyString);
    if (!resultado.valida) {
      return resultado;
    }

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

// Handler único optimizado para recibir licencias sin refrescar la app si ya está abierta
ipcMain.on('submit-license-key', async (event, keyInput) => {
  const resultado = validarLicencia(keyInput);

  if (resultado.valida) {
    fs.writeFileSync(licenseFilePath, keyInput.trim(), 'utf8');
    event.reply('submit-license-key-response', { success: true });

    // Si la ventana principal ya existe (Ajustes), cierra la modal y no reinicia la app
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (licenseWindow && !licenseWindow.isDestroyed()) {
        licenseWindow.close();
      }
      return;
    }

    if (licenseWindow && !licenseWindow.isDestroyed()) {
      licenseWindow.close();
    }
    await iniciarSistemaCompleto();

  } else {
    event.reply('submit-license-key-response', {
      success: false,
      error: resultado.motivo
    });
  }
});

function solicitarLicencia(mensajeError = '') {
  const hardwareId = getHardwareId();

  licenseWindow = new BrowserWindow({
    width: 480,
    height: 480,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    title: 'BORBOTO POS - Licencia Requerida',
    icon: path.join(__dirname, 'BORBOTOIcon.ico'),
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

// Helper para ejecutar binarios con argumentos en array
function runExecFile(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error, stdout, stderr });
      } else {
        resolve({ ok: true, stdout, stderr });
      }
    });
  });
}

// ─── 1. ARRANQUE E INICIALIZACIÓN DE POSTGRES PORTABLE ───────────────────────
async function iniciarPostgres() {
  if (!fs.existsSync(pgDataPath)) {
    console.log(`📦 Inicializando cluster de Postgres con usuario administrador '${DB_USER}'...`);
    const initRes = await runExecFile(initdbExe, [
      '-D', pgDataPath,
      '-U', DB_USER,
      '-A', 'trust',
      '--encoding=UTF8'
    ]);
    if (!initRes.ok) {
      console.error('❌ Error ejecutando initdb:', initRes.stderr || initRes.error);
    }
  }

  console.log(`🚀 Arrancando servicio PostgreSQL portable en ${DB_HOST}:${DB_PORT}...`);

  pgProcess = spawn(postgresExe, [
    '-D', pgDataPath,
    '-h', DB_HOST,
    '-p', DB_PORT
  ], {
    cwd: backendPath,
    detached: false
  });

  pgProcess.stdout?.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('database system is ready to accept connections')) {
      console.log('⚡ PostgreSQL está listo para aceptar conexiones.');
    }
  });

  pgProcess.stderr?.on('data', (data) => {
    console.log(`[PG LOG]: ${data.toString().trim()}`);
  });

  await new Promise(res => setTimeout(res, 2000));

  await runExecFile(createdbExe, [
    '-h', DB_HOST,
    '-p', DB_PORT,
    '-U', DB_USER,
    DB_NAME
  ]);

  await runExecFile(psqlExe, [
    '-h', DB_HOST,
    '-p', DB_PORT,
    '-U', DB_USER,
    '-d', DB_NAME,
    '-c', `ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';`
  ]);

  console.log(`✅ Base de datos '${DB_NAME}' y credenciales de '${DB_USER}' listas.`);
}

// ─── 2. APAGADO LIMPIO DE POSTGRES ──────────────────────────────────────────
function detenerPostgres() {
  if (pgProcess) {
    console.log('🛑 Deteniendo servicio PostgreSQL portable...');
    pgProcess.kill('SIGTERM');
    pgProcess = null;
  }
}

// ─── 3. ARRANQUE DEL BACKEND EXPRESS ─────────────────────────────────────────
function iniciarBackend() {
  console.log('🚀 Iniciando servidor backend de Express con Bun...');

  const envVars = Object.assign({}, process.env, {
    PORT: PORT,
    DB_HOST: DB_HOST,
    DB_PORT: DB_PORT,
    DB_USER: DB_USER,
    DB_PASSWORD: DB_PASSWORD,
    DB_NAME: DB_NAME
  });

  backendProcess = spawn('bun', ['run', 'index.ts'], {
    cwd: backendPath,
    shell: true,
    env: envVars
  });

  backendProcess.stdout.on('data', (data) => console.log(`[BACKEND]: ${data.toString().trim()}`));
  backendProcess.stderr.on('data', (data) => console.error(`[BACKEND ERR]: ${data.toString().trim()}`));
}

// ─── 4. VENTANA PRINCIPAL DE ELECTRON ────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'BORBOTO POS - Máquina Madre',
    icon: path.join(__dirname, 'BORBOTOIcon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Permitir conexiones locales, Google Fonts y Material Icons sin errores CSP
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com;"
        ]
      }
    });
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:4200');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/browser/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── 5. ARRANQUE COMPLETO DEL SISTEMA ─────────────────────────────────────────
async function iniciarSistemaCompleto() {
  try {
    await iniciarPostgres();
    iniciarBackend();

    // Pausa de 1.5 segundos para garantizar que Express aplique 000_init.sql antes de abrir la UI
    await new Promise(resolve => setTimeout(resolve, 1500));

    createMainWindow();
  } catch (err) {
    dialog.showErrorBox('Error de Inicio', err.message);
  }
}

// ─── CICLO DE VIDA DE ELECTRON ──────────────────────────────────────────────
app.whenReady().then(async () => {
  const claveGuardada = fs.existsSync(licenseFilePath) ? fs.readFileSync(licenseFilePath, 'utf8').trim() : '';
  const estadoLicencia = validarLicencia(claveGuardada);

  if (estadoLicencia.valida) {
    await iniciarSistemaCompleto();
  } else {
    solicitarLicencia(estadoLicencia.motivo);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
  detenerPostgres();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});