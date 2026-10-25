import { z } from 'zod';
import { db } from '../db.js';
import { lerNfe } from '../nfe/leitura.js';
import { lerNfse } from '../nfse/leitura.js';
import { ErroNegocio } from './emissao.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const hojeBr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const TOLERANCIA = 0.05;

// ---------------------------------------------------------------------------
// Catálogo de impostos
// ---------------------------------------------------------------------------
export interface Imposto { codigo: string; nome: string; grupo: string; pode_reter: number; credita: number; ativo: number; ordem: number }
export const listarImpostos = () => db.prepare('SELECT * FROM impostos ORDER BY ordem').all() as Imposto[];

export const EdicaoImposto = z.object({ nome: z.string().trim().min(2).max(80), ativo: z.boolean() });
export function editarImposto(codigo: string, d: z.infer<typeof EdicaoImposto>) {
  if (!db.prepare('UPDATE impostos SET nome = ?, ativo = ? WHERE codigo = ?').run(d.nome, d.ativo ? 1 : 0, codigo).changes) throw new ErroNegocio('Imposto não encontrado.', 404);
}

// ---------------------------------------------------------------------------
// Perfis de tributação (conjunto de impostos, com vigência)
// ---------------------------------------------------------------------------
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullish().or(z.literal('').transform(() => null));
export const ItemPerfil = z.object({
  imposto_codigo: z.string().min(2),
  aliquota: z.number().min(0).max(100),
  reducao_base: z.number().min(0).max(100).default(0),
  retido: z.boolean().default(false),
  cst: z.string().regex(/^\d{3}$/, 'CST tem 3 dígitos').nullish().or(z.literal('').transform(() => null)),
  c_class_trib: z.string().regex(/^\d{6}$/, 'cClassTrib tem 6 dígitos').nullish().or(z.literal('').transform(() => null)),
  vigencia_ini: Data, vigencia_fim: Data,
}).refine((i) => !i.vigencia_ini || !i.vigencia_fim || i.vigencia_ini <= i.vigencia_fim, { message: 'A vigência inicial é maior que a final', path: ['vigencia_fim'] });
export const Perfil = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do perfil').max(80),
  descricao: z.string().trim().max(300).nullish(),
  itens: z.array(ItemPerfil).max(40).default([]),
});

function conferirImpostos(itens: z.infer<typeof ItemPerfil>[]) {
  const validos = new Set(listarImpostos().map((i) => i.codigo));
  for (const i of itens) if (!validos.has(i.imposto_codigo)) throw new ErroNegocio(`Imposto desconhecido: ${i.imposto_codigo}.`);
}
function gravarItens(perfilId: number, itens: z.infer<typeof ItemPerfil>[]) {
  conferirImpostos(itens);
  db.prepare('DELETE FROM perfil_itens WHERE perfil_id = ?').run(perfilId);
  const ins = db.prepare('INSERT INTO perfil_itens (perfil_id, imposto_codigo, aliquota, reducao_base, retido, cst, c_class_trib, vigencia_ini, vigencia_fim) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const i of itens) ins.run(perfilId, i.imposto_codigo, i.aliquota, i.reducao_base, i.retido ? 1 : 0, i.cst ?? null, i.c_class_trib ?? null, i.vigencia_ini || null, i.vigencia_fim || null);
}

export function listarPerfis(empresaId: number) {
  const perfis = db.prepare('SELECT id, nome, descricao FROM perfis_tributacao WHERE empresa_id = ? AND ativo = 1 ORDER BY nome').all(empresaId) as any[];
  const itens = db.prepare('SELECT * FROM perfil_itens WHERE perfil_id = ? ORDER BY imposto_codigo, vigencia_ini');
  return perfis.map((p) => ({ ...p, itens: (itens.all(p.id) as any[]).map((i) => ({ ...i, retido: !!i.retido })),
    usos: (db.prepare('SELECT COUNT(*) AS n FROM tipos_documento WHERE perfil_id = ? AND ativo = 1').get(p.id) as any).n }));
}
export function criarPerfil(empresaId: number, d: z.infer<typeof Perfil>) {
  return db.transaction(() => {
    const id = Number(db.prepare('INSERT INTO perfis_tributacao (empresa_id, nome, descricao) VALUES (?,?,?)').run(empresaId, d.nome, d.descricao ?? null).lastInsertRowid);
    gravarItens(id, d.itens);
    return { id };
  })();
}
export function editarPerfil(empresaId: number, id: number, d: z.infer<typeof Perfil>) {
  db.transaction(() => {
    if (!db.prepare('UPDATE perfis_tributacao SET nome = ?, descricao = ? WHERE id = ? AND empresa_id = ? AND ativo = 1').run(d.nome, d.descricao ?? null, id, empresaId).changes) throw new ErroNegocio('Perfil não encontrado.', 404);
    gravarItens(id, d.itens);
  })();
}
export function excluirPerfil(empresaId: number, id: number) {
  const usos = (db.prepare('SELECT COUNT(*) AS n FROM tipos_documento WHERE perfil_id = ? AND ativo = 1').get(id) as any).n;
  if (usos) throw new ErroNegocio(`Este perfil é usado por ${usos} tipo(s) de documento. Troque o perfil deles antes de excluir.`);
  if (!db.prepare('UPDATE perfis_tributacao SET ativo = 0 WHERE id = ? AND empresa_id = ?').run(id, empresaId).changes) throw new ErroNegocio('Perfil não encontrado.', 404);
}

/** Itens do perfil que valem na data (vigência em branco = sem limite). */
export function itensVigentes(perfilId: number, data: string) {
  return (db.prepare(`SELECT pi.*, i.pode_reter, i.credita FROM perfil_itens pi JOIN impostos i ON i.codigo = pi.imposto_codigo
    WHERE pi.perfil_id = ? AND i.ativo = 1 AND (pi.vigencia_ini IS NULL OR pi.vigencia_ini <= ?) AND (pi.vigencia_fim IS NULL OR pi.vigencia_fim >= ?)`).all(perfilId, data, data) as any[]);
}

/** valor = base × (1 − redução) × alíquota. Vários itens do mesmo imposto na mesma data: vale o de vigência mais recente. */
export function calcularPerfil(perfilId: number, base: number, data: string) {
  const porImposto = new Map<string, any>();
  for (const it of itensVigentes(perfilId, data)) {
    const atual = porImposto.get(it.imposto_codigo);
    if (!atual || (it.vigencia_ini ?? '') >= (atual.vigencia_ini ?? '')) porImposto.set(it.imposto_codigo, it);
  }
  return [...porImposto.values()].map((it) => {
    const b = r2(base * (1 - it.reducao_base / 100));
    return { imposto: it.imposto_codigo as string, base: b, aliquota: it.aliquota as number, valor: r2(b * it.aliquota / 100), retido: !!it.retido };
  });
}

// ---------------------------------------------------------------------------
// Tipos de documento / operação
// ---------------------------------------------------------------------------
export const NATUREZAS = ['Serviço', 'Mercadoria para revenda', 'Insumo', 'Uso e consumo', 'Ativo imobilizado', 'Devolução', 'Outra'] as const;
export const TipoDocumento = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do tipo').max(80),
  sentido: z.enum(['SAIDA', 'ENTRADA']),
  modelo: z.enum(['NFSE', 'NFE', 'MANUAL']),
  natureza: z.string().trim().max(60).nullish(),
  perfil_id: z.number().int().nullish(),
  c_trib_nac: z.string().trim().max(6).nullish(),
  cfop: z.string().trim().max(4).nullish(),
  ind_op: z.string().trim().max(6).nullish(),
  gera_credito: z.boolean().default(false),
  destino: z.enum(['RECEITA', 'DESPESA', 'NENHUM']).default('NENHUM'),
  padrao: z.boolean().default(false),
});
function conferirTipo(empresaId: number, d: z.infer<typeof TipoDocumento>) {
  if (d.perfil_id && !db.prepare('SELECT 1 FROM perfis_tributacao WHERE id = ? AND empresa_id = ? AND ativo = 1').get(d.perfil_id, empresaId)) throw new ErroNegocio('Perfil de tributação inválido.');
  if (d.sentido === 'SAIDA' && d.modelo === 'NFE') throw new ErroNegocio('NF-e de mercadorias é só de entrada (compras); para saída use NFS-e.');
}
function exclusivoPadrao(empresaId: number, id: number, d: z.infer<typeof TipoDocumento>) {
  if (d.padrao) db.prepare('UPDATE tipos_documento SET padrao = 0 WHERE empresa_id = ? AND sentido = ? AND id <> ?').run(empresaId, d.sentido, id);
}
export const listarTipos = (empresaId: number) =>
  (db.prepare(`SELECT t.*, p.nome AS perfil_nome,
      (SELECT COUNT(*) FROM servicos s WHERE s.tipo_documento_id = t.id AND s.ativo = 1) + (SELECT COUNT(*) FROM compras c WHERE c.tipo_documento_id = t.id) AS usos
    FROM tipos_documento t LEFT JOIN perfis_tributacao p ON p.id = t.perfil_id WHERE t.empresa_id = ? AND t.ativo = 1 ORDER BY t.sentido DESC, t.nome`).all(empresaId) as any[])
    .map((t) => ({ ...t, gera_credito: !!t.gera_credito, padrao: !!t.padrao }));
export function criarTipo(empresaId: number, d: z.infer<typeof TipoDocumento>) {
  conferirTipo(empresaId, d);
  return db.transaction(() => {
    const id = Number(db.prepare(`INSERT INTO tipos_documento (empresa_id, nome, sentido, modelo, natureza, perfil_id, c_trib_nac, cfop, ind_op, gera_credito, destino, padrao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId, d.nome, d.sentido, d.modelo, d.natureza ?? null, d.perfil_id ?? null, d.c_trib_nac || null, d.cfop || null, d.ind_op || null, d.gera_credito ? 1 : 0, d.destino, d.padrao ? 1 : 0).lastInsertRowid);
    exclusivoPadrao(empresaId, id, d);
    return { id };
  })();
}
export function editarTipo(empresaId: number, id: number, d: z.infer<typeof TipoDocumento>) {
  conferirTipo(empresaId, d);
  db.transaction(() => {
    if (!db.prepare(`UPDATE tipos_documento SET nome=?, sentido=?, modelo=?, natureza=?, perfil_id=?, c_trib_nac=?, cfop=?, ind_op=?, gera_credito=?, destino=?, padrao=? WHERE id=? AND empresa_id=? AND ativo=1`)
      .run(d.nome, d.sentido, d.modelo, d.natureza ?? null, d.perfil_id ?? null, d.c_trib_nac || null, d.cfop || null, d.ind_op || null, d.gera_credito ? 1 : 0, d.destino, d.padrao ? 1 : 0, id, empresaId).changes) throw new ErroNegocio('Tipo de documento não encontrado.', 404);
    exclusivoPadrao(empresaId, id, d);
  })();
}
export function excluirTipo(empresaId: number, id: number) {
  const usos = (db.prepare('SELECT (SELECT COUNT(*) FROM servicos WHERE tipo_documento_id = ? AND ativo = 1) + (SELECT COUNT(*) FROM compras WHERE tipo_documento_id = ?) AS n').get(id, id) as any).n;
  if (usos) throw new ErroNegocio(`Este tipo está vinculado a ${usos} serviço(s)/compra(s). Troque o vínculo antes de excluir.`);
  if (!db.prepare('UPDATE tipos_documento SET ativo = 0, padrao = 0 WHERE id = ? AND empresa_id = ?').run(id, empresaId).changes) throw new ErroNegocio('Tipo de documento não encontrado.', 404);
}

/** Tipo de documento padrão da empresa para um sentido (usado quando o serviço/compra não aponta nenhum). */
export const tipoPadrao = (empresaId: number, sentido: 'SAIDA' | 'ENTRADA') =>
  db.prepare('SELECT * FROM tipos_documento WHERE empresa_id = ? AND sentido = ? AND padrao = 1 AND ativo = 1').get(empresaId, sentido) as any | undefined;

export function conferirTipoDoVinculo(empresaId: number, tipoId: number | null | undefined, sentido: 'SAIDA' | 'ENTRADA') {
  if (!tipoId) return null;
  const t = db.prepare('SELECT sentido FROM tipos_documento WHERE id = ? AND empresa_id = ? AND ativo = 1').get(tipoId, empresaId) as any;
  if (!t) throw new ErroNegocio('Tipo de documento inválido.');
  if (t.sentido !== sentido) throw new ErroNegocio(`Este vínculo precisa de um tipo de ${sentido === 'SAIDA' ? 'saída' : 'entrada'}.`);
  return tipoId;
}

/**
 * Retenções e ISS retido que o perfil do tipo de documento define para um serviço.
 * Devolve null quando o serviço não tem tipo/perfil (vale a tributação cadastrada no próprio serviço).
 */
export function tributacaoDoPerfil(servicoId: number, data = hojeBr()) {
  const r = db.prepare(`SELECT t.perfil_id FROM servicos s JOIN tipos_documento t ON t.id = s.tipo_documento_id WHERE s.id = ? AND t.ativo = 1`).get(servicoId) as any;
  if (!r?.perfil_id) return null;
  const it = itensVigentes(r.perfil_id, data);
  const ret = (cod: string) => it.find((x) => x.imposto_codigo === cod && x.retido)?.aliquota ?? null;
  return { pPis: ret('PIS'), pCofins: ret('COFINS'), pCsll: ret('CSLL'), pIrrf: ret('IRRF'), pCp: ret('INSS'), issRetido: it.some((x) => x.imposto_codigo === 'ISS' && x.retido) ? 2 : 1 };
}

/** Cria perfis a partir da tributação já cadastrada nos serviços (retenções) e vincula cada serviço. Idempotente. */
export function gerarPerfisDosServicos(empresaId: number) {
  const servs = db.prepare('SELECT id, nome, aliquota, tributacao_json FROM servicos WHERE empresa_id = ? AND ativo = 1 AND tipo_documento_id IS NULL').all(empresaId) as any[];
  let criados = 0;
  { // cada perfil/tipo já é gravado em sua própria transação; refazer a operação é seguro (idempotente)
    const cache = new Map<string, number>();
    for (const sv of servs) {
      const t = sv.tributacao_json ? JSON.parse(sv.tributacao_json) : {};
      const itens: z.infer<typeof ItemPerfil>[] = [];
      const add = (cod: string, aliq: any, retido: boolean) => { if (aliq != null && Number(aliq) > 0) itens.push({ imposto_codigo: cod, aliquota: Number(aliq), reducao_base: 0, retido, cst: null, c_class_trib: null, vigencia_ini: null, vigencia_fim: null }); };
      add('ISS', sv.aliquota, t.issRetido === 2 || t.issRetido === 3);
      add('PIS', t.pPis, true); add('COFINS', t.pCofins, true); add('CSLL', t.pCsll, true); add('IRRF', t.pIrrf, true); add('INSS', t.pCp, true);
      if (!itens.length) continue;
      const chave = JSON.stringify(itens);
      let tipoId = cache.get(chave);
      if (!tipoId) {
        const nome = `Serviço — ${itens.map((i) => i.imposto_codigo + (i.retido ? ' ret.' : '')).join(', ')}`.slice(0, 80);
        const perfil = criarPerfil(empresaId, { nome, descricao: 'Criado a partir da tributação cadastrada nos serviços.', itens });
        tipoId = criarTipo(empresaId, { nome, sentido: 'SAIDA', modelo: 'NFSE', natureza: 'Serviço', perfil_id: perfil.id, gera_credito: false, destino: 'RECEITA', padrao: false }).id;
        cache.set(chave, tipoId); criados++;
      }
      db.prepare('UPDATE servicos SET tipo_documento_id = ? WHERE id = ?').run(tipoId, sv.id);
    }
  }
  return { servicos: servs.length, perfisCriados: criados };
}

// ---------------------------------------------------------------------------
// Apuração assistida: o que o perfil calcula × o que as notas/compras declararam
// ---------------------------------------------------------------------------
const NOME_IMPOSTO = () => Object.fromEntries(listarImpostos().map((i) => [i.codigo, i]));

function declaradoNota(xml: string) {
  const n = lerNfse(xml), v = n.valores, ib = n.ibscbs;
  const ret = String(v.tpRetISSQN ?? '1') !== '1';
  const out: { imposto: string; valor: number; retido: boolean }[] = [];
  const put = (imposto: string, valor: number | undefined, retido: boolean) => { if (valor && valor > 0) out.push({ imposto, valor: r2(valor), retido }); };
  put('ISS', v.vISSQN, ret); put('IRRF', v.vRetIRRF, true); put('INSS', v.vRetCP, true); put('CSLL', v.vRetCSLL, true);
  const pcRet = String(v.tpRetPisCofins ?? '2') === '1';
  put('PIS', v.vPis, pcRet); put('COFINS', v.vCofins, pcRet);
  put('IBS_UF', ib?.vIBSUF, false); put('IBS_MUN', ib?.vIBSMun, false); put('CBS', ib?.vCBS, false);
  return out;
}
function declaradoCompra(xml: string) {
  const t = lerNfe(xml).totais;
  return ([['ICMS', t.icms], ['IPI', t.ipi], ['IBS_UF', t.ibsUf], ['IBS_MUN', t.ibsMun], ['CBS', t.cbs]] as [string, number][]).filter(([, v]) => v > 0).map(([imposto, valor]) => ({ imposto, valor: r2(valor), retido: false }));
}

function gravar(empresaId: number, origem: 'NOTA' | 'COMPRA', docId: number, comp: string, fonte: 'CALCULADO' | 'XML', perfilId: number | null, linhas: { imposto: string; base?: number; aliquota?: number | null; valor: number; retido: boolean }[]) {
  const ins = db.prepare(`INSERT OR REPLACE INTO documento_tributos (empresa_id, origem, documento_id, competencia, imposto_codigo, base, aliquota, valor, retido, fonte, perfil_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const l of linhas) ins.run(empresaId, origem, docId, comp, l.imposto, l.base ?? 0, l.aliquota ?? null, l.valor, l.retido ? 1 : 0, fonte, perfilId);
}

/** Garante os registros (calculado e declarado) de todas as notas e compras da competência. */
export function prepararCompetencia(empresaId: number, mes: string, recalcular = false) {
  const padSaida = tipoPadrao(empresaId, 'SAIDA'), padEntrada = tipoPadrao(empresaId, 'ENTRADA');
  const tem = db.prepare('SELECT 1 FROM documento_tributos WHERE origem = ? AND documento_id = ? AND fonte = ? LIMIT 1');
  const semTipo = { notas: 0, compras: 0 };
  db.transaction(() => {
    if (recalcular) db.prepare("DELETE FROM documento_tributos WHERE empresa_id = ? AND competencia = ?").run(empresaId, mes);
    const notas = db.prepare(`SELECT n.id, n.competencia, n.valor_servico, n.xml_nfse, s.tipo_documento_id FROM notas n LEFT JOIN servicos s ON s.id = n.servico_id
      WHERE n.empresa_id = ? AND n.status = 'AUTORIZADA' AND substr(n.competencia,1,7) = ?`).all(empresaId, mes) as any[];
    for (const n of notas) {
      const tipo = n.tipo_documento_id ? (db.prepare('SELECT id, perfil_id FROM tipos_documento WHERE id = ?').get(n.tipo_documento_id) as any) : padSaida;
      if (!tem.get('NOTA', n.id, 'CALCULADO')) {
        if (tipo?.perfil_id) gravar(empresaId, 'NOTA', n.id, mes, 'CALCULADO', tipo.perfil_id, calcularPerfil(tipo.perfil_id, n.valor_servico, n.competencia.slice(0, 10)));
      }
      if (!tipo?.perfil_id) semTipo.notas++;
      if (n.xml_nfse && !tem.get('NOTA', n.id, 'XML')) { try { gravar(empresaId, 'NOTA', n.id, mes, 'XML', null, declaradoNota(n.xml_nfse)); } catch { /* XML fora do padrão: sem declarado */ } }
    }
    const compras = db.prepare(`SELECT id, emissao, valor_produtos, valor_frete, valor_outras, valor_desconto, valor_icms, valor_ipi, xml, tipo_documento_id FROM compras
      WHERE empresa_id = ? AND substr(emissao,1,7) = ?`).all(empresaId, mes) as any[];
    for (const c of compras) {
      const tipo = c.tipo_documento_id ? (db.prepare('SELECT id, perfil_id FROM tipos_documento WHERE id = ?').get(c.tipo_documento_id) as any) : padEntrada;
      if (!tem.get('COMPRA', c.id, 'CALCULADO') && tipo?.perfil_id) {
        gravar(empresaId, 'COMPRA', c.id, mes, 'CALCULADO', tipo.perfil_id, calcularPerfil(tipo.perfil_id, r2(c.valor_produtos + c.valor_frete + c.valor_outras - c.valor_desconto), c.emissao));
      }
      if (!tipo?.perfil_id) semTipo.compras++;
      if (c.xml && !tem.get('COMPRA', c.id, 'XML')) { try { gravar(empresaId, 'COMPRA', c.id, mes, 'XML', null, declaradoCompra(c.xml)); } catch { /* sem declarado */ } }
    }
  })();
  return semTipo;
}

export function apuracaoAssistida(empresaId: number, mes: string, recalcular = false) {
  const semTipo = prepararCompetencia(empresaId, mes, recalcular);
  const imp = NOME_IMPOSTO();
  const linhas = db.prepare(`SELECT origem, documento_id, imposto_codigo, valor, retido, fonte FROM documento_tributos WHERE empresa_id = ? AND competencia = ?`).all(empresaId, mes) as any[];
  const nota = (id: number) => db.prepare('SELECT n_nfse, tomador_nome FROM notas WHERE id = ?').get(id) as any;
  const compra = (id: number) => db.prepare('SELECT numero, fornecedor_nome, tipo_documento_id FROM compras WHERE id = ?').get(id) as any;
  const credita = (compraId: number) => {
    const c = compra(compraId); const tipo = c?.tipo_documento_id ? db.prepare('SELECT gera_credito FROM tipos_documento WHERE id = ?').get(c.tipo_documento_id) as any : tipoPadrao(empresaId, 'ENTRADA');
    return !!tipo?.gera_credito;
  };
  const creditaCache = new Map<number, boolean>();
  const geraCredito = (id: number) => (creditaCache.has(id) ? creditaCache.get(id)! : (creditaCache.set(id, credita(id)), creditaCache.get(id)!));

  type Acc = { calc: number; xml: number };
  const novo = (): Acc => ({ calc: 0, xml: 0 });
  const resumo = new Map<string, { debito: Acc; credito: Acc; retido: Acc }>();
  const get = (cod: string) => resumo.get(cod) ?? (resumo.set(cod, { debito: novo(), credito: novo(), retido: novo() }), resumo.get(cod)!);
  const porDoc = new Map<string, { origem: string; id: number; imposto: string; calc: number | null; xml: number | null }>();
  for (const l of linhas) {
    const k = `${l.origem}:${l.documento_id}:${l.imposto_codigo}`;
    const d = porDoc.get(k) ?? { origem: l.origem, id: l.documento_id, imposto: l.imposto_codigo, calc: null, xml: null };
    if (l.fonte === 'CALCULADO') d.calc = l.valor; else d.xml = l.valor;
    porDoc.set(k, d);
    const campo = l.fonte === 'CALCULADO' ? 'calc' : 'xml';
    const a = get(l.imposto_codigo);
    if (l.origem === 'NOTA') (l.retido ? a.retido : a.debito)[campo] += l.valor;
    else if (imp[l.imposto_codigo]?.credita && geraCredito(l.documento_id)) a.credito[campo] += l.valor;
  }
  const divergencias = [...porDoc.values()].map((d) => {
    const doc = d.origem === 'NOTA' ? nota(d.id) : compra(d.id);
    const calc = d.calc ?? 0, xml = d.xml ?? 0;
    const situacao = d.calc == null ? 'Declarado no XML, mas sem esse imposto no perfil' : d.xml == null ? (calc > TOLERANCIA ? 'Não declarado no XML' : null) : Math.abs(calc - xml) > TOLERANCIA ? 'Diverge do XML' : null;
    return situacao ? { origem: d.origem, documento_id: d.id, documento: d.origem === 'NOTA' ? `NFS-e ${doc?.n_nfse ?? d.id} — ${doc?.tomador_nome ?? ''}` : `NF ${doc?.numero ?? d.id} — ${doc?.fornecedor_nome ?? ''}`,
      imposto: d.imposto, calculado: d.calc == null ? null : r2(calc), declarado: d.xml == null ? null : r2(xml), diferenca: r2(calc - xml), situacao } : null;
  }).filter(Boolean);
  const resumoLista = [...resumo.entries()].map(([cod, a]) => ({
    imposto: cod, nome: imp[cod]?.nome ?? cod, grupo: imp[cod]?.grupo,
    debito_calc: r2(a.debito.calc), debito_xml: r2(a.debito.xml), credito_calc: r2(a.credito.calc), credito_xml: r2(a.credito.xml),
    saldo_calc: r2(a.debito.calc - a.credito.calc), saldo_xml: r2(a.debito.xml - a.credito.xml), retido_calc: r2(a.retido.calc), retido_xml: r2(a.retido.xml),
  })).sort((a, b) => (imp[a.imposto]?.ordem ?? 0) - (imp[b.imposto]?.ordem ?? 0));
  return { mes, resumo: resumoLista, divergencias, semTipo,
    documentos: { notas: (db.prepare("SELECT COUNT(*) AS n FROM notas WHERE empresa_id = ? AND status = 'AUTORIZADA' AND substr(competencia,1,7) = ?").get(empresaId, mes) as any).n,
      compras: (db.prepare('SELECT COUNT(*) AS n FROM compras WHERE empresa_id = ? AND substr(emissao,1,7) = ?').get(empresaId, mes) as any).n } };
}
