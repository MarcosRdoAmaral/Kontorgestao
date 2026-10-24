import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore módulo .mjs sem tipos
import { compararVersoes, buscarNovaVersao, urlPermitida } from '../electron/atualizador.mjs';

test('comparação de versões', () => {
  assert.ok(compararVersoes('1.0.10', '1.0.9') > 0);
  assert.ok(compararVersoes('v1.1.0', '1.0.99') > 0);
  assert.equal(compararVersoes('1.0.0', '1.0'), 0);
  assert.ok(compararVersoes('1.0.5', '1.0.6') < 0);
});

test('busca de atualização na release do GitHub', async () => {
  const release = (tag: string, assets: string[]) => ({ tag_name: tag, body: 'notas', assets: assets.map((name) => ({ name, browser_download_url: `https://github.com/x/y/releases/download/${tag}/${name}` })) });
  const resp = (status: number, corpo: unknown = {}) => async () => new Response(JSON.stringify(corpo), { status });
  assert.equal((await buscarNovaVersao('', '1.0.5', resp(200))).situacao, 'nao_configurado');
  assert.equal((await buscarNovaVersao('x/y', '1.0.5', resp(404))).situacao, 'sem_release');
  assert.equal((await buscarNovaVersao('x/y', '1.0.5', resp(200, release('v1.0.5', ['Kontor-Gestao-Instalador-1.0.5.exe'])))).situacao, 'atualizado');
  assert.equal((await buscarNovaVersao('x/y', '1.0.5', resp(200, release('v1.0.6', ['outro.zip'])))).situacao, 'sem_instalador');
  const n = await buscarNovaVersao('x/y', '1.0.5', resp(200, release('v1.0.6', ['Kontor-Gestao-Instalador-1.0.6.exe', 'Kontor-Gestao-Instalador-1.0.6.exe.sha256'])));
  assert.equal(n.situacao, 'nova');
  assert.equal(n.versao, '1.0.6');
  assert.ok(n.sha);
  await assert.rejects(buscarNovaVersao('x/y', '1.0.5', resp(500)), /500/);
});

test('só baixa de github.com', () => {
  assert.ok(urlPermitida('https://github.com/x/y/releases/download/v1/a.exe'));
  assert.ok(urlPermitida('https://objects.githubusercontent.com/a'));
  assert.ok(!urlPermitida('http://github.com/a'));
  assert.ok(!urlPermitida('https://evil.com/github.com/a'));
  assert.ok(!urlPermitida('https://github.com.evil.com/a'));
});
