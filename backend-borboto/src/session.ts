import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const key = randomBytes(32);
export interface Session { id: number; rol: string; exp: number }
const roles = new Set(['ADMIN', 'CAJERO', 'MESERO', 'COCINERO']);

export function emitirSesion(id: number, rol: string): string {
  const payload = Buffer.from(JSON.stringify({ id, rol, exp: Date.now() + 12 * 3600000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

export function verificarSesion(token: string): Session | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    if (!payload || !signature) return null;
    const expected = createHmac('sha256', key).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const value: Session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Number.isInteger(value.id) && value.id > 0 && roles.has(value.rol) && Number.isFinite(value.exp) && value.exp > Date.now() ? value : null;
  } catch { return null; }
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  return `hash$${salt}$${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function verificarPin(pin: string, stored: string): boolean {
  if (!stored.startsWith('hash$')) {
    const left = Buffer.from(pin);
    const right = Buffer.from(stored);
    return left.length === right.length && timingSafeEqual(left, right);
  }
  const [, salt, encoded] = stored.split('$');
  if (!salt || !encoded || !/^[0-9a-f]{64}$/.test(encoded)) return false;
  const expected = Buffer.from(encoded, 'hex');
  return timingSafeEqual(scryptSync(pin, salt, 32), expected);
}