// Load the same validators used in the browser, without browser/Node dependencies.
import '../../../security.js';
export const { validCpf, validatePdf } = globalThis.DoxisSecurity;
export function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error('Campo inválido.');
  return value.trim();
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new Error('A senha deve ter entre 8 e 128 caracteres.');
  return value;
}
export function cpf(value) {
  if (typeof value !== 'string' || !/^\d{11}$/.test(value) || !validCpf(value)) throw new Error('CPF inválido.');
  return value;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Identificador inválido.');
  return value;
}
