// tools/generar_licencia.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generarLicenciaCliente(clienteId, hardwareId, fechaVencimiento) {
  const privateKeyPath = path.join(__dirname, 'licencia_privada.pem');

  if (!fs.existsSync(privateKeyPath)) {
    console.error('❌ Error: No se encontró "licencia_privada.pem". Ejecuta "generar_claves.js" primero.');
    process.exit(1);
  }

  if (!clienteId || !hardwareId || !fechaVencimiento) {
    console.error('\n⚠️ USO: node tools/generar_licencia.js "<NombreCliente>" "<HardwareID>" "<YYYY-MM-DD>"\n');
    console.error('Ejemplo: node tools/generar_licencia.js "Taquería El Pastor" "4C4C4544-0035-3710-8031-B2C04F343033" "2026-12-31"\n');
    process.exit(1);
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

  const payload = {
    cliente: clienteId.trim(),
    hardware_id: hardwareId.trim().toUpperCase(),
    vencimiento: fechaVencimiento.trim()
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');

  const signer = crypto.createSign('SHA256');
  signer.update(payloadBase64);
  const firmaBase64 = signer.sign(privateKey, 'base64');

  const claveLicencia = `${payloadBase64}.${firmaBase64}`;

  console.log('\n======================================================');
  console.log(`🎟️ CLIENTE:     ${payload.cliente}`);
  console.log(`💻 HARDWARE ID: ${payload.hardware_id}`);
  console.log(`📅 VENCIMIENTO: ${payload.vencimiento}`);
  console.log('======================================================');
  console.log(claveLicencia);
  console.log('======================================================\n');
}

const args = process.argv.slice(2);
generarLicenciaCliente(args[0], args[1], args[2]);