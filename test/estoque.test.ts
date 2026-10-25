import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estoque-'));
process.env.DATABASE_PATH = path.join(dir, 'd.db');
process.env.STORAGE_DIR = dir;
process.env.MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SESSION_SECRET = 'x';
process.env.NFSE_DESKTOP = '1';

const chave = '35261012345678000195550010000012341000012345';
const nfe = (extra = '', ch = chave, destino = '10512356000168') => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00">
<ide><cUF>35</cUF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-10-10T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000195</CNPJ><xNome>Papelaria Central Ltda</xNome><xFant>Central</xFant><enderEmit><xMun>Florianópolis</xMun><UF>SC</UF></enderEmit></emit>
<dest><CNPJ>${destino}</CNPJ><xNome>BARBIERI SERVICOS</xNome></dest>
<det nItem="1"><prod><cProd>A1</cProd><xProd>Papel A4</xProd><NCM>48025610</NCM><CFOP>5102</CFOP><uCom>CX</uCom><qCom>10.0000</qCom><vUnCom>20.0000</vUnCom><vProd>200.00</vProd></prod></det>
<det nItem="2"><prod><cProd>B2</cProd><xProd>Caneta</xProd><NCM>96081000</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>5.0000</qCom><vUnCom>10.0000</vUnCom><vProd>50.00</vProd></prod></det>
<total><ICMSTot><vProd>250.00</vProd><vFrete>10.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vOutro>0.00</vOutro><vICMS>0.00</vICMS><vIPI>0.00</vIPI><vNF>260.00</vNF></ICMSTot></total>
${extra}</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

test('estoque: itens, entrada pela NF-e, baixa, saldo, avisos e exclusão', async () => {
  const { migrar, db } = await import('../src/db.js');
  migrar();
  const { importarCompraXml } = await import('../src/servicos/compras.js');
  const E = await import('../src/servicos/estoque.js');
  db.prepare("INSERT INTO escritorios (id, nome) VALUES (1, 'E')").run();
  db.prepare("INSERT INTO usuarios (id, escritorio_id, nome, email, papel, login, senha_hash) VALUES (1, 1, 'A', 'a@x.com', 'admin', 'A', 'x')").run();
  db.prepare("INSERT INTO empresas (id, escritorio_id, documento, razao_social, cod_municipio, op_simp_nac, ambiente) VALUES (1, 1, '10512356000168', 'BARBIERI', '4208203', 3, 2)").run();

  const c = importarCompraXml(1, 1, { xml: nfe(), gerarDespesas: false, categoria: 'x' });
  const itens = E.itensDaCompra(c.id) as any[];
  assert.equal(itens.length, 2);
  const r = E.lancarCompraNoEstoque(1, c.id, E.LancamentoCompra.parse({ itens: itens.map((i) => ({ compra_item_id: i.id })) }), 1);
  assert.deepEqual(r, { lancados: 2, novos: 2 });
  // lançar de novo não duplica
  assert.equal(E.lancarCompraNoEstoque(1, c.id, E.LancamentoCompra.parse({ itens: [{ compra_item_id: itens[0].id }] }), 1).lancados, 0);

  let lista = E.listarItens(1);
  const papel = lista.find((i: any) => i.nome === 'Papel A4')!;
  assert.equal(papel.saldo, 10);
  assert.equal(papel.ultimo_custo, 20);

  // baixa e saldo insuficiente
  E.movimentar(1, papel.id, E.Movimento.parse({ tipo: 'SAIDA', quantidade: 4, data: '2026-10-15' }), 1);
  assert.throws(() => E.movimentar(1, papel.id, E.Movimento.parse({ tipo: 'SAIDA', quantidade: 7 }), 1), /Saldo insuficiente/);
  assert.equal(E.saldoDoItem(papel.id), 6);

  // mínimo: saldo <= mínimo vira COMPRAR
  E.editarItem(1, papel.id, E.ItemEstoque.parse({ nome: 'Papel A4', unidade: 'CX', estoque_minimo: 6 }));
  let av = E.avisos(1, '2026-10-20');
  assert.deepEqual(av.comprar.map((i: any) => i.nome), ['Papel A4']);
  // caneta: comprada em 2026-10-10 e nunca usada → parada após 30 dias
  assert.equal(E.avisos(1, '2026-10-20').parados.length, 0);
  av = E.avisos(1, '2026-11-15');
  assert.deepEqual(av.parados.map((i: any) => i.nome), ['Caneta']);
  assert.ok(av.parados[0].dias_parado >= 30);

  // zerar o item sem mínimo → também precisa comprar
  const caneta = E.listarItens(1).find((i: any) => i.nome === 'Caneta')!;
  E.movimentar(1, caneta.id, E.Movimento.parse({ tipo: 'SAIDA', quantidade: 5, data: '2026-11-01' }), 1);
  av = E.avisos(1, '2026-11-15');
  assert.ok(av.comprar.some((i: any) => i.nome === 'Caneta'));
  assert.equal(av.parados.length, 0);

  // ajuste de inventário
  E.movimentar(1, papel.id, E.Movimento.parse({ tipo: 'AJUSTE', quantidade: 9 }), 1);
  assert.equal(E.saldoDoItem(papel.id), 9);
  assert.throws(() => E.movimentar(1, papel.id, E.Movimento.parse({ tipo: 'AJUSTE', quantidade: 9 }), 1), /igual/);

  // nome duplicado
  assert.throws(() => E.criarItem(1, E.ItemEstoque.parse({ nome: 'papel a4' })), /Já existe/);
  // apagar entrada com baixas posteriores recusa
  const mov = E.listarMovimentos(1, papel.id) as any[];
  const ent = mov.find((m) => m.tipo === 'ENTRADA');
  assert.throws(() => E.excluirMovimento(1, ent.id), /negativo/);
  // item com histórico só é desativado
  assert.equal(E.excluirItem(1, papel.id).desativado, true);
  assert.equal(E.listarItens(1).some((i: any) => i.id === papel.id), false);
  const novo = E.criarItem(1, E.ItemEstoque.parse({ nome: 'Grampo' }));
  assert.equal(E.excluirItem(1, novo.id).desativado, false);
});
