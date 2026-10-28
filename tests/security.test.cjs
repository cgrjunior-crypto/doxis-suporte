const {test,before}=require('node:test');
const assert=require('node:assert/strict');
let security;
before(async()=>{await import('../security.js');security=globalThis.DoxisSecurity});
test('escapes markup, quotes and event payloads',()=>{
  assert.equal(security.escapeHtml(`<img src=x onerror="alert(1)">'&`),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;');
});
test('CPF checksum rejects repeated and incorrect digits',()=>{
  assert.equal(security.validCpf('529.982.247-25'),true);
  for(const value of ['11111111111','52998224726','123','00000000000'])assert.equal(security.validCpf(value),false);
});
test('PDF checks reject disguised, empty and oversized uploads',async()=>{
  await security.validatePdf(new File(['%PDF-1.7\n'],'document.pdf',{type:'application/pdf'}));
  await assert.rejects(security.validatePdf(new File(['<html>bad'],'fake.pdf',{type:'application/pdf'})),/assinatura/);
  await assert.rejects(security.validatePdf(new File(['%PDF-'],'bad.exe',{type:'application/pdf'})),/Selecione/);
  await assert.rejects(security.validatePdf(new File([],'empty.pdf')),/vazio/);
  await assert.rejects(security.validatePdf({size:security.MAX_PDF_BYTES+1,name:'large.pdf'}),/50 MB/);
});
