import { z } from 'zod';
import { db } from '../db.js';
import { lerNfe } from '../nfe/leitura.js';
import { ErroNegocio } from './emissao.js';
import { conferirTipoDoVinculo, tipoPadrao } from './tributacao.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const soDig = (s: string | null | undefined) => String(s ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

export const OpcoesImportacao = z.object({
  xml: z.string().min(200),
  /** Lança as parcelas (ou o total, se à vista) como despesas na data de vencimento. */
  gerarDespesas: z.boolean().default(false),
  categoria: z.string().trim().max(60).default('Material e equipamentos'),
  tipoDocumentoId: z.number().int().nullish(),
});

function lancarDespesa(empresaId: number, usuarioId: number, data: string, categoria: string, descricao: string, valor: number) {
  return Number(db.prepare('INSERT INTO despesas (empresa_id, data, categoria, descricao, valor, criado_por) VALUES (?,?,?,?,?,?)')
    .run(empresaId, data, categoria, descricao.slice(0, 200), valor, usuarioId).lastInsertRowid);
}

export function importarCompraXml(empresaId: number, usuarioId: number, entrada: z.infer<typeof OpcoesImportacao>) {
  const empresa = db.prepare('SELECT documento FROM empresas WHERE id = ?').get(empresaId) as { documento: string } | undefined;
  if (!empresa) throw new ErroNegocio('Empresa não encontrada.', 404);
  let nfe: ReturnType<typeof lerNfe>;
  try { nfe = lerNfe(entrada.xml); } catch (e: any) { throw new ErroNegocio(e.message ?? 'XML inválido.'); }
  if (soDig(nfe.fornecedor.documento) === soDig(empresa.documento)) throw new ErroNegocio('Esta NF-e foi emitida pela própria empresa (é uma venda), não uma compra.');
  if (db.prepare('SELECT 1 FROM compras WHERE empresa_id = ? AND chave_acesso = ?').get(empresaId, nfe.chave)) throw new ErroNegocio(`A NF-e ${nfe.numero} de ${nfe.fornecedor.nome} já foi importada.`);
  const alertas: string[] = [];
  if (nfe.destinatario.documento && soDig(nfe.destinatario.documento) !== soDig(empresa.documento)) {
    alertas.push(`O destinatário da nota (${nfe.destinatario.nome ?? nfe.destinatario.documento}) não é esta empresa. Confira se a compra foi lançada na empresa certa.`);
  }
  const t = nfe.totais;
  const totalCalc = r2(t.produtos + t.frete + t.seguro + t.outras + t.icmsSt + t.ipi - t.desconto);
  if (t.nf <= 0) throw new ErroNegocio('A NF-e não traz o valor total (vNF).');
  if (Math.abs(totalCalc - t.nf) > 0.05) alertas.push(`O total da nota (R$ ${t.nf.toFixed(2)}) difere da soma dos componentes (R$ ${totalCalc.toFixed(2)}); foi mantido o total informado na nota.`);
  const somaParc = r2(nfe.parcelas.reduce((a, p) => a + p.valor, 0));
  if (nfe.parcelas.length && Math.abs(somaParc - t.nf) > 0.05) alertas.push(`A soma das parcelas (R$ ${somaParc.toFixed(2)}) difere do total da nota.`);

  const tipoId = conferirTipoDoVinculo(empresaId, entrada.tipoDocumentoId, 'ENTRADA') ?? tipoPadrao(empresaId, 'ENTRADA')?.id ?? null;
  const id = db.transaction(() => {
    const cid = Number(db.prepare(`INSERT INTO compras (empresa_id, fornecedor_documento, fornecedor_nome, numero, serie, chave_acesso, emissao, natureza, categoria,
        valor_produtos, valor_frete, valor_desconto, valor_outras, valor_icms, valor_ipi, valor_total, xml, origem, criado_por, tipo_documento_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'XML',?,?)`).run(
      empresaId, nfe.fornecedor.documento, nfe.fornecedor.nome, nfe.numero, nfe.serie, nfe.chave, nfe.emissao, nfe.natureza, entrada.gerarDespesas ? entrada.categoria : null,
      t.produtos, t.frete + t.seguro, t.desconto, t.outras, t.icms, t.ipi, t.nf, entrada.xml, usuarioId, tipoId).lastInsertRowid);
    const ins = db.prepare('INSERT INTO compra_itens (compra_id, n_item, codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total, desconto) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const i of nfe.itens) ins.run(cid, i.n, i.codigo, i.descricao, i.ncm, i.cfop, i.unidade, i.quantidade, i.valorUnit, i.valor, i.desconto);
    const parcelas = nfe.parcelas.length ? nfe.parcelas : [{ numero: null as string | null, vencimento: nfe.emissao, valor: t.nf }];
    const insP = db.prepare('INSERT INTO compra_parcelas (compra_id, numero, vencimento, valor, despesa_id) VALUES (?,?,?,?,?)');
    parcelas.forEach((p, k) => {
      const desp = entrada.gerarDespesas
        ? lancarDespesa(empresaId, usuarioId, p.vencimento, entrada.categoria, `NF ${nfe.numero} — ${nfe.fornecedor.nome}${parcelas.length > 1 ? ` (parcela ${k + 1}/${parcelas.length})` : ''}`, p.valor)
        : null;
      insP.run(cid, p.numero, p.vencimento, p.valor, desp);
    });
    return cid;
  })();
  return { id, numero: nfe.numero, fornecedor: nfe.fornecedor.nome, valor: t.nf, itens: nfe.itens.length, parcelas: nfe.parcelas.length, alertas };
}

export const CompraManual = z.object({
  fornecedor_nome: z.string().trim().min(2, 'Informe o fornecedor').max(120),
  fornecedor_documento: z.string().trim().max(20).nullish(),
  numero: z.string().trim().max(30).nullish(),
  emissao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  valor_total: z.number().positive('O valor precisa ser maior que zero'),
  observacao: z.string().trim().max(300).nullish(),
  gerarDespesas: z.boolean().default(false),
  categoria: z.string().trim().max(60).default('Material e equipamentos'),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  tipoDocumentoId: z.number().int().nullish(),
});

export function criarCompraManual(empresaId: number, usuarioId: number, d: z.infer<typeof CompraManual>) {
  const tipoId = conferirTipoDoVinculo(empresaId, d.tipoDocumentoId, 'ENTRADA') ?? tipoPadrao(empresaId, 'ENTRADA')?.id ?? null;
  return db.transaction(() => {
    const cid = Number(db.prepare(`INSERT INTO compras (empresa_id, fornecedor_documento, fornecedor_nome, numero, emissao, categoria, observacao, valor_produtos, valor_total, origem, criado_por, tipo_documento_id)
      VALUES (?,?,?,?,?,?,?,?,?,'MANUAL',?,?)`).run(empresaId, d.fornecedor_documento ?? null, d.fornecedor_nome, d.numero ?? null, d.emissao, d.gerarDespesas ? d.categoria : null, d.observacao ?? null, d.valor_total, d.valor_total, usuarioId, tipoId).lastInsertRowid);
    const venc = d.vencimento ?? d.emissao;
    const desp = d.gerarDespesas ? lancarDespesa(empresaId, usuarioId, venc, d.categoria, `Compra${d.numero ? ' ' + d.numero : ''} — ${d.fornecedor_nome}`, d.valor_total) : null;
    db.prepare('INSERT INTO compra_parcelas (compra_id, vencimento, valor, despesa_id) VALUES (?,?,?,?)').run(cid, venc, d.valor_total, desp);
    return { id: cid };
  })();
}

export function listarCompras(empresaId: number, mes: string) {
  const linhas = db.prepare(`SELECT c.id, c.fornecedor_nome, c.fornecedor_documento, c.numero, c.serie, c.emissao, c.valor_total, c.origem, c.categoria,
      (SELECT COUNT(*) FROM compra_itens i WHERE i.compra_id = c.id) AS itens,
      (SELECT COUNT(*) FROM compra_parcelas p WHERE p.compra_id = c.id AND p.despesa_id IS NOT NULL) AS despesas
    FROM compras c WHERE c.empresa_id = ? AND substr(c.emissao,1,7) = ? ORDER BY c.emissao DESC, c.id DESC`).all(empresaId, mes) as any[];
  const porFornecedor = new Map<string, number>();
  for (const l of linhas) porFornecedor.set(l.fornecedor_nome, r2((porFornecedor.get(l.fornecedor_nome) ?? 0) + l.valor_total));
  return {
    compras: linhas,
    total: r2(linhas.reduce((a, l) => a + l.valor_total, 0)),
    fornecedores: [...porFornecedor.entries()].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total).slice(0, 5),
  };
}

export function obterCompra(id: number) {
  const c = db.prepare('SELECT id, empresa_id, tipo_documento_id, fornecedor_documento, fornecedor_nome, numero, serie, chave_acesso, emissao, natureza, categoria, observacao, valor_produtos, valor_frete, valor_desconto, valor_outras, valor_icms, valor_ipi, valor_total, origem, criado_em, (xml IS NOT NULL) AS tem_xml FROM compras WHERE id = ?').get(id) as any;
  if (!c) throw new ErroNegocio('Compra não encontrada.', 404);
  c.itens = db.prepare('SELECT n_item, codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total, desconto FROM compra_itens WHERE compra_id = ? ORDER BY n_item').all(id);
  c.parcelas = db.prepare('SELECT numero, vencimento, valor, despesa_id FROM compra_parcelas WHERE compra_id = ? ORDER BY vencimento, id').all(id);
  return c;
}

export function xmlDaCompra(id: number): { xml: string; nome: string } {
  const c = db.prepare('SELECT xml, chave_acesso, numero FROM compras WHERE id = ?').get(id) as any;
  if (!c?.xml) throw new ErroNegocio('Esta compra não tem XML.', 404);
  return { xml: c.xml, nome: `NFe-${c.chave_acesso ?? c.numero}.xml` };
}

/** Apaga a compra e as despesas que ela gerou. */
export function excluirCompra(id: number) {
  const c = db.prepare('SELECT id FROM compras WHERE id = ?').get(id);
  if (!c) throw new ErroNegocio('Compra não encontrada.', 404);
  db.transaction(() => {
    for (const p of db.prepare('SELECT despesa_id FROM compra_parcelas WHERE compra_id = ? AND despesa_id IS NOT NULL').all(id) as { despesa_id: number }[]) {
      db.prepare('DELETE FROM despesas WHERE id = ?').run(p.despesa_id);
    }
    db.prepare('DELETE FROM compra_itens WHERE compra_id = ?').run(id);
    db.prepare('DELETE FROM compra_parcelas WHERE compra_id = ?').run(id);
    db.prepare('DELETE FROM compras WHERE id = ?').run(id);
  })();
  return { ok: true };
}
