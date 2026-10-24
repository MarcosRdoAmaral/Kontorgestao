import { unzipSync } from 'fflate';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-'));
process.env.DATABASE_PATH = path.join(tmp, 'db.sqlite');
process.env.STORAGE_DIR = path.join(tmp, 'arq');
process.env.MASTER_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.ADMIN_SENHA = 'senha-forte-123';

execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/k.pem -out ${tmp}/c.pem -days 30 -subj "/CN=EMPRESA TESTE LTDA:11222333000181" 2>/dev/null && openssl pkcs12 -export -inkey ${tmp}/k.pem -in ${tmp}/c.pem -out ${tmp}/t.pfx -passout pass:1234`);

// ---- Sefin falsa ----
// O XSD oficial traz ^...$ no padrão de <serie> (literais em XSD), o que recusa até "1".
// Validamos contra uma cópia com esse padrão corrigido.
const XSD = path.join(tmp, 'xsd');
fs.cpSync(path.resolve('schemas/1.01'), XSD, { recursive: true });
const tsPath = path.join(XSD, 'tiposSimples_v1.01.xsd');
fs.writeFileSync(tsPath, fs.readFileSync(tsPath, 'utf8').replace('^0{0,4}\\d{1,5}$', '0{0,4}\\d{1,5}'));
const recebidos: string[] = [];
let modo: 'ok' | 'rejeitar' | 'cair' | 'cair_mas_gerar' = 'ok';
const geradas = new Map<string, string>();
const srv = https.createServer({ key: fs.readFileSync(`${tmp}/k.pem`), cert: fs.readFileSync(`${tmp}/c.pem`) }, (req, res) => {
  const partes: Buffer[] = [];
  req.on('data', (c) => partes.push(c));
  req.on('end', () => {
    const json = (st: number, o: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const corpo = partes.length ? JSON.parse(Buffer.concat(partes).toString()) : {};
    if (req.method === 'POST' && req.url === '/nfse') {
      const xml = zlib.gunzipSync(Buffer.from(corpo.dpsXmlGZipB64, 'base64')).toString();
      if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) return json(400, { erros: [{ Codigo: 'E1229', Descricao: 'Xml não está utilizando codificação UTF-8.' }] });
      recebidos.push(xml);
      fs.writeFileSync(`${tmp}/recebida.xml`, xml);
      try { execSync(`xmllint --noout --schema ${XSD}/DPS_v1.01.xsd ${tmp}/recebida.xml 2>&1`); }
      catch (e: any) { return json(400, { erros: [{ Codigo: 'E1235', Descricao: 'XSD: ' + e.stdout?.toString().slice(0, 300) }] }); }
      if (modo === 'rejeitar') return json(400, { erros: [{ Codigo: 'E0312', Descricao: 'Informe o desdobro municipal' }] });
      const id = xml.match(/infDPS Id="(DPS\d{42})"/)![1];
      const nfse = montarNfse(xml, id);
      geradas.set(id, nfse.xml);
      if (modo === 'cair') return json(503, { erro: 'indisponível' });
      if (modo === 'cair_mas_gerar') { res.destroy(); return; }
      return json(201, { chaveAcesso: nfse.chave, nfseXmlGZipB64: zlib.gzipSync(nfse.xml).toString('base64') });
    }
    const dps = req.url?.match(/^\/dps\/(.+)$/);
    if (dps) { const x = geradas.get(dps[1]); if (!x) return json(404, { erros: [{ Codigo: 'E2404', Descricao: 'não gerada' }] }); return json(200, { chaveAcesso: x.match(/Id="NFS(\d{50})"/)![1] }); }
    const nf = req.url?.match(/^\/nfse\/(\d{50})$/);
    if (nf) { const x = [...geradas.values()].find((v) => v.includes(`NFS${nf[1]}`))!; return json(200, { nfseXmlGZipB64: zlib.gzipSync(x).toString('base64') }); }
    const ev = req.url?.match(/^\/nfse\/(\d{50})\/eventos$/);
    if (ev && req.method === 'POST') {
      const x = zlib.gunzipSync(Buffer.from(corpo.pedidoRegistroEventoXmlGZipB64, 'base64')).toString();
      if (!x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) return json(400, { erros: [{ Codigo: 'E1229', Descricao: 'Xml não está utilizando codificação UTF-8.' }] });
      fs.writeFileSync(`${tmp}/evento.xml`, x);
      try { execSync(`xmllint --noout --schema ${XSD}/pedRegEvento_v1.01.xsd ${tmp}/evento.xml 2>&1`); } catch { return json(400, { erros: [{ Codigo: 'E1235', Descricao: 'XSD evento' }] }); }
      return json(200, { eventoXmlGZipB64: zlib.gzipSync('<evento>ok</evento>').toString('base64') });
    }
    json(404, {});
  });
});

let seq = 0;
function montarNfse(dpsXml: string, idDps: string) {
  const chave = `4208203211122233300018155${String(1).padStart(1, '0')}`.padEnd(50, '0').slice(0, 40) + String(++seq).padStart(10, '0');
  const dps = dpsXml.replace(/^<\?xml[^>]*\?>/, '').replace(/<Signature[\s\S]*<\/Signature>/, '');
  const xml = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${chave}"><xLocEmi>Itajaí</xLocEmi><xLocPrestacao>Itajaí</xLocPrestacao>` +
    `<nNFSe>${seq}</nNFSe><xTribNac>Contabilidade</xTribNac><verAplic>SefinNacional_1.6.0</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>100</cStat>` +
    `<dhProc>2026-10-23T19:10:00-03:00</dhProc><nDFSe>${seq}</nDFSe><emit><CNPJ>11222333000181</CNPJ><IM>12345</IM><xNome>EMPRESA TESTE LTDA</xNome>` +
    `<enderNac><xLgr>Rua X</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>4208203</cMun><UF>SC</UF><CEP>88301000</CEP></enderNac></emit>` +
    `<valores><vBC>1500.00</vBC><pAliqAplic>2.50</pAliqAplic><vISSQN>37.50</vISSQN><vTotalRet>0.00</vTotalRet><vLiq>1500.00</vLiq></valores>` +
    dps.replace(/^<DPS[^>]*>/, '<DPS versao="1.01">') + `</infNFSe></NFSe>`;
  return { xml, chave };
}

test('fluxo completo: cadastro, emissão, rejeição, queda de rede, DANFSe e cancelamento', async () => {
  await new Promise<void>((r) => srv.listen(0, r));
  process.env.SEFIN_URL_TESTE = `https://127.0.0.1:${(srv.address() as any).port}`;
  const { criarApp } = await import('../src/server.js');
  const app = await criarApp();
  try {
  const call = async (method: any, url: string, body?: any, token?: string) => {
    const r = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: r.statusCode, json: r.headers['content-type']?.includes('json') ? r.json() : null, raw: r.rawPayload, headers: r.headers };
  };

  assert.equal((await call('POST', '/api/login', { email: 'admin@escritorio.com.br', senha: 'errada' })).status, 401);
  const token = (await call('POST', '/api/login', { email: 'admin@escritorio.com.br', senha: 'senha-forte-123' })).json.token;
  assert.equal((await call('GET', '/api/empresas')).status, 401);

  // validações de cadastro
  assert.equal((await call('POST', '/api/empresas', { documento: '11111111111111', razao_social: 'X', cod_municipio: '4208203', op_simp_nac: 3 }, token)).status, 400);
  const emp = await call('POST', '/api/empresas', { documento: '11.222.333/0001-81', razao_social: 'EMPRESA TESTE LTDA', cod_municipio: '4208203', inscricao_municipal: '12345', op_simp_nac: 3, reg_ap_trib_sn: 1, p_tot_trib_sn: 6, ambiente: 2, serie: '1' }, token);
  assert.equal(emp.status, 200);
  const eid = emp.json.id;

  // emitir sem certificado falha cedo, sem consumir número
  const semCert = await call('POST', '/api/notas', { empresaId: eid, competencia: '2026-10-23', descricao: 'x', valor: 10, cTribNac: '171901' }, token);
  assert.equal(semCert.status, 400);

  // upload do certificado (multipart)
  const boundary = '----t';
  const pfx = fs.readFileSync(`${tmp}/t.pfx`);
  const mp = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="senha"\r\n\r\n1234\r\n--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="t.pfx"\r\nContent-Type: application/x-pkcs12\r\n\r\n`),
    pfx, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const up = await app.inject({ method: 'POST', url: `/api/empresas/${eid}/certificado`, payload: mp, headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  assert.equal(up.statusCode, 200, up.body);
  const lista = (await call('GET', '/api/empresas', undefined, token)).json;
  assert.equal(lista[0].tem_certificado, true);
  assert.equal(lista[0].cert_pfx_enc, undefined, 'certificado nunca deve vazar na API');

  const tom = await call('POST', `/api/empresas/${eid}/tomadores`, { tipo_doc: 'CPF', documento: '529.982.247-25', nome: 'Fulano & Cia <teste>', cep: '88301-000', cod_municipio: '4208203', logradouro: 'Rua A', numero: '10', bairro: 'Centro' }, token);
  assert.equal(tom.status, 200);
  assert.equal((await call('POST', `/api/empresas/${eid}/tomadores`, { tipo_doc: 'CPF', documento: '111.111.111-11', nome: 'Inválido' }, token)).status, 400);
  const srvc = await call('POST', `/api/empresas/${eid}/servicos`, { nome: 'Honorários', descricao: 'Serviços de contabilidade', c_trib_nac: '17.19.01', aliquota: 2.5 }, token);
  assert.equal(srvc.status, 200);

  const base = { empresaId: eid, tomadorId: tom.json.id, servicoId: srvc.json.id, competencia: '2026-10-23', descricao: 'Honorários de outubro', valor: 1500 };

  // 1) emissão com sucesso (a Sefin falsa valida o XML contra o XSD oficial)
  let r = await call('POST', '/api/notas', base, token);
  assert.equal(r.json.status, 'AUTORIZADA', JSON.stringify(r.json));
  assert.equal(r.json.n_dps, 1);
  assert.match(r.json.chave_acesso, /^\d{50}$/);
  const nota1 = r.json.id;

  // 2) rejeição não perde a nota e mantém o número para reenvio
  modo = 'rejeitar';
  r = await call('POST', '/api/notas', base, token);
  assert.equal(r.json.status, 'REJEITADA');
  assert.equal(r.json.n_dps, 2);
  assert.equal(r.json.erros[0].codigo, 'E0312');
  const rej = r.json.id;
  modo = 'ok';
  r = await call('POST', `/api/notas/${rej}/reenviar`, {}, token);
  assert.equal(r.json.status, 'AUTORIZADA');
  assert.equal(r.json.n_dps, 2, 'reenvio mantém o mesmo nº de DPS');

  // 3) conexão cai DEPOIS da Sefin gerar a nota: reconciliação recupera sem duplicar
  modo = 'cair_mas_gerar';
  r = await call('POST', '/api/notas', base, token);
  assert.equal(r.json.status, 'ERRO_COMUNICACAO');
  const queda = r.json.id;
  const antes = recebidos.length;
  modo = 'ok';
  r = await call('POST', `/api/notas/${queda}/reenviar`, {}, token);
  assert.equal(r.json.status, 'AUTORIZADA');
  assert.equal(recebidos.length, antes, 'não pode reenviar a DPS: a nota foi recuperada pela consulta');

  // numeração sequencial sem buracos nem repetição
  const todas = (await call('GET', `/api/notas?empresaId=${eid}`, undefined, token)).json;
  assert.deepEqual(todas.map((n: any) => n.n_dps).sort(), [1, 2, 3]);

  // 4) DANFSe e XML
  const pdf = await call('GET', `/api/notas/${nota1}/danfse`, undefined, token);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.raw.subarray(0, 4).toString(), '%PDF');
  fs.writeFileSync(`${tmp}/danfse.pdf`, pdf.raw);
  assert.equal((await call('GET', `/api/notas/${nota1}/xml`, undefined, token)).status, 200);

  // 4b) lucro presumido: IBS/CBS + retenções federais (PIS/COFINS/CSLL/IRRF) validadas no XSD
  const ruim = await call('POST', `/api/empresas/${eid}/servicos`, { nome: 'IBS ruim', descricao: 'x', c_trib_nac: '171901', ibscbs: { indFinal: 0, cIndOp: '030102', indDest: 0, cst: '01', cClassTrib: '000001' } }, token);
  assert.equal(ruim.status, 400);
  assert.match(JSON.stringify(ruim.json), /3 dígitos/);
  const sIbs = await call('POST', `/api/empresas/${eid}/servicos`, { nome: 'Asseio', descricao: 'Serviços de asseio e conservação', c_trib_nac: '071002', c_nbs: '118031000', aliquota: 5, ibscbs: { indFinal: 0, cIndOp: '030102', indDest: 0, cst: '000', cClassTrib: '000001' } }, token);
  assert.equal(sIbs.status, 200, JSON.stringify(sIbs.json));
  const ret = await call('POST', '/api/notas', { ...base, servicoId: sIbs.json.id, valor: 1000, retencoes: { pis: 6.5, pPis: 0.65, cofins: 30, pCofins: 3, csll: 10, irrf: 15 } }, token);
  assert.equal(ret.json.status, 'AUTORIZADA', JSON.stringify(ret.json));
  assert.match(ret.json.xml_dps, /<piscofins><CST>01<\/CST><vBCPisCofins>1000\.00<\/vBCPisCofins><pAliqPis>0\.65<\/pAliqPis><pAliqCofins>3\.00<\/pAliqCofins><vPis>6\.50<\/vPis><vCofins>30\.00<\/vCofins><tpRetPisCofins>3<\/tpRetPisCofins><\/piscofins>/);

  const semNbs = await call('POST', `/api/empresas/${eid}/servicos`, { nome: 'IBS sem NBS', descricao: 'x', c_trib_nac: '071002', ibscbs: { indFinal: 0, cIndOp: '030102', indDest: 0, cst: '000', cClassTrib: '000001' } }, token);
  assert.equal(semNbs.status, 400);
  assert.match(JSON.stringify(semNbs.json), /NBS/);
  // IBS/CBS sem endereço completo do tomador: falha cedo (E0234), sem consumir número de DPS
  const tSemEnd = await call('POST', `/api/empresas/${eid}/tomadores`, { tipo_doc: 'CNPJ', documento: '28.627.851/0001-88', nome: 'Tomador sem endereço' }, token);
  const semEnd = await call('POST', '/api/notas', { ...base, tomadorId: tSemEnd.json.id, servicoId: sIbs.json.id }, token);
  assert.equal(semEnd.status, 422 === semEnd.status ? 422 : semEnd.status);
  assert.match(JSON.stringify(semEnd.json), /E0234/);

  // 4d) e-mail: SMTP do escritório, bloqueio de nota de teste, envio com PDF + XML anexos
  const { trocarTransporte } = await import('../src/servicos/email.js');
  const { db: bancoEmail } = await import('../src/db.js');
  const enviadosEmail: any[] = [];
  trocarTransporte(() => ({ sendMail: async (m: any) => { enviadosEmail.push(m); return {}; } }) as any);
  assert.equal((await call('PUT', '/api/email/config', { host: 'smtp.exemplo.com', port: 587, secure: false, usuario: 'u@x.com', senha: 's3nh4', remetente_nome: 'Escritório', remetente_email: 'u@x.com' }, token)).status, 200);
  const emTeste = await call('POST', `/api/notas/${nota1}/email`, { para: ['cliente@x.com'] }, token);
  assert.equal(emTeste.status, 400);
  assert.match(JSON.stringify(emTeste.json), /teste/i);
  bancoEmail.prepare('UPDATE notas SET ambiente = 1 WHERE id = ?').run(nota1);
  assert.equal((await call('POST', `/api/notas/${nota1}/email`, { para: ['nao-e-email'] }, token)).status, 400);
  const ok = await call('POST', `/api/notas/${nota1}/email`, { para: ['cliente@x.com', 'financeiro@x.com'] }, token);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const msg = enviadosEmail.at(-1);
  assert.equal(msg.to, 'cliente@x.com, financeiro@x.com');
  assert.deepEqual(msg.attachments.map((a: any) => a.filename).sort(), [`DANFSe_${(await call('GET', `/api/notas/${nota1}`, undefined, token)).json.n_nfse}.pdf`, `NFSe_${(await call('GET', `/api/notas/${nota1}`, undefined, token)).json.n_nfse}.xml`].sort());
  assert.equal(Buffer.from(msg.attachments[0].content).subarray(0, 4).toString(), '%PDF');
  assert.equal((await call('GET', `/api/notas/${nota1}/emails`, undefined, token)).json[0].status, 'ENVIADO');
  bancoEmail.prepare('UPDATE notas SET ambiente = 2 WHERE id = ?').run(nota1);

  // 4c) logo no DANFSe + download em lote
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const mpl = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="arquivo"; filename="l.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const lg = await app.inject({ method: 'POST', url: `/api/empresas/${eid}/logo`, payload: mpl, headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  assert.equal(lg.statusCode, 200, lg.body);
  assert.equal((await call('GET', '/api/empresas', undefined, token)).json[0].tem_logo, true);
  assert.equal((await call('GET', `/api/notas/${nota1}/danfse`, undefined, token)).raw.subarray(0, 4).toString(), '%PDF');
  const lote = await call('GET', `/api/notas-lote?empresaId=${eid}&formato=ambos`, undefined, token);
  assert.equal(lote.status, 200);
  assert.equal(lote.raw.subarray(0, 2).toString(), 'PK');
  assert.ok(Object.keys(unzipSync(new Uint8Array(lote.raw))).some((n) => n.endsWith('.pdf')));

  // 5) cancelamento
  assert.equal((await call('POST', `/api/notas/${nota1}/cancelar`, { cMotivo: 1, xMotivo: 'curto' }, token)).status, 400);
  r = await call('POST', `/api/notas/${nota1}/cancelar`, { cMotivo: 1, xMotivo: 'Erro no valor do serviço informado' }, token);
  assert.equal(r.json.status, 'CANCELADA', JSON.stringify(r.json));
  assert.equal((await call('POST', `/api/notas/${nota1}/cancelar`, { cMotivo: 1, xMotivo: 'Erro no valor do serviço informado' }, token)).status, 400);

  // 6) isolamento: cliente só enxerga a própria empresa
  const emp2 = await call('POST', '/api/empresas', { documento: '529.982.247-25', razao_social: 'Outro MEI', cod_municipio: '4208203', op_simp_nac: 2 }, token);
  await call('POST', '/api/usuarios', { nome: 'Cliente', email: 'c@x.com', senha: 'cliente-123', papel: 'cliente', empresas: [eid] }, token);
  const tc = (await call('POST', '/api/login', { email: 'c@x.com', senha: 'cliente-123' })).json.token;
  assert.deepEqual((await call('GET', '/api/empresas', undefined, tc)).json.map((e: any) => e.id), [eid]);
  assert.equal((await call('GET', `/api/empresas/${emp2.json.id}/tomadores`, undefined, tc)).status, 404);
  assert.equal((await call('POST', `/api/notas/${nota1}/cancelar`, { cMotivo: 1, xMotivo: 'x'.repeat(20) }, tc)).status, 403);

  // 7) resumo mensal
  const res = (await call('GET', '/api/relatorios/resumo?mes=2026-10', undefined, token)).json;
  const e1 = res.find((x: any) => x.empresa_id === eid);
  assert.equal(e1.autorizadas, 3); assert.equal(e1.canceladas, 1); assert.equal(e1.faturado, 4000);

  // 8) o certificado está criptografado em repouso
  const { db } = await import('../src/db.js');
  const bruto = (db.prepare('SELECT cert_pfx_enc FROM empresas WHERE id = ?').get(eid) as any).cert_pfx_enc as Buffer;
  assert.ok(!Buffer.from(bruto).includes(pfx.subarray(0, 32)));

  console.log('PDF de exemplo:', `${tmp}/danfse.pdf`);
  } finally { await app.close(); srv.closeAllConnections(); srv.close(); }
});
