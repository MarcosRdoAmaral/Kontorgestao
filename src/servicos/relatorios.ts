import PDFDocument from 'pdfkit';
import { db } from '../db.js';
import { lerNfse } from '../nfse/leitura.js';
import { ErroNegocio } from './emissao.js';
import { balancoExtrato } from './extrato.js';

/**
 * Relatórios gerenciais. A nota e o boleto têm datas próprias (emissão da nota, emissão do boleto, vencimento,
 * pagamento), então cada relatório diz qual data filtra e as demais aparecem como colunas.
 */
export type TipoColuna = 'texto' | 'data' | 'moeda' | 'inteiro';
export interface Coluna { k: string; nome: string; tipo: TipoColuna; soma?: boolean }
export interface Relatorio { id: string; titulo: string; descricao: string; filtroData: string; colunas: Coluna[]; linhas: Record<string, any>[]; totais: Record<string, number>; subtitulo: string }
export interface Filtros { de: string; ate: string; tomadorId?: number | null; situacao?: string | null }

const hojeBr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

/** Um título = boleto, com os dados da nota a que pertence (quando houver). */
function titulos(empresaId: number, tomadorId?: number | null) {
  const hoje = hojeBr();
  const l = db.prepare(`SELECT c.id, c.vencimento, c.valor, c.valor_pago, c.pago_em, c.status AS st, c.descricao, c.desconto,
      COALESCE(c.emissao, substr(c.criado_em,1,10)) AS emissao_boleto, t.id AS tomador_id, t.nome AS cliente,
      n.id AS nota_id, n.n_nfse, n.valor_servico, n.status AS nota_status,
      COALESCE(date(n.autorizada_em, '-3 hours'), date(n.criado_em, '-3 hours')) AS emissao_nota
    FROM cobrancas c JOIN tomadores t ON t.id = c.tomador_id LEFT JOIN notas n ON n.id = c.nota_id
    WHERE c.empresa_id = ? AND c.status <> 'CANCELADO' ${tomadorId ? 'AND c.tomador_id = ?' : ''} ORDER BY c.vencimento, t.nome`).all(...(tomadorId ? [empresaId, tomadorId] : [empresaId])) as any[];
  return l.map((x) => ({
    ...x,
    emissao: x.emissao_nota ?? x.emissao_boleto,
    situacao: x.st === 'PAGO' ? 'Pago' : x.vencimento < hoje ? 'Vencido' : 'A vencer',
    atraso: x.st === 'PAGO' ? Math.max(0, dias(x.pago_em ?? x.vencimento, x.vencimento)) : Math.max(0, dias(hoje, x.vencimento)),
  }));
}
const entre = (d: string | null | undefined, f: Filtros) => !!d && d.slice(0, 10) >= f.de && d.slice(0, 10) <= f.ate;
const soma = (l: any[], k: string) => r2(l.reduce((t, x) => t + (Number(x[k]) || 0), 0));

const COL = {
  emissao: { k: 'emissao', nome: 'Emissão', tipo: 'data' }, vencimento: { k: 'vencimento', nome: 'Vencimento', tipo: 'data' },
  cliente: { k: 'cliente', nome: 'Cliente', tipo: 'texto' }, nota: { k: 'n_nfse', nome: 'Nota', tipo: 'texto' },
  valorNota: { k: 'valor_servico', nome: 'Valor da nota', tipo: 'moeda', soma: true }, valorBoleto: { k: 'valor', nome: 'Valor do boleto', tipo: 'moeda', soma: true },
  situacao: { k: 'situacao', nome: 'Situação', tipo: 'texto' }, pagoEm: { k: 'pago_em', nome: 'Pago em', tipo: 'data' },
  atraso: { k: 'atraso', nome: 'Dias de atraso', tipo: 'inteiro' },
} as const satisfies Record<string, Coluna>;

interface Def { titulo: string; descricao: string; filtroData: string; situacoes?: string[]; gerar: (empresaId: number, f: Filtros) => { colunas: Coluna[]; linhas: any[] } }

export const RELATORIOS: Record<string, Def> = {
  'receitas-emitidas': {
    titulo: 'Receitas emitidas', filtroData: 'Data de emissão (da nota; do boleto quando não há nota)',
    descricao: 'Tudo o que foi faturado no período, com a data da nota e o vencimento do boleto lado a lado.',
    gerar: (e, f) => {
      const t = titulos(e, f.tomadorId).filter((x) => entre(x.emissao, f));
      const semBoleto = db.prepare(`SELECT n.n_nfse, n.valor_servico, n.tomador_nome AS cliente, COALESCE(date(n.autorizada_em,'-3 hours'), date(n.criado_em,'-3 hours')) AS emissao
        FROM notas n WHERE n.empresa_id = ? AND n.status = 'AUTORIZADA' ${f.tomadorId ? 'AND n.tomador_id = ' + Number(f.tomadorId) : ''}
        AND NOT EXISTS (SELECT 1 FROM cobrancas c WHERE c.nota_id = n.id AND c.status <> 'CANCELADO')`).all(e) as any[];
      const linhas = [...t, ...semBoleto.filter((x) => entre(x.emissao, f)).map((x) => ({ ...x, situacao: 'Sem boleto' }))].sort((a, b) => a.emissao.localeCompare(b.emissao));
      return { colunas: [COL.emissao, COL.nota, COL.cliente, COL.valorNota, COL.vencimento, COL.valorBoleto, COL.situacao, COL.pagoEm], linhas };
    },
  },
  'a-receber': {
    titulo: 'Contas a receber por vencimento', filtroData: 'Vencimento do boleto', situacoes: ['Vencido', 'A vencer'],
    descricao: 'Boletos em aberto no período de vencimento, separados em vencidos e a vencer, com a data de emissão da nota.',
    gerar: (e, f) => ({
      colunas: [COL.vencimento, COL.cliente, COL.nota, COL.emissao, COL.valorBoleto, COL.atraso, COL.situacao],
      linhas: titulos(e, f.tomadorId).filter((x) => x.st !== 'PAGO' && entre(x.vencimento, f) && (!f.situacao || x.situacao === f.situacao)),
    }),
  },
  'em-aberto-emissao': {
    titulo: 'Em aberto por data de emissão', filtroData: 'Data de emissão da nota/boleto', situacoes: ['Vencido', 'A vencer'],
    descricao: 'O que foi emitido no período e ainda não foi pago, mesmo que o vencimento seja em outro mês.',
    gerar: (e, f) => ({
      colunas: [COL.emissao, COL.cliente, COL.nota, COL.vencimento, COL.valorBoleto, COL.atraso, COL.situacao],
      linhas: titulos(e, f.tomadorId).filter((x) => x.st !== 'PAGO' && entre(x.emissao, f) && (!f.situacao || x.situacao === f.situacao)).sort((a, b) => a.emissao.localeCompare(b.emissao)),
    }),
  },
  recebimentos: {
    titulo: 'Recebimentos', filtroData: 'Data do pagamento',
    descricao: 'Boletos pagos no período, com vencimento, valor pago e dias de atraso.',
    gerar: (e, f) => ({
      colunas: [COL.pagoEm, COL.cliente, COL.nota, COL.vencimento, COL.valorBoleto, { k: 'valor_pago', nome: 'Valor pago', tipo: 'moeda', soma: true }, COL.atraso],
      linhas: titulos(e, f.tomadorId).filter((x) => x.st === 'PAGO' && entre(x.pago_em, f)).sort((a, b) => (a.pago_em ?? '').localeCompare(b.pago_em ?? '')).map((x) => ({ ...x, valor_pago: x.valor_pago ?? x.valor })),
    }),
  },
  'saldo-vencido': {
    titulo: 'Saldo vencido por cliente', filtroData: 'Posição na data final (títulos vencidos até ela)',
    descricao: 'Quanto cada cliente deve em atraso, por faixa de dias.',
    gerar: (e, f) => {
      const por = new Map<string, any>();
      for (const x of titulos(e, f.tomadorId).filter((x) => x.st !== 'PAGO' && x.vencimento < f.ate)) {
        const d = dias(f.ate, x.vencimento);
        const r = por.get(x.cliente) ?? { cliente: x.cliente, f1: 0, f2: 0, f3: 0, f4: 0, total: 0, titulos: 0 };
        r[d <= 30 ? 'f1' : d <= 60 ? 'f2' : d <= 90 ? 'f3' : 'f4'] += x.valor; r.total += x.valor; r.titulos++; por.set(x.cliente, r);
      }
      const m = (k: string, nome: string): Coluna => ({ k, nome, tipo: 'moeda', soma: true });
      return { colunas: [COL.cliente, { k: 'titulos', nome: 'Títulos', tipo: 'inteiro', soma: true }, m('f1', 'Até 30 dias'), m('f2', '31 a 60'), m('f3', '61 a 90'), m('f4', 'Mais de 90'), m('total', 'Total vencido')],
        linhas: [...por.values()].sort((a, b) => b.total - a.total) };
    },
  },
  'posicao-clientes': {
    titulo: 'Posição por cliente', filtroData: 'Emissão da nota/boleto no período',
    descricao: 'Para cada cliente: quanto foi faturado, recebido, está a vencer e vencido.',
    gerar: (e, f) => {
      const por = new Map<string, any>();
      for (const x of titulos(e, f.tomadorId).filter((x) => entre(x.emissao, f))) {
        const r = por.get(x.cliente) ?? { cliente: x.cliente, qtd: 0, faturado: 0, recebido: 0, a_vencer: 0, vencido: 0 };
        r.qtd++; r.faturado += x.valor;
        if (x.st === 'PAGO') r.recebido += x.valor_pago ?? x.valor; else if (x.situacao === 'Vencido') r.vencido += x.valor; else r.a_vencer += x.valor;
        por.set(x.cliente, r);
      }
      const m = (k: string, nome: string): Coluna => ({ k, nome, tipo: 'moeda', soma: true });
      return { colunas: [COL.cliente, { k: 'qtd', nome: 'Boletos', tipo: 'inteiro', soma: true }, m('faturado', 'Faturado'), m('recebido', 'Recebido'), m('a_vencer', 'A vencer'), m('vencido', 'Vencido')], linhas: [...por.values()].sort((a, b) => b.faturado - a.faturado) };
    },
  },
  'notas-emitidas': {
    titulo: 'Notas emitidas e tributos', filtroData: 'Data de emissão da nota',
    descricao: 'Notas autorizadas no período com ISS, retenções federais e valor líquido, lidos do XML.',
    gerar: (e, f) => {
      const notas = db.prepare(`SELECT id, n_nfse, status, xml_nfse, tomador_nome AS cliente, valor_servico, competencia,
          COALESCE(date(autorizada_em,'-3 hours'), date(criado_em,'-3 hours')) AS emissao
        FROM notas WHERE empresa_id = ? AND xml_nfse IS NOT NULL ${f.tomadorId ? 'AND tomador_id = ' + Number(f.tomadorId) : ''} ORDER BY emissao, id LIMIT 5000`).all(e) as any[];
      const linhas = notas.filter((n) => entre(n.emissao, f)).map((n) => {
        let v: any = {}, desc = '';
        try { const l = lerNfse(n.xml_nfse); v = l.valores; desc = l.servico.descricao; } catch { /* XML fora do padrão: mostra só o básico */ }
        const federais = (v.vRetIRRF ?? 0) + (v.vRetCP ?? 0) + (v.vRetCSLL ?? 0) + (v.vPis ?? 0) + (v.vCofins ?? 0);
        return { ...n, situacao: n.status === 'CANCELADA' ? 'Cancelada' : 'Autorizada', servico: desc.slice(0, 60), iss: v.vISSQN ?? 0, retencoes: r2(federais), liquido: v.vLiq ?? n.valor_servico };
      });
      return { colunas: [COL.emissao, COL.nota, COL.cliente, { k: 'servico', nome: 'Serviço', tipo: 'texto' }, COL.valorNota, { k: 'iss', nome: 'ISS', tipo: 'moeda', soma: true },
        { k: 'retencoes', nome: 'Retenções federais', tipo: 'moeda', soma: true }, { k: 'liquido', nome: 'Líquido', tipo: 'moeda', soma: true }, COL.situacao], linhas };
    },
  },
  'compras': {
    titulo: 'Compras (NF-e de entrada)', filtroData: 'Data de emissão da NF-e',
    descricao: 'Compras lançadas por XML ou manualmente, com o fornecedor, o total e o que foi lançado como despesa.',
    gerar: (e, f) => ({
      colunas: [
        { k: 'emissao', nome: 'Emissão', tipo: 'data' }, { k: 'fornecedor', nome: 'Fornecedor', tipo: 'texto' }, { k: 'documento', nome: 'CNPJ/CPF', tipo: 'texto' },
        { k: 'numero', nome: 'NF', tipo: 'texto' }, { k: 'produtos', nome: 'Produtos', tipo: 'moeda', soma: true }, { k: 'outras', nome: 'Frete e outras', tipo: 'moeda', soma: true },
        { k: 'desconto', nome: 'Desconto', tipo: 'moeda', soma: true }, { k: 'total', nome: 'Total', tipo: 'moeda', soma: true }, { k: 'despesa', nome: 'Em despesas', tipo: 'texto' },
      ],
      linhas: (db.prepare(`SELECT c.emissao, c.fornecedor_nome AS fornecedor, c.fornecedor_documento AS documento, c.numero, c.valor_produtos AS produtos,
          (c.valor_frete + c.valor_outras) AS outras, c.valor_desconto AS desconto, c.valor_total AS total,
          CASE WHEN EXISTS (SELECT 1 FROM compra_parcelas p WHERE p.compra_id = c.id AND p.despesa_id IS NOT NULL) THEN 'Sim' ELSE 'Não' END AS despesa
        FROM compras c WHERE c.empresa_id = ? AND c.emissao BETWEEN ? AND ? ORDER BY c.emissao, c.id`).all(e, f.de, f.ate) as any[]),
    }),
  },
  'fluxo-caixa': {
    titulo: 'Fluxo de caixa por categoria', filtroData: 'Data do lançamento no extrato',
    descricao: 'Entradas e saídas classificadas a partir do extrato bancário importado.',
    gerar: (e, f) => {
      const b = balancoExtrato(e, f.de, f.ate);
      const linhas = [...b.entradas.map((x) => ({ categoria: x.categoria, tipo: 'Entrada', valor: x.total })), ...b.saidas.map((x) => ({ categoria: x.categoria, tipo: 'Saída', valor: -x.total }))];
      return { colunas: [{ k: 'tipo', nome: 'Tipo', tipo: 'texto' }, { k: 'categoria', nome: 'Categoria', tipo: 'texto' }, { k: 'valor', nome: 'Valor', tipo: 'moeda', soma: true }], linhas };
    },
  },
};

export const catalogo = () => Object.entries(RELATORIOS).map(([id, d]) => ({ id, titulo: d.titulo, descricao: d.descricao, filtroData: d.filtroData, situacoes: d.situacoes ?? null }));

export function gerarRelatorio(empresaId: number, id: string, f: Filtros): Relatorio {
  const def = RELATORIOS[id];
  if (!def) throw new ErroNegocio('Relatório não encontrado.', 404);
  if (f.de > f.ate) throw new ErroNegocio('A data inicial é maior que a final.');
  const { colunas, linhas } = def.gerar(empresaId, f);
  const totais: Record<string, number> = {};
  for (const c of colunas) if (c.soma) totais[c.k] = soma(linhas, c.k);
  const br = (d: string) => d.split('-').reverse().join('/');
  return { id, titulo: def.titulo, descricao: def.descricao, filtroData: def.filtroData, colunas, linhas, totais, subtitulo: `${def.filtroData}: ${br(f.de)} a ${br(f.ate)}${f.situacao ? ` · ${f.situacao}` : ''}` };
}

const fmt = (v: any, t: TipoColuna) => v == null || v === '' ? '' : t === 'moeda' ? Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t === 'data' ? String(v).slice(0, 10).split('-').reverse().join('/') : String(v);

export function relatorioCsv(r: Relatorio): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const l = [r.colunas.map((c) => q(c.nome)).join(';'), ...r.linhas.map((x) => r.colunas.map((c) => q(fmt(x[c.k], c.tipo))).join(';'))];
  if (r.colunas.some((c) => c.soma)) l.push(r.colunas.map((c, i) => q(i === 0 ? 'TOTAL' : c.soma ? fmt(r.totais[c.k], c.tipo) : '')).join(';'));
  return '﻿' + l.join('\r\n');
}

export function relatorioPdf(r: Relatorio, empresa: string): Promise<Buffer> {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    const partes: Buffer[] = []; doc.on('data', (b) => partes.push(b)); doc.on('end', () => ok(Buffer.concat(partes)));
    const W = doc.page.width - 60, n = r.colunas.length;
    const peso = (c: Coluna) => (c.tipo === 'texto' ? (c.k === 'cliente' || c.k === 'servico' ? 3 : 1.3) : c.tipo === 'inteiro' ? 0.9 : 1.2);
    const tot = r.colunas.reduce((s, c) => s + peso(c), 0), larg = r.colunas.map((c) => (peso(c) / tot) * W);
    const cab = () => {
      doc.font('Helvetica-Bold').fontSize(14).text(r.titulo, 30, 30); doc.font('Helvetica').fontSize(9).fillColor('#555').text(`${empresa} · ${r.subtitulo} · emitido em ${fmt(hojeBr(), 'data')}`, 30, 48); doc.fillColor('#000');
    };
    const linha = (vals: string[], y: number, negrito = false, fundo?: string) => {
      if (fundo) doc.rect(30, y - 2, W, 14).fill(fundo).fillColor('#000');
      doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      let x = 30; vals.forEach((v, i) => { doc.text(v, x + 2, y, { width: larg[i] - 4, height: 11, ellipsis: true, lineBreak: false, align: r.colunas[i].tipo === 'moeda' || r.colunas[i].tipo === 'inteiro' ? 'right' : 'left' }); x += larg[i]; });
    };
    let y = 75; cab(); linha(r.colunas.map((c) => c.nome), y, true, '#e8e8e8'); y += 16;
    for (const x of r.linhas) {
      if (y > doc.page.height - 50) { doc.addPage(); cab(); y = 75; linha(r.colunas.map((c) => c.nome), y, true, '#e8e8e8'); y += 16; }
      linha(r.colunas.map((c) => fmt(x[c.k], c.tipo)), y); y += 13;
    }
    if (r.colunas.some((c) => c.soma)) { y += 4; linha(r.colunas.map((c, i) => (i === 0 ? `TOTAL (${r.linhas.length})` : c.soma ? fmt(r.totais[c.k], c.tipo) : '')), y, true, '#f3f3f3'); }
    if (!r.linhas.length) doc.font('Helvetica').fontSize(10).text('Nenhum registro no período.', 30, y + 10);
    doc.end();
  });
}
