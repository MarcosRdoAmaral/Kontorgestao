import { z } from 'zod';
import { db } from '../db.js';
import type { Usuario } from '../auth.js';
import { ajustarVencimento } from './diautil.js';
import { EntradaEmissao, ErroNegocio, emitir } from './emissao.js';
import { enviarMensagemBoleto, enviarNotaPorEmail } from './email.js';
import { exigirLicenca } from '../licenca.js';
import { boletoPdf, criarCobranca, listarCobrancas as listar, obterConta, obterCobranca, pendenciasPagador, registrarEmailCobranca } from './cobranca.js';

export type Acao = 'NOTA' | 'NOTA_BOLETO' | 'BOLETO';

/** Dados para "emitir tudo com um comando": o que fazer vem do cadastro do cliente, salvo se informado. */
export const EntradaFaturamento = EntradaEmissao.extend({
  acao: z.enum(['NOTA', 'NOTA_BOLETO', 'BOLETO']).nullish(),
  /** Valor do boleto; padrão = valor líquido a receber (serviço − descontos − retenções). */
  valorBoleto: z.number().positive().nullish(),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  enviarEmail: z.boolean().nullish(),
});
export type EntradaFaturamento = z.infer<typeof EntradaFaturamento>;

const dataIso = (d: Date) => d.toISOString().slice(0, 10);

/** Vencimento a partir da regra do cliente: N dias após a emissão, ou dia fixo do mês (próxima ocorrência). */
export function calcularVencimento(base: Date, tipo: 'PRAZO' | 'DIA_FIXO', valor: number): string {
  if (tipo === 'PRAZO') return dataIso(new Date(base.getTime() + valor * 86400e3));
  const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  let ano = base.getUTCFullYear(), mes = base.getUTCMonth();
  let dia = Math.min(valor, ultimoDia(ano, mes));
  if (Date.UTC(ano, mes, dia) <= Date.UTC(ano, mes, base.getUTCDate())) {
    mes += 1;
    if (mes > 11) { mes = 0; ano += 1; }
    dia = Math.min(valor, ultimoDia(ano, mes));
  }
  return dataIso(new Date(Date.UTC(ano, mes, dia)));
}

/** Valor líquido a receber: serviço − descontos − retenções federais − ISS retido pelo tomador. */
export function valorLiquido(e: Pick<EntradaEmissao, 'valor' | 'descontoIncondicionado' | 'retencoes' | 'issRetido' | 'aliquota'>): number {
  const r = e.retencoes ?? {};
  const base = e.valor - (e.descontoIncondicionado ?? 0);
  const iss = e.issRetido === 2 ? Math.round(base * (e.aliquota ?? 0)) / 100 : 0;
  const ret = (r.irrf ?? 0) + (r.cp ?? 0) + (r.csll ?? 0) + (r.pis ?? 0) + (r.cofins ?? 0) + iss;
  return Math.round((base - ret) * 100) / 100;
}

export async function faturar(u: Usuario, entrada: EntradaFaturamento) {
  exigirLicenca();
  const tomador = entrada.tomadorId
    ? (db.prepare('SELECT * FROM tomadores WHERE id = ? AND empresa_id = ?').get(entrada.tomadorId, entrada.empresaId) as any)
    : null;
  if (entrada.tomadorId && !tomador) throw new ErroNegocio('Cliente não encontrado para esta empresa.');
  const acao: Acao = entrada.acao ?? tomador?.modo_faturamento ?? 'NOTA';
  if (acao !== 'NOTA' && !tomador) throw new ErroNegocio('Escolha o cliente para gerar o boleto.');
  const fazNota = acao !== 'BOLETO';
  const fazBoleto = acao !== 'NOTA';

  // confere o cadastro antes de emitir a nota, para não deixar a nota emitida sem o boleto
  if (fazBoleto && obterConta(entrada.empresaId)) {
    const falta = pendenciasPagador(tomador);
    if (falta.length) throw new ErroNegocio(`Para gerar o boleto, complete o cadastro de ${tomador.nome}: ${falta.join(', ')}.`);
    const venc = entrada.vencimento ?? calcularVencimento(new Date(Date.now() - 3 * 3600e3), tomador.vencimento_tipo, tomador.vencimento_valor);
    if (venc < new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)) throw new ErroNegocio('O vencimento do boleto não pode estar no passado.');
  }

  const resultado: { acao: Acao; nota?: any; cobranca?: any; email?: { status: 'ENVIADO' | 'ERRO' | 'NAO_ENVIADO'; para?: string; erro?: string }; avisos: string[] } = { acao, avisos: [] };

  if (fazNota) {
    resultado.nota = await emitir(u, entrada);
    if (resultado.nota.status !== 'AUTORIZADA') {
      if (fazBoleto) resultado.avisos.push('O boleto não foi gerado porque a nota não foi autorizada. Corrija a nota e tente novamente.');
      return resultado;
    }
  }

  if (fazBoleto) {
    const hoje = new Date(Date.now() - 3 * 3600e3);
    const ajuste = ajustarVencimento(entrada.vencimento ?? calcularVencimento(hoje, tomador.vencimento_tipo, tomador.vencimento_valor), dataIso(hoje),
      (db.prepare('SELECT feriados_extra FROM empresas WHERE id = ?').get(entrada.empresaId) as any)?.feriados_extra);
    const vencimento = ajuste.data;
    if (ajuste.aviso) resultado.avisos.push(ajuste.aviso);
    const valor = entrada.valorBoleto ?? (fazNota ? valorLiquido(entrada) : entrada.valor);
    if (!(valor > 0)) throw new ErroNegocio('O valor do boleto precisa ser maior que zero.');
    resultado.cobranca = criarCobranca({ empresaId: entrada.empresaId, tomadorId: tomador.id, notaId: resultado.nota?.id ?? null, descricao: entrada.descricao, valor, vencimento, usuarioId: u.id });
    if (resultado.cobranca.status === 'AGUARDANDO_BANCO') {
      resultado.avisos.push(obterConta(entrada.empresaId)
        ? (resultado.cobranca.observacao_banco ?? 'O boleto ficou pendente.')
        : 'Boleto registrado como "aguardando banco": cadastre os dados bancários da empresa para gerar o boleto.');
    }
  }

  const queroEmail = entrada.enviarEmail ?? !!tomador?.enviar_email_auto;
  if (queroEmail) {
    const para = [tomador?.email, ...(tomador?.email_cobranca ?? '').split(/[,;\s]+/)].filter((x): x is string => !!x && /@/.test(x));
    const unicos = [...new Set(para.map((e) => e.toLowerCase()))].slice(0, 5);
    const cob = resultado.cobranca ? obterCobranca(resultado.cobranca.id) : null;
    const temBoleto = !!cob?.nosso_numero;
    if (!unicos.length) resultado.email = { status: 'ERRO', erro: 'O cliente não tem e-mail cadastrado.' };
    else if (!resultado.nota && !temBoleto) resultado.email = { status: 'NAO_ENVIADO', erro: 'O boleto ainda não foi gerado, então não há o que enviar.' };
    else {
      try {
        const b = temBoleto ? await boletoPdf(cob.id) : null;
        const extras = b ? [{ filename: b.nome, content: b.pdf, contentType: 'application/pdf' }] : [];
        const linhasExtras = temBoleto ? ['', `Boleto: vencimento em ${cob.vencimento.split('-').reverse().join('/')}, valor R$ ${cob.valor.toFixed(2).replace('.', ',')}.`, `Linha digitável: ${cob.linha_digitavel}`, 'O boleto segue em anexo (PDF).'] : [];
        if (resultado.nota) await enviarNotaPorEmail(resultado.nota.id, u.escritorio_id, unicos, u.id, 'emissao', { extras, linhasExtras });
        else await enviarMensagemBoleto(u.escritorio_id, unicos, cob, tomador, extras);
        if (cob) registrarEmailCobranca(cob.id, 'ENVIADO', unicos.join(', '));
        resultado.email = { status: 'ENVIADO', para: unicos.join(', ') };
      } catch (e: any) {
        if (cob) registrarEmailCobranca(cob.id, 'ERRO', unicos.join(', '));
        resultado.email = { status: 'ERRO', erro: String(e?.message ?? e) };
      }
    }
  }
  return resultado;
}

export const listarCobrancas = listar;
