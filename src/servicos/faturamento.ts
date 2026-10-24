import { z } from 'zod';
import { db } from '../db.js';
import type { Usuario } from '../auth.js';
import { EntradaEmissao, ErroNegocio, emitir } from './emissao.js';
import { enviarNotaPorEmail } from './email.js';
import { exigirLicenca } from '../licenca.js';

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
    const vencimento = entrada.vencimento ?? calcularVencimento(hoje, tomador.vencimento_tipo, tomador.vencimento_valor);
    const valor = entrada.valorBoleto ?? (fazNota ? valorLiquido(entrada) : entrada.valor);
    if (!(valor > 0)) throw new ErroNegocio('O valor do boleto precisa ser maior que zero.');
    const r = db.prepare(`INSERT INTO cobrancas (empresa_id, tomador_id, nota_id, descricao, valor, vencimento, criado_por) VALUES (?,?,?,?,?,?,?)`)
      .run(entrada.empresaId, tomador.id, resultado.nota?.id ?? null, entrada.descricao, valor, vencimento, u.id);
    resultado.cobranca = db.prepare('SELECT * FROM cobrancas WHERE id = ?').get(Number(r.lastInsertRowid));
    resultado.avisos.push('Boleto registrado como "aguardando banco": a integração bancária ainda não está configurada, então o arquivo do boleto será gerado quando ela for ativada.');
  }

  const queroEmail = entrada.enviarEmail ?? !!tomador?.enviar_email_auto;
  if (queroEmail) {
    if (!resultado.nota) {
      resultado.email = { status: 'NAO_ENVIADO', erro: 'Sem nota para enviar (o e-mail do boleto será enviado quando a integração bancária estiver ativa).' };
    } else {
      const para = [tomador?.email, ...(tomador?.email_cobranca ?? '').split(/[,;\s]+/)].filter((x): x is string => !!x && /@/.test(x));
      const unicos = [...new Set(para.map((e) => e.toLowerCase()))].slice(0, 5);
      if (!unicos.length) resultado.email = { status: 'ERRO', erro: 'O cliente não tem e-mail cadastrado.' };
      else {
        try {
          await enviarNotaPorEmail(resultado.nota.id, u.escritorio_id, unicos, u.id);
          resultado.email = { status: 'ENVIADO', para: unicos.join(', ') };
        } catch (e: any) { resultado.email = { status: 'ERRO', erro: String(e?.message ?? e) }; }
      }
    }
  }
  return resultado;
}

export function listarCobrancas(empresaId: number) {
  return db.prepare(`SELECT c.*, t.nome AS tomador_nome, n.n_nfse FROM cobrancas c
    JOIN tomadores t ON t.id = c.tomador_id LEFT JOIN notas n ON n.id = c.nota_id
    WHERE c.empresa_id = ? ORDER BY c.vencimento DESC, c.id DESC LIMIT 500`).all(empresaId);
}
