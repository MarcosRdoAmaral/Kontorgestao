import { z } from 'zod';
import { db } from '../db.js';
import { ErroNegocio } from './emissao.js';

/** Dias sem nenhuma baixa para um item comprado ser apontado como "comprado e não utilizado". */
export const DIAS_PARADO = 30;

const num = z.coerce.number().finite();
export const ItemEstoque = z.object({
  nome: z.string().trim().min(1).max(120),
  unidade: z.string().trim().min(1).max(10).default('un'),
  categoria: z.string().trim().max(60).nullish(),
  estoque_minimo: num.min(0).default(0),
  observacao: z.string().trim().max(300).nullish(),
});
export type ItemEstoque = z.infer<typeof ItemEstoque>;

export const Movimento = z.object({
  tipo: z.enum(['ENTRADA', 'SAIDA', 'AJUSTE']),
  /** ENTRADA/SAIDA: quantidade positiva. AJUSTE: o novo saldo contado. */
  quantidade: num.min(0),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  custo_unitario: num.min(0).nullish(),
  observacao: z.string().trim().max(300).nullish(),
});
export type Movimento = z.infer<typeof Movimento>;

const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const arred = (n: number) => Math.round(n * 1000) / 1000;

const SQL_ITENS = `
  SELECT i.*,
    COALESCE((SELECT SUM(quantidade) FROM estoque_movimentos m WHERE m.item_id = i.id), 0) AS saldo,
    (SELECT COALESCE(SUM(quantidade), 0) FROM estoque_movimentos m WHERE m.item_id = i.id AND m.tipo = 'ENTRADA') AS entradas,
    (SELECT COALESCE(-SUM(quantidade), 0) FROM estoque_movimentos m WHERE m.item_id = i.id AND m.tipo = 'SAIDA') AS saidas,
    (SELECT MAX(data) FROM estoque_movimentos m WHERE m.item_id = i.id AND m.tipo = 'ENTRADA') AS ultima_entrada,
    (SELECT MAX(data) FROM estoque_movimentos m WHERE m.item_id = i.id AND m.tipo = 'SAIDA') AS ultima_saida,
    (SELECT custo_unitario FROM estoque_movimentos m WHERE m.item_id = i.id AND m.tipo = 'ENTRADA' AND custo_unitario IS NOT NULL ORDER BY data DESC, id DESC LIMIT 1) AS ultimo_custo
  FROM estoque_itens i`;

function dias(de: string, ate: string) { return Math.floor((Date.parse(ate) - Date.parse(de)) / 86400e3); }

export type SituacaoEstoque = 'COMPRAR' | 'PARADO' | 'OK' | 'ZERADO';

function classificar(it: any, ref = hoje()): SituacaoEstoque {
  const saldo = arred(it.saldo);
  if (it.ativo && ((it.estoque_minimo > 0 && saldo <= it.estoque_minimo) || (it.entradas > 0 && saldo <= 0))) return 'COMPRAR';
  if (it.ativo && saldo > 0 && it.entradas > 0 && !it.ultima_saida && it.ultima_entrada && dias(it.ultima_entrada, ref) >= DIAS_PARADO) return 'PARADO';
  if (it.ativo && saldo > 0 && it.ultima_saida && it.ultima_entrada && it.ultima_entrada > it.ultima_saida && dias(it.ultima_entrada, ref) >= DIAS_PARADO) return 'PARADO';
  return saldo <= 0 ? 'ZERADO' : 'OK';
}

export function listarItens(empresaId: number, incluirInativos = false) {
  const rows = db.prepare(`${SQL_ITENS} WHERE i.empresa_id = ? ${incluirInativos ? '' : 'AND i.ativo = 1'} ORDER BY i.nome`).all(empresaId) as any[];
  return rows.map((r) => ({ ...r, saldo: arred(r.saldo), entradas: arred(r.entradas), saidas: arred(r.saidas), situacao: classificar(r) }));
}

function itemDaEmpresa(empresaId: number, id: number) {
  const it = db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id) as any;
  if (!it || it.empresa_id !== empresaId) throw new ErroNegocio('Item de estoque não encontrado.', 404);
  return it;
}

export function criarItem(empresaId: number, d: ItemEstoque) {
  const dup = db.prepare('SELECT id FROM estoque_itens WHERE empresa_id = ? AND ativo = 1 AND lower(nome) = lower(?)').get(empresaId, d.nome);
  if (dup) throw new ErroNegocio('Já existe um item com esse nome.');
  const r = db.prepare('INSERT INTO estoque_itens (empresa_id, nome, unidade, categoria, estoque_minimo, observacao) VALUES (?,?,?,?,?,?)')
    .run(empresaId, d.nome, d.unidade ?? 'un', d.categoria || null, d.estoque_minimo ?? 0, d.observacao || null);
  return { id: Number(r.lastInsertRowid) };
}

export function editarItem(empresaId: number, id: number, d: ItemEstoque) {
  itemDaEmpresa(empresaId, id);
  const dup = db.prepare('SELECT id FROM estoque_itens WHERE empresa_id = ? AND ativo = 1 AND lower(nome) = lower(?) AND id <> ?').get(empresaId, d.nome, id);
  if (dup) throw new ErroNegocio('Já existe um item com esse nome.');
  db.prepare('UPDATE estoque_itens SET nome = ?, unidade = ?, categoria = ?, estoque_minimo = ?, observacao = ? WHERE id = ?')
    .run(d.nome, d.unidade ?? 'un', d.categoria || null, d.estoque_minimo ?? 0, d.observacao || null, id);
  return { ok: true };
}

/** Item com histórico é só desativado (some das listas); sem movimentos é removido de vez. */
export function excluirItem(empresaId: number, id: number) {
  itemDaEmpresa(empresaId, id);
  const mov = db.prepare('SELECT COUNT(*) AS n FROM estoque_movimentos WHERE item_id = ?').get(id) as { n: number };
  if (mov.n) db.prepare('UPDATE estoque_itens SET ativo = 0 WHERE id = ?').run(id);
  else db.prepare('DELETE FROM estoque_itens WHERE id = ?').run(id);
  return { ok: true, desativado: mov.n > 0 };
}

export function saldoDoItem(id: number): number {
  return arred((db.prepare('SELECT COALESCE(SUM(quantidade), 0) AS s FROM estoque_movimentos WHERE item_id = ?').get(id) as { s: number }).s);
}

export function movimentar(empresaId: number, itemId: number, m: Movimento, usuarioId: number | null) {
  const it = itemDaEmpresa(empresaId, itemId);
  if (!it.ativo) throw new ErroNegocio('Este item está desativado.');
  const saldo = saldoDoItem(itemId);
  let delta: number;
  if (m.tipo === 'ENTRADA') { if (!(m.quantidade > 0)) throw new ErroNegocio('Informe a quantidade.'); delta = m.quantidade; }
  else if (m.tipo === 'SAIDA') {
    if (!(m.quantidade > 0)) throw new ErroNegocio('Informe a quantidade.');
    if (m.quantidade > saldo + 1e-9) throw new ErroNegocio(`Saldo insuficiente: há ${saldo} ${it.unidade} em estoque.`);
    delta = -m.quantidade;
  } else { delta = arred(m.quantidade - saldo); if (delta === 0) throw new ErroNegocio('O saldo contado é igual ao do sistema.'); }
  const r = db.prepare('INSERT INTO estoque_movimentos (empresa_id, item_id, tipo, quantidade, custo_unitario, data, observacao, usuario_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(empresaId, itemId, m.tipo, delta, m.tipo === 'ENTRADA' ? (m.custo_unitario ?? null) : null, m.data ?? hoje(), m.observacao || null, usuarioId);
  return { id: Number(r.lastInsertRowid), saldo: saldoDoItem(itemId) };
}

export function listarMovimentos(empresaId: number, itemId?: number, limite = 200) {
  return db.prepare(`SELECT m.*, i.nome AS item, i.unidade FROM estoque_movimentos m JOIN estoque_itens i ON i.id = m.item_id
    WHERE m.empresa_id = ? ${itemId ? 'AND m.item_id = ?' : ''} ORDER BY m.data DESC, m.id DESC LIMIT ${Math.min(limite, 1000)}`)
    .all(...(itemId ? [empresaId, itemId] : [empresaId]));
}

export function excluirMovimento(empresaId: number, id: number) {
  const m = db.prepare('SELECT empresa_id, item_id, quantidade FROM estoque_movimentos WHERE id = ?').get(id) as any;
  if (!m || m.empresa_id !== empresaId) throw new ErroNegocio('Movimento não encontrado.', 404);
  if (m.quantidade > 0 && saldoDoItem(m.item_id) - m.quantidade < -1e-9) throw new ErroNegocio('Não dá para apagar esta entrada: o saldo ficaria negativo (já houve baixas).');
  db.prepare('DELETE FROM estoque_movimentos WHERE id = ?').run(id);
  return { ok: true };
}

/** Avisos do topo: o que precisa ser comprado e o que foi comprado e segue sem uso. */
export function avisos(empresaId: number, ref = hoje()) {
  const itens = listarItens(empresaId).map((i) => ({ ...i, situacao: classificar(i, ref) }));
  const pick = (i: any) => ({ id: i.id, nome: i.nome, unidade: i.unidade, saldo: i.saldo, estoque_minimo: i.estoque_minimo, ultima_entrada: i.ultima_entrada, ultima_saida: i.ultima_saida,
    dias_parado: i.ultima_entrada ? dias(i.ultima_saida && i.ultima_saida > i.ultima_entrada ? i.ultima_saida : i.ultima_entrada, ref) : null });
  return { comprar: itens.filter((i) => i.situacao === 'COMPRAR').map(pick), parados: itens.filter((i) => i.situacao === 'PARADO').map(pick), diasParado: DIAS_PARADO };
}

// ---- entrada pela compra (NF-e) ----
export function itensDaCompra(compraId: number) {
  return db.prepare(`SELECT ci.id, ci.n_item, ci.codigo, ci.descricao, ci.unidade, ci.quantidade, ci.valor_unitario,
      (SELECT item_id FROM estoque_movimentos m WHERE m.compra_item_id = ci.id) AS estoque_item_id
    FROM compra_itens ci WHERE ci.compra_id = ? ORDER BY ci.n_item`).all(compraId);
}

export const LancamentoCompra = z.object({
  itens: z.array(z.object({
    compra_item_id: z.number().int(),
    /** existente ou novo (nome) */
    item_id: z.number().int().nullish(),
    nome: z.string().trim().min(1).max(120).nullish(),
    quantidade: num.positive().nullish(),
  })).min(1),
});

export function lancarCompraNoEstoque(empresaId: number, compraId: number, d: z.infer<typeof LancamentoCompra>, usuarioId: number | null) {
  const compra = db.prepare('SELECT empresa_id, emissao FROM compras WHERE id = ?').get(compraId) as { empresa_id: number; emissao: string | null } | undefined;
  if (!compra || compra.empresa_id !== empresaId) throw new ErroNegocio('Compra não encontrada.', 404);
  let lancados = 0, novos = 0;
  db.transaction(() => {
    for (const x of d.itens) {
      const ci = db.prepare('SELECT * FROM compra_itens WHERE id = ? AND compra_id = ?').get(x.compra_item_id, compraId) as any;
      if (!ci) throw new ErroNegocio('Item da compra não encontrado.', 404);
      if (db.prepare('SELECT 1 FROM estoque_movimentos WHERE compra_item_id = ?').get(ci.id)) continue; // já lançado
      let itemId = x.item_id ?? null;
      if (itemId) itemDaEmpresa(empresaId, itemId);
      else {
        const nome = (x.nome ?? ci.descricao).slice(0, 120);
        const ex = db.prepare('SELECT id FROM estoque_itens WHERE empresa_id = ? AND ativo = 1 AND lower(nome) = lower(?)').get(empresaId, nome) as { id: number } | undefined;
        if (ex) itemId = ex.id;
        else { itemId = criarItem(empresaId, ItemEstoque.parse({ nome, unidade: (ci.unidade || 'un').slice(0, 10) })).id; novos++; }
      }
      const qtd = x.quantidade ?? ci.quantidade;
      db.prepare('INSERT INTO estoque_movimentos (empresa_id, item_id, tipo, quantidade, custo_unitario, data, compra_item_id, observacao, usuario_id) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(empresaId, itemId, 'ENTRADA', qtd, ci.valor_unitario ?? null, (compra.emissao ?? hoje()).slice(0, 10), ci.id, 'Entrada pela NF-e de compra', usuarioId);
      lancados++;
    }
  })();
  return { lancados, novos };
}
