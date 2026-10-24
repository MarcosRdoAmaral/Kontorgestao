// Atualização do aplicativo via GitHub Releases (sem dependências nativas).
// Lógica pura aqui; a interface (diálogos, backup, abrir o instalador) fica em main.mjs.

/** Compara "1.0.10" com "1.0.9". Retorna >0 se a > b, 0 se iguais, <0 se a < b. */
export function compararVersoes(a, b) {
  const n = (v) => String(v).replace(/^v/i, '').split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const [pa, pb] = [n(a), n(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Escolhe o instalador (.exe) e o arquivo de checksum (.sha256) de uma release do GitHub. */
export function escolherAssets(release) {
  const assets = release?.assets ?? [];
  const exe = assets.find((a) => /^Kontor-Gestao-Instalador-[\d.]+\.exe$/i.test(a.name));
  if (!exe) return null;
  const sha = assets.find((a) => a.name === `${exe.name}.sha256`);
  return { exe, sha };
}

/** Consulta a última release publicada (não rascunho, não pré-lançamento). */
export async function buscarNovaVersao(repo, versaoAtual, buscar = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) return { situacao: 'nao_configurado' };
  const r = await buscar(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Kontor-Gestao' },
  });
  if (r.status === 404) return { situacao: 'sem_release' };
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
  const rel = await r.json();
  const versao = String(rel.tag_name ?? '').replace(/^v/i, '');
  if (!versao || compararVersoes(versao, versaoAtual) <= 0) return { situacao: 'atualizado', versao: versaoAtual };
  const assets = escolherAssets(rel);
  if (!assets) return { situacao: 'sem_instalador', versao };
  return { situacao: 'nova', versao, notas: rel.body ?? '', ...assets };
}

/** Só baixa de github.com (release assets). */
export function urlPermitida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com'));
  } catch { return false; }
}
