// tools/generar_claves.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const toolsDir = __dirname;
const rootDir = path.resolve(__dirname, '..');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

fs.writeFileSync(path.join(toolsDir, 'licencia_privada.pem'), privateKey);
fs.writeFileSync(path.join(toolsDir, 'licencia_publica.pem'), publicKey);
fs.writeFileSync(path.join(rootDir, 'licencia_publica.pem'), publicKey);

console.log('🔑 Claves generadas exitosamente:');
console.log(' - Clave privada: tools/licencia_privada.pem (⚠️ SECRETA - NO DISTRIBUIR)');
console.log(' - Clave pública:  tools/licencia_publica.pem');
console.log(' - Clave pública:  licencia_publica.pem (Copiada a la raíz para la app)');