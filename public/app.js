// ---------------------------------------------------------------------------
// Kontor Gestão — interface (JavaScript puro, sem build)
// ---------------------------------------------------------------------------

const $ = (s, el = document) => el.querySelector(s);
const conteudo = $('#conteudo');
const estado = { token: localStorage.getItem('token'), usuario: null, empresas: [], empresaId: Number(localStorage.getItem('empresaId')) || null };

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const brl = (n) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Datas do banco vêm em UTC ("2026-10-24 01:25:38"); mostra no horário de Brasília. */
const dhBr = (s) => {
  if (!s) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
const dataBr = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');
const mesAtual = () => new Date().toISOString().slice(0, 7);
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const fmtDoc = (d) => !d ? '' : d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
const numero = (v) => (v === '' || v == null ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));
const STATUS = { AUTORIZADA: 'Autorizada', CANCELADA: 'Cancelada', REJEITADA: 'Rejeitada', ERRO_COMUNICACAO: 'Sem resposta', PENDENTE: 'Pendente' };
const carimbo = (s, grande) => `<span class="carimbo ${s}${grande ? ' grande' : ''}">${STATUS[s] ?? s}</span>`;

function aviso(msg) {
  const a = $('#aviso');
  a.textContent = msg;
  a.classList.add('visivel');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => a.classList.remove('visivel'), 4500);
}

async function api(metodo, url, corpo, { bruto = false } = {}) {
  const opts = { method: metodo, headers: { Authorization: `Bearer ${estado.token}` } };
  if (corpo instanceof FormData) opts.body = corpo;
  else if (corpo !== undefined) { opts.body = JSON.stringify(corpo); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, opts);
  if (r.status === 401) { sair(); throw new Error('Sessão expirada.'); }
  if (bruto) { if (!r.ok) throw new Error((await r.json()).erro); return r; }
  const json = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) {
    const e = new Error(json?.erro ?? `Erro ${r.status}`);
    e.campos = json?.campos; e.detalhes = json?.detalhes;
    throw e;
  }
  return json;
}

function mensagemErro(e) {
  if (e.campos?.length) return `${e.message}: ${e.campos.map((c) => `${c.campo || 'campo'} — ${c.mensagem}`).join('; ')}`;
  if (Array.isArray(e.detalhes) && e.detalhes.length) return `${e.message} ${e.detalhes.map((d) => `[${d.codigo}] ${d.descricao}`).join(' ')}`;
  return e.message;
}

async function baixar(url, nome, abrir = false) {
  try {
    const r = await api('GET', url, undefined, { bruto: true });
    const blob = URL.createObjectURL(await r.blob());
    if (abrir) window.open(blob, '_blank');
    else Object.assign(document.createElement('a'), { href: blob, download: nome }).click();
  } catch (e) { aviso(mensagemErro(e)); }
}

/** Lê um formulário em objeto, convertendo campos marcados com data-num. */
function lerForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { o[el.name] = el.checked; continue; }
    const v = el.value.trim();
    o[el.name] = el.dataset.num !== undefined ? numero(v) : v === '' ? null : v;
  }
  return o;
}

function abrirDialogo(html, aoAbrir) {
  const d = $('#dialogo');
  $('#dialogo-corpo').innerHTML = html;
  d.showModal();
  d.querySelectorAll('[data-fechar]').forEach((b) => (b.onclick = () => d.close()));
  aoAbrir?.(d);
  return d;
}

/** Busca endereço e código IBGE pelo CEP (ViaCEP). */
async function buscarCep(form) {
  const cep = form.cep.value.replace(/\D/g, '');
  if (cep.length !== 8) return;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
    if (r.erro) return aviso('CEP não encontrado.');
    for (const [campo, valor] of [['logradouro', r.logradouro], ['bairro', r.bairro], ['cod_municipio', r.ibge], ['uf', r.uf]]) {
      if (form[campo] && valor && !form[campo].value) form[campo].value = valor;
    }
    if (form.cod_municipio && r.ibge) form.cod_municipio.value = r.ibge;
    if (form.cidade && r.localidade) form.cidade.value = r.localidade;
    if (form.uf && r.uf) form.uf.value = r.uf;
    const info = form.querySelector('[data-municipio]');
    if (info) info.textContent = `${r.localidade}/${r.uf} — IBGE ${r.ibge}`;
  } catch { /* sem internet: preenchimento manual */ }
}

// ---- Dia útil (espelha src/servicos/diautil.ts; o servidor confere de novo) ----
const DIA_MS = 864e5;
function pascoaMs(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
function feriadosAno(y, extras) {
  const S = new Set(), p = pascoaMs(y), iso = (t) => new Date(t).toISOString().slice(0, 10);
  ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].forEach((x) => S.add(`${y}-${x}`));
  [-48, -47, -2, 60].forEach((n) => S.add(iso(p + n * DIA_MS)));
  String(extras ?? '').split(/[,;\s]+/).forEach((t) => { const m = t.match(/^(\d{1,2})\/(\d{1,2})$/); if (m) S.add(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`); });
  return S;
}
function motivoNaoUtil(ds, extras) {
  const [y, m, d] = ds.split('-').map(Number), w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 'domingo' : w === 6 ? 'sábado' : feriadosAno(y, extras).has(ds) ? 'feriado' : '';
}
function ajustarVencimento(venc, extras) {
  const motivo = motivoNaoUtil(venc, extras);
  if (!motivo) return { data: venc };
  const andar = (sentido) => { let t = Date.parse(venc + 'T00:00:00Z'); for (let i = 0; i < 15 && motivoNaoUtil(new Date(t).toISOString().slice(0, 10), extras); i++) t += sentido * DIA_MS; return new Date(t).toISOString().slice(0, 10); };
  let novo = andar(-1);
  if (novo < hoje()) novo = andar(1);
  return { data: novo, aviso: `Vencimento ajustado: ${dataBr(venc)} cai em ${motivo}; ${novo < venc ? 'antecipado' : 'adiado'} para ${dataBr(novo)}.` };
}

// ---- Gráficos simples em SVG ----
const compacto = (n) => (n >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : brl(n));
const nomeMes = (ym) => ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(ym.slice(5)) - 1] + '/' + ym.slice(2, 4);
/** Barras agrupadas: cada série é { cor, valores[] }; rótulos no eixo X. */
function graficoBarras(rotulos, series, destaque) {
  const max = Math.max(1, ...series.flatMap((x) => x.valores));
  const larg = 600 / rotulos.length, bw = Math.min(40, (larg - 14) / series.length);
  let svg = '<svg viewBox="0 0 600 230" role="img" style="width:100%;height:auto"><line x1="10" x2="590" y1="190" y2="190" stroke="currentColor" opacity=".25"/>';
  rotulos.forEach((r, i) => {
    const x0 = i * larg + (larg - bw * series.length) / 2;
    series.forEach((se, j) => {
      const v = se.valores[i], h = (v / max) * 150, x = x0 + j * bw;
      svg += `<rect x="${x}" y="${190 - h}" width="${bw - 3}" height="${h}" rx="3" fill="${se.cor}"/>`;
      if (v > 0) svg += `<text x="${x + (bw - 3) / 2}" y="${186 - h}" text-anchor="middle" font-size="10" fill="currentColor">${compacto(v).replace('R$ ', '')}</text>`;
    });
    svg += `<text x="${i * larg + larg / 2}" y="210" text-anchor="middle" font-size="11" fill="currentColor" opacity="${i === destaque ? 1 : .65}" ${i === destaque ? 'font-weight="700"' : ''}>${nomeMes(r)}</text>`;
  });
  return svg + '</svg>';
}
const legenda = (itens) => `<div class="legenda">${itens.map(([cor, t]) => `<span><i style="background:${cor}"></i>${t}</span>`).join('')}</div>`;
const COR = { verde: '#4ade80', laranja: '#fb923d', vermelho: '#f87171' };

// ---------------------------------------------------------------------------
// Sessão e estrutura
// ---------------------------------------------------------------------------

function sair() {
  localStorage.removeItem('token');
  estado.token = null;
  $('#app').hidden = true;
  $('#setup').hidden = true;
  $('#login').hidden = false;
}

function mostrarSetup() {
  $('#app').hidden = true;
  $('#login').hidden = true;
  $('#setup').hidden = false;
}

$('#form-setup').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.senha.value !== f.senha2.value) return ($('#erro-setup').textContent = 'As senhas não são iguais.');
  try {
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escritorio: f.escritorio.value, nome: f.nome.value, usuario: f.usuario.value.trim().toUpperCase(), email: f.email.value, senha: f.senha.value }) });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.erro), { campos: j.campos });
    estado.token = j.token;
    localStorage.setItem('token', j.token);
    $('#setup').hidden = true;
    iniciar();
  } catch (e) { $('#erro-setup').textContent = mensagemErro(e); }
};

$('#form-login').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: f.usuario.value.trim().toUpperCase(), senha: f.senha.value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro);
    estado.token = j.token;
    localStorage.setItem('token', j.token);
    iniciar();
  } catch (e) { $('#erro-login').textContent = e.message; }
};
$('#sair').onclick = sair;

// Esqueci minha senha: 1) informa o usuário e recebe um código por e-mail; 2) informa o código e a senha volta à padrão.
$('#esqueci').onclick = () => abrirDialogo(`
  <form id="form-esqueci"><h2>Esqueci minha senha</h2>
    <p class="sutil">Enviamos um código de 6 dígitos para o e-mail cadastrado no seu usuário. Ao informá-lo, sua senha volta para a senha padrão do sistema e você cria uma nova em seguida.</p>
    <label>Usuário <input name="usuario" required autocapitalize="characters" style="text-transform:uppercase" value="${esc($('#form-login').usuario.value.trim().toUpperCase())}"></label>
    <p class="erro" id="erro-esqueci"></p>
    <div class="acoes"><button class="primario" type="submit">Enviar código por e-mail</button><button type="button" data-fechar>Fechar</button></div>
  </form>`, (d) => {
  $('#form-esqueci').onsubmit = async (ev) => {
    ev.preventDefault();
    const usuario = ev.target.usuario.value.trim().toUpperCase();
    try {
      const r = await fetch('/api/esqueci-senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Não foi possível enviar.');
      $('#dialogo-corpo').innerHTML = `
        <form id="form-codigo"><h2>Digite o código</h2>
          <p class="sutil">${esc(j.mensagem)}</p>
          <label>Código de 6 dígitos <input name="codigo" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label>
          <p class="erro" id="erro-codigo"></p>
          <div class="acoes"><button class="primario" type="submit">Redefinir para a senha padrão</button><button type="button" data-fechar>Fechar</button></div>
        </form>`;
      d.querySelectorAll('[data-fechar]').forEach((b) => (b.onclick = () => d.close()));
      $('#form-codigo').onsubmit = async (e2) => {
        e2.preventDefault();
        try {
          const r2 = await fetch('/api/esqueci-senha/confirmar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, codigo: e2.target.codigo.value.trim() }) });
          const j2 = await r2.json();
          if (!r2.ok) throw new Error(j2.erro || 'Código inválido.');
          d.close(); $('#form-login').usuario.value = usuario; $('#form-login').senha.focus();
          $('#erro-login').textContent = ''; aviso(j2.mensagem);
        } catch (e) { $('#erro-codigo').textContent = e.message; }
      };
    } catch (e) { $('#erro-esqueci').textContent = e.message; }
  };
});

/** Troca de senha. Obrigatória (sem como fechar) no primeiro acesso com senha padrão. */
function trocarSenha({ obrigatoria = false } = {}) {
  const d = abrirDialogo(`
    <form id="form-senha"><h2>${obrigatoria ? 'Crie sua senha' : 'Alterar minha senha'}</h2>
      ${obrigatoria ? '<p class="sutil">Você está usando uma senha provisória. Escolha uma senha só sua para continuar.</p>' : ''}
      <label>Senha atual <input name="atual" type="password" required autocomplete="current-password"></label>
      <label>Nova senha <input name="nova" type="password" minlength="8" required autocomplete="new-password"><span class="dica">Mínimo de 8 caracteres e diferente da senha padrão.</span></label>
      <label>Repita a nova senha <input name="nova2" type="password" minlength="8" required autocomplete="new-password"></label>
      <p class="erro" id="erro-senha"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar senha</button>${obrigatoria ? '<button type="button" id="senha-sair">Sair</button>' : '<button type="button" data-fechar>Fechar</button>'}</div>
    </form>`, (dlg) => {
    if (obrigatoria) { dlg.oncancel = (e) => e.preventDefault(); $('#senha-sair').onclick = () => { dlg.close(); sair(); }; }
    $('#form-senha').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      if (f.nova.value !== f.nova2.value) return ($('#erro-senha').textContent = 'As senhas novas não são iguais.');
      try {
        const r = await api('PUT', '/api/me/senha', { atual: f.atual.value, nova: f.nova.value });
        estado.token = r.token; localStorage.setItem('token', r.token);
        dlg.oncancel = null; dlg.close(); aviso('Senha alterada.');
        if (obrigatoria) iniciar();
      } catch (e) { $('#erro-senha').textContent = mensagemErro(e); }
    };
  });
  return d;
}

async function carregarEmpresas() {
  estado.empresas = await api('GET', '/api/empresas');
  if (!estado.empresas.some((e) => e.id === estado.empresaId)) estado.empresaId = estado.empresas[0]?.id ?? null;
  const sel = $('#empresa-atual');
  sel.innerHTML = estado.empresas.length
    ? estado.empresas.map((e) => `<option value="${e.id}" ${e.id === estado.empresaId ? 'selected' : ''}>${esc(e.nome_fantasia || e.razao_social)}</option>`).join('')
    : '<option>Nenhuma empresa cadastrada</option>';
  infoEmpresa();
}

function empresa() { return estado.empresas.find((e) => e.id === estado.empresaId); }

function infoEmpresa() {
  const e = empresa();
  if (!e) { $('#info-empresa').innerHTML = ''; return; }
  const dias = e.cert_validade ? Math.floor((new Date(e.cert_validade) - Date.now()) / 864e5) : null;
  $('#info-empresa').innerHTML = `${fmtDoc(e.documento)}<br>
    ${e.ambiente === 1 ? 'Produção' : '<span class="alerta">Produção restrita (testes)</span>'} · série ${esc(e.serie)}<br>
    ${!e.tem_certificado ? '<span class="alerta">Sem certificado A1</span>' : dias < 30 ? `<span class="alerta">Certificado vence em ${dias} dias</span>` : `Certificado até ${dataBr(e.cert_validade)}`}`;
}

$('#empresa-atual').onchange = (ev) => {
  estado.empresaId = Number(ev.target.value);
  localStorage.setItem('empresaId', estado.empresaId);
  api('PUT', '/api/me/empresa', { id: estado.empresaId }).catch(() => {});
  infoEmpresa();
  rotear();
};

async function iniciar() {
  try { estado.usuario = await api('GET', '/api/me'); } catch { return sair(); }
  // a escolha guardada no banco vale quando o navegador não lembra (porta/origem mudou após atualizar)
  if (!localStorage.getItem('empresaId') && estado.usuario.ultima_empresa_id) estado.empresaId = estado.usuario.ultima_empresa_id;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#nome-usuario').textContent = `${estado.usuario.nome} (${estado.usuario.login})`;
  document.querySelectorAll('[data-modulo]').forEach((a) => (a.hidden = !estado.usuario.modulos.includes(a.dataset.modulo)));
  if (estado.usuario.trocar_senha) { $('#app').hidden = true; return trocarSenha({ obrigatoria: true }); }
  await carregarEmpresas();
  atualizarLicenca();
  if (!location.hash || !telaPermitida((location.hash.split('/')[1] || 'painel'))) location.hash = '#/' + (estado.usuario.modulos[0] ?? 'config');
  rotear();
}

/** A tela pertence a algum módulo liberado para o usuário? (o servidor confere de novo em cada chamada) */
function telaPermitida(nome) {
  const modulo = { painel: 'painel', emitir: 'emitir', notas: 'notas', nota: 'notas', cobrancas: 'cobrancas', banco: 'banco', despesas: 'despesas', tomadores: 'tomadores', servicos: 'servicos', empresas: 'empresas' }[nome];
  return nome === 'config' || (modulo && estado.usuario.modulos.includes(modulo));
}

const rotas = {
  painel: telaPainel, emitir: telaEmitir, notas: telaNotas, nota: telaNota,
  cobrancas: telaCobrancas, banco: telaBanco, despesas: telaDespesas, tomadores: telaTomadores, servicos: telaServicos, empresas: telaEmpresas, config: telaConfig,
};

function rotear() {
  const [, nome = 'painel', param] = location.hash.split('/');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#/${nome}`));
  if (['usuarios', 'email', 'backup', 'licenca'].includes(nome)) { location.hash = '#/config/' + nome; return; } // endereços antigos
  if (!telaPermitida(nome)) { conteudo.innerHTML = '<div class="vazio"><p>Seu usuário não tem acesso a esta funcionalidade.</p></div>'; return; }
  const precisaEmpresa = !['painel', 'empresas', 'nota', 'config'].includes(nome);
  if (precisaEmpresa && !empresa()) {
    conteudo.innerHTML = `<div class="vazio"><p>Cadastre a primeira empresa para começar a emitir.</p>
      ${estado.usuario.papel !== 'cliente' ? '<a href="#/empresas">Cadastrar empresa</a>' : ''}</div>`;
    return;
  }
  (rotas[nome] ?? telaPainel)(param).catch((e) => (conteudo.innerHTML = `<p class="erro">${esc(mensagemErro(e))}</p>`));
  conteudo.focus();
}
window.addEventListener('hashchange', rotear);

// ---------------------------------------------------------------------------
// Painel do mês
// ---------------------------------------------------------------------------

async function telaPainel() {
  const mes = telaPainel.mes ?? mesAtual();
  const linhas = await api('GET', `/api/relatorios/resumo?mes=${mes}`);
  const tot = linhas.reduce((a, l) => ({ fat: a.fat + (l.faturado ?? 0), aut: a.aut + (l.autorizadas ?? 0), pend: a.pend + (l.pendencias ?? 0) }), { fat: 0, aut: 0, pend: 0 });
  const fin = empresa() ? await api('GET', `/api/empresas/${estado.empresaId}/painel?mes=${mes}`).catch(() => null) : null;
  const k = fin?.kpis;
  conteudo.innerHTML = `
    <div class="topo">
      <div><h1>Painel do mês</h1><p class="sutil">Cobranças e recebimentos de ${esc(empresa()?.nome_fantasia || empresa()?.razao_social || 'sua empresa')} e notas de todas as empresas.</p></div>
      <label>Mês <input type="month" id="mes" value="${mes}"></label>
    </div>
    ${fin ? `
    <div class="resumo">
      <div class="cartao"><div class="sutil">Faturado</div><div class="valor">${compacto(k.faturado)}</div><div class="dica">${k.qtd} cobrança(s) com vencimento no mês</div></div>
      <div class="cartao"><div class="sutil">Recebido</div><div class="valor" style="color:${COR.verde}">${compacto(k.recebido)}</div><div class="dica">${k.pctRecebido}% do faturado</div></div>
      <div class="cartao"><div class="sutil">A receber</div><div class="valor">${compacto(k.aReceber)}</div><div class="dica">${k.qtdAReceber} em dia</div></div>
      <div class="cartao"><div class="sutil">Em atraso</div><div class="valor" style="color:${k.qtdAtraso ? COR.vermelho : 'inherit'}">${compacto(k.emAtraso)}</div><div class="dica">${k.qtdAtraso} cobrança(s) · inadimplência ${k.inadimplencia}%</div></div>
      <div class="cartao"><div class="sutil">Falta emitir</div><div class="valor">${fin.faltamEmitir.qtd}</div><div class="dica">de ${fin.faltamEmitir.total} cliente(s) em ${nomeMes(mes)}</div></div>
    </div>
    <div class="cartao" style="margin-top:16px"><h2 style="margin-top:0">Dicas para o seu caixa</h2>
      <ul class="dicas">${fin.dicas.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
    <div class="duas-colunas">
      <div class="cartao"><h2 style="margin-top:0">Cobranças dos últimos 6 meses</h2>
        ${graficoBarras(fin.serie.map((x) => x.mes), [{ cor: COR.verde, valores: fin.serie.map((x) => x.recebido) }, { cor: COR.laranja, valores: fin.serie.map((x) => x.aberto) }], 5)}
        ${legenda([[COR.verde, 'Recebido'], [COR.laranja, 'Em aberto']])}</div>
      <div class="cartao"><h2 style="margin-top:0">Receitas × despesas</h2>
        ${graficoBarras(fin.balanco.map((x) => x.mes), [{ cor: COR.verde, valores: fin.balanco.map((x) => x.receitas) }, { cor: COR.vermelho, valores: fin.balanco.map((x) => x.despesas) }], 5)}
        ${legenda([[COR.verde, 'Recebido no mês'], [COR.vermelho, 'Despesas']])}
        <p class="dica"><a href="#/despesas">Lançar despesas e ver o balanço</a></p></div>
    </div>
    <div class="duas-colunas">
      <div class="cartao"><h2 style="margin-top:0">Atrasadas</h2>
        ${fin.atrasadas.length ? `<table class="tabela"><tbody>${fin.atrasadas.map((c) => `<tr><td>${esc(c.tomador)}</td><td class="num">${brl(c.valor)}</td><td class="sutil">venceu em ${dataBr(c.vencimento)} (${c.dias} dia(s))</td></tr>`).join('')}</tbody></table>` : '<p class="sutil">Nenhuma cobrança em atraso.</p>'}
        <p class="dica"><a href="#/cobrancas">Abrir Cobranças</a></p></div>
      <div class="cartao"><h2 style="margin-top:0">Falta emitir em ${nomeMes(mes)}</h2>
        ${fin.faltamEmitir.qtd ? `<ul class="dicas">${fin.faltamEmitir.clientes.map((c) => `<li>${esc(c.nome)}</li>`).join('')}${fin.faltamEmitir.qtd > fin.faltamEmitir.clientes.length ? `<li class="sutil">e mais ${fin.faltamEmitir.qtd - fin.faltamEmitir.clientes.length}…</li>` : ''}</ul>` : '<p class="sutil">Todos os clientes já foram faturados neste mês.</p>'}
        <p class="dica"><a href="#/emitir">Emitir agora</a></p></div>
    </div>
    <h2>Notas por empresa</h2>` : ''}
    <div class="resumo">
      <div class="cartao"><div class="sutil">Faturado (autorizadas)</div><div class="valor">${brl(tot.fat)}</div></div>
      <div class="cartao"><div class="sutil">Notas autorizadas</div><div class="valor">${tot.aut}</div></div>
      <div class="cartao"><div class="sutil">Pendências</div><div class="valor ${tot.pend ? 'pendente-txt' : ''}">${tot.pend}</div>
        <div class="dica">Rejeitadas ou sem resposta da Sefin</div></div>
    </div>
    <h2>Por empresa</h2>
    ${linhas.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Empresa</th><th class="num">Autorizadas</th><th class="num">Canceladas</th><th class="num">Pendências</th><th class="num">Faturado</th></tr></thead><tbody>
      ${linhas.map((l) => `<tr class="clicavel" data-id="${l.empresa_id}"><td>${esc(l.empresa)}</td><td class="num">${l.autorizadas ?? 0}</td><td class="num">${l.canceladas ?? 0}</td>
        <td class="num ${l.pendencias ? 'pendente-txt' : ''}">${l.pendencias ?? 0}</td><td class="num">${brl(l.faturado)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhuma empresa cadastrada ainda.</div>'}`;
  $('#mes').onchange = (e) => { telaPainel.mes = e.target.value; telaPainel(); };
  conteudo.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => {
    estado.empresaId = Number(tr.dataset.id); localStorage.setItem('empresaId', estado.empresaId);
    api('PUT', '/api/me/empresa', { id: estado.empresaId }).catch(() => {});
    $('#empresa-atual').value = estado.empresaId; infoEmpresa(); location.hash = '#/notas';
  }));
}

// ---------------------------------------------------------------------------
// Emitir nota
// ---------------------------------------------------------------------------

async function telaEmitir(notaIdCorrecao) {
  const e = empresa();
  const [tomadores, servicos] = await Promise.all([
    api('GET', `/api/empresas/${e.id}/tomadores`),
    api('GET', `/api/empresas/${e.id}/servicos`),
  ]);
  const corrigindo = notaIdCorrecao ? await api('GET', `/api/notas/${notaIdCorrecao}`) : null;
  const p = corrigindo?.payload ?? {};

  conteudo.innerHTML = `
    <div class="topo"><div>
      <h1>${corrigindo ? `Corrigir e reenviar DPS nº ${corrigindo.n_dps}` : 'Emitir nota'}</h1>
      <p class="sutil">${esc(e.razao_social)} — ${fmtDoc(e.documento)}</p>
    </div></div>
    ${e.ambiente === 2 ? '<div class="banner teste">Esta empresa está em produção restrita: as notas são de teste e não têm valor fiscal.</div>' : ''}
    ${!e.tem_certificado ? '<div class="banner teste">Cadastre o certificado A1 da empresa antes de emitir.</div>' : ''}
    <form id="form-emitir">
      <fieldset><legend>Tomador</legend>
        <div class="grade">
          <label class="largo">Quem contratou o serviço
            <select name="tomadorId">
              <option value="">Consumidor não identificado</option>
              ${tomadores.map((t) => `<option value="${t.id}" ${p.tomadorId === t.id ? 'selected' : ''}>${esc(t.nome)} ${t.documento ? '— ' + fmtDoc(t.documento) : ''}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="acoes"><button type="button" id="novo-tomador">Cadastrar novo cliente</button></div>
      </fieldset>

      <fieldset id="bloco-cobranca" hidden><legend>O que emitir</legend>
        <div class="grade">
          <label class="largo">Ação
            <select name="acao"><option value="NOTA">Somente a nota fiscal</option><option value="NOTA_BOLETO">Nota fiscal + boleto</option><option value="BOLETO">Somente o boleto</option></select>
            <span class="dica" id="dica-acao"></span></label>
          <label data-boleto>Vencimento do boleto <input type="date" name="vencimento"></label>
          <label data-boleto>Valor do boleto (R$) <input name="valorBoleto" data-num inputmode="decimal" placeholder="Valor líquido da nota"><span class="dica">Preenchido sozinho com o líquido da nota (serviço menos descontos e retenções). Você pode alterar; apague o campo para voltar ao automático.</span></label>
        </div>
      </fieldset>

      <fieldset><legend>Serviço</legend>
        <div class="grade">
          <label class="largo">Serviço cadastrado
            <select name="servicoId">
              <option value="">Informar manualmente</option>
              ${servicos.map((s) => `<option value="${s.id}" ${p.servicoId === s.id ? 'selected' : ''}>${esc(s.nome)} (${s.c_trib_nac})</option>`).join('')}
            </select>
          </label>
          <label class="largo">Descrição que sai na nota <textarea name="descricao" required maxlength="2000">${esc(p.descricao ?? '')}</textarea></label>
          <label>Competência <input type="date" name="competencia" required value="${p.competencia ?? hoje()}"></label>
          <label>Valor do serviço (R$) <input name="valor" data-num required inputmode="decimal" value="${p.valor ?? ''}"></label>
          <label>Código de tributação nacional <input name="cTribNac" maxlength="8" placeholder="Ex.: 171901" value="${esc(p.cTribNac ?? '')}">
            <span class="dica">Fica em branco para usar o do serviço cadastrado</span></label>
          <label>Município da prestação (IBGE) <input name="municipioPrestacao" maxlength="7" placeholder="${e.cod_municipio}" value="${esc(p.municipioPrestacao ?? '')}"></label>
        </div>
      </fieldset>

      <fieldset><legend>Tributação</legend>
        <div class="grade">
          <label>ISSQN
            <select name="tribISSQN">
              <option value="1">Operação tributável</option><option value="2">Imunidade</option>
              <option value="3">Exportação de serviço</option><option value="4">Não incidência</option>
            </select></label>
          <label>Retenção do ISSQN
            <select name="issRetido"><option value="1">Não retido</option><option value="2">Retido pelo tomador</option><option value="3">Retido pelo intermediário</option></select></label>
          <label>Alíquota ISSQN (%) <input name="aliquota" data-num inputmode="decimal" value="${p.aliquota ?? ''}">
            <span class="dica">Simples ME/EPP: alíquota do Anexo. MEI e não optantes: deixe em branco.</span></label>
          <label>Desconto incondicionado (R$) <input name="descontoIncondicionado" data-num inputmode="decimal" value="${p.descontoIncondicionado ?? ''}"></label>
          <fieldset class="largo retencoes"><legend>Retenções federais</legend>
            <p class="dica">Preencha só o que o tomador vai reter. Use o botão para sugerir as alíquotas usuais (PIS 0,65% · COFINS 3% · CSLL 1% · IRRF 1,5%) e ajuste se o caso for outro; retenções abaixo de R$ 10,00 normalmente são dispensadas.</p>
            <div class="grade">
              <label>PIS (%) <input name="pPis" data-num inputmode="decimal" value="${p.retencoes?.pPis ?? ''}"></label>
              <label>PIS retido (R$) <input name="pis" data-num inputmode="decimal" value="${p.retencoes?.pis ?? ''}"></label>
              <label>COFINS (%) <input name="pCofins" data-num inputmode="decimal" value="${p.retencoes?.pCofins ?? ''}"></label>
              <label>COFINS retida (R$) <input name="cofins" data-num inputmode="decimal" value="${p.retencoes?.cofins ?? ''}"></label>
              <label>CSLL (%) <input name="pCsll" data-num inputmode="decimal"></label>
              <label>CSLL retida (R$) <input name="csll" data-num inputmode="decimal" value="${p.retencoes?.csll ?? ''}"></label>
              <label>IRRF (%) <input name="pIrrf" data-num inputmode="decimal"></label>
              <label>IRRF retido (R$) <input name="irrf" data-num inputmode="decimal" value="${p.retencoes?.irrf ?? ''}"></label>
              <label>INSS / CP retido (R$) <input name="cp" data-num inputmode="decimal" value="${p.retencoes?.cp ?? ''}"></label>
              <label><span>&nbsp;</span><button type="button" id="ret-padrao">Sugerir retenções usuais</button></label>
            </div>
          </fieldset>
          ${empresa()?.op_simp_nac === 1 ? `<fieldset class="largo"><legend>Totais aproximados de tributos (Lei 12.741)</legend>
            <p class="dica">Obrigatório informar para empresa não optante do Simples. Use os percentuais do seu serviço (ex.: Federais 11,33 e Municipais 3,00).</p>
            <div class="grade">
              <label>Federais (%) <input name="tFed" data-num inputmode="decimal" value="${p.pTotTrib?.fed ?? ''}"></label>
              <label>Estaduais (%) <input name="tEst" data-num inputmode="decimal" value="${p.pTotTrib?.est ?? ''}"></label>
              <label>Municipais (%) <input name="tMun" data-num inputmode="decimal" value="${p.pTotTrib?.mun ?? ''}"></label>
            </div></fieldset>` : ''}
          ${empresa()?.ambiente === 1 && estado.usuario.papel !== 'cliente' ? '<label class="largo"><span><input type="checkbox" name="enviarEmail"> Enviar por e-mail ao cliente quando a nota for autorizada</span><span class="dica">Usa o e-mail do cadastro do cliente (e os de cobrança). Configure o servidor em E-mail.</span></label>' : ''}
          <label class="largo">Informações complementares <textarea name="infoComplementar" maxlength="2000">${esc(p.infoComplementar ?? '')}</textarea></label>
        </div>
      </fieldset>
      <p class="erro" id="erro-emitir" role="alert"></p>
      <div class="acoes"><button class="primario" type="submit" id="btn-emitir">${corrigindo ? 'Reenviar à Sefin' : 'Emitir nota'}</button></div>
    </form>`;

  const f = $('#form-emitir');
  if (!e.tem_certificado) f.querySelector('[type=submit]').disabled = true;
  if (p.tribISSQN) f.tribISSQN.value = p.tribISSQN;
  if (p.issRetido) f.issRetido.value = p.issRetido;

  f.servicoId.onchange = () => {
    const s = servicos.find((x) => x.id === Number(f.servicoId.value));
    if (!s) return;
    f.descricao.value = s.descricao;
    if (s.aliquota != null) f.aliquota.value = s.aliquota;
    if (s.valor_padrao) f.valor.value = s.valor_padrao;
    f.cTribNac.value = '';
  };
  $('#novo-tomador').onclick = () => formTomador(null, async (id) => { telaEmitir.prefTomador = id; await telaEmitir(notaIdCorrecao); $('#form-emitir').tomadorId.value = id; });

  // regra do cliente: nota / nota + boleto / só boleto
  const somaDias = (d, n) => new Date(d.getTime() + n * 86400e3);
  const vencPadrao = (t) => {
    const base = new Date(Date.now() - 3 * 3600e3);
    if (!t || t.vencimento_tipo !== 'DIA_FIXO') return somaDias(base, t?.vencimento_valor ?? 10).toISOString().slice(0, 10);
    const ult = (a, m) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
    let a = base.getUTCFullYear(), m = base.getUTCMonth(), dia = Math.min(t.vencimento_valor, ult(a, m));
    if (dia <= base.getUTCDate()) { m += 1; if (m > 11) { m = 0; a += 1; } dia = Math.min(t.vencimento_valor, ult(a, m)); }
    return new Date(Date.UTC(a, m, dia)).toISOString().slice(0, 10);
  };
  const aplicarModo = () => {
    const t = tomadores.find((x) => x.id === Number(f.tomadorId.value));
    const bloco = $('#bloco-cobranca');
    bloco.hidden = !t || !!corrigindo;
    if (!t || corrigindo) return;
    const acao = f.acao.value;
    const boleto = acao !== 'NOTA';
    bloco.querySelectorAll('[data-boleto]').forEach((x) => (x.hidden = !boleto));
    $('#dica-acao').textContent = `Padrão do cliente: ${NOME_MODO[t.modo_faturamento] ?? 'Nota'}.`;
    // só boleto: não há dados fiscais a preencher
    f.querySelectorAll('fieldset').forEach((fs) => { if (fs.querySelector('[name=tribISSQN]') && !fs.closest('fieldset#bloco-cobranca')) fs.hidden = acao === 'BOLETO'; });
    $('#btn-emitir').textContent = { NOTA: 'Emitir nota', NOTA_BOLETO: 'Emitir nota e boleto', BOLETO: 'Gerar boleto' }[acao];
  };
  f.tomadorId.addEventListener('change', () => {
    const t = tomadores.find((x) => x.id === Number(f.tomadorId.value));
    if (t) {
      f.acao.value = t.modo_faturamento ?? 'NOTA';
      f.vencimento.value = vencPadrao(t);
      if (f.enviarEmail) f.enviarEmail.checked = !!t.enviar_email_auto;
    }
    aplicarModo();
  });
  f.acao.addEventListener('change', aplicarModo);
  // vencimento em dia útil: antecipa fim de semana/feriado e avisa (o servidor repete a regra)
  let feriadosLocais = '';
  api('GET', `/api/empresas/${e.id}/feriados`).then((r) => { feriadosLocais = r.feriados_extra ?? ''; }).catch(() => {});
  const avisoVenc = document.createElement('span'); avisoVenc.className = 'dica'; f.vencimento?.after(avisoVenc);
  const conferirVenc = () => {
    avisoVenc.textContent = '';
    if (!f.vencimento?.value) return;
    const r = ajustarVencimento(f.vencimento.value, feriadosLocais);
    if (r.aviso) { f.vencimento.value = r.data; avisoVenc.textContent = r.aviso; }
  };
  f.vencimento?.addEventListener('change', conferirVenc);
  f.tomadorId.addEventListener('change', () => setTimeout(conferirVenc, 0));
  // Valor do boleto: acompanha o líquido da nota (mesma conta do servidor), até o usuário digitar outro valor
  let boletoManual = false;
  const sugerirBoleto = () => {
    if (boletoManual || !f.valorBoleto) return;
    const d = lerForm(f), r = d;
    const base = (d.valor ?? 0) - (d.descontoIncondicionado ?? 0);
    const iss = Number(d.issRetido) === 2 ? Math.round(base * (d.aliquota ?? 0)) / 100 : 0;
    const ret = (r.irrf ?? 0) + (r.cp ?? 0) + (r.csll ?? 0) + (r.pis ?? 0) + (r.cofins ?? 0) + iss;
    const liquido = f.acao.value === 'BOLETO' ? (d.valor ?? 0) : Math.round((base - ret) * 100) / 100;
    f.valorBoleto.value = liquido > 0 ? liquido.toFixed(2).replace('.', ',') : '';
  };
  f.valorBoleto?.addEventListener('input', () => { boletoManual = f.valorBoleto.value.trim() !== ''; if (!boletoManual) sugerirBoleto(); });
  f.addEventListener('input', (ev) => { if (ev.target !== f.valorBoleto) sugerirBoleto(); });
  f.addEventListener('change', (ev) => { if (ev.target !== f.valorBoleto) sugerirBoleto(); });
  if (f.tomadorId.value) f.tomadorId.dispatchEvent(new Event('change'));

  const recalcular = () => {
    const base = (lerForm(f).valor ?? 0) - (lerForm(f).descontoIncondicionado ?? 0);
    const preencher = (aliq, campo) => {
      const pc = lerForm(f)[aliq];
      f.elements[campo].value = pc ? (Math.round(base * pc) / 100).toFixed(2).replace('.', ',') : '';
    };
    preencher('pPis', 'pis'); preencher('pCofins', 'cofins'); preencher('pCsll', 'csll'); preencher('pIrrf', 'irrf');
  };
  ['pPis', 'pCofins', 'pCsll', 'pIrrf'].forEach((n) => f.elements[n].addEventListener('input', recalcular));
  $('#ret-padrao').onclick = () => {
    const pad = { pPis: '0,65', pCofins: '3,00', pCsll: '1,00', pIrrf: '1,50' };
    for (const k in pad) f.elements[k].value = pad[k];
    recalcular();
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = lerForm(f);
    const corpo = {
      empresaId: e.id,
      tomadorId: d.tomadorId ? Number(d.tomadorId) : null,
      servicoId: d.servicoId ? Number(d.servicoId) : null,
      competencia: d.competencia, descricao: d.descricao, valor: d.valor,
      descontoIncondicionado: d.descontoIncondicionado, cTribNac: d.cTribNac, municipioPrestacao: d.municipioPrestacao,
      aliquota: d.aliquota, tribISSQN: Number(d.tribISSQN), issRetido: Number(d.issRetido),
      retencoes: { irrf: d.irrf, cp: d.cp, csll: d.csll, pis: d.pis, cofins: d.cofins, pPis: d.pPis, pCofins: d.pCofins }, infoComplementar: d.infoComplementar,
      pTotTrib: empresa()?.op_simp_nac === 1 ? { fed: d.tFed, est: d.tEst, mun: d.tMun } : undefined,
    };
    const botao = f.querySelector('[type=submit]');
    botao.disabled = true; botao.textContent = 'Enviando à Sefin…';
    try {
      if (corrigindo) {
        const nota = await api('POST', `/api/notas/${corrigindo.id}/reenviar`, corpo);
        aviso(nota.status === 'AUTORIZADA' ? `NFS-e nº ${nota.n_nfse} autorizada.` : `A nota ficou ${STATUS[nota.status].toLowerCase()}. Veja o motivo.`);
        location.hash = `#/nota/${nota.id}`;
        return;
      }
      // um comando: nota → boleto → e-mail, conforme o cadastro do cliente
      const r = await api('POST', '/api/faturar', {
        ...corpo,
        acao: corpo.tomadorId ? d.acao : 'NOTA',
        vencimento: d.vencimento || null,
        valorBoleto: d.valorBoleto || null,
        enviarEmail: f.enviarEmail ? !!f.enviarEmail.checked : null,
      });
      const partes = [];
      if (r.nota) partes.push(r.nota.status === 'AUTORIZADA' ? `NFS-e nº ${r.nota.n_nfse} autorizada` : `a nota ficou ${STATUS[r.nota.status].toLowerCase()}`);
      if (r.cobranca) partes.push(`boleto de ${brl(r.cobranca.valor)} registrado (venc. ${dataBr(r.cobranca.vencimento)})`);
      if (r.email?.status === 'ENVIADO') partes.push(`e-mail enviado para ${r.email.para}`);
      if (r.email?.status === 'ERRO') partes.push(`e-mail não enviado: ${r.email.erro}`);
      aviso(partes.join(' · ').replace(/^./, (c) => c.toUpperCase()) + '.');
      location.hash = r.nota ? `#/nota/${r.nota.id}` : '#/cobrancas';
    } catch (err) {
      $('#erro-emitir').textContent = mensagemErro(err);
      botao.disabled = false; aplicarModo(); if (!botao.textContent || botao.textContent.endsWith('…')) botao.textContent = corrigindo ? 'Reenviar à Sefin' : 'Emitir nota';
      atualizarLicenca();
    }
  };
}

// ---------------------------------------------------------------------------
// Cobranças (boletos Ailos): boleto em PDF, remessa CNAB 240 e retorno
// ---------------------------------------------------------------------------
const STATUS_COBRANCA = {
  AGUARDANDO_BANCO: 'Pendente (sem boleto)', A_REMETER: 'Boleto pronto', REMETIDO: 'Enviado ao banco', REGISTRADO: 'Registrado no banco',
  REJEITADO: 'Rejeitado pelo banco', PAGO: 'Pago', CANCELADO: 'Cancelado',
};
async function telaCobrancas() {
  const [lista, remessas, conta] = await Promise.all([
    api('GET', `/api/empresas/${estado.empresaId}/cobrancas`),
    api('GET', `/api/empresas/${estado.empresaId}/remessas`),
    api('GET', `/api/empresas/${estado.empresaId}/conta-bancaria`),
  ]);
  const podeEditar = estado.usuario.papel !== 'cliente';
  const aberto = lista.filter((c) => !['CANCELADO', 'PAGO', 'REJEITADO'].includes(c.status)).reduce((a, c) => a + c.valor, 0);
  const aRemeter = lista.filter((c) => c.status === 'A_REMETER' || c.baixa_pendente === 1).length;
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Cobranças</h1><p class="sutil">${lista.length} registros · ${brl(aberto)} em aberto</p></div>
      ${podeEditar ? `<div class="acoes"><button id="gerar-remessa" class="primario" ${conta && aRemeter ? '' : 'disabled'}>Gerar remessa${aRemeter ? ` (${aRemeter})` : ''}</button>
        <button id="modelo-wa">Mensagem do WhatsApp</button>
        <button id="ler-retorno" ${conta ? '' : 'disabled'}>Importar retorno</button><input type="file" id="arq-retorno" accept=".ret,.RET,.txt,.TXT,.rem,.REM,*/*" hidden></div>` : ''}</div>
    ${conta ? '' : `<div class="banner teste">Os dados bancários (Ailos) desta empresa ainda não foram informados. <a href="#/banco">Informar agora</a> — os boletos pendentes são gerados automaticamente depois disso.</div>`}
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Vencimento</th><th>Cliente</th><th>Nota</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((c) => `<tr><td>${dataBr(c.vencimento)}${c.status !== 'PAGO' && c.status !== 'CANCELADO' && c.vencimento < hoje ? ' <span class="dica erro">vencido</span>' : ''}</td>
        <td>${esc(c.tomador_nome)}<br><span class="dica">${esc((c.descricao ?? '').slice(0, 60))}</span></td>
        <td>${c.nota_id ? `<a href="#/nota/${c.nota_id}">${c.n_nfse ?? '—'}</a>` : '—'}</td><td class="num">${brl(c.valor)}</td>
        <td>${STATUS_COBRANCA[c.status] ?? c.status}${c.baixa_pendente ? ' <span class="dica">(baixa solicitada)</span>' : ''}${c.pago_em ? `<br><span class="dica">em ${dataBr(c.pago_em)}</span>` : ''}${c.observacao_banco ? `<br><span class="dica erro">${esc(c.observacao_banco)}</span>` : ''}</td>
        <td class="acoes-linha">${c.nosso_numero ? `<button data-boleto="${c.id}">Boleto</button>` : ''}${c.status !== 'PAGO' && c.status !== 'CANCELADO' ? `<button data-wa="${c.id}">WhatsApp</button>` : ''}${podeEditar ? `<button data-reemitir="${c.id}">Reemitir</button>` : ''}${podeEditar && !['PAGO', 'CANCELADO'].includes(c.status) ? `<button data-pago="${c.id}">Marcar pago</button><button data-cancelar="${c.id}">Cancelar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhuma cobrança registrada. Escolha “Nota + boleto” ou “Somente o boleto” ao emitir.</div>'}
    ${remessas.length ? `<h2>Remessas geradas</h2><div class="rolagem"><table class="tabela"><thead><tr><th>Nº</th><th>Data</th><th>Títulos</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${remessas.map((r) => `<tr><td>${r.numero}</td><td>${esc(r.criado_em)}</td><td>${r.qtd_titulos}</td><td class="num">${brl(r.valor_total)}</td><td><button data-remessa="${r.id}" data-nome="${esc(r.nome_arquivo)}">Baixar arquivo</button></td></tr>`).join('')}</tbody></table></div>
      <p class="dica">Envie o arquivo no Ailos Conta Online: Cobrança Bancária → Arquivo de Cobrança. O arquivo de retorno fica no mesmo menu; importe-o aqui para dar baixa nos pagamentos.</p>` : ''}`;
  conteudo.querySelectorAll('[data-boleto]').forEach((b) => (b.onclick = () => baixar(`/api/cobrancas/${b.dataset.boleto}/boleto`, `Boleto_${b.dataset.boleto}.pdf`, true)));
  conteudo.querySelectorAll('[data-remessa]').forEach((b) => (b.onclick = () => baixar(`/api/remessas/${b.dataset.remessa}/arquivo`, b.dataset.nome)));
  conteudo.querySelectorAll('[data-pago]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Marcar este boleto como pago hoje?')) return;
    try { await api('POST', `/api/cobrancas/${b.dataset.pago}/pagar`, {}); telaCobrancas(); } catch (e) { aviso(mensagemErro(e)); }
  }));
  conteudo.querySelectorAll('[data-cancelar]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Cancelar este boleto? Se ele já foi enviado ao banco, a baixa vai na próxima remessa.')) return;
    try { const r = await api('POST', `/api/cobrancas/${b.dataset.cancelar}/cancelar`, {}); aviso(r.baixaNoBanco ? 'Baixa solicitada: gere uma nova remessa para o banco.' : 'Boleto cancelado.'); telaCobrancas(); } catch (e) { aviso(mensagemErro(e)); }
  }));
  // ---- WhatsApp de cobrança com modelo editável ----
  const aplicarModelo = (modelo, c) => modelo
    .replace(/\{cliente\}/g, c.tomador_nome).replace(/\{valor\}/g, brl(c.valor)).replace(/\{vencimento\}/g, dataBr(c.vencimento))
    .replace(/\{empresa\}/g, empresa()?.nome_fantasia || empresa()?.razao_social || '')
    .replace(/\{linha\}/g, c.linha_digitavel ? `\nLinha digitável: ${c.linha_digitavel}` : '');
  conteudo.querySelectorAll('[data-wa]').forEach((b) => (b.onclick = async () => {
    const c = lista.find((x) => x.id === Number(b.dataset.wa));
    const m = await api('GET', `/api/empresas/${estado.empresaId}/modelos-whatsapp`);
    const atrasado = c.vencimento < hoje;
    abrirDialogo(`
      <form id="form-wa"><h2>WhatsApp para ${esc(c.tomador_nome)}</h2>
        <p class="sutil">${atrasado ? 'Cobrança vencida: usando o modelo de atraso.' : 'Usando o modelo de lembrete.'} Revise o texto; o WhatsApp abre com a mensagem pronta e você só confirma o envio.</p>
        <label>WhatsApp do cliente (com DDD) <input name="fone" required value="${esc(c.tomador_fone ?? '')}" placeholder="(47) 99999-9999"></label>
        <label>Mensagem <textarea name="texto" rows="7">${esc(aplicarModelo(atrasado ? m.atraso : m.lembrete, c))}</textarea></label>
        <p class="erro" id="erro-wa"></p>
        <div class="acoes"><button class="primario" type="submit">Abrir WhatsApp</button>${c.nosso_numero ? '<button type="button" id="wa-pdf">Baixar boleto para anexar</button>' : ''}<button type="button" data-fechar>Fechar</button></div>
      </form>`, () => {
      const pdf = $('#wa-pdf'); if (pdf) pdf.onclick = () => baixar(`/api/cobrancas/${c.id}/boleto`, `Boleto_${c.id}.pdf`);
      $('#form-wa').onsubmit = (ev) => {
        ev.preventDefault();
        let num = ev.target.fone.value.replace(/\D/g, '');
        if (num.length === 10 || num.length === 11) num = '55' + num;
        if (num.length < 12 || num.length > 13) { $('#erro-wa').textContent = 'Número inválido. Informe DDD + número, por exemplo (47) 99999-9999.'; return; }
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(ev.target.texto.value)}`, '_blank');
      };
    });
  }));
  $('#modelo-wa').onclick = async () => {
    const m = await api('GET', `/api/empresas/${estado.empresaId}/modelos-whatsapp`);
    abrirDialogo(`
      <form id="form-modelo"><h2>Mensagens de cobrança por WhatsApp</h2>
        <p class="sutil">Campos que o sistema preenche sozinho: <code>{cliente}</code> <code>{valor}</code> <code>{vencimento}</code> <code>{empresa}</code> <code>{linha}</code> (linha digitável do boleto, quando existir).</p>
        <label>Lembrete (boleto ainda não vencido) <textarea name="lembrete" rows="5">${esc(m.lembrete)}</textarea></label>
        <label>Cobrança em atraso <textarea name="atraso" rows="5">${esc(m.atraso)}</textarea></label>
        <p class="erro" id="erro-modelo"></p>
        <div class="acoes"><button class="primario" type="submit">Salvar</button><button type="button" id="modelo-padrao">Voltar ao texto padrão</button><button type="button" data-fechar>Fechar</button></div>
      </form>`, (d) => {
      $('#modelo-padrao').onclick = () => { $('#form-modelo').lembrete.value = m.padrao.lembrete; $('#form-modelo').atraso.value = m.padrao.atraso; };
      $('#form-modelo').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('PUT', `/api/empresas/${estado.empresaId}/modelos-whatsapp`, { lembrete: ev.target.lembrete.value, atraso: ev.target.atraso.value }); d.close(); aviso('Mensagens salvas.'); }
        catch (e) { $('#erro-modelo').textContent = mensagemErro(e); }
      };
    });
  };

  // ---- Reemitir: nova cobrança com os mesmos dados e outro vencimento ----
  conteudo.querySelectorAll('[data-reemitir]').forEach((b) => (b.onclick = async () => {
    const c = lista.find((x) => x.id === Number(b.dataset.reemitir));
    const [a, m, dia] = c.vencimento.split('-').map(Number);
    const prox = new Date(Date.UTC(a, m, Math.min(dia, new Date(Date.UTC(a, m + 1, 0)).getUTCDate()))).toISOString().slice(0, 10);
    const sugerido = prox < hoje ? hoje : prox;
    const fer = await api('GET', `/api/empresas/${estado.empresaId}/feriados`).then((r) => r.feriados_extra).catch(() => '');
    abrirDialogo(`
      <form id="form-re"><h2>Reemitir boleto</h2>
        <p class="sutil">Gera uma nova cobrança para <strong>${esc(c.tomador_nome)}</strong> com a mesma descrição. Só o boleto: nenhuma nota é emitida.</p>
        <div class="grade">
          <label>Novo vencimento <input type="date" name="vencimento" required value="${sugerido}"></label>
          <label>Valor (R$) <input name="valor" data-num required inputmode="decimal" value="${String(c.valor).replace('.', ',')}"></label>
        </div>
        <p class="dica" id="aviso-re"></p><p class="erro" id="erro-re"></p>
        <div class="acoes"><button class="primario" type="submit">Gerar boleto</button><button type="button" data-fechar>Cancelar</button></div>
      </form>`, (d) => {
      const f = $('#form-re');
      f.vencimento.onchange = () => { const r = ajustarVencimento(f.vencimento.value, fer); if (r.aviso) { f.vencimento.value = r.data; $('#aviso-re').textContent = r.aviso; } else $('#aviso-re').textContent = ''; };
      f.vencimento.onchange();
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const v = lerForm(f);
        try {
          const r = await api('POST', `/api/cobrancas/${c.id}/reemitir`, { vencimento: v.vencimento, valor: v.valor });
          d.close(); aviso(`Novo boleto de ${brl(r.cobranca.valor)} com vencimento em ${dataBr(r.cobranca.vencimento)}.`); telaCobrancas();
        } catch (e) { $('#erro-re').textContent = mensagemErro(e); }
      };
    });
  }));

  const gr = $('#gerar-remessa');
  if (gr) gr.onclick = async () => {
    gr.disabled = true;
    try {
      const r = await api('POST', `/api/empresas/${estado.empresaId}/remessas`, {});
      await baixar(`/api/remessas/${r.id}/arquivo`, r.nome_arquivo);
      aviso(`Remessa ${r.numero} gerada: ${r.entradas} boleto(s) e ${r.baixas} baixa(s).`); telaCobrancas();
    } catch (e) { aviso(mensagemErro(e)); gr.disabled = false; }
  };
  const lr = $('#ler-retorno'), arq = $('#arq-retorno');
  if (lr) {
    lr.onclick = () => arq.click();
    arq.onchange = async () => {
      const f = arq.files[0]; if (!f) return;
      try {
        const r = await api('POST', `/api/empresas/${estado.empresaId}/retorno`, { conteudo: await f.text() });
        const partes = [r.pagos && `${r.pagos} pago(s)`, r.registrados && `${r.registrados} registrado(s)`, r.rejeitados && `${r.rejeitados} rejeitado(s)`, r.baixados && `${r.baixados} baixado(s)`].filter(Boolean);
        aviso(`Retorno processado: ${partes.join(', ') || 'sem alterações'}.${r.naoEncontrados.length ? ` ${r.naoEncontrados.length} título(s) não encontrados.` : ''}`);
        telaCobrancas();
      } catch (e) { aviso(mensagemErro(e)); }
    };
  }
}

// ---------------------------------------------------------------------------
// Dados bancários (convênio de cobrança Ailos)
// ---------------------------------------------------------------------------
async function telaBanco() {
  const c = (await api('GET', `/api/empresas/${estado.empresaId}/conta-bancaria`)) ?? { cooperativa_nome: 'Ailos', carteira: '01', multa_pct: 2, juros_pct_mes: 1 };
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Dados bancários</h1><p class="sutil">${esc(empresa().razao_social)} — cobrança Ailos (banco 085)</p></div></div>
    <form id="form-banco">
      <fieldset><legend>Conta e convênio de cobrança</legend><p class="dica">Peça estes dados à sua cooperativa: o número do convênio de cobrança e a carteira são informados por ela.</p><div class="grade">
        <label>Cooperativa <input name="cooperativa_nome" required maxlength="30" value="${esc(c.cooperativa_nome ?? '')}"></label>
        <label>Agência <input name="agencia" required inputmode="numeric" maxlength="5" value="${esc(c.agencia ?? '')}"></label>
        <label>Dígito da agência <input name="agencia_dv" required maxlength="1" value="${esc(c.agencia_dv ?? '')}"></label>
        <label>Conta corrente (sem dígito) <input name="conta" required inputmode="numeric" maxlength="7" value="${esc(c.conta ?? '')}"></label>
        <label>Dígito da conta <input name="conta_dv" required maxlength="1" value="${esc(c.conta_dv ?? '')}"></label>
        <label>Convênio de cobrança <input name="convenio" required inputmode="numeric" maxlength="6" value="${esc(c.convenio ?? '')}"></label>
        <label>Carteira <input name="carteira" required maxlength="2" value="${esc(c.carteira ?? '01')}"></label>
        <label>Formato do arquivo
          <select name="layout"><option value="CNAB400" ${c.layout !== 'CNAB240' ? 'selected' : ''}>CNAB 400 (padrão Ailos)</option><option value="CNAB240" ${c.layout === 'CNAB240' ? 'selected' : ''}>CNAB 240</option></select></label>
      </div></fieldset>
      <fieldset><legend>Numeração (para quem já emitia boletos em outro sistema)</legend>
        <p class="dica">O nosso número nunca pode repetir. Se esta conta já emitiu boletos antes do Kontor, informe aqui o <strong>próximo</strong> número livre (último usado + 1) e o número da próxima remessa. Depois que houver boletos emitidos, só é possível aumentar.</p>
        <div class="grade">
          <label>Próximo número de boleto <input name="proximo_boleto" type="number" min="1" value="${c.proximo_boleto ?? 1}"></label>
          <label>Número da próxima remessa <input name="proxima_remessa" type="number" min="1" value="${c.proxima_remessa ?? 1}"></label>
        </div></fieldset>
      <fieldset><legend>Encargos e mensagem do boleto</legend><div class="grade">
        <label>Multa após o vencimento (%) <input name="multa_pct" data-num inputmode="decimal" value="${String(c.multa_pct ?? 2).replace('.', ',')}"></label>
        <label>Juros ao mês (%) <input name="juros_pct_mes" data-num inputmode="decimal" value="${String(c.juros_pct_mes ?? 1).replace('.', ',')}"></label>
        <label class="largo">Instrução adicional (até 40 caracteres) <input name="instrucoes" maxlength="40" value="${esc(c.instrucoes ?? '')}"></label>
      </div></fieldset>
      <p class="erro" id="erro-banco" role="alert"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar dados bancários</button></div>
    </form>
    <form id="form-feriados" class="cartao" style="margin-top:20px">
      <h2 style="margin-top:0">Feriados locais</h2>
      <p class="dica">Boleto não vence em sábado, domingo nem feriado: o sistema antecipa para o dia útil anterior. Os feriados nacionais, o carnaval, a sexta-feira santa e o Corpus Christi já estão incluídos. Informe aqui os feriados do seu município (dia/mês, separados por vírgula).</p>
      <label>Feriados municipais <input name="feriados_extra" placeholder="ex.: 24/06, 19/03" value=""></label>
      <p class="erro" id="erro-feriados"></p>
      <div class="acoes"><button type="submit">Salvar feriados</button></div>
    </form>
`;
  api('GET', `/api/empresas/${estado.empresaId}/feriados`).then((r) => { $('#form-feriados').feriados_extra.value = r.feriados_extra ?? ''; }).catch(() => {});
  $('#form-feriados').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('PUT', `/api/empresas/${estado.empresaId}/feriados`, { feriados_extra: ev.target.feriados_extra.value }); aviso('Feriados salvos.'); }
    catch (e) { $('#erro-feriados').textContent = mensagemErro(e); }
  };
  const f = $('#form-banco');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = lerForm(f);
    try {
      await api('PUT', `/api/empresas/${estado.empresaId}/conta-bancaria`, { ...d, multa_pct: d.multa_pct ?? 0, juros_pct_mes: d.juros_pct_mes ?? 0, instrucoes: d.instrucoes || null, proximo_boleto: Number(d.proximo_boleto) || null, proxima_remessa: Number(d.proxima_remessa) || null });
      aviso('Dados bancários salvos.'); telaBanco();
    } catch (e) { $('#erro-banco').textContent = mensagemErro(e); }
  };
}

// ---------------------------------------------------------------------------
// Despesas e balanço
// ---------------------------------------------------------------------------
async function telaDespesas() {
  const mes = telaDespesas.mes ?? mesAtual();
  const base = `/api/empresas/${estado.empresaId}`;
  const [d, fin] = await Promise.all([api('GET', `${base}/despesas?mes=${mes}`), api('GET', `${base}/painel?mes=${mes}`).catch(() => null)]);
  const total = d.despesas.reduce((t, x) => t + x.valor, 0);
  const porCat = Object.entries(d.despesas.reduce((a, x) => ({ ...a, [x.categoria]: (a[x.categoria] ?? 0) + x.valor }), {})).sort((a, b) => b[1] - a[1]);
  const bal = fin?.balanco.at(-1);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Despesas e balanço</h1><p class="sutil">Receitas = boletos pagos no mês. Despesas = o que você lançar aqui.</p></div>
      <label>Mês <input type="month" id="mes-desp" value="${mes}"></label></div>
    ${bal ? `<div class="resumo">
      <div class="cartao"><div class="sutil">Receitas</div><div class="valor" style="color:${COR.verde}">${compacto(bal.receitas)}</div></div>
      <div class="cartao"><div class="sutil">Despesas</div><div class="valor" style="color:${COR.vermelho}">${compacto(bal.despesas)}</div><div class="dica">${d.despesas.length} lançamento(s)</div></div>
      <div class="cartao"><div class="sutil">Resultado</div><div class="valor" style="color:${bal.resultado < 0 ? COR.vermelho : COR.verde}">${compacto(bal.resultado)}</div><div class="dica">${bal.receitas ? 'margem de ' + Math.round(bal.resultado / bal.receitas * 100) + '%' : 'sem receitas no mês'}</div></div>
    </div>
    <div class="duas-colunas">
      <div class="cartao"><h2 style="margin-top:0">Últimos 6 meses</h2>
        ${graficoBarras(fin.balanco.map((x) => x.mes), [{ cor: COR.verde, valores: fin.balanco.map((x) => x.receitas) }, { cor: COR.vermelho, valores: fin.balanco.map((x) => x.despesas) }], 5)}
        ${legenda([[COR.verde, 'Receitas'], [COR.vermelho, 'Despesas']])}</div>
      <div class="cartao"><h2 style="margin-top:0">Resultado por mês</h2>
        <table class="tabela"><thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th class="num">Resultado</th></tr></thead><tbody>
        ${[...fin.balanco].reverse().map((x) => `<tr><td>${nomeMes(x.mes)}</td><td class="num">${brl(x.receitas)}</td><td class="num">${brl(x.despesas)}</td><td class="num" style="color:${x.resultado < 0 ? COR.vermelho : COR.verde}">${brl(x.resultado)}</td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}
    <div class="topo"><h2>Lançamentos de ${nomeMes(mes)} <span class="sutil">· ${brl(total)}</span></h2>
      <div><button id="cats">Categorias</button> <button class="primario" id="nova-desp">Lançar despesa</button></div></div>
    ${d.despesas.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${d.despesas.map((x) => `<tr><td>${dataBr(x.data)}</td><td>${esc(x.categoria)}</td><td>${esc(x.descricao ?? '')}</td><td class="num">${brl(x.valor)}</td>
        <td class="acoes-linha"><button data-ed="${x.id}">Editar</button> <button data-ex="${x.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>
      ${porCat.length > 1 ? `<p class="sutil">Por categoria: ${porCat.map(([c, v]) => `${esc(c)} ${brl(v)}`).join(' · ')}</p>` : ''}` : '<div class="vazio">Nenhuma despesa lançada neste mês.</div>'}`;
  $('#mes-desp').onchange = (ev) => { telaDespesas.mes = ev.target.value || mesAtual(); telaDespesas(); };
  const formDespesa = (x) => abrirDialogo(`
    <form id="form-desp"><h2>${x ? 'Editar despesa' : 'Lançar despesa'}</h2>
      <div class="grade">
        <label>Data <input type="date" name="data" required value="${x?.data ?? (mes === mesAtual() ? hoje() : mes + '-01')}"></label>
        <label>Valor (R$) <input name="valor" data-num required inputmode="decimal" value="${x ? String(x.valor).replace('.', ',') : ''}"></label>
        <label>Categoria <input name="categoria" required list="lista-cat" value="${esc(x?.categoria ?? '')}"><datalist id="lista-cat">${d.categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label>Descrição <input name="descricao" maxlength="200" value="${esc(x?.descricao ?? '')}"></label>
      </div>
      <p class="erro" id="erro-desp"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (dlg) => {
    $('#form-desp').onsubmit = async (ev) => {
      ev.preventDefault();
      const v = lerForm(ev.target);
      try {
        const corpo = { data: v.data, categoria: v.categoria, descricao: v.descricao, valor: v.valor };
        if (x) await api('PUT', `${base}/despesas/${x.id}`, corpo); else await api('POST', `${base}/despesas`, corpo);
        dlg.close(); telaDespesas();
      } catch (e) { $('#erro-desp').textContent = mensagemErro(e); }
    };
  });
  $('#nova-desp').onclick = () => formDespesa(null);
  conteudo.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => formDespesa(d.despesas.find((x) => x.id === Number(b.dataset.ed)))));
  conteudo.querySelectorAll('[data-ex]').forEach((b) => (b.onclick = () => abrirDialogo(`
    <form id="form-ex"><h2>Excluir despesa?</h2><p>Esta ação não pode ser desfeita.</p>
      <div class="acoes"><button class="primario" type="submit">Excluir</button><button type="button" data-fechar>Cancelar</button></div></form>`, (dlg) => {
    $('#form-ex').onsubmit = async (ev) => { ev.preventDefault(); await api('DELETE', `${base}/despesas/${b.dataset.ex}`); dlg.close(); telaDespesas(); };
  })));
  $('#cats').onclick = () => abrirDialogo(`
    <form id="form-cats"><h2>Categorias de despesa</h2>
      <p class="sutil">Uma por linha. Despesas já lançadas não mudam.</p>
      <label><textarea name="cats" rows="10">${esc(d.categorias.join('\n'))}</textarea></label>
      <p class="erro" id="erro-cats"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar</button><button type="button" data-fechar>Fechar</button></div></form>`, (dlg) => {
    $('#form-cats').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('PUT', `${base}/despesas-categorias`, { categorias: ev.target.cats.value.split('\n') }); dlg.close(); telaDespesas(); }
      catch (e) { $('#erro-cats').textContent = mensagemErro(e); }
    };
  });
}

// ---------------------------------------------------------------------------
// Licença
// ---------------------------------------------------------------------------
async function atualizarLicenca() {
  const el = $('#licenca-info');
  try {
    const s = await api('GET', '/api/licenca');
    estado.licenca = s;
    if (s.estado === 'livre') { el.hidden = true; return s; }
    el.hidden = false;
    el.className = 'licenca-info' + (!s.permitido ? ' bloqueada' : s.aviso ? ' aviso' : '');
    el.textContent = !s.permitido ? 'Licença: emissão bloqueada' : s.estado === 'teste' ? `Teste: ${s.diasRestantes} dia(s)` : `Licença até ${dataBr(s.ate)}`;
    return s;
  } catch { return null; }
}

async function telaLicenca() {
  const s = await atualizarLicenca() ?? await api('GET', '/api/licenca');
  const admin = estado.usuario.papel === 'admin';
  const titulo = { livre: 'Sem controle de licença', teste: 'Período de teste', ativa: 'Licença ativa', vencida: 'Licença vencida', relogio: 'Data do computador incorreta' }[s.estado];
  corpoConfig().innerHTML = `
    <div class="topo"><div><h1>Licença</h1><p class="sutil">${titulo}</p></div></div>
    <div class="banner ${s.permitido && !s.aviso ? '' : 'teste'}">${esc(s.mensagem)}</div>
    ${s.cliente ? `<p>Licenciado para <strong>${esc(s.cliente)}</strong>.</p>` : ''}
    ${s.estado === 'livre' ? '' : `
    <fieldset><legend>Código deste computador</legend>
      <p class="dica">Para renovar, envie este código ao suporte. Você receberá um código de ativação válido apenas neste computador.</p>
      <p><span class="codigo-copia" id="cod-pc">${esc(s.codigoComputador)}</span> <button type="button" id="copiar-cod">Copiar</button></p>
    </fieldset>
    <fieldset><legend>Inserir código de ativação</legend>
      ${admin ? `<form id="form-lic"><label>Código recebido <textarea name="codigo" required placeholder="KG1.…"></textarea></label>
        <p class="erro" id="erro-lic"></p><div class="acoes"><button class="primario" type="submit">Ativar</button></div></form>` : '<p class="dica">Peça a um administrador para inserir o código.</p>'}
    </fieldset>
    <p class="dica">Com a licença vencida, apenas a emissão é bloqueada: consultas, downloads de PDF/XML e backup continuam funcionando.</p>`}`;
  const copiar = $('#copiar-cod');
  if (copiar) copiar.onclick = async () => { try { await navigator.clipboard.writeText(s.codigoComputador); aviso('Código copiado.'); } catch { aviso('Selecione o código e copie com Ctrl+C.'); } };
  const fl = $('#form-lic');
  if (fl) fl.onsubmit = async (ev) => {
    ev.preventDefault();
    try { await api('POST', '/api/licenca', { codigo: fl.codigo.value.trim() }); aviso('Licença ativada.'); telaLicenca(); }
    catch (e) { $('#erro-lic').textContent = mensagemErro(e); }
  };
}

// ---------------------------------------------------------------------------
// Notas emitidas e detalhe
// ---------------------------------------------------------------------------

async function telaNotas() {
  const f = telaNotas.filtros ??= { mes: mesAtual(), status: '', q: '' };
  const qs = new URLSearchParams({ empresaId: estado.empresaId, ...(f.mes && { mes: f.mes }), ...(f.status && { status: f.status }), ...(f.q && { q: f.q }) });
  const notas = await api('GET', `/api/notas?${qs}`);
  const total = notas.filter((n) => n.status === 'AUTORIZADA').reduce((a, n) => a + n.valor_servico, 0);
  conteudo.innerHTML = `
    <div class="topo">
      <div><h1>Notas emitidas</h1><p class="sutil">${notas.length} notas · ${brl(total)} autorizados</p></div>
      <form class="filtros" id="filtros">
        <label>Competência <input type="month" name="mes" value="${f.mes}"></label>
        <label>Situação <select name="status"><option value="">Todas</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Buscar <input name="q" placeholder="Tomador ou nº da nota" value="${esc(f.q)}"></label>
        <button type="submit">Filtrar</button>
        <button type="button" id="lote" ${notas.some((n) => n.chave_acesso) ? '' : 'disabled'}>Baixar em lote</button>
      </form>
    </div>
    ${notas.length ? `<div class="rolagem"><table class="tabela"><thead><tr>
      <th>Nº NFS-e</th><th>DPS</th><th>Competência</th><th>Tomador</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
      ${notas.map((n) => `<tr class="clicavel" data-id="${n.id}"><td>${n.n_nfse ?? '—'}</td><td>${n.serie}/${n.n_dps}</td><td>${dataBr(n.competencia)}</td>
        <td>${esc(n.tomador_nome ?? 'Não identificado')}<br><span class="dica">${esc(n.descricao.slice(0, 70))}</span></td>
        <td class="num">${brl(n.valor_servico)}</td><td>${carimbo(n.status)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhuma nota com esses filtros. <a href="#/emitir">Emitir nota</a></div>'}`;
  $('#filtros').onsubmit = (ev) => { ev.preventDefault(); telaNotas.filtros = lerForm(ev.target); for (const k in telaNotas.filtros) telaNotas.filtros[k] ??= ''; telaNotas(); };
  conteudo.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => (location.hash = `#/nota/${tr.dataset.id}`)));
  $('#lote').onclick = () => abrirDialogo(`
    <form id="form-lote"><h2>Baixar notas em lote</h2>
      <p class="sutil">Gera um arquivo ZIP com as notas emitidas de ${esc(empresa()?.razao_social ?? '')}${f.mes ? ` na competência ${f.mes.split('-').reverse().join('/')}` : ''}${f.status ? ` (situação filtrada)` : ''}.</p>
      <label>Conteúdo <select name="formato"><option value="ambos">XML e PDF</option><option value="xml">Só XML</option><option value="pdf">Só PDF</option></select></label>
      <p class="erro" id="erro-lote"></p>
      <div class="acoes"><button class="primario" type="submit">Baixar ZIP</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    $('#form-lote').onsubmit = async (ev) => {
      ev.preventDefault();
      const botao = ev.target.querySelector('[type=submit]');
      botao.disabled = true; botao.textContent = 'Gerando…';
      const p = new URLSearchParams({ empresaId: estado.empresaId, formato: ev.target.formato.value, ...(f.mes && { mes: f.mes }), ...(f.status && { status: f.status }) });
      try { await baixar(`/api/notas-lote?${p}`, `notas-${f.mes || 'todas'}.zip`); d.close(); }
      catch (er) { $('#erro-lote').textContent = mensagemErro(er); botao.disabled = false; botao.textContent = 'Baixar ZIP'; }
    };
  });
}

async function telaNota(id) {
  const n = await api('GET', `/api/notas/${id}`);
  const p = n.payload;
  const podeCancelar = n.status === 'AUTORIZADA' && estado.usuario.papel !== 'cliente';
  conteudo.innerHTML = `
    <div class="topo"><div>
      <h1>${n.n_nfse ? `NFS-e nº ${n.n_nfse}` : `DPS ${n.serie}/${n.n_dps}`}</h1>
      ${carimbo(n.status, true)}
    </div><a href="#/notas">Voltar para a lista</a></div>
    ${n.ambiente === 2 ? '<div class="banner teste">Emitida em produção restrita (sem valor fiscal).</div>' : ''}
    ${n.status === 'ERRO_COMUNICACAO' ? '<div class="banner teste">A Sefin não respondeu. A nota pode ter sido gerada: use "Consultar na Sefin" antes de reenviar. O reenvio usa o mesmo número de DPS, então não duplica.</div>' : ''}
    ${n.erros.length ? `<h2>Motivo${n.erros.length > 1 ? 's' : ''} da recusa</h2><ul class="lista-erros">${n.erros.map((e) => `<li><strong>${esc(e.codigo)}</strong> ${esc(e.descricao)}${e.complemento ? ` <span class="dica">${esc(e.complemento)}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${n.alertas.length ? `<h2>Alertas da Sefin</h2><ul>${n.alertas.map((a) => `<li>${esc(a.Descricao ?? a.descricao ?? JSON.stringify(a))}</li>`).join('')}</ul>` : ''}
    <div class="acoes">
      ${n.chave_acesso ? `<button class="primario" id="b-pdf">Abrir DANFSe</button><button id="b-xml">Baixar XML</button><button id="b-portal">Consultar no portal nacional</button>${estado.usuario.papel !== 'cliente' && n.ambiente === 1 ? `<button id="b-email">Enviar por e-mail${n.status === 'CANCELADA' ? ' (aviso de cancelamento)' : ''}</button><button id="b-whats">Enviar por WhatsApp</button>` : ''}` : ''}
      ${['REJEITADA', 'ERRO_COMUNICACAO', 'PENDENTE'].includes(n.status) ? `<a href="#/emitir/${n.id}"><button type="button">Corrigir e reenviar</button></a><button id="b-reenviar">Reenviar sem alterar</button>` : ''}
      ${n.status === 'ERRO_COMUNICACAO' ? '<button id="b-consultar">Consultar na Sefin</button>' : ''}
      ${podeCancelar ? '<button class="perigo" id="b-cancelar">Cancelar nota</button>' : ''}
    </div>
    <h2>Dados</h2>
    <dl class="dados">
      <dt>Chave de acesso</dt><dd>${n.chave_acesso ?? '—'}</dd>
      <dt>Id da DPS</dt><dd>${n.id_dps}</dd>
      <dt>Competência</dt><dd>${dataBr(n.competencia)}</dd>
      <dt>Tomador</dt><dd>${esc(n.tomador_nome ?? 'Não identificado')} ${fmtDoc(n.tomador_documento)}</dd>
      <dt>Descrição</dt><dd>${esc(n.descricao)}</dd>
      <dt>Valor do serviço</dt><dd>${brl(n.valor_servico)}</dd>
      <dt>Alíquota ISSQN</dt><dd>${p.aliquota != null ? p.aliquota + '%' : '—'}</dd>
      <dt>Criada em</dt><dd>${dhBr(n.criado_em)}</dd>
      ${n.autorizada_em ? `<dt>Autorizada em</dt><dd>${dhBr(n.autorizada_em)}</dd>` : ''}
      ${n.cancelada_em ? `<dt>Cancelada em</dt><dd>${dhBr(n.cancelada_em)}</dd>` : ''}
    </dl>
    ${n.emails?.length ? `<h2>E-mails enviados</h2><ul>${n.emails.map((m) => `<li>${dhBr(m.criado_em)} — ${esc(m.para)}: ${m.status === 'ENVIADO' ? 'enviado' : '<span class="pendente-txt">falhou</span> ' + esc(m.erro ?? '')}</li>`).join('')}</ul>` : ''}
    ${n.eventos.length ? `<h2>Eventos</h2><ul>${n.eventos.map((e) => `<li>${dhBr(e.criado_em)} — ${e.tipo}: ${e.status} (${esc(e.motivo ?? '')})</li>`).join('')}</ul>` : ''}`;

  $('#b-pdf') && ($('#b-pdf').onclick = () => baixar(`/api/notas/${id}/danfse`, `DANFSe_${n.n_nfse}.pdf`, true));
  $('#b-email') && ($('#b-email').onclick = () => abrirDialogo(`
    <form id="form-email"><h2>${n.status === 'CANCELADA' ? 'Avisar o cancelamento da' : 'Enviar'} NFS-e nº ${n.n_nfse} por e-mail</h2>
      <p class="sutil">Vão em anexo o PDF (DANFSe) e o XML${n.status === 'CANCELADA' ? ' (nota e cancelamento)' : ''}. Separe vários e-mails com vírgula (até 5).</p>
      <label>Para <input name="para" required placeholder="cliente@empresa.com.br" value="${esc(n.tomador_email ?? '')}"></label>
      <p class="erro" id="erro-email"></p>
      <div class="acoes"><button class="primario" type="submit">Enviar</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    $('#form-email').onsubmit = async (ev) => {
      ev.preventDefault();
      const botao = ev.target.querySelector('[type=submit]');
      botao.disabled = true; botao.textContent = 'Enviando…';
      try {
        await api('POST', `/api/notas/${id}/email`, { para: ev.target.para.value.split(/[,;\s]+/).filter(Boolean), tipo: n.status === 'CANCELADA' ? 'cancelamento' : 'emissao' });
        d.close(); aviso('E-mail enviado.'); telaNota(id);
      } catch (er) { $('#erro-email').textContent = mensagemErro(er); botao.disabled = false; botao.textContent = 'Enviar'; }
    };
  }));
  $('#b-whats') && ($('#b-whats').onclick = () => {
    const link = `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${n.chave_acesso}`;
    const nome = n.empresa_nome?.nome_fantasia || n.empresa_nome?.razao_social || '';
    const texto = n.status === 'CANCELADA'
      ? `Olá${n.tomador_nome ? ', ' + n.tomador_nome : ''}! A NFS-e nº ${n.n_nfse} emitida por ${nome} (${brl(n.valor_servico)}) foi *cancelada* e não tem mais validade. Consulta: ${link}`
      : `Olá${n.tomador_nome ? ', ' + n.tomador_nome : ''}! Segue a NFS-e nº ${n.n_nfse} emitida por ${nome} (${brl(n.valor_servico)}, competência ${dataBr(n.competencia)}). Para ver e baixar o PDF e o XML: ${link}`;
    abrirDialogo(`
      <form id="form-whats"><h2>Enviar NFS-e nº ${n.n_nfse} por WhatsApp</h2>
        <p class="sutil">O WhatsApp abre com a mensagem pronta; você só confirma o envio. O link leva o cliente à nota no portal nacional (PDF e XML). Para mandar o PDF como anexo, baixe-o aqui e anexe na conversa.</p>
        <div class="grade">
          <label>Celular do cliente (com DDD) <input name="fone" required inputmode="tel" placeholder="(47) 99999-9999" value="${esc(n.tomador_fone ?? '')}"></label>
          <label class="largo">Mensagem <textarea name="texto" rows="5">${esc(texto)}</textarea></label>
        </div>
        <p class="erro" id="erro-whats"></p>
        <div class="acoes"><button class="primario" type="submit">Abrir WhatsApp</button><button type="button" id="w-pdf">Baixar PDF para anexar</button><button type="button" data-fechar>Fechar</button></div>
      </form>`, (d) => {
      $('#w-pdf').onclick = () => baixar(`/api/notas/${id}/danfse`, `DANFSe_${n.n_nfse}.pdf`);
      $('#form-whats').onsubmit = (ev) => {
        ev.preventDefault();
        let num = ev.target.fone.value.replace(/\D/g, '');
        if (num.startsWith('0')) num = num.replace(/^0+/, '');
        if (!(num.startsWith('55') && num.length >= 12)) num = '55' + num;
        if (num.length < 12 || num.length > 13) { $('#erro-whats').textContent = 'Número inválido. Informe DDD + número, por exemplo (47) 99999-9999.'; return; }
        window.open(`https://wa.me/${num}?text=${encodeURIComponent(ev.target.texto.value)}`, '_blank');
      };
    });
  });
  $('#b-portal') && ($('#b-portal').onclick = () => window.open(`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${n.chave_acesso}`, '_blank'));
  $('#b-xml') && ($('#b-xml').onclick = () => baixar(`/api/notas/${id}/xml`, `NFSe_${n.n_nfse}.xml`));
  const acao = (sel, url, ok) => $(sel) && ($(sel).onclick = async (ev) => {
    ev.target.disabled = true;
    try { const r = await api('POST', url, {}); aviso(ok(r)); telaNota(id); } catch (e) { aviso(mensagemErro(e)); ev.target.disabled = false; }
  });
  acao('#b-reenviar', `/api/notas/${id}/reenviar`, (r) => `Situação: ${STATUS[r.status]}.`);
  acao('#b-consultar', `/api/notas/${id}/reconciliar`, (r) => (r.status === 'AUTORIZADA' ? 'A nota já havia sido gerada e foi recuperada.' : 'A Sefin não tem NFS-e para esta DPS. Pode reenviar.'));
  $('#b-cancelar') && ($('#b-cancelar').onclick = () => abrirDialogo(`
    <form id="form-cancelar"><h2>Cancelar NFS-e nº ${n.n_nfse}</h2>
      <p class="sutil">O cancelamento é registrado na Sefin e não pode ser desfeito. Fora do prazo do seu município, ele pode exigir análise da prefeitura.</p>
      <div class="grade">
        <label>Motivo <select name="cMotivo"><option value="1">Erro na emissão</option><option value="2">Serviço não prestado</option><option value="9">Outros</option></select></label>
        <label class="largo">Justificativa <textarea name="xMotivo" required minlength="15" maxlength="255"></textarea></label>
        ${n.tomador_email && n.ambiente === 1 ? `<label class="largo"><span><input type="checkbox" name="avisar" checked> Avisar o tomador por e-mail (${esc(n.tomador_email)})</span></label>` : ''}
      </div>
      <p class="erro" id="erro-cancelar"></p>
      <div class="acoes"><button class="perigo" type="submit">Cancelar nota</button><button type="button" data-fechar>Voltar</button></div>
    </form>`, (d) => {
    $('#form-cancelar').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try {
        await api('POST', `/api/notas/${id}/cancelar`, { cMotivo: Number(f.cMotivo.value), xMotivo: f.xMotivo.value });
        d.close();
        let msg = 'Nota cancelada.';
        if (f.avisar?.checked) {
          try { await api('POST', `/api/notas/${id}/email`, { para: [n.tomador_email], tipo: 'cancelamento' }); msg += ` Aviso enviado para ${n.tomador_email}.`; }
          catch (e2) { msg += ` O e-mail de aviso não foi enviado: ${mensagemErro(e2)}`; }
        }
        aviso(msg); telaNota(id);
      }
      catch (e) { $('#erro-cancelar').textContent = mensagemErro(e); }
    };
  }));
}

/**
 * Consulta de CNPJ na Receita Federal (via servidor): preenche os campos ainda vazios do formulário.
 * modo 'empresa' também ajusta o regime (MEI / Simples / não optante) quando a base informa.
 */
function ligarConsultaCnpj(form, modo) {
  const btn = form.querySelector('[data-buscar-cnpj]');
  const info = form.querySelector('[data-cnpj-info]');
  const nomeCampo = modo === 'empresa' ? 'razao_social' : 'nome';
  const limpo = () => form.documento.value.replace(/[^0-9A-Za-z]/g, '');
  const dicaPadrao = info.textContent;

  const buscar = async () => {
    if (limpo().length !== 14) { info.className = 'dica erro'; info.textContent = 'O CNPJ tem 14 caracteres.'; return; }
    btn.disabled = true; info.className = 'dica'; info.textContent = 'Consultando a Receita Federal…';
    try {
      const d = await api('GET', `/api/consulta/cnpj/${limpo()}`);
      const preencher = (campo, valor) => { const el = form[campo]; if (el && valor && !el.value.trim()) el.value = valor; };
      preencher(nomeCampo, d.razao_social);
      preencher('nome_fantasia', d.nome_fantasia);
      preencher('email', d.email);
      preencher('fone', d.fone);
      preencher('cep', d.cep);
      preencher('cod_municipio', d.cod_municipio);
      preencher('uf', d.uf);
      preencher('cidade', d.municipio);
      preencher('logradouro', d.logradouro);
      preencher('numero', d.numero);
      preencher('complemento', d.complemento);
      preencher('bairro', d.bairro);
      if (modo === 'tomador' && form.tipo_doc) form.tipo_doc.value = 'CNPJ';
      if (modo === 'empresa' && d.op_simp_nac && form.op_simp_nac) { form.op_simp_nac.value = d.op_simp_nac; form.op_simp_nac.onchange?.(); }
      const mun = form.querySelector('[data-municipio]');
      if (mun && d.municipio) mun.textContent = `${d.municipio}/${d.uf}${d.cod_municipio ? ' — IBGE ' + d.cod_municipio : ''}`;
      const regime = d.op_simp_nac ? ['', 'Não optante', 'MEI', 'Simples ME/EPP'][d.op_simp_nac] : null;
      const faltas = [!d.cod_municipio && 'código IBGE', !d.logradouro && 'logradouro', !d.numero && 'número', modo === 'empresa' && 'inscrição municipal (não consta na Receita)'].filter(Boolean);
      info.className = d.ativa ? 'dica' : 'dica erro';
      info.textContent = `Receita Federal: ${d.situacao ?? 'situação não informada'}${regime ? ' · ' + regime : ''}.${d.ativa ? '' : ' Atenção: o CNPJ não está ativo.'}${faltas.length ? ' Confira: ' + faltas.join(', ') + '.' : ''}`;
    } catch (e) {
      info.className = 'dica erro'; info.textContent = e.message;
    } finally { btn.disabled = false; }
  };
  btn.onclick = buscar;
  // ao sair do campo com um CNPJ completo e o nome ainda vazio, busca sozinho
  form.documento.addEventListener('blur', () => { if (limpo().length === 14 && !form[nomeCampo].value.trim()) buscar(); });
  form.documento.addEventListener('input', () => { if (info.className !== 'dica') { info.className = 'dica'; info.textContent = dicaPadrao; } });
}

// ---------------------------------------------------------------------------
// Tomadores
// ---------------------------------------------------------------------------

const NOME_MODO = { NOTA: 'Nota', NOTA_BOLETO: 'Nota + boleto', BOLETO: 'Só boleto' };
function formTomador(t, aoSalvar) {
  t ??= { tipo_doc: 'CNPJ', modo_faturamento: 'NOTA', vencimento_tipo: 'PRAZO', vencimento_valor: 10, enviar_email_auto: 0 };
  abrirDialogo(`
    <form id="form-tomador"><h2>${t.id ? 'Editar cliente' : 'Novo cliente'}</h2>
      <fieldset class="sub"><legend>Identificação</legend><div class="grade">
        <label>Tipo <select name="tipo_doc">${['CNPJ', 'CPF', 'SEM'].map((v) => `<option value="${v}" ${t.tipo_doc === v ? 'selected' : ''}>${v === 'SEM' ? 'Sem documento' : v}</option>`).join('')}</select></label>
        <label>CNPJ / CPF <span class="linha-campo"><input name="documento" value="${esc(t.documento ?? '')}"><button type="button" data-buscar-cnpj>Buscar CNPJ</button></span><span class="dica" data-cnpj-info>Digite o CNPJ e clique em Buscar para preencher os dados.</span></label>
        <label class="largo">Nome / Razão social <input name="nome" required value="${esc(t.nome ?? '')}"></label>
        <label>Inscrição municipal <input name="inscricao_municipal" value="${esc(t.inscricao_municipal ?? '')}"></label>
      </div></fieldset>
      <fieldset class="sub"><legend>Contato</legend><div class="grade">
        <label>E-mail principal <input name="email" type="email" value="${esc(t.email ?? '')}"></label>
        <label>Telefone / WhatsApp <input name="fone" value="${esc(t.fone ?? '')}"></label>
      </div></fieldset>
      <fieldset class="sub"><legend>Endereço</legend><div class="grade">
        <label>CEP <input name="cep" value="${esc(t.cep ?? '')}"><span class="dica" data-municipio></span></label>
        <label>Município (IBGE) <input name="cod_municipio" maxlength="7" value="${esc(t.cod_municipio ?? '')}"></label>
        <label>Cidade <input name="cidade" maxlength="60" value="${esc(t.cidade ?? '')}"></label>
        <label>UF <input name="uf" maxlength="2" value="${esc(t.uf ?? '')}"></label>
        <label class="largo">Logradouro <input name="logradouro" value="${esc(t.logradouro ?? '')}"></label>
        <label>Número <input name="numero" value="${esc(t.numero ?? '')}"></label>
        <label>Complemento <input name="complemento" value="${esc(t.complemento ?? '')}"></label>
        <label>Bairro <input name="bairro" value="${esc(t.bairro ?? '')}"></label>
      </div><p class="dica">Endereço é opcional; se preencher, informe CEP, município, logradouro e bairro.</p></fieldset>
      <fieldset class="sub"><legend>Faturamento e cobrança</legend><div class="grade">
        <label class="largo">O que emitir para este cliente
          <select name="modo_faturamento">
            <option value="NOTA" ${t.modo_faturamento === 'NOTA' ? 'selected' : ''}>Somente a nota fiscal</option>
            <option value="NOTA_BOLETO" ${t.modo_faturamento === 'NOTA_BOLETO' ? 'selected' : ''}>Nota fiscal + boleto</option>
            <option value="BOLETO" ${t.modo_faturamento === 'BOLETO' ? 'selected' : ''}>Somente o boleto</option>
          </select></label>
        <label data-cobranca>Vencimento do boleto
          <select name="vencimento_tipo"><option value="PRAZO" ${t.vencimento_tipo === 'PRAZO' ? 'selected' : ''}>Dias após a emissão</option><option value="DIA_FIXO" ${t.vencimento_tipo === 'DIA_FIXO' ? 'selected' : ''}>Dia fixo do mês</option></select></label>
        <label data-cobranca><span data-rotulo-venc>Quantidade de dias</span> <input name="vencimento_valor" data-num type="number" min="0" max="60" value="${t.vencimento_valor ?? 10}"></label>
        <label class="largo" data-cobranca>E-mails extras para cobrança <input name="email_cobranca" placeholder="financeiro@cliente.com, outro@cliente.com" value="${esc(t.email_cobranca ?? '')}"><span class="dica">Separe por vírgula. Recebem junto com o e-mail principal.</span></label>
        <label class="largo"><span><input type="checkbox" name="enviar_email_auto" ${t.enviar_email_auto ? 'checked' : ''}> Enviar por e-mail automaticamente ao emitir</span><span class="dica">Só em produção. A nota é enviada logo após ser autorizada.</span></label>
      </div><p class="dica" data-aviso-banco>O boleto ainda não está ligado a um banco: ele fica registrado como “aguardando banco” até a integração ser ativada.</p></fieldset>
      <p class="erro" id="erro-tomador"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar cliente</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-tomador');
    f.cep.onblur = () => buscarCep(f);
    ligarConsultaCnpj(f, 'tomador');
    const ajustar = () => {
      const comBoleto = f.modo_faturamento.value !== 'NOTA';
      f.querySelectorAll('[data-cobranca]').forEach((x) => (x.hidden = !comBoleto));
      f.querySelector('[data-aviso-banco]').hidden = !comBoleto;
      f.querySelector('[data-rotulo-venc]').textContent = f.vencimento_tipo.value === 'PRAZO' ? 'Quantidade de dias' : 'Dia do mês (1 a 31)';
    };
    f.modo_faturamento.onchange = f.vencimento_tipo.onchange = ajustar; ajustar();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const corpo = lerForm(f);
        corpo.enviar_email_auto = f.enviar_email_auto.checked;
        corpo.vencimento_valor = Number(f.vencimento_valor.value || 0);
        corpo.cidade = f.cidade.value.trim() || null; corpo.uf = f.uf.value.trim().toUpperCase() || null;
        corpo.email_cobranca = f.email_cobranca.value.trim() || null;
        const r = t.id ? await api('PUT', `/api/tomadores/${t.id}`, corpo) : await api('POST', `/api/empresas/${estado.empresaId}/tomadores`, corpo);
        d.close(); aviso('Cliente salvo.');
        aoSalvar?.(t.id ?? r.id);
      } catch (e) { $('#erro-tomador').textContent = mensagemErro(e); }
    };
  });
}

async function telaTomadores() {
  const lista = await api('GET', `/api/empresas/${estado.empresaId}/tomadores`);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Clientes (tomadores)</h1><p class="sutil">Clientes de ${esc(empresa().razao_social)}.</p></div>
      <button class="primario" id="novo">Cadastrar cliente</button></div>
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Documento</th><th>E-mail</th><th>Faturamento</th></tr></thead><tbody>
      ${lista.map((t, i) => `<tr class="clicavel" data-i="${i}"><td>${esc(t.nome)}</td><td>${fmtDoc(t.documento)}</td><td>${esc(t.email ?? '')}</td><td>${NOME_MODO[t.modo_faturamento] ?? 'Nota'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhum tomador cadastrado.</div>'}`;
  $('#novo').onclick = () => formTomador(null, telaTomadores);
  conteudo.querySelectorAll('tr[data-i]').forEach((tr) => (tr.onclick = () => formTomador(lista[tr.dataset.i], telaTomadores)));
}

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------

let tabelaServicosNac = null;
const semAcento = (v) => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Busca na Lista Nacional de Serviços (Anexo B do SN-NFS-e) e preenche código + descrição sugerida. */
function ligarBuscaServicos(f) {
  const busca = $('#busca-serv'), lista = $('#res-serv');
  const carregar = async () => {
    if (tabelaServicosNac) return tabelaServicosNac;
    try {
      const r = await fetch('/servicos-nacionais.json');
      tabelaServicosNac = (await r.json()).map((o) => ({ ...o, _k: semAcento(`${o.c} ${o.i} ${o.t} ${o.s} ${o.g}`) }));
    } catch { tabelaServicosNac = []; }
    return tabelaServicosNac;
  };
  const mostrar = async () => {
    const termos = semAcento(busca.value).split(/\s+/).filter(Boolean);
    if (!termos.length) { lista.hidden = true; return; }
    const achados = (await carregar()).filter((o) => termos.every((t) => o._k.includes(t))).slice(0, 30);
    lista.innerHTML = achados.length
      ? achados.map((o) => `<li data-c="${o.c}"><b>${o.c}</b> <span class="sutil">item ${o.i}</span><br>${esc(o.t)}${o.s && o.s !== o.t ? `<br><small class="sutil">${esc(o.s)}</small>` : ''}</li>`).join('')
      : '<li class="sutil">Nenhum serviço encontrado.</li>';
    lista.hidden = false;
  };
  busca.oninput = mostrar;
  lista.onclick = (ev) => {
    const li = ev.target.closest('li[data-c]');
    if (!li) return;
    const o = tabelaServicosNac.find((x) => x.c === li.dataset.c);
    f.elements.c_trib_nac.value = o.c;
    if (!f.elements.descricao.value.trim()) f.elements.descricao.value = o.t;
    if (!f.elements.nome.value.trim()) f.elements.nome.value = o.t.replace(/\.$/, '').slice(0, 80);
    busca.value = `${o.c} — ${o.t}`;
    lista.hidden = true;
  };
}

let tabelaNbs = null;
function ligarBuscaNbs(f) {
  const busca = $('#busca-nbs'), lista = $('#res-nbs');
  const mostrar = async () => {
    const termos = semAcento(busca.value).split(/\s+/).filter(Boolean);
    if (!termos.length) { lista.hidden = true; return; }
    if (!tabelaNbs) {
      try { tabelaNbs = (await (await fetch('/nbs.json')).json()).map((o) => ({ ...o, _k: semAcento(`${o.c} ${o.t}`) })); } catch { tabelaNbs = []; }
    }
    const achados = tabelaNbs.filter((o) => termos.every((t) => o._k.includes(t))).slice(0, 30);
    lista.innerHTML = achados.length
      ? achados.map((o) => `<li data-c="${o.c}"><b>${o.c}</b><br>${esc(o.t)}</li>`).join('')
      : '<li class="sutil">Nenhum NBS encontrado.</li>';
    lista.hidden = false;
  };
  busca.oninput = mostrar;
  lista.onclick = (ev) => {
    const li = ev.target.closest('li[data-c]');
    if (!li) return;
    f.elements.c_nbs.value = li.dataset.c;
    busca.value = `${li.dataset.c} — ${tabelaNbs.find((x) => x.c === li.dataset.c).t}`;
    lista.hidden = true;
  };
}

function formServico(s) {
  s ??= {};
  const ib = s.ibscbs ?? {};
  abrirDialogo(`
    <form id="form-servico"><h2>${s.id ? 'Editar serviço' : 'Novo serviço'}</h2>
      <div class="busca-servico">
        <label>Buscar na lista nacional de serviços (338 códigos)
          <input id="busca-serv" type="search" autocomplete="off" placeholder="Digite o código ou parte da descrição: contab, software, 17.19…"></label>
        <ul id="res-serv" class="res-serv" hidden></ul>
      </div>
      <div class="grade">
        <label class="largo">Nome interno <input name="nome" required placeholder="Ex.: Honorários contábeis mensais" value="${esc(s.nome ?? '')}"></label>
        <label class="largo">Descrição padrão na nota <textarea name="descricao" required>${esc(s.descricao ?? '')}</textarea></label>
        <label>Código de tributação nacional <input name="c_trib_nac" required placeholder="171901" value="${esc(s.c_trib_nac ?? '')}">
          <span class="dica">6 dígitos: item, subitem e desdobro da LC 116</span></label>
        <label>Código municipal <input name="c_trib_mun" maxlength="3" value="${esc(s.c_trib_mun ?? '')}"><span class="dica">Só se o município usar desdobro</span></label>
        <label class="largo">Buscar NBS (lista oficial) <input id="busca-nbs" type="search" autocomplete="off" placeholder="Digite parte da descrição: asseio, limpeza, contabilidade…"></label>
        <ul id="res-nbs" class="res-serv largo" hidden></ul>
        <label>Código NBS <input name="c_nbs" maxlength="9" pattern="\\d{9}" placeholder="9 dígitos" value="${esc(s.c_nbs ?? '')}"><span class="dica">Obrigatório quando informar IBS/CBS</span></label>
        <label>Alíquota ISSQN (%) <input name="aliquota" data-num value="${s.aliquota ?? ''}"></label>
        <label>Valor padrão (R$) <input name="valor_padrao" data-num value="${s.valor_padrao ?? ''}"></label>
      </div>
      <fieldset style="margin-top:16px"><legend>IBS/CBS (regime regular)</legend>
        <p class="dica">Preencha apenas para empresas fora do Simples Nacional, conforme a tabela de classificação tributária vigente.</p>
        <div class="grade">
          <label><span><input type="checkbox" name="usaIbs" ${s.ibscbs ? 'checked' : ''}> Informar grupo IBS/CBS</span></label>
          <label>Indicador da operação (cIndOp) <input name="cIndOp" maxlength="6" value="${esc(ib.cIndOp ?? '')}"></label>
          <label>CST <input name="cst" maxlength="3" pattern="\\d{3}" placeholder="000" value="${esc(ib.cst ?? '')}"><span class="dica">3 dígitos (000 = tributação integral)</span></label>
          <label>Classificação (cClassTrib) <input name="cClassTrib" maxlength="6" pattern="\\d{6}" placeholder="000001" value="${esc(ib.cClassTrib ?? '')}"><span class="dica">6 dígitos</span></label>
          <label>Consumidor final <select name="indFinal"><option value="0">Não</option><option value="1" ${ib.indFinal === 1 ? 'selected' : ''}>Sim</option></select></label>
          <label>Destinatário <select name="indDest"><option value="0">O próprio tomador</option><option value="1" ${ib.indDest === 1 ? 'selected' : ''}>Outro</option></select></label>
        </div>
      </fieldset>
      <p class="erro" id="erro-servico"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar serviço</button>
        ${s.id ? '<button type="button" class="perigo" id="excluir">Desativar</button>' : ''}<button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-servico');
    ligarBuscaServicos(f);
    ligarBuscaNbs(f);
    $('#excluir') && ($('#excluir').onclick = async () => { await api('DELETE', `/api/servicos/${s.id}`); d.close(); telaServicos(); });
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const x = lerForm(f);
      const corpo = {
        nome: x.nome, descricao: x.descricao, c_trib_nac: x.c_trib_nac, c_trib_mun: x.c_trib_mun, c_nbs: x.c_nbs,
        aliquota: x.aliquota, valor_padrao: x.valor_padrao,
        ibscbs: x.usaIbs ? { cIndOp: x.cIndOp, cst: x.cst, cClassTrib: x.cClassTrib, indFinal: Number(x.indFinal), indDest: Number(x.indDest) } : null,
      };
      try {
        s.id ? await api('PUT', `/api/servicos/${s.id}`, corpo) : await api('POST', `/api/empresas/${estado.empresaId}/servicos`, corpo);
        d.close(); aviso('Serviço salvo.'); telaServicos();
      } catch (e) { $('#erro-servico').textContent = mensagemErro(e); }
    };
  });
}

async function telaServicos() {
  const lista = await api('GET', `/api/empresas/${estado.empresaId}/servicos`);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Serviços</h1><p class="sutil">Modelos com código de tributação e alíquota, para emitir em poucos cliques.</p></div>
      <button class="primario" id="novo">Cadastrar serviço</button></div>
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Código nacional</th><th>NBS</th><th class="num">Alíquota</th><th class="num">Valor padrão</th></tr></thead><tbody>
      ${lista.map((s, i) => `<tr class="clicavel" data-i="${i}"><td>${esc(s.nome)}</td><td>${s.c_trib_nac}${s.c_trib_mun ? ' / ' + s.c_trib_mun : ''}</td><td>${s.c_nbs ?? ''}</td>
        <td class="num">${s.aliquota != null ? s.aliquota + '%' : '—'}</td><td class="num">${s.valor_padrao ? brl(s.valor_padrao) : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Cadastre os serviços que esta empresa presta.</div>'}`;
  $('#novo').onclick = () => formServico();
  conteudo.querySelectorAll('tr[data-i]').forEach((tr) => (tr.onclick = () => formServico(lista[tr.dataset.i])));
}

// ---------------------------------------------------------------------------
// Empresas e certificados
// ---------------------------------------------------------------------------

function formEmpresa(e) {
  e ??= { op_simp_nac: 3, reg_ap_trib_sn: 1, reg_esp_trib: 0, ambiente: 2, serie: '1' };
  abrirDialogo(`
    <form id="form-empresa"><h2>${e.id ? 'Editar empresa' : 'Nova empresa'}</h2>
      <div class="grade">
        <label>CNPJ / CPF <span class="linha-campo"><input name="documento" required value="${esc(e.documento ?? '')}"><button type="button" data-buscar-cnpj>Buscar CNPJ</button></span><span class="dica" data-cnpj-info>Digite o CNPJ e clique em Buscar para preencher os dados.</span></label>
        <label class="largo">Razão social <input name="razao_social" required value="${esc(e.razao_social ?? '')}"></label>
        <label>Nome fantasia <input name="nome_fantasia" value="${esc(e.nome_fantasia ?? '')}"></label>
        <label>Inscrição municipal <input name="inscricao_municipal" value="${esc(e.inscricao_municipal ?? '')}"></label>
        <label>CEP (para achar o município) <input name="cep"><span class="dica" data-municipio></span></label>
        <label>Município (IBGE) <input name="cod_municipio" required maxlength="7" value="${esc(e.cod_municipio ?? '')}"></label>
        <label>UF <input name="uf" maxlength="2" value="${esc(e.uf ?? '')}"></label>
        <label>E-mail <input name="email" type="email" value="${esc(e.email ?? '')}"></label>
        <label>Simples Nacional <select name="op_simp_nac" data-num>
          <option value="3">Optante ME/EPP</option><option value="2">MEI</option><option value="1">Não optante</option></select></label>
        <label>Apuração no Simples <select name="reg_ap_trib_sn" data-num>
          <option value="1">Tributos federais e municipal pelo SN</option><option value="2">Federais pelo SN, ISSQN fora</option><option value="3">Federais e ISSQN fora do SN</option></select></label>
        <label>Regime especial <select name="reg_esp_trib" data-num>
          <option value="0">Nenhum</option><option value="1">Ato cooperado</option><option value="2">Estimativa</option><option value="3">Microempresa municipal</option>
          <option value="4">Notário ou registrador</option><option value="5">Profissional autônomo</option><option value="6">Sociedade de profissionais</option></select></label>
        <label>% aproximado de tributos (Simples) <input name="p_tot_trib_sn" data-num value="${e.p_tot_trib_sn ?? ''}"><span class="dica">Lei 12.741 — opcional</span></label>
        <label>Ambiente <select name="ambiente" data-num><option value="2">Produção restrita (testes)</option><option value="1">Produção</option></select></label>
        <label>Série da DPS <input name="serie" maxlength="5" value="${esc(e.serie)}"></label>
      </div>
      <p class="erro" id="erro-empresa"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar empresa</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-empresa');
    for (const c of ['op_simp_nac', 'reg_ap_trib_sn', 'reg_esp_trib', 'ambiente']) if (e[c] != null) f[c].value = e[c];
    f.cep.onblur = () => buscarCep(f);
    ligarConsultaCnpj(f, 'empresa');
    const sn = () => (f.reg_ap_trib_sn.disabled = f.op_simp_nac.value !== '3');
    f.op_simp_nac.onchange = sn; sn();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const corpo = lerForm(f);
      delete corpo.cep;
      if (corpo.ambiente === 1 && e.ambiente !== 1 && !confirm('Mudar para PRODUÇÃO? As próximas notas terão valor fiscal.')) return;
      try {
        e.id ? await api('PUT', `/api/empresas/${e.id}`, corpo) : await api('POST', '/api/empresas', corpo);
        d.close(); aviso('Empresa salva.'); await carregarEmpresas(); telaEmpresas();
      } catch (er) { $('#erro-empresa').textContent = mensagemErro(er); }
    };
  });
}

function formLogo(e) {
  abrirDialogo(`
    <form id="form-logo"><h2>Logo — ${esc(e.razao_social)}</h2>
      <p class="sutil">Aparece no cabeçalho do PDF (DANFSe) das notas desta empresa. PNG ou JPG, até 1 MB; fundo claro/transparente funciona melhor.</p>
      <label>Imagem <input type="file" name="arquivo" accept="image/png,image/jpeg" ${e.tem_logo ? '' : 'required'}></label>
      <p class="erro" id="erro-logo"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar logo</button>
        ${e.tem_logo ? '<button type="button" class="perigo" id="rm-logo">Remover logo</button>' : ''}<button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const pronto = async (msg) => { d.close(); aviso(msg); await carregarEmpresas(); telaEmpresas(); };
    $('#rm-logo') && ($('#rm-logo').onclick = async () => { await api('DELETE', `/api/empresas/${e.id}/logo`); pronto('Logo removida.'); });
    $('#form-logo').onsubmit = async (ev) => {
      ev.preventDefault();
      const arq = ev.target.arquivo.files[0];
      if (!arq) return d.close();
      const fd = new FormData(); fd.append('arquivo', arq);
      try { await api('POST', `/api/empresas/${e.id}/logo`, fd); pronto('Logo salva.'); }
      catch (er) { $('#erro-logo').textContent = mensagemErro(er); }
    };
  });
}

function formCertificado(e) {
  abrirDialogo(`
    <form id="form-cert"><h2>Certificado A1 — ${esc(e.razao_social)}</h2>
      <p class="sutil">Arquivo .pfx ou .p12 do e-CNPJ. Ele é guardado criptografado e usado apenas para assinar e transmitir as notas desta empresa.</p>
      <div class="grade">
        <label class="largo">Arquivo <input type="file" name="arquivo" accept=".pfx,.p12" required></label>
        <label>Senha do certificado <input type="password" name="senha" required autocomplete="off"></label>
      </div>
      <p class="erro" id="erro-cert"></p>
      <div class="acoes"><button class="primario" type="submit">Enviar certificado</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    $('#form-cert').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const fd = new FormData();
      fd.append('senha', f.senha.value);
      fd.append('arquivo', f.arquivo.files[0]);
      try {
        const r = await api('POST', `/api/empresas/${e.id}/certificado`, fd);
        d.close(); aviso(`Certificado de ${r.titular} válido até ${new Date(r.validade).toLocaleDateString('pt-BR')}.`);
        await carregarEmpresas(); telaEmpresas();
      } catch (er) { $('#erro-cert').textContent = mensagemErro(er); }
    };
  });
}

async function telaEmpresas() {
  await carregarEmpresas();
  const lista = estado.empresas;
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Empresas</h1><p class="sutil">Prestadores que emitem pelo escritório. Cada um com seu certificado A1.</p></div>
      <button class="primario" id="novo">Cadastrar empresa</button></div>
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Empresa</th><th>Documento</th><th>Regime</th><th>Ambiente</th><th>Certificado</th><th></th></tr></thead><tbody>
      ${lista.map((e, i) => `<tr><td>${esc(e.razao_social)}</td><td>${fmtDoc(e.documento)}</td><td>${['', 'Não optante', 'MEI', 'Simples ME/EPP'][e.op_simp_nac]}</td>
        <td>${e.ambiente === 1 ? 'Produção' : 'Testes'}</td><td>${e.tem_certificado ? `até ${dataBr(e.cert_validade)}` : '<span class="pendente-txt">Falta enviar</span>'}</td>
        <td><button data-editar="${i}">Editar</button> <button data-cert="${i}">Certificado</button> <button data-logo="${i}">${e.tem_logo ? 'Logo ✓' : 'Logo'}</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Cadastre a primeira empresa cliente do escritório.</div>'}`;
  $('#novo').onclick = () => formEmpresa();
  conteudo.querySelectorAll('[data-editar]').forEach((b) => (b.onclick = () => formEmpresa(lista[b.dataset.editar])));
  conteudo.querySelectorAll('[data-cert]').forEach((b) => (b.onclick = () => formCertificado(lista[b.dataset.cert])));
  conteudo.querySelectorAll('[data-logo]').forEach((b) => (b.onclick = () => formLogo(lista[b.dataset.logo])));
}

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Configurações (usuários e acessos, e-mail, backup, licença, atualizações)
// ---------------------------------------------------------------------------

const corpoConfig = () => $('#cfg-corpo') ?? conteudo;

async function telaConfig(aba) {
  const adm = estado.usuario.tipo === 'adm';
  const abas = [
    ['conta', 'Minha conta', true], ['usuarios', 'Usuários e acessos', adm], ['email', 'E-mail', adm],
    ['backup', 'Backup', adm], ['licenca', 'Licença', true], ['atualizacoes', 'Atualizações', true],
  ].filter((x) => x[2]);
  if (!abas.some((x) => x[0] === aba)) aba = abas[0][0];
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Configurações</h1><p class="sutil">Ajustes gerais do sistema${adm ? '' : ' e da sua conta'}.</p></div></div>
    <nav class="abas" aria-label="Configurações">${abas.map(([k, nome]) => `<a href="#/config/${k}" class="${k === aba ? 'ativo' : ''}">${nome}</a>`).join('')}</nav>
    <div id="cfg-corpo"></div>`;
  const tela = { conta: telaMinhaConta, usuarios: telaUsuarios, email: telaEmail, backup: telaBackup, licenca: telaLicenca, atualizacoes: telaAtualizacoes }[aba];
  await tela();
}

function telaMinhaConta() {
  const u = estado.usuario;
  corpoConfig().innerHTML = `
    <h2>Minha conta</h2>
    <div class="cartao">
      <p><strong>${esc(u.nome)}</strong> · usuário <strong>${esc(u.login)}</strong></p>
      <p class="sutil">Perfil: ${u.tipo === 'adm' ? 'Administrador (acesso total)' : 'Normal'}${u.email ? ' · ' + esc(u.email) : ' · sem e-mail cadastrado (a recuperação de senha por e-mail não fica disponível)'}</p>
      ${u.tipo === 'adm' ? '' : `<p class="sutil">Funcionalidades liberadas: ${u.modulos.length ? u.modulos.map((m) => esc(u.todosModulos[m])).join(', ') : 'nenhuma'}.</p>`}
      <div class="acoes"><button class="primario" id="alterar-senha">Alterar minha senha</button></div>
    </div>`;
  $('#alterar-senha').onclick = () => trocarSenha();
}

async function telaAtualizacoes() {
  const ponte = window.nfseDesktop;
  const st = await fetch('/api/setup/status').then((r) => r.json()).catch(() => ({}));
  const desc = (e) => {
    if (!e || e.situacao === 'nunca') return 'Ainda não verificado nesta sessão.';
    if (e.situacao === 'nova') return `Nova versão ${e.versao} disponível.`;
    if (e.situacao === 'erro') return e.erro;
    if (e.situacao === 'nao_configurado') return 'Atualização automática não configurada.';
    if (e.situacao === 'sem_release') return 'Nenhuma versão publicada ainda.';
    if (e.situacao === 'sem_instalador') return `A versão ${e.versao} foi publicada, mas o instalador ainda não está disponível. Tente de novo em alguns minutos.`;
    return 'Você está na versão mais recente.';
  };
  corpoConfig().innerHTML = `
    <h2>Atualizações</h2>
    <div class="cartao">
      <p>Versão instalada: <strong>${esc(st.versao ?? '')}</strong></p>
      ${ponte?.verificarAtualizacao ? `
        <p class="sutil">O sistema procura versões novas sozinho ao abrir, a cada hora e quando você volta à janela. Quando houver uma, aparece um aviso no topo da tela.</p>
        <p id="atu-status" class="sutil">Consultando…</p>
        <div class="acoes"><button class="primario" id="atu-verificar">Verificar agora</button><button id="atu-instalar" hidden>Atualizar agora</button></div>`
        : '<p class="sutil">A busca automática de atualizações funciona no aplicativo instalado no Windows. Neste modo de uso, a atualização é feita com o instalador novo.</p>'}
    </div>`;
  if (!ponte?.verificarAtualizacao) return;
  const mostrar = (e) => {
    $('#atu-status').textContent = desc(e) + (e?.em ? ` (verificado às ${new Date(e.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : '');
    $('#atu-instalar').hidden = e?.situacao !== 'nova';
  };
  mostrar(await ponte.estadoAtualizacao().catch(() => null));
  $('#atu-verificar').onclick = async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Verificando…';
    try { mostrar(await ponte.verificarAtualizacao()); } catch { $('#atu-status').textContent = 'Não foi possível verificar agora.'; }
    ev.target.disabled = false; ev.target.textContent = 'Verificar agora';
  };
  $('#atu-instalar').onclick = async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Baixando…';
    const r = await ponte.instalarAtualizacao();
    if (!r?.ok) { ev.target.disabled = false; ev.target.textContent = 'Atualizar agora'; aviso(r?.erro ?? 'Não foi possível atualizar agora.'); }
  };
}

async function telaUsuarios() {
  const lista = await api('GET', '/api/usuarios');
  const nomeEmpresa = (id) => esc(estado.empresas.find((e) => e.id === Number(id))?.razao_social ?? id);
  corpoConfig().innerHTML = `
    <div class="topo"><div><h2>Usuários e acessos</h2>
      <p class="sutil"><strong>Administrador</strong> tem acesso total e redefine senhas. <strong>Normal</strong> acessa só as funcionalidades marcadas para ele.</p></div>
      <button class="primario" id="novo">Adicionar usuário</button></div>
    <div class="rolagem"><table class="tabela"><thead><tr><th>Usuário</th><th>Nome</th><th>Perfil</th><th>Acessos</th><th>Empresas</th><th></th></tr></thead><tbody>
      ${lista.map((x) => `<tr class="${x.ativo ? '' : 'inativo'}"><td><strong>${esc(x.login)}</strong>${x.mestre ? ' <span class="sutil">(master Kontor)</span>' : ''}${x.ativo ? '' : ' <span class="sutil">(inativo)</span>'}</td>
        <td>${esc(x.nome)}${x.email ? `<br><span class="sutil">${esc(x.email)}</span>` : ''}</td>
        <td>${x.tipo === 'adm' ? 'Administrador' : 'Normal'}${x.trocar_senha ? '<br><span class="sutil">senha provisória</span>' : ''}</td>
        <td>${x.tipo === 'adm' ? 'Tudo' : x.modulos.length ? x.modulos.map((m) => esc(estado.usuario.todosModulos[m])).join(', ') : '—'}</td>
        <td>${x.tipo !== 'adm' && x.empresas ? x.empresas.split(',').map(nomeEmpresa).join(', ') : 'Todas'}</td>
        <td class="acoes-linha">${x.mestre ? '' : `<button data-editar="${x.id}">Editar</button> <button data-reset="${x.id}">Redefinir senha</button>`}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('#novo').onclick = () => formUsuario(null, lista);
  corpoConfig().querySelectorAll('[data-editar]').forEach((b) => (b.onclick = () => formUsuario(lista.find((x) => x.id === Number(b.dataset.editar)), lista)));
  corpoConfig().querySelectorAll('[data-reset]').forEach((b) => (b.onclick = () => {
    const x = lista.find((y) => y.id === Number(b.dataset.reset));
    abrirDialogo(`<form id="form-reset"><h2>Redefinir senha</h2>
      <p>A senha de <strong>${esc(x.login)}</strong> (${esc(x.nome)}) voltará para a senha padrão <strong>Kontor2026</strong> e a pessoa terá de criar uma nova no próximo acesso. Ela será desconectada agora.</p>
      <p class="erro" id="erro-reset"></p>
      <div class="acoes"><button class="primario" type="submit">Redefinir</button><button type="button" data-fechar>Cancelar</button></div></form>`, (d) => {
      $('#form-reset').onsubmit = async (ev) => {
        ev.preventDefault();
        try { await api('POST', `/api/usuarios/${x.id}/redefinir-senha`, {}); d.close(); aviso(`Senha de ${x.login} redefinida para a senha padrão.`); telaUsuarios(); }
        catch (e) { $('#erro-reset').textContent = mensagemErro(e); }
      };
    });
  }));
}

function formUsuario(x, lista) {
  const novo = !x;
  const modulos = estado.usuario.todosModulos;
  const marcado = (m) => (x ? x.modulos.includes(m) : ['painel', 'emitir', 'notas'].includes(m));
  const vinculadas = new Set((x?.empresas ?? '').split(',').filter(Boolean).map(Number));
  abrirDialogo(`
    <form id="form-usuario"><h2>${novo ? 'Novo usuário' : 'Editar usuário'}</h2>
      <div class="grade">
        <label>Usuário (login) <input name="login" required minlength="3" maxlength="30" pattern="[A-Za-z0-9._\-]+" style="text-transform:uppercase" ${novo ? '' : 'disabled'} value="${esc(x?.login ?? '')}">
          <span class="dica">${novo ? 'Definido agora e não muda depois. Sem espaços nem acentos; fica em MAIÚSCULAS.' : 'O usuário não pode ser alterado.'}</span></label>
        <label>Nome <input name="nome" required value="${esc(x?.nome ?? '')}"></label>
        <label>E-mail <input name="email" type="email" value="${esc(x?.email ?? '')}"><span class="dica">Necessário para o "esqueci minha senha".</span></label>
        <label>Perfil <select name="tipo"><option value="normal" ${x?.tipo !== 'adm' ? 'selected' : ''}>Normal (acessos marcados abaixo)</option><option value="adm" ${x?.tipo === 'adm' ? 'selected' : ''}>Administrador (acesso total)</option></select></label>
        ${novo ? '<label>Senha inicial <input name="senha" type="password" minlength="8" autocomplete="new-password"><span class="dica">Em branco = senha padrão Kontor2026, e a pessoa será obrigada a trocá-la no primeiro acesso.</span></label>' : `<label class="largo"><span><input type="checkbox" name="ativo" ${x.ativo ? 'checked' : ''}> Usuário ativo (desmarque para bloquear o acesso)</span></label>`}
      </div>
      <fieldset id="grupo-modulos" style="margin-top:16px"><legend>Funcionalidades liberadas</legend>
        ${Object.entries(modulos).map(([k, nome]) => `<label><span><input type="checkbox" name="mod" value="${k}" ${marcado(k) ? 'checked' : ''}> ${esc(nome)}</span></label>`).join('')}
        <p class="dica">Configurações (usuários, e-mail, backup, ativação de licença) são sempre exclusivas de administradores.</p>
      </fieldset>
      <fieldset id="grupo-empresas" style="margin-top:12px"><legend>Empresas que este usuário pode acessar</legend>
        ${estado.empresas.map((e) => `<label><span><input type="checkbox" name="emp" value="${e.id}" ${vinculadas.has(e.id) ? 'checked' : ''}> ${esc(e.razao_social)}</span></label>`).join('')}
        <p class="dica">Sem nenhuma marcada, o usuário enxerga todas as empresas.</p>
      </fieldset>
      <p class="erro" id="erro-usuario"></p>
      <div class="acoes"><button class="primario" type="submit">${novo ? 'Adicionar usuário' : 'Salvar'}</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-usuario');
    const ajustar = () => { const adm = f.tipo.value === 'adm'; $('#grupo-modulos').hidden = adm; $('#grupo-empresas').hidden = adm; };
    f.tipo.onchange = ajustar; ajustar();
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const permissoes = [...f.querySelectorAll('[name=mod]:checked')].map((c) => c.value);
      const empresas = [...f.querySelectorAll('[name=emp]:checked')].map((c) => Number(c.value));
      try {
        if (novo) {
          const r = await api('POST', '/api/usuarios', { login: f.login.value.trim().toUpperCase(), nome: f.nome.value, email: f.email.value, senha: f.senha.value, tipo: f.tipo.value, permissoes, empresas });
          aviso(r.senhaPadrao ? 'Usuário criado com a senha padrão Kontor2026 (troca obrigatória no primeiro acesso).' : 'Usuário criado.');
        } else {
          await api('PUT', `/api/usuarios/${x.id}`, { nome: f.nome.value, email: f.email.value, tipo: f.tipo.value, permissoes, empresas, ativo: f.ativo.checked });
          aviso('Usuário atualizado.');
        }
        d.close(); telaUsuarios();
      } catch (e) { $('#erro-usuario').textContent = mensagemErro(e); }
    };
  });
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const PROVEDORES = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true, dica: 'Gmail: ative a verificação em duas etapas e crie uma "senha de app" em myaccount.google.com/apppasswords. Use essa senha aqui, não a senha normal.' },
  outlook: { host: 'smtp.office365.com', port: 587, secure: false, dica: 'Outlook/Microsoft 365: use uma senha de aplicativo (ou habilite SMTP autenticado na conta).' },
  outro: { host: '', port: 587, secure: false, dica: 'Peça ao provedor do e-mail (ou ao responsável pelo domínio) o servidor SMTP, a porta e o tipo de segurança.' },
};

async function telaEmail() {
  const c = (await api('GET', '/api/email/config')) ?? { host: '', port: 587, secure: false, usuario: '', remetente_nome: estado.usuario.nome ? '' : '', remetente_email: '' };
  corpoConfig().innerHTML = `
    <div class="topo"><div><h1>E-mail</h1><p class="sutil">Servidor usado para enviar a NFS-e (PDF e XML) ao tomador. A senha fica criptografada neste computador.</p></div></div>
    <form id="form-smtp" class="cartao">
      <div class="grade">
        <label>Provedor <select id="provedor"><option value="gmail">Gmail</option><option value="outlook">Outlook / Microsoft 365</option><option value="outro" ${c.host && !/gmail|office365/.test(c.host) ? 'selected' : ''}>Outro</option></select></label>
        <label>Servidor SMTP <input name="host" required value="${esc(c.host)}"></label>
        <label>Porta <input name="port" data-num required value="${c.port}"></label>
        <label>Segurança <select name="secure"><option value="0">STARTTLS (porta 587)</option><option value="1" ${c.secure ? 'selected' : ''}>SSL (porta 465)</option></select></label>
        <label>Usuário (e-mail de login) <input name="usuario" required autocomplete="off" value="${esc(c.usuario)}"></label>
        <label>Senha (ou senha de aplicativo) <input name="senha" type="password" autocomplete="new-password" placeholder="${c.tem_senha ? 'já salva — deixe em branco para manter' : ''}" ${c.tem_senha ? '' : 'required'}></label>
        <label>Nome do remetente <input name="remetente_nome" required placeholder="Escritório Silva Contabilidade" value="${esc(c.remetente_nome)}"></label>
        <label>E-mail do remetente <input name="remetente_email" type="email" required value="${esc(c.remetente_email)}"></label>
      </div>
      <p class="dica" id="dica-provedor"></p>
      <p class="erro" id="erro-smtp"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar</button>
        <button type="button" id="testar" ${c.host ? '' : 'disabled'}>Enviar e-mail de teste</button></div>
    </form>
    <p class="sutil">O e-mail sai em nome do escritório e o cliente responde para o e-mail cadastrado da empresa emitente. Só notas em <b>Produção</b> podem ser enviadas.</p>`;
  const f = $('#form-smtp');
  const dica = () => ($('#dica-provedor').textContent = PROVEDORES[$('#provedor').value].dica);
  $('#provedor').onchange = () => { const p = PROVEDORES[$('#provedor').value]; if (p.host) { f.host.value = p.host; f.port.value = p.port; f.secure.value = p.secure ? '1' : '0'; } dica(); };
  dica();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const d = lerForm(f);
    try {
      await api('PUT', '/api/email/config', { host: d.host, port: d.port, secure: d.secure === '1', usuario: d.usuario, senha: d.senha || null, remetente_nome: d.remetente_nome, remetente_email: d.remetente_email });
      aviso('Configuração de e-mail salva.'); telaEmail();
    } catch (e) { $('#erro-smtp').textContent = mensagemErro(e); }
  };
  // window.prompt() não existe no aplicativo instalado (Electron): usa uma janela própria
  $('#testar').onclick = () => abrirDialogo(`
    <form id="form-teste"><h2>E-mail de teste</h2>
      <p class="sutil">Envia uma mensagem simples com a configuração salva para conferir se está tudo certo.</p>
      <label>Enviar para <input name="para" type="email" required value="${esc(estado.usuario.email ?? '')}"></label>
      <p class="erro" id="erro-teste"></p>
      <div class="acoes"><button class="primario" type="submit">Enviar teste</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    $('#form-teste').onsubmit = async (ev) => {
      ev.preventDefault();
      const botao = ev.target.querySelector('[type=submit]');
      botao.disabled = true; botao.textContent = 'Enviando…';
      try { await api('POST', '/api/email/testar', { para: ev.target.para.value }); d.close(); aviso('E-mail de teste enviado. Confira a caixa de entrada (e o spam).'); }
      catch (e) { $('#erro-teste').textContent = mensagemErro(e); botao.disabled = false; botao.textContent = 'Enviar teste'; }
    };
  });
}

async function telaBackup() {
  const b = await api('GET', '/api/backup');
  const tam = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  corpoConfig().innerHTML = `
    <div class="topo"><div><h1>Backup</h1>
      <p class="sutil">Neste modelo, o computador é o único lugar onde as notas ficam guardadas. Faça uma cópia de tempos em tempos e guarde fora dele (pen drive, nuvem).</p></div>
      <button class="primario" id="baixar">Baixar backup agora</button></div>
    <div class="banner teste">O backup guarda cadastros, notas e XML. Os certificados A1 ficam protegidos por uma chave deste computador: ao restaurar em outro, será preciso enviar o arquivo .pfx de cada empresa novamente.</div>
    <h2>Cópias automáticas</h2>
    ${b.pasta ? `<p class="sutil">O sistema salva uma cópia por dia e mantém as últimas 30 em <strong>${esc(b.pasta)}</strong>.</p>` : '<p class="sutil">Backup automático não está ativo nesta instalação.</p>'}
    ${b.automaticos.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Arquivo</th><th>Gerado em</th><th class="num">Tamanho</th></tr></thead><tbody>
      ${b.automaticos.map((x) => `<tr><td>${esc(x.nome)}</td><td>${new Date(x.data).toLocaleString('pt-BR')}</td><td class="num">${tam(x.bytes)}</td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${window.nfseDesktop ? `<h2>Restaurar</h2><p class="sutil">Para voltar a uma cópia, use o menu <strong>Arquivo > Restaurar backup…</strong>. O sistema guarda os dados atuais antes de substituí-los.</p>` : ''}`;
  $('#baixar').onclick = () => baixar('/api/backup/baixar', `nfse-backup-${hoje()}.db`);
}

// ---------------------------------------------------------------------------
(async function iniciarApp() {
  try {
    const st = await fetch('/api/setup/status').then((r) => r.json());
    if (st.versao) $('#versao').textContent = 'Versão ' + st.versao;
    if (!st.configurado) return mostrarSetup();
  } catch { /* servidor indisponível: segue para o login */ }
  if (estado.token) iniciar(); else sair();
})();


// ---------------------------------------------------------------------------
// Aviso fixo de nova versão (aplicativo instalado)
// ---------------------------------------------------------------------------
(function avisoDeVersao() {
  const ponte = window.nfseDesktop;
  if (!ponte || typeof ponte.versaoPendente !== 'function') return;
  const faixa = document.getElementById('aviso-versao');
  let dispensado = false;
  const mostrar = (info) => {
    if (!info || dispensado) return;
    faixa.innerHTML = `<span><strong>Nova versão ${esc(info.versao)} disponível.</strong> Seus dados são preservados e uma cópia de segurança é feita antes de atualizar.</span>
      <span class="acoes-faixa"><button class="primario" id="av-atualizar">Atualizar agora</button><button id="av-depois">Depois</button></span>`;
    faixa.hidden = false;
    document.body.classList.add('com-aviso-versao');
    document.getElementById('av-depois').onclick = () => { dispensado = true; faixa.hidden = true; document.body.classList.remove('com-aviso-versao'); };
    document.getElementById('av-atualizar').onclick = async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Baixando…';
      const r = await ponte.instalarAtualizacao();
      if (!r?.ok) { ev.target.disabled = false; ev.target.textContent = 'Atualizar agora'; aviso(r?.erro ?? 'Não foi possível atualizar agora.'); }
    };
  };
  ponte.aoHaverAtualizacao(mostrar);
  ponte.versaoPendente().then(mostrar).catch(() => {});
})();
