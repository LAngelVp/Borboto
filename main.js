// main.js - Orquestador Principal de Electron para Borboto POS
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const dotenv = require('dotenv');

// ─── CARGAR VARIABLES DE ENTORNO ANTES DE CUALQUIER OPERACIÓN ───────────────
const backendPath = path.join(__dirname, 'backend-borboto');
const envPath = path.join(backendPath, '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

let mainWindow;
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
      nodeIntegration: false,
      contextIsolation: true
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

// ─── CICLO DE VIDA DE ELECTRON ──────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    await iniciarPostgres();
    iniciarBackend();

    // Pausa de 1.5 segundos para garantizar que Express aplique 000_init.sql antes de abrir la UI
    await new Promise(resolve => setTimeout(resolve, 1500));

    createMainWindow();
  } catch (err) {
    console.error('❌ Error fatal durante el arranque:', err);
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