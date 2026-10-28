/* Shared, dependency-free validation used by browser, Edge Function and tests. */
(function (root) {
  const MAX_PDF_BYTES = 50 * 1024 * 1024;
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function validCpf(value) {
    const cpf = String(value).replace(/\D/g, '');
    if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let n = 9; n < 11; n++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += Number(cpf[i]) * (n + 1 - i);
      let digit = (sum * 10) % 11;
      if (digit === 10) digit = 0;
      if (digit !== Number(cpf[n])) return false;
    }
    return true;
  }
  async function validatePdf(file) {
    if (!file || file.size < 5 || file.size > MAX_PDF_BYTES) throw new Error('O PDF deve ter até 50 MB e não pode estar vazio.');
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) throw new Error('Selecione um arquivo PDF.');
    const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
    if (signature !== '%PDF-') throw new Error('O arquivo não possui assinatura de PDF.');
  }
  const api = { escapeHtml, validCpf, validatePdf, MAX_PDF_BYTES };
  root.DoxisSecurity = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
