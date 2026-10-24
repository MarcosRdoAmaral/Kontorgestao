import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ajustarVencimento, feriados, motivoNaoUtil } from '../src/servicos/diautil.js';

test('dia útil: fins de semana, feriados móveis e locais', () => {
  assert.deepEqual([...feriados(2026)].filter((d) => /-(02-16|02-17|04-03|06-04)$/.test(d)).sort(), ['2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04']); // carnaval, sexta santa, corpus christi
  assert.equal(motivoNaoUtil('2026-10-24'), 'sábado'); assert.equal(motivoNaoUtil('2026-10-25'), 'domingo');
  assert.equal(motivoNaoUtil('2026-10-12'), 'feriado'); assert.equal(motivoNaoUtil('2026-10-26'), '');
  assert.equal(motivoNaoUtil('2026-06-24'), ''); assert.equal(motivoNaoUtil('2026-06-24', '24/06'), 'feriado');
  assert.equal(ajustarVencimento('2026-11-10', '2026-10-24').aviso, undefined);
  const a = ajustarVencimento('2026-11-15', '2026-10-24'); // domingo + feriado 15/11: volta para sexta 13/11
  assert.equal(a.data, '2026-11-13'); assert.match(a.aviso!, /antecipado/);
  const b = ajustarVencimento('2026-10-24', '2026-10-24'); // sábado hoje: sexta já passou, vai para segunda
  assert.equal(b.data, '2026-10-26'); assert.match(b.aviso!, /adiado/);
});

test('painel financeiro, despesas e balanço', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-fin-'));
  Object.assign(process.env, { DATABASE_PATH: path.join(tmp, 'd.db'), STORAGE_DIR: tmp, MASTER_KEY: crypto.randomBytes(32).toString('base64'), SESSION_SECRET: 'x', NFSE_DESKTOP: '1' });
  const { criarApp } = await import('../src/server.js');
  const { db } = await import('../src/db.js');
  const app = await criarApp();
  const call = async (method: any, url: string, payload?: any, token?: string) => {
    const r = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: r.statusCode, json: r.headers['content-type']?.includes('json') ? r.json() : null };
  };
  try {
    const t = (await call('POST', '/api/setup', { escritorio: 'Contábil', usuario: 'ana', nome: 'Ana', email: 'ana@x.com', senha: 'senha-segura-1' })).json.token;
    const eid = (await call('POST', '/api/empresas', { documento: '529.982.247-25', razao_social: 'MEI Teste', cod_municipio: '4208203', op_simp_nac: 2 }, t)).json.id;
    const tom = (n: string, d: string) => Number(db.prepare("INSERT INTO tomadores (empresa_id, tipo_doc, documento, nome, modo_faturamento) VALUES (?,?,?,?,'NOTA_BOLETO')").run(eid, 'CPF', d, n).lastInsertRowid);
    const [c1, c2, c3] = [tom('Cliente A', '52998224725'), tom('Cliente B', '11144477735'), tom('Cliente C', '39053344705')];
    const cob = (tid: number, valor: number, venc: string, status: string, pago: string | null, criado: string) =>
      db.prepare('INSERT INTO cobrancas (empresa_id, tomador_id, descricao, valor, vencimento, status, pago_em, valor_pago, criado_em) VALUES (?,?,?,?,?,?,?,?,?)').run(eid, tid, 'x', valor, venc, status, pago, pago ? valor : null, criado);
    cob(c1, 1000, '2026-10-10', 'PAGO', '2026-10-09', '2026-10-01 10:00:00');
    cob(c2, 500, '2026-10-05', 'REGISTRADO', null, '2026-10-01 10:00:00');   // atrasada (hoje 2026-10-24)
    cob(c2, 300, '2026-10-30', 'REGISTRADO', null, '2026-10-02 10:00:00');   // a vencer
    cob(c1, 800, '2026-09-10', 'PAGO', '2026-09-12', '2026-09-01 10:00:00');
    cob(c1, 99, '2026-10-20', 'CANCELADO', null, '2026-10-01 10:00:00');       // não conta

    assert.equal((await call('POST', `/api/empresas/${eid}/despesas`, { data: '2026-10-03', categoria: 'Aluguel', valor: 700 }, t)).status, 200);
    assert.equal((await call('POST', `/api/empresas/${eid}/despesas`, { data: '2026-09-03', categoria: 'Aluguel', valor: 400, descricao: 'set' }, t)).status, 200);
    assert.equal((await call('POST', `/api/empresas/${eid}/despesas`, { data: '2026-10-03', categoria: 'Aluguel', valor: 0 }, t)).status, 400);

    const { painelFinanceiro } = await import('../src/servicos/financeiro.js');
    const p = painelFinanceiro(eid, '2026-10', '2026-10-24');
    assert.deepEqual([p.kpis.faturado, p.kpis.recebido, p.kpis.aReceber, p.kpis.emAtraso, p.kpis.qtd, p.kpis.inadimplencia], [1800, 1000, 300, 500, 3, 33]);
    assert.equal(p.atrasadas[0].dias, 19); assert.equal(p.atrasadas[0].tomador, 'Cliente B');
    assert.deepEqual(p.serie.at(-1), { mes: '2026-10', recebido: 1000, aberto: 800 });
    assert.deepEqual(p.balanco.at(-1), { mes: '2026-10', receitas: 1000, despesas: 700, resultado: 300 });
    assert.deepEqual(p.balanco.at(-2), { mes: '2026-09', receitas: 800, despesas: 400, resultado: 400 });
    assert.equal(p.faltamEmitir.qtd, 1); assert.equal(p.faltamEmitir.clientes[0].nome, 'Cliente C');
    assert.ok(p.dicas.some((d) => /em atraso/.test(d)) && p.dicas.length <= 5);

    const lista = (await call('GET', `/api/empresas/${eid}/despesas?mes=2026-10`, undefined, t)).json;
    assert.equal(lista.despesas.length, 1); assert.ok(lista.categorias.includes('Aluguel'));
    const id = lista.despesas[0].id;
    assert.equal((await call('PUT', `/api/empresas/${eid}/despesas/${id}`, { data: '2026-10-04', categoria: 'Aluguel', valor: 750 }, t)).status, 200);
    assert.equal((await call('DELETE', `/api/empresas/${eid}/despesas/${id}`, undefined, t)).status, 200);
    assert.equal((await call('GET', `/api/empresas/${eid}/despesas?mes=2026-10`, undefined, t)).json.despesas.length, 0);
    assert.equal((await call('PUT', `/api/empresas/${eid}/feriados`, { feriados_extra: '24/06, 19/03' }, t)).status, 200);
    assert.equal((await call('PUT', `/api/empresas/${eid}/feriados`, { feriados_extra: 'amanhã' }, t)).status, 400);

    // usuário normal sem o módulo não acessa despesas
    await call('POST', '/api/usuarios', { login: 'bia', nome: 'Bia', tipo: 'normal', senha: 'bia-senha-123', permissoes: ['painel'], empresas: [] }, t);
    const tb = (await call('POST', '/api/login', { usuario: 'BIA', senha: 'bia-senha-123' })).json.token;
    assert.equal((await call('GET', `/api/empresas/${eid}/painel`, undefined, tb)).status, 200);
    assert.equal((await call('GET', `/api/empresas/${eid}/despesas`, undefined, tb)).status, 403);
  } finally { await app.close(); }
});
