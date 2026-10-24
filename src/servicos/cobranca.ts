import { z } from 'zod';
import { db } from '../db.js';
import { ErroNegocio } from './emissao.js';
import { codigoBarras, descreverMotivo, gerarRemessa, lerRetorno, linhaDigitavel, nossoNumero, MOVIMENTO_RETORNO, type ContaAilos, type Titulo } from '../cobranca/ailos.js';
import { gerarBoletoPdf } from '../cobranca/boleto-pdf.js';

const UF_IBGE: Record<string, string> = { '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF' };
const hojeBr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const soDig = (s: string) => s.replace(/\D/g, '');

// ---------------------------------------------------------------------------
// Conta bancária (convênio de cobrança do Ailos)
// ---------------------------------------------------------------------------
export const ContaBancaria = z.object({
  cooperativa_nome: z.string().trim().min(2, 'Informe o nome da cooperativa').max(30),
  agencia: z.string().transform(soDig).refine((v) => v.length >= 1 && v.length <= 5, 'Agência: até 5 dígitos'),
  agencia_dv: z.string().trim().length(1, 'Informe o dígito da agência'),
  conta: z.string().transform(soDig).refine((v) => v.length >= 1 && v.length <= 7, 'Conta: até 7 dígitos, sem o dígito verificador'),
  conta_dv: z.string().trim().length(1, 'Informe o dígito da conta').regex(/^\d$/, 'O dígito da conta deve ser numérico'),
  convenio: z.string().transform(soDig).refine((v) => v.length >= 1 && v.length <= 6, 'Convênio: até 6 dígitos').transform((v) => v.padStart(6, '0')),
  carteira: z.string().transform(soDig).refine((v) => v.length >= 1 && v.length <= 2, 'Carteira: 2 dígitos').transform((v) => v.padStart(2, '0')).default('01'),
  multa_pct: z.number().min(0).max(20).default(2),
  juros_pct_mes: z.number().min(0).max(20).default(1),
  instrucoes: z.string().max(40, 'A instrução cabe em 40 caracteres').nullish(),
});
export type ContaBancaria = z.infer<typeof ContaBancaria>;

export function obterConta(empresaId: number): (ContaBancaria & { proximo_boleto: number; proxima_remessa: number }) | null {
  return (db.prepare('SELECT * FROM contas_bancarias WHERE empresa_id = ?').get(empresaId) as any) ?? null;
}

export function salvarConta(empresaId: number, d: ContaBancaria) {
  const atual = obterConta(empresaId);
  db.prepare(`INSERT INTO contas_bancarias (empresa_id, cooperativa_nome, agencia, agencia_dv, conta, conta_dv, convenio, carteira, multa_pct, juros_pct_mes, instrucoes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(empresa_id) DO UPDATE SET cooperativa_nome=excluded.cooperativa_nome, agencia=excluded.agencia, agencia_dv=excluded.agencia_dv, conta=excluded.conta, conta_dv=excluded.conta_dv,
      convenio=excluded.convenio, carteira=excluded.carteira, multa_pct=excluded.multa_pct, juros_pct_mes=excluded.juros_pct_mes, instrucoes=excluded.instrucoes, atualizado_em=datetime('now')`)
    .run(empresaId, d.cooperativa_nome, d.agencia, d.agencia_dv, d.conta, d.conta_dv, d.convenio, d.carteira, d.multa_pct, d.juros_pct_mes, d.instrucoes || null);
  // quem já tem boleto emitido não pode trocar de conta (o nosso número inclui a conta)
  if (atual && (atual.conta !== d.conta || atual.conta_dv !== d.conta_dv || atual.convenio !== d.convenio)) {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM cobrancas WHERE empresa_id = ? AND nosso_numero IS NOT NULL AND status NOT IN ('PAGO','CANCELADO','REJEITADO')").get(empresaId) as { n: number }).n;
    if (n) throw new ErroNegocio(`Existem ${n} boleto(s) em aberto emitidos com a conta/convênio anteriores. Quite ou cancele esses boletos antes de trocar a conta.`);
  }
  for (const c of db.prepare("SELECT id FROM cobrancas WHERE empresa_id = ? AND status = 'AGUARDANDO_BANCO' AND vencimento >= ?").all(empresaId, hojeBr()) as { id: number }[]) {
    try { gerarTitulo(c.id); } catch { /* cadastro do cliente incompleto: segue pendente */ }
  }
  return obterConta(empresaId);
}

const contaAilos = (c: any): ContaAilos => ({ cooperativa_nome: c.cooperativa_nome, agencia: c.agencia, agencia_dv: c.agencia_dv, conta: c.conta, conta_dv: c.conta_dv, convenio: c.convenio, carteira: c.carteira });

// ---------------------------------------------------------------------------
// Cobranças
// ---------------------------------------------------------------------------
/** Itens do cadastro do cliente que o boleto exige. */
export function pendenciasPagador(t: any): string[] {
  const f: string[] = [];
  if (!t.documento || t.tipo_doc === 'SEM') f.push('CPF/CNPJ');
  if (!t.logradouro) f.push('logradouro');
  if (!t.cep || soDig(t.cep).length !== 8) f.push('CEP');
  if (!t.bairro) f.push('bairro');
  if (!t.cidade) f.push('cidade');
  if (!(t.uf || UF_IBGE[String(t.cod_municipio ?? '').slice(0, 2)])) f.push('UF');
  return f;
}

export function criarCobranca(d: { empresaId: number; tomadorId: number; notaId: number | null; descricao: string; valor: number; vencimento: string; usuarioId: number }) {
  if (d.valor > 99999999.99) throw new ErroNegocio('Valor do boleto acima do limite.');
  const r = db.prepare(`INSERT INTO cobrancas (empresa_id, tomador_id, nota_id, descricao, valor, vencimento, emissao, criado_por) VALUES (?,?,?,?,?,?,?,?)`)
    .run(d.empresaId, d.tomadorId, d.notaId, d.descricao, d.valor, d.vencimento, hojeBr(), d.usuarioId);
  const id = Number(r.lastInsertRowid);
  if (obterConta(d.empresaId)) { try { gerarTitulo(id); } catch { /* fica pendente, com o motivo na tela */ } }
  return obterCobranca(id)!;
}

/** Reserva o número do boleto e calcula nosso número, código de barras e linha digitável. */
export function gerarTitulo(cobrancaId: number) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(cobrancaId) as any;
  if (!c || c.status !== 'AGUARDANDO_BANCO') return;
  const conta = obterConta(c.empresa_id);
  if (!conta) return;
  const t = db.prepare('SELECT * FROM tomadores WHERE id = ?').get(c.tomador_id) as any;
  const falta = pendenciasPagador(t);
  if (falta.length) {
    db.prepare('UPDATE cobrancas SET observacao_banco = ? WHERE id = ?').run(`Complete o cadastro do cliente: ${falta.join(', ')}.`, cobrancaId);
    throw new ErroNegocio(`Para gerar o boleto, complete o cadastro de ${t.nome}: ${falta.join(', ')}.`);
  }
  if (c.vencimento < hojeBr()) throw new ErroNegocio('O vencimento do boleto não pode estar no passado.');
  db.transaction(() => {
    const numero = (db.prepare('SELECT proximo_boleto AS n FROM contas_bancarias WHERE empresa_id = ?').get(c.empresa_id) as { n: number }).n;
    db.prepare('UPDATE contas_bancarias SET proximo_boleto = proximo_boleto + 1 WHERE empresa_id = ?').run(c.empresa_id);
    const ca = contaAilos(conta);
    const barras = codigoBarras(ca, numero, c.vencimento, c.valor);
    db.prepare(`UPDATE cobrancas SET status = 'A_REMETER', numero_boleto = ?, nosso_numero = ?, codigo_barras = ?, linha_digitavel = ?, observacao_banco = NULL WHERE id = ?`)
      .run(numero, nossoNumero(ca, numero), barras, linhaDigitavel(barras), cobrancaId);
  })();
}

export function obterCobranca(id: number) {
  return db.prepare(`SELECT c.*, t.nome AS tomador_nome, t.email AS tomador_email, n.n_nfse FROM cobrancas c
    JOIN tomadores t ON t.id = c.tomador_id LEFT JOIN notas n ON n.id = c.nota_id WHERE c.id = ?`).get(id) as any;
}

export function listarCobrancas(empresaId: number) {
  return db.prepare(`SELECT c.id, c.nota_id, c.tomador_id, c.descricao, c.valor, c.vencimento, c.status, c.nosso_numero, c.linha_digitavel, c.baixa_pendente, c.pago_em, c.valor_pago,
      c.observacao_banco, c.email_status, c.email_para, c.criado_em, t.nome AS tomador_nome, n.n_nfse FROM cobrancas c
    JOIN tomadores t ON t.id = c.tomador_id LEFT JOIN notas n ON n.id = c.nota_id
    WHERE c.empresa_id = ? ORDER BY c.vencimento DESC, c.id DESC LIMIT 500`).all(empresaId);
}

function mensagens(conta: any): string[] {
  const m: string[] = [];
  if (conta.instrucoes) m.push(String(conta.instrucoes).slice(0, 40));
  const f = (n: number) => String(n).replace('.', ',');
  if (conta.juros_pct_mes > 0 || conta.multa_pct > 0) {
    const partes = [conta.juros_pct_mes > 0 && `JUROS ${f(conta.juros_pct_mes)}% AO MES`, conta.multa_pct > 0 && `MULTA ${f(conta.multa_pct)}%`].filter(Boolean);
    m.push(`APOS VENCIMENTO: ${partes.join(' + ')}`.slice(0, 40));
  }
  return m;
}

export async function boletoPdf(cobrancaId: number): Promise<{ pdf: Buffer; nome: string }> {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(cobrancaId) as any;
  if (!c) throw new ErroNegocio('Cobrança não encontrada.', 404);
  if (!c.nosso_numero) throw new ErroNegocio(c.observacao_banco ?? 'Este boleto ainda não foi gerado: configure os dados bancários da empresa.');
  const conta = obterConta(c.empresa_id)!;
  const emp = db.prepare('SELECT razao_social, documento FROM empresas WHERE id = ?').get(c.empresa_id) as any;
  const t = db.prepare('SELECT * FROM tomadores WHERE id = ?').get(c.tomador_id) as any;
  const end = [t.logradouro, t.numero].filter(Boolean).join(', ') + (t.complemento ? ` - ${t.complemento}` : '');
  const uf = t.uf || UF_IBGE[String(t.cod_municipio ?? '').slice(0, 2)] || '';
  const pdf = await gerarBoletoPdf({
    beneficiario: { nome: emp.razao_social, documento: emp.documento },
    agenciaCodigo: `${conta.agencia.padStart(4, '0')}-${conta.agencia_dv} / ${conta.conta}-${conta.conta_dv}`,
    pagador: { nome: t.nome, documento: t.documento ?? '', endereco: `${end} - ${t.bairro ?? ''} - ${soDig(t.cep ?? '').replace(/(\d{5})(\d{3})/, '$1-$2')} ${t.cidade ?? ''}/${uf}` },
    nossoNumero: c.nosso_numero, numeroDocumento: c.nota_id ? `NFS-e ${(db.prepare('SELECT n_nfse FROM notas WHERE id = ?').get(c.nota_id) as any)?.n_nfse ?? ''}`.trim() : `COB ${c.id}`,
    vencimento: c.vencimento, valor: c.valor, emissao: c.emissao ?? c.criado_em.slice(0, 10), carteira: conta.carteira,
    instrucoes: mensagens(conta).length ? mensagens(conta) : ['Não receber após o vencimento sem consultar o beneficiário.'],
    linhaDigitavel: c.linha_digitavel, codigoBarras: c.codigo_barras,
  });
  return { pdf, nome: `Boleto_${c.nosso_numero}.pdf` };
}

export function cancelarCobranca(id: number) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(id) as any;
  if (!c) throw new ErroNegocio('Cobrança não encontrada.', 404);
  if (c.status === 'PAGO' || c.status === 'CANCELADO') throw new ErroNegocio('Esta cobrança já está encerrada.');
  if (c.status === 'AGUARDANDO_BANCO' || c.status === 'A_REMETER' || c.status === 'REJEITADO') {
    db.prepare("UPDATE cobrancas SET status = 'CANCELADO' WHERE id = ?").run(id);
    return { baixaNoBanco: false };
  }
  db.prepare('UPDATE cobrancas SET baixa_pendente = 1 WHERE id = ?').run(id); // pedido de baixa vai na próxima remessa
  return { baixaNoBanco: true };
}

export function marcarPago(id: number, data?: string, valor?: number) {
  const c = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(id) as any;
  if (!c) throw new ErroNegocio('Cobrança não encontrada.', 404);
  if (c.status === 'PAGO' || c.status === 'CANCELADO') throw new ErroNegocio('Esta cobrança já está encerrada.');
  db.prepare("UPDATE cobrancas SET status = 'PAGO', pago_em = ?, valor_pago = ?, baixa_pendente = 0 WHERE id = ?").run(data ?? hojeBr(), valor ?? c.valor, id);
}

export function registrarEmailCobranca(id: number, status: 'ENVIADO' | 'ERRO', para: string) {
  db.prepare("UPDATE cobrancas SET email_status = ?, email_para = ?, email_em = datetime('now') WHERE id = ?").run(status, para, id);
}

// ---------------------------------------------------------------------------
// Remessa e retorno
// ---------------------------------------------------------------------------
export function gerarRemessaEmpresa(empresaId: number, usuarioId: number) {
  const conta = obterConta(empresaId);
  if (!conta) throw new ErroNegocio('Configure os dados bancários da empresa antes de gerar a remessa.');
  const emp = db.prepare('SELECT razao_social, documento FROM empresas WHERE id = ?').get(empresaId) as any;
  const linhas = db.prepare(`SELECT c.*, t.nome AS t_nome, t.documento AS t_doc, t.logradouro, t.numero, t.complemento, t.bairro, t.cep, t.cidade, t.uf, t.cod_municipio
    FROM cobrancas c JOIN tomadores t ON t.id = c.tomador_id
    WHERE c.empresa_id = ? AND ((c.status = 'A_REMETER') OR (c.baixa_pendente = 1 AND c.status IN ('REMETIDO','REGISTRADO'))) ORDER BY c.id`).all(empresaId) as any[];
  if (!linhas.length) throw new ErroNegocio('Não há boletos novos nem baixas para enviar ao banco.');
  const msgs = mensagens(conta);
  const titulos: Titulo[] = linhas.map((c) => ({
    idInterno: c.id, nossoNumero: c.nosso_numero, numeroDocumento: c.nota_id ? `NFSE ${(db.prepare('SELECT n_nfse FROM notas WHERE id = ?').get(c.nota_id) as any)?.n_nfse ?? c.id}` : `COB ${c.id}`,
    vencimento: c.vencimento, valor: c.valor, emissao: c.emissao ?? c.criado_em.slice(0, 10),
    multaPct: conta.multa_pct, jurosPctMes: conta.juros_pct_mes, mensagens: msgs, movimento: c.status === 'A_REMETER' ? 'ENTRADA' : 'BAIXA',
    pagador: { documento: c.t_doc, nome: c.t_nome, endereco: [c.logradouro, c.numero].filter(Boolean).join(', ') + (c.complemento ? ` - ${c.complemento}` : ''), bairro: c.bairro ?? '', cep: c.cep ?? '', cidade: c.cidade ?? '', uf: c.uf || UF_IBGE[String(c.cod_municipio ?? '').slice(0, 2)] || '' },
  }));
  const numero = conta.proxima_remessa;
  const conteudo = gerarRemessa({ beneficiario: { documento: emp.documento, nome: emp.razao_social }, conta: contaAilos(conta), numeroRemessa: numero, agora: new Date(), titulos });
  const entradas = linhas.filter((c) => c.status === 'A_REMETER');
  const total = entradas.reduce((a, c) => a + c.valor, 0);
  const nome = `REMESSA_AILOS_${String(numero).padStart(6, '0')}.REM`;
  return db.transaction(() => {
    db.prepare('UPDATE contas_bancarias SET proxima_remessa = proxima_remessa + 1 WHERE empresa_id = ?').run(empresaId);
    const r = db.prepare('INSERT INTO remessas (empresa_id, numero, nome_arquivo, conteudo, qtd_titulos, valor_total, criado_por) VALUES (?,?,?,?,?,?,?)')
      .run(empresaId, numero, nome, conteudo, linhas.length, total, usuarioId);
    const rid = Number(r.lastInsertRowid);
    for (const c of linhas) {
      if (c.status === 'A_REMETER') db.prepare("UPDATE cobrancas SET status = 'REMETIDO', remessa_id = ? WHERE id = ?").run(rid, c.id);
      else db.prepare('UPDATE cobrancas SET baixa_pendente = 2 WHERE id = ?').run(c.id);
    }
    return { id: rid, numero, nome_arquivo: nome, qtd_titulos: linhas.length, entradas: entradas.length, baixas: linhas.length - entradas.length, valor_total: total };
  })();
}

export const listarRemessas = (empresaId: number) =>
  db.prepare('SELECT id, numero, nome_arquivo, qtd_titulos, valor_total, criado_em FROM remessas WHERE empresa_id = ? ORDER BY id DESC LIMIT 50').all(empresaId);

export function obterRemessa(id: number) {
  return db.prepare('SELECT * FROM remessas WHERE id = ?').get(id) as { id: number; empresa_id: number; nome_arquivo: string; conteudo: string } | undefined;
}

export function processarRetorno(empresaId: number, texto: string) {
  let r;
  try { r = lerRetorno(texto); } catch (e: any) { throw new ErroNegocio(e.message); }
  const resumo = { titulos: r.itens.length, registrados: 0, rejeitados: 0, pagos: 0, baixados: 0, tarifas: 0, naoEncontrados: [] as string[], detalhes: [] as string[] };
  db.transaction(() => {
    for (const i of r.itens) {
      const c = db.prepare('SELECT * FROM cobrancas WHERE empresa_id = ? AND nosso_numero = ?').get(empresaId, i.nossoNumero.slice(0, 17)) as any;
      if (!c) { if (i.movimento !== '28') resumo.naoEncontrados.push(i.nossoNumero); continue; }
      const motivos = i.motivos.map(descreverMotivo).join('; ');
      const rotulo = MOVIMENTO_RETORNO[i.movimento] ?? `Movimento ${i.movimento}`;
      switch (i.movimento) {
        case '02': if (c.status !== 'PAGO') db.prepare("UPDATE cobrancas SET status = 'REGISTRADO', observacao_banco = NULL WHERE id = ?").run(c.id); resumo.registrados++; break;
        case '03': db.prepare("UPDATE cobrancas SET status = 'REJEITADO', observacao_banco = ? WHERE id = ?").run(motivos || 'Entrada rejeitada pelo banco', c.id); resumo.rejeitados++; resumo.detalhes.push(`${c.id}: ${motivos}`); break;
        case '06': case '17': case '76': case '77':
          db.prepare("UPDATE cobrancas SET status = 'PAGO', pago_em = ?, valor_pago = ?, baixa_pendente = 0, observacao_banco = NULL WHERE id = ?").run(i.dataCredito ?? i.dataOcorrencia ?? hojeBr(), i.valorPago || c.valor, c.id); resumo.pagos++; break;
        case '09': if (c.status !== 'PAGO') db.prepare("UPDATE cobrancas SET status = 'CANCELADO', baixa_pendente = 0 WHERE id = ?").run(c.id); resumo.baixados++; break;
        case '26': db.prepare('UPDATE cobrancas SET observacao_banco = ? WHERE id = ?').run(`Instrução rejeitada: ${motivos}`, c.id); resumo.detalhes.push(`${c.id}: instrução rejeitada – ${motivos}`); break;
        case '28': resumo.tarifas++; break;
        default: resumo.detalhes.push(`${c.id}: ${rotulo}${motivos ? ' – ' + motivos : ''}`);
      }
    }
  })();
  return resumo;
}
