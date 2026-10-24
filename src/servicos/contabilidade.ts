import { strToU8, zipSync } from 'fflate';
import { db } from '../db.js';
import { ErroNegocio, danfse } from './emissao.js';
import { obterConta } from './cobranca.js';

export interface Movimento { data: string; valor: number; tipo: 'CREDIT' | 'DEBIT'; id: string; historico: string }

const ymd = (d: string) => d.replace(/-/g, '');
const xmlTxt = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const num = (v: number) => v.toFixed(2);
const sgml = (s: string) => s.replace(/[\r\n<>&]+/g, ' ').trim().slice(0, 64);

/** Movimentação do período: extrato importado ou, na falta dele, boletos pagos (entradas) e despesas lançadas (saídas). */
export function movimentos(empresaId: number, de: string, ate: string): Movimento[] {
  // com extrato bancário importado, ele é a fonte oficial (já traz tudo que passou pela conta)
  const extrato = db.prepare('SELECT id, data, valor, descricao, documento, categoria FROM extrato_lancamentos WHERE empresa_id = ? AND data BETWEEN ? AND ? ORDER BY data, id').all(empresaId, de, ate) as any[];
  if (extrato.length) {
    return extrato.map((r): Movimento => ({ data: r.data, valor: Math.abs(r.valor), tipo: r.valor > 0 ? 'CREDIT' : 'DEBIT', id: `KG-EXT-${r.id}`, historico: `${r.descricao}${r.documento ? ' ' + r.documento : ''}${r.categoria ? ' [' + r.categoria + ']' : ''}` }));
  }
  const entradas = db.prepare(`SELECT c.id, substr(c.pago_em,1,10) AS data, COALESCE(c.valor_pago, c.valor) AS valor, c.descricao, t.nome
      FROM cobrancas c LEFT JOIN tomadores t ON t.id = c.tomador_id
      WHERE c.empresa_id = ? AND c.status = 'PAGO' AND c.pago_em IS NOT NULL AND substr(c.pago_em,1,10) BETWEEN ? AND ?`).all(empresaId, de, ate) as any[];
  const saidas = db.prepare('SELECT id, data, valor, categoria, descricao FROM despesas WHERE empresa_id = ? AND data BETWEEN ? AND ?').all(empresaId, de, ate) as any[];
  return [
    ...entradas.map((r): Movimento => ({ data: r.data, valor: r.valor, tipo: 'CREDIT', id: `KG-REC-${r.id}`, historico: `RECEBIMENTO ${r.nome ?? ''} ${r.descricao ?? ''}` })),
    ...saidas.map((r): Movimento => ({ data: r.data, valor: r.valor, tipo: 'DEBIT', id: `KG-DES-${r.id}`, historico: `${r.categoria}${r.descricao ? ' - ' + r.descricao : ''}` })),
  ].sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));
}

/** Arquivo OFX 1.02 (SGML) com a movimentação do período, aceito pelos sistemas contábeis. */
export function gerarOfx(empresaId: number, de: string, ate: string): string {
  const conta = obterConta(empresaId);
  const mv = movimentos(empresaId, de, ate);
  const saldo = mv.reduce((s, m) => s + (m.tipo === 'CREDIT' ? m.valor : -m.valor), 0);
  const linhas = mv.map((m) => `<STMTTRN>
<TRNTYPE>${m.tipo}
<DTPOSTED>${ymd(m.data)}120000[-3:BRT]
<TRNAMT>${num(m.tipo === 'CREDIT' ? m.valor : -m.valor)}
<FITID>${m.id}
<MEMO>${sgml(m.historico)}
</STMTTRN>`).join('\n');
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>${ymd(new Date().toISOString().slice(0, 10))}120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>085<BRANCHID>${conta?.agencia ?? '0'}<ACCTID>${conta ? conta.conta + conta.conta_dv : '0'}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${ymd(de)}120000[-3:BRT]<DTEND>${ymd(ate)}120000[-3:BRT]
${linhas}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${num(saldo)}<DTASOF>${ymd(ate)}120000[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;
}

export interface OpcoesPacote { de: string; ate: string; xml: boolean; pdf: boolean; ofx: boolean }

/** ZIP para a contabilidade: XML e PDF das notas do período, OFX da movimentação e planilha-índice. */
export async function pacoteContabilidade(empresaId: number, o: OpcoesPacote): Promise<{ zip: Buffer; nome: string }> {
  const emp = db.prepare('SELECT razao_social, documento, ambiente FROM empresas WHERE id = ?').get(empresaId) as any;
  if (!emp) throw new ErroNegocio('Empresa não encontrada.', 404);
  if (o.de > o.ate) throw new ErroNegocio('A data inicial é maior que a final.');
  if (!o.xml && !o.pdf && !o.ofx) throw new ErroNegocio('Marque ao menos um tipo de arquivo.');
  const arq: Record<string, Uint8Array> = {};
  const notas = db.prepare(`SELECT id, n_nfse, status, competencia, valor_servico, tomador_nome, tomador_documento, chave_acesso, xml_nfse
      FROM notas WHERE empresa_id = ? AND ambiente = ? AND xml_nfse IS NOT NULL AND competencia BETWEEN ? AND ? ORDER BY competencia, id LIMIT 5000`)
    .all(empresaId, emp.ambiente, o.de, o.ate) as any[];
  if (o.xml || o.pdf) {
    for (const n of notas) {
      if (o.xml) arq[`notas/xml/NFSe_${n.n_nfse}.xml`] = strToU8(n.xml_nfse);
      if (o.pdf) arq[`notas/pdf/NFSe_${n.n_nfse}.pdf`] = await danfse(n.id);
    }
    const cab = ['Número', 'Situação', 'Competência', 'Tomador', 'CPF/CNPJ', 'Valor do serviço', 'Chave de acesso'];
    arq['notas/relatorio-notas.csv'] = strToU8('﻿' + [cab.map(csv).join(';'), ...notas.map((n) => [n.n_nfse, n.status, n.competencia, n.tomador_nome, n.tomador_documento, num(n.valor_servico).replace('.', ','), n.chave_acesso].map(csv).join(';'))].join('\r\n'));
  }
  if (o.ofx) {
    arq[`extrato/movimentacao_${o.de}_${o.ate}.ofx`] = strToU8(gerarOfx(empresaId, o.de, o.ate));
    const mv = movimentos(empresaId, o.de, o.ate);
    arq['extrato/movimentacao.csv'] = strToU8('﻿' + [['Data', 'Tipo', 'Valor', 'Histórico'].map(csv).join(';'), ...mv.map((m) => [m.data.split('-').reverse().join('/'), m.tipo === 'CREDIT' ? 'Entrada' : 'Saída', num(m.valor).replace('.', ','), m.historico].map(csv).join(';'))].join('\r\n'));
  }
  if (!Object.keys(arq).length) throw new ErroNegocio('Nada encontrado no período escolhido.', 404);
  const limpo = String(emp.razao_social).normalize('NFD').replace(/[^\w]+/g, '_').slice(0, 30);
  return { zip: Buffer.from(zipSync(arq, { level: 6 })), nome: `contabilidade_${limpo}_${o.de}_${o.ate}.zip` };
}
