const path = require('node:path');
const { spawn: spawnDefault } = require('node:child_process');

function crearDictadoLocal({ ipcMain, app, getMainWindow, resourcesPath = process.resourcesPath, platform = process.platform, systemRoot = process.env.SystemRoot, spawn = spawnDefault, schedule = setTimeout, unschedule = clearTimeout }) {
  let actual = null;
  const idValido = payload => payload && typeof payload.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(payload.id);
  const autorizado = event => {
    const ventana = getMainWindow();
    return ventana && !ventana.isDestroyed() && event.sender === ventana.webContents && event.senderFrame === ventana.webContents.mainFrame;
  };
  function enviar(sesion, tipo, datos = {}) {
    if (!sesion.sender.isDestroyed()) sesion.sender.send('dictado-resultado', { id: sesion.id, tipo, ...datos });
  }
  function cerrar() {
    const sesion = actual;
    actual = null;
    if (!sesion) return;
    unschedule(sesion.limite); unschedule(sesion.finalizacion);
    sesion.child.stdin.removeListener('error', sesion.errorEntrada);
    sesion.child.stdin.on('error', () => {});
    if (sesion.child.exitCode === null) sesion.child.kill();
  }
  function fallar(sesion, error) {
    if (actual !== sesion) return;
    enviar(sesion, 'error', { error }); cerrar();
  }
  ipcMain.handle('dictado-iniciar', (event, payload) => {
    if (!autorizado(event) || !idValido(payload)) return { ok: false, error: 'Solicitud de dictado no permitida' };
    if (platform !== 'win32') return { ok: false, error: 'El dictado local requiere Windows' };
    if (actual) return { ok: false, error: 'Ya hay un dictado en curso' };
    try {
      const ejecutable = path.join(systemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const script = app.isPackaged ? path.join(resourcesPath, 'speech', 'windows-dictation.ps1') : path.join(__dirname, 'speech', 'windows-dictation.ps1');
      const child = spawn(ejecutable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      const sesion = { id: payload.id, sender: event.sender, child, buffer: '', limite: null, finalizacion: null, errorEntrada: null };
      actual = sesion;
      sesion.errorEntrada = () => fallar(sesion, 'No se pudo detener el microfono local. Intenta de nuevo.');
      child.stdin.on('error', sesion.errorEntrada);
      child.stdout.setEncoding('utf8');
      child.stderr.resume();
      child.stdout.on('data', chunk => {
        if (actual !== sesion) return;
        sesion.buffer += chunk;
        if (sesion.buffer.length > 32768) { fallar(sesion, 'Respuesta de dictado local invalida'); return; }
        let salto;
        while (actual === sesion && (salto = sesion.buffer.indexOf('\n')) >= 0) {
          const linea = sesion.buffer.slice(0, salto).trim(); sesion.buffer = sesion.buffer.slice(salto + 1);
          if (!linea) continue;
          let mensaje;
          try { mensaje = JSON.parse(linea); } catch { fallar(sesion, 'Respuesta de dictado local invalida'); return; }
          if (mensaje?.tipo === 'texto' && typeof mensaje.texto === 'string' && mensaje.texto.length <= 8000) enviar(sesion, 'texto', { texto: mensaje.texto });
          else if (mensaje?.tipo === 'listo') enviar(sesion, 'listo');
          else if (mensaje?.tipo === 'fin') { enviar(sesion, 'fin'); cerrar(); }
          else if (mensaje?.tipo === 'error') {
            const errores = {
              'sin-motor': 'Instala un motor de reconocimiento de voz de escritorio en espanol en Windows. Las voces de lectura y el dictado online no lo sustituyen.',
              'sin-microfono': 'Windows no pudo abrir el microfono. Revisa el dispositivo y el permiso para aplicaciones de escritorio.',
              'sin-runtime': 'El dictado local requiere Windows PowerShell 5.1 y System.Speech de .NET Framework.',
              'fallo-local': 'El motor local de Windows no pudo completar el dictado. Puedes usar el teclado.',
            };
            fallar(sesion, errores[mensaje.error] || errores['fallo-local']);
          } else { fallar(sesion, 'Respuesta de dictado local invalida'); return; }
        }
      });
      child.on('error', () => fallar(sesion, 'No se pudo iniciar Windows PowerShell para el dictado local.'));
      child.on('close', () => fallar(sesion, 'El motor local se cerro antes de terminar. Revisa el motor de voz de Windows.'));
      sesion.limite = schedule(() => fallar(sesion, 'El dictado alcanzo el limite de 90 segundos. Puedes iniciar otro.'), 90000);
      sesion.limite?.unref?.();
      return { ok: true };
    } catch { cerrar(); return { ok: false, error: 'No se pudo iniciar el dictado local de Windows' }; }
  });
  for (const canal of ['dictado-detener', 'dictado-cancelar']) ipcMain.handle(canal, (event, payload) => {
    if (!autorizado(event) || !idValido(payload)) return { ok: false, error: 'Solicitud de dictado no permitida' };
    if (!actual || actual.id !== payload.id || actual.sender !== event.sender) return { ok: true };
    if (canal === 'dictado-cancelar') cerrar();
    else if (!actual.finalizacion) {
      const sesion = actual;
      sesion.finalizacion = schedule(() => fallar(sesion, 'El motor local no respondio al detenerse. El microfono se ha cerrado.'), 5000);
      sesion.finalizacion?.unref?.();
      sesion.child.stdin.write('STOP\n');
    }
    return { ok: true };
  });
  return {
    cerrar,
    vincularVentana(ventana) {
      ventana.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (!isInPlace && isMainFrame) cerrar(); });
      ventana.webContents.on('render-process-gone', cerrar);
      ventana.webContents.on('destroyed', cerrar);
      ventana.on('closed', cerrar);
    },
  };
}
module.exports = { crearDictadoLocal };