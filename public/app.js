// ---------------------------------------------------------------------------
// Kontor Gestão — interface (JavaScript puro, sem build)
// ---------------------------------------------------------------------------

const $ = (s, el = document) => el.querySelector(s);
const conteudo = $('#conteudo');
const estado = { token: localStorage.getItem('token'), usuario: null, empresas: [], empresaId: Number(localStorage.getItem('empresaId')) || null };

/** O usuário tem a permissão "Excluir registros"? (o servidor confere de novo) */
const podeExcluirRegistros = () => estado.usuario.modulos.includes('excluir');
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

/**
 * Consulta de clientes por F2: abre uma busca (nome, CNPJ/CPF ou e-mail) sobre a lista do <select>.
 * Setas navegam, Enter escolhe, Esc fecha. Vale em qualquer tela que passe o formulário e o select.
 */
function habilitarConsultaF2(form, select, clientes) {
  const abrir = () => {
    let sel = 0, achados = clientes;
    const norm = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    abrirDialogo(`
      <h2>Consultar cliente</h2>
      <input id="f2-busca" type="search" autocomplete="off" placeholder="Digite o nome, CNPJ/CPF ou e-mail" style="width:100%">
      <div class="rolagem" style="max-height:320px;margin-top:10px"><table class="tabela"><tbody id="f2-lista"></tbody></table></div>
      <p class="dica">↑ ↓ para navegar · Enter para escolher · Esc para fechar</p>
      <div class="acoes"><button type="button" data-fechar>Fechar</button></div>`, (d) => {
      const lista = d.querySelector('#f2-lista'), busca = d.querySelector('#f2-busca');
      const escolher = (t) => { d.close(); select.value = String(t.id); select.dispatchEvent(new Event('change')); select.focus(); };
      const pintar = () => {
        const q = norm(busca.value).replace(/\s+/g, ' ').trim(), qd = q.replace(/\D/g, '');
        achados = clientes.filter((t) => !q || norm(t.nome).includes(q) || norm(t.email).includes(q) || (qd && String(t.documento ?? '').replace(/\D/g, '').includes(qd)));
        sel = Math.min(sel, Math.max(achados.length - 1, 0));
        lista.innerHTML = achados.length ? achados.slice(0, 200).map((t, i) => `<tr class="clicavel ${i === sel ? 'sel-f2' : ''}" data-i="${i}"><td>${esc(t.nome)}</td><td>${t.documento ? fmtDoc(t.documento) : ''}</td></tr>`).join('') : '<tr><td class="dica">Nenhum cliente encontrado.</td></tr>';
        lista.querySelectorAll('tr[data-i]').forEach((tr) => (tr.onclick = () => escolher(achados[tr.dataset.i])));
        lista.querySelector('.sel-f2')?.scrollIntoView({ block: 'nearest' });
      };
      busca.oninput = () => { sel = 0; pintar(); };
      busca.onkeydown = (ev) => {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); sel = Math.min(sel + 1, achados.length - 1); pintar(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(sel - 1, 0); pintar(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); if (achados[sel]) escolher(achados[sel]); }
      };
      pintar(); busca.focus();
    });
  };
  form.addEventListener('keydown', (ev) => { if (ev.key === 'F2') { ev.preventDefault(); abrir(); } });
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
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/** Cores dos gráficos acompanham o tema escolhido. */
const COR = { get verde() { return cssVar('--verde'); }, get laranja() { return cssVar('--laranja'); }, get vermelho() { return cssVar('--vermelho'); } };

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
  $('#empresa-atual').title = e.razao_social;
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
  // quem não tem o acesso a Relatórios ainda enxerga o manual, por um item próprio no menu
  $('#menu-doc').hidden = estado.usuario.modulos.includes('relatorios');
  if (estado.usuario.trocar_senha) { $('#app').hidden = true; return trocarSenha({ obrigatoria: true }); }
  await carregarEmpresas();
  atualizarLicenca();
  if (!location.hash || !telaPermitida((location.hash.split('/')[1] || 'painel'))) location.hash = '#/' + (estado.usuario.modulos[0] ?? 'config');
  rotear();
}

/** A tela pertence a algum módulo liberado para o usuário? (o servidor confere de novo em cada chamada) */
function telaPermitida(nome) {
  const modulo = { painel: 'painel', emitir: 'emitir', notas: 'notas', nota: 'notas', cobrancas: 'cobrancas', banco: 'empresas', despesas: 'despesas', extrato: 'despesas', agenda: 'emitir', relatorios: 'relatorios', tomadores: 'tomadores', servicos: 'servicos', empresas: 'empresas' }[nome];
  return nome === 'config' || (modulo && estado.usuario.modulos.includes(modulo));
}

const rotas = {
  painel: telaPainel, emitir: telaEmitir, notas: telaNotas, nota: telaNota,
  cobrancas: telaCobrancas, banco: telaBanco, despesas: telaDespesas, extrato: telaExtrato, agenda: telaAgenda, relatorios: telaRelatorios, tomadores: telaTomadores, servicos: telaServicos, empresas: telaEmpresas, config: telaConfig,
};

function rotear() {
  const [, nome = 'painel', param] = location.hash.split('/');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#/${nome}` || (a.id === 'menu-doc' && nome === 'relatorios' && param === 'documentacao')));
  const manual = nome === 'relatorios' && param === 'documentacao'; // o manual é de todos os usuários
  if (['usuarios', 'email', 'backup', 'licenca'].includes(nome)) { location.hash = '#/config/' + nome; return; } // endereços antigos
  if (!manual && !telaPermitida(nome)) { conteudo.innerHTML = '<div class="vazio"><p>Seu usuário não tem acesso a esta funcionalidade.</p></div>'; return; }
  const precisaEmpresa = !manual && !['painel', 'empresas', 'nota', 'config'].includes(nome);
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
    ${e.modo_emissao === 'PORTAL' ? '<div class="banner teste">Esta empresa emite as notas pelo portal do Emissor Nacional (sem certificado). Aqui você gera o <strong>boleto</strong>; a nota é emitida no portal e importada em <a href="#/notas">Notas emitidas</a>.</div>' : !e.tem_certificado ? '<div class="banner teste">Cadastre o certificado A1 da empresa antes de emitir.</div>' : ''}
    <form id="form-emitir">
      <fieldset><legend>Tomador</legend>
        <div class="grade">
          <label class="largo">Quem contratou o serviço <span class="dica">(F2 para consultar)</span>
            <select name="tomadorId">
              <option value="">Consumidor não identificado</option>
              ${tomadores.map((t) => `<option value="${t.id}" ${p.tomadorId === t.id ? 'selected' : ''}>${esc(t.nome)} ${t.documento ? '— ' + fmtDoc(t.documento) : ''}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="acoes"><button type="button" id="novo-tomador">Cadastrar novo cliente</button></div>
      </fieldset>

      <div id="serv-padrao" class="banner" hidden></div>
      <div id="aviso-desconto" class="banner teste" hidden></div>
      <fieldset id="bloco-cobranca" hidden><legend>O que emitir</legend>
        <div class="grade">
          <label class="largo">Ação
            <select name="acao"><option value="NOTA">Somente a nota fiscal</option><option value="NOTA_BOLETO">Nota fiscal + boleto</option><option value="BOLETO">Somente o boleto</option></select>
            <span class="dica" id="dica-acao"></span></label>
          <label data-boleto>Vencimento do boleto <input type="date" name="vencimento"></label>
          <label data-boleto>Valor do boleto (R$) <input name="valorBoleto" data-num inputmode="decimal" placeholder="Valor líquido da nota"><span class="dica">Preenchido sozinho com o líquido da nota (serviço menos descontos e retenções). Você pode alterar; apague o campo para voltar ao automático.</span><span class="dica" id="dica-boleto-desc"></span></label>
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
  const portal = e.modo_emissao === 'PORTAL';
  if (!e.tem_certificado && !portal) f.querySelector('[type=submit]').disabled = true;
  if (portal) f.acao.querySelectorAll('option:not([value=BOLETO])').forEach((o) => o.remove());
  if (p.tribISSQN) f.tribISSQN.value = p.tribISSQN;
  if (p.issRetido) f.issRetido.value = p.issRetido;

  let pCpServico = null, tpImunidadeServico = null;
  f.servicoId.onchange = () => {
    const s = servicos.find((x) => x.id === Number(f.servicoId.value));
    if (!s) return;
    f.descricao.value = s.descricao;
    if (s.aliquota != null) f.aliquota.value = s.aliquota;
    if (s.valor_padrao) f.valor.value = s.valor_padrao;
    f.cTribNac.value = '';
    // tributação padrão cadastrada no serviço
    const t = s.tributacao;
    const fmt = (n) => (n == null ? '' : String(n).replace('.', ','));
    if (t) {
      f.tribISSQN.value = String(t.tribISSQN ?? 1);
      f.issRetido.value = String(t.issRetido ?? 1);
      for (const k of ['pPis', 'pCofins', 'pCsll', 'pIrrf']) f.elements[k].value = fmt(t[k]);
      if (t.municipioPrestacao) f.municipioPrestacao.value = t.municipioPrestacao;
      if (t.infoComplementar) f.infoComplementar.value = t.infoComplementar;
      if (f.tFed) { f.tFed.value = fmt(t.pTotTrib?.fed); f.tEst.value = fmt(t.pTotTrib?.est); f.tMun.value = fmt(t.pTotTrib?.mun); }
      pCpServico = t.pCp ?? null; tpImunidadeServico = t.tpImunidade ?? null;
      recalcular();
      sugerirBoleto?.();
    } else { pCpServico = null; tpImunidadeServico = null; }
  };
  habilitarConsultaF2($('#form-emitir'), $('#form-emitir').tomadorId, tomadores);
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
      f.acao.value = portal ? 'BOLETO' : t.modo_faturamento ?? 'NOTA';
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
  // serviço padrão do cliente: preenche serviço, texto e valor (nota e boleto)
  const aplicarServicoPadrao = (sp, t) => {
    const sv = servicos.find((x) => x.id === sp.servico_id);
    if (!sv) return;
    f.servicoId.value = String(sv.id);
    f.servicoId.onchange();
    if (sp.descricao) f.descricao.value = sp.descricao;
    f.valor.value = String(sp.valor).replace('.', ',');
    boletoManual = false;
    f.valor.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const mostrarServicoPadrao = () => {
    const box = $('#serv-padrao');
    const t = tomadores.find((x) => x.id === Number(f.tomadorId.value));
    const lista = (t?.servicos_padrao ?? []).filter((x) => servicos.some((sv) => sv.id === x.servico_id));
    if (!t || corrigindo || !lista.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<label>Serviço padrão de ${esc(t.nome)} ${lista.length > 1 ? `<select id="sel-serv-padrao">${lista.map((x, i) => `<option value="${i}">${esc(servicos.find((sv) => sv.id === x.servico_id).nome)} — ${brl(x.valor)}${x.padrao ? ' (principal)' : ''}</option>`).join('')}</select>` : `<strong>${esc(servicos.find((sv) => sv.id === lista[0].servico_id).nome)} — ${brl(lista[0].valor)}</strong>`}</label>
      <span class="dica">Já preenchido abaixo; você pode alterar o que precisar antes de emitir.</span>`;
    const sel = $('#sel-serv-padrao');
    if (sel) sel.onchange = () => aplicarServicoPadrao(lista[Number(sel.value)], t);
    aplicarServicoPadrao(lista[0], t);
  };
  f.tomadorId.addEventListener('change', mostrarServicoPadrao);
  // desconto fixo do cliente: lembrete na emissão e efeito no boleto
  const atualizarDesconto = () => {
    const t = tomadores.find((x) => x.id === Number(f.tomadorId.value));
    const box = $('#aviso-desconto'), desc = t?.desconto_valor ?? 0;
    if (!t || !desc || corrigindo) { box.hidden = true; $('#dica-boleto-desc')?.replaceChildren(); return; }
    const naNota = (lerForm(f).descontoIncondicionado ?? 0) >= desc;
    box.hidden = false;
    // só redesenha se mudou: refazer o botão durante o clique (o campo anterior dispara "change") faria o clique se perder
    const html = `<strong>Este cliente tem desconto cadastrado: ${brl(desc)}</strong> (${esc(t.desconto_motivo ?? '')}).<br>
      ${f.acao.value === 'NOTA' ? '' : 'No boleto o desconto é aplicado automaticamente. '}Na NFS-e ele <u>não</u> é aplicado sozinho: ${naNota ? 'já está lançado como desconto incondicionado nesta nota.' : 'se o desconto também vale para a nota, use o botão abaixo.'}
      ${naNota ? '' : '<br><button type="button" id="aplicar-desc-nota">Lançar como desconto na nota</button>'}`;
    if (box.dataset.html !== html) {
      box.innerHTML = html; box.dataset.html = html;
      const b = $('#aplicar-desc-nota');
      if (b) b.onclick = () => { f.descontoIncondicionado.value = String(desc).replace('.', ','); f.descontoIncondicionado.dispatchEvent(new Event('input', { bubbles: true })); };
    }
    const dica = $('#dica-boleto-desc');
    if (dica) {
      const bruto = numero(f.valorBoleto.value) ?? 0;
      dica.textContent = naNota ? 'O desconto do cliente já está na nota, então não é abatido de novo.' : bruto > desc ? `Desconto do cliente: − ${brl(desc)} (${t.desconto_motivo}) → boleto de ${brl(bruto - desc)}.` : '';
    }
  };
  f.addEventListener('input', atualizarDesconto); f.addEventListener('change', atualizarDesconto);
  f.valorBoleto?.addEventListener('input', () => { boletoManual = f.valorBoleto.value.trim() !== ''; if (!boletoManual) sugerirBoleto(); });
  f.addEventListener('input', (ev) => { if (ev.target !== f.valorBoleto) sugerirBoleto(); });
  f.addEventListener('change', (ev) => { if (ev.target !== f.valorBoleto) sugerirBoleto(); });
  if (f.tomadorId.value) f.tomadorId.dispatchEvent(new Event('change'));

  function recalcular() {
    const base = (lerForm(f).valor ?? 0) - (lerForm(f).descontoIncondicionado ?? 0);
    if (pCpServico != null) f.elements.cp.value = pCpServico ? (Math.round(base * pCpServico) / 100).toFixed(2).replace('.', ',') : '';
    const preencher = (aliq, campo) => {
      const pc = lerForm(f)[aliq];
      f.elements[campo].value = pc ? (Math.round(base * pc) / 100).toFixed(2).replace('.', ',') : '';
    };
    preencher('pPis', 'pis'); preencher('pCofins', 'cofins'); preencher('pCsll', 'csll'); preencher('pIrrf', 'irrf');
  }
  // com percentuais preenchidos, os valores retidos acompanham o valor do serviço
  ['valor', 'descontoIncondicionado'].forEach((n) => f.elements[n].addEventListener('input', () => {
    if (['pPis', 'pCofins', 'pCsll', 'pIrrf'].some((k) => lerForm(f)[k]) || pCpServico) recalcular();
  }));
  ['pPis', 'pCofins', 'pCsll', 'pIrrf'].forEach((n) => f.elements[n].addEventListener('input', recalcular));
  $('#ret-padrao').onclick = () => {
    const pad = { pPis: '0,65', pCofins: '3,00', pCsll: '1,00', pIrrf: '1,50' };
    for (const k in pad) f.elements[k].value = pad[k];
    recalcular();
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    if (portal && !f.tomadorId.value) { $('#erro-emitir').textContent = 'Escolha o cliente para gerar o boleto.'; return; }
    const d = lerForm(f);
    const corpo = {
      empresaId: e.id,
      tomadorId: d.tomadorId ? Number(d.tomadorId) : null,
      servicoId: d.servicoId ? Number(d.servicoId) : null,
      competencia: d.competencia, descricao: d.descricao, valor: d.valor,
      descontoIncondicionado: d.descontoIncondicionado, cTribNac: d.cTribNac, municipioPrestacao: d.municipioPrestacao,
      aliquota: d.aliquota, tribISSQN: Number(d.tribISSQN), issRetido: Number(d.issRetido), tpImunidade: Number(d.tribISSQN) === 2 ? tpImunidadeServico : null,
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
        <button id="novo-boleto" class="primario">Novo boleto</button>
        <button id="modelo-wa">Mensagem do WhatsApp</button>
        <button id="ler-retorno" ${conta ? '' : 'disabled'}>Importar retorno</button><input type="file" id="arq-retorno" accept=".ret,.RET,.txt,.TXT,.rem,.REM,*/*" hidden></div>` : ''}</div>
    ${conta ? '' : `<div class="banner teste">Os dados bancários (Ailos) desta empresa ainda não foram informados. <a href="#/banco">Informar agora (em Empresas › Dados bancários)</a> — os boletos pendentes são gerados automaticamente depois disso.</div>`}
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Vencimento</th><th>Cliente</th><th>Nota</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${lista.map((c) => `<tr><td>${dataBr(c.vencimento)}${c.status !== 'PAGO' && c.status !== 'CANCELADO' && c.vencimento < hoje ? ' <span class="dica erro">vencido</span>' : ''}</td>
        <td>${esc(c.tomador_nome)}<br><span class="dica">${esc((c.descricao ?? '').slice(0, 60))}</span>${c.desconto > 0 ? `<br><span class="dica">desconto de ${brl(c.desconto)}: ${esc(c.desconto_motivo ?? '')}</span>` : ''}</td>
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
  // ---- Novo boleto (sem nota fiscal) ----
  const nb = $('#novo-boleto');
  if (nb) nb.onclick = async () => {
    const [clientes, fer] = await Promise.all([
      api('GET', `/api/empresas/${estado.empresaId}/tomadores`),
      api('GET', `/api/empresas/${estado.empresaId}/feriados`).then((r) => r.feriados_extra).catch(() => ''),
    ]);
    if (!clientes.length) { aviso('Cadastre um cliente antes de gerar boletos.'); return; }
    clientes.sort((a, b) => (b.modo_faturamento === 'BOLETO') - (a.modo_faturamento === 'BOLETO') || a.nome.localeCompare(b.nome, 'pt-BR'));
    const vencDe = (t) => {
      const base = new Date(Date.now() - 3 * 3600e3);
      if (t.vencimento_tipo !== 'DIA_FIXO') return new Date(base.getTime() + (t.vencimento_valor ?? 10) * 86400e3).toISOString().slice(0, 10);
      const ult = (a, m) => new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
      let a = base.getUTCFullYear(), m = base.getUTCMonth(), dia = Math.min(t.vencimento_valor, ult(a, m));
      if (dia <= base.getUTCDate()) { m += 1; if (m > 11) { m = 0; a += 1; } dia = Math.min(t.vencimento_valor, ult(a, m)); }
      return new Date(Date.UTC(a, m, dia)).toISOString().slice(0, 10);
    };
    abrirDialogo(`
      <form id="form-nb"><h2>Novo boleto</h2>
        <p class="sutil">Gera só o boleto, sem emitir nota fiscal. Os clientes marcados como “Somente boleto” aparecem primeiro.</p>
        <div class="grade">
          <label class="largo">Cliente <select name="tomadorId" required>${clientes.map((t) => `<option value="${t.id}">${esc(t.nome)}${t.modo_faturamento === 'BOLETO' ? ' — somente boleto' : ''}</option>`).join('')}</select></label>
          <label class="largo">Descrição <input name="descricao" required maxlength="2000" placeholder="ex.: Honorários contábeis — outubro/2026"></label>
          <label>Valor antes do desconto (R$) <input name="valor" data-num required inputmode="decimal"><span class="dica" id="dica-desc-nb"></span></label>
          <label>Vencimento <input type="date" name="vencimento" required></label>
          <label class="largo"><span><input type="checkbox" name="enviarEmail"> Enviar o boleto por e-mail ao cliente</span></label>
        </div>
        <p class="dica" id="aviso-nb"></p><p class="erro" id="erro-nb"></p>
        <div class="acoes"><button class="primario" type="submit">Gerar boleto</button><button type="button" data-fechar>Cancelar</button></div>
      </form>`, (d) => {
      const f = $('#form-nb');
      const cliente = () => clientes.find((t) => t.id === Number(f.tomadorId.value));
      const ajustar = () => { const r = ajustarVencimento(f.vencimento.value, fer); if (r.aviso) { f.vencimento.value = r.data; $('#aviso-nb').textContent = r.aviso; } else $('#aviso-nb').textContent = ''; };
      const dicaDesc = () => { const t = cliente(); $('#dica-desc-nb').textContent = t.desconto_valor ? `Será abatido o desconto do cliente: ${brl(t.desconto_valor)} (${t.desconto_motivo}).` : ''; };
      f.tomadorId.addEventListener('change', dicaDesc);
      f.tomadorId.onchange = () => { const t = cliente(); dicaDesc(); f.vencimento.value = vencDe(t); f.enviarEmail.checked = !!t.enviar_email_auto; ajustar(); };
      f.vencimento.onchange = ajustar;
      f.tomadorId.onchange();
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const v = lerForm(f);
        const botao = f.querySelector('[type=submit]'); botao.disabled = true; botao.textContent = 'Gerando…';
        try {
          const r = await api('POST', `/api/empresas/${estado.empresaId}/boleto-avulso`, { tomadorId: Number(v.tomadorId), descricao: v.descricao, valor: v.valor, vencimento: v.vencimento, enviarEmail: !!v.enviarEmail });
          d.close();
          const partes = [`Boleto de ${brl(r.cobranca.valor)} (venc. ${dataBr(r.cobranca.vencimento)})`];
          if (r.email?.status === 'ENVIADO') partes.push(`e-mail enviado para ${r.email.para}`);
          if (r.email?.status === 'ERRO') partes.push(`e-mail não enviado: ${r.email.erro}`);
          aviso(partes.join(' · ') + '.' + (r.avisos?.length ? ' ' + r.avisos.join(' ') : '')); telaCobrancas();
        } catch (e) { $('#erro-nb').textContent = mensagemErro(e); botao.disabled = false; botao.textContent = 'Gerar boleto'; }
      };
    });
  };

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
          <label>Valor antes do desconto (R$) <input name="valor" data-num required inputmode="decimal" value="${String(Math.round((c.valor + (c.desconto ?? 0)) * 100) / 100).replace('.', ',')}"></label>
        </div>
        <p class="dica">${c.desconto > 0 ? `O desconto cadastrado no cliente (${esc(c.desconto_motivo ?? '')}) é abatido deste valor.` : 'Se o cliente tiver desconto cadastrado, ele é abatido deste valor.'}</p>
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
    <div class="topo"><div><p class="sutil"><a href="#/empresas">← Empresas</a></p><h1>Dados bancários</h1><p class="sutil">${esc(empresa().razao_social)} — cobrança Ailos (banco 085)</p></div></div>
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
async function telaDocumentacao() {
  const { MANUAL, MANUAL_VERSAO } = await import('/manual.js');
  const est = (telaDocumentacao.est ??= { topico: MANUAL[0].id, busca: '' });
  const textoPuro = (t) => (t.titulo + ' ' + t.resumo + ' ' + t.corpo.replace(/<[^>]+>/g, ' ')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Relatórios</h1><p class="sutil">Manual de uso do sistema (versão ${MANUAL_VERSAO}).</p></div></div>
    <nav class="abas" aria-label="Relatórios"><a href="#/relatorios">Relatórios</a><a href="#/relatorios/documentacao" class="ativo">Documentação</a></nav>
    <div class="manual">
      <aside class="manual-indice">
        <input type="search" id="man-busca" placeholder="Pesquisar no manual" autocomplete="off" value="${esc(est.busca)}">
        <div id="man-lista"></div>
        <button type="button" id="man-imprimir">Imprimir / salvar em PDF</button>
      </aside>
      <article class="manual-corpo" id="man-corpo"></article>
    </div>`;
  const pintar = () => {
    const q = est.busca.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const achados = MANUAL.filter((t) => !q || textoPuro(t).includes(q));
    if (!achados.some((t) => t.id === est.topico) && achados[0]) est.topico = achados[0].id;
    $('#man-lista').innerHTML = achados.length
      ? achados.map((t) => `<a href="#" data-t="${t.id}" class="${t.id === est.topico ? 'ativo' : ''}"><strong>${esc(t.titulo)}</strong><span>${esc(t.resumo)}</span></a>`).join('')
      : '<p class="dica">Nada encontrado.</p>';
    $('#man-lista').querySelectorAll('[data-t]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); est.topico = a.dataset.t; pintar(); $('#man-corpo').scrollIntoView({ block: 'start' }); }));
    const t = MANUAL.find((x) => x.id === est.topico);
    $('#man-corpo').innerHTML = t ? `<h2>${esc(t.titulo)}</h2><p class="sutil">${esc(t.resumo)}</p>${t.corpo}` : '';
  };
  $('#man-busca').oninput = (ev) => { est.busca = ev.target.value; pintar(); };
  $('#man-imprimir').onclick = () => {
    const t = MANUAL.find((x) => x.id === est.topico);
    const box = $('#man-corpo'); const antes = box.innerHTML;
    box.innerHTML = `<h1>Manual do Kontor Gestão — versão ${MANUAL_VERSAO}</h1>` + MANUAL.map((x) => `<section><h2>${esc(x.titulo)}</h2>${x.corpo}</section>`).join('');
    document.body.classList.add('imprimindo-manual');
    const voltar = () => { document.body.classList.remove('imprimindo-manual'); box.innerHTML = antes; window.removeEventListener('afterprint', voltar); };
    window.addEventListener('afterprint', voltar); setTimeout(() => window.print(), 50);
  };
  pintar();
}

async function telaRelatorios(aba) {
  if (aba === 'documentacao') return telaDocumentacao();
  const cat = await api('GET', '/api/relatorios');
  const ini = mesAtual() + '-01', fim = new Date(Date.UTC(+mesAtual().slice(0, 4), +mesAtual().slice(5), 0)).toISOString().slice(0, 10);
  const est = telaRelatorios.est ??= { rel: cat[0].id, de: ini, ate: fim, tomadorId: '', situacao: '' };
  const clientes = await api('GET', `/api/empresas/${estado.empresaId}/tomadores`).catch(() => []);
  const fmtCel = (v, t) => (v == null || v === '' ? '' : t === 'moeda' ? brl(v) : t === 'data' ? dataBr(v) : esc(String(v)));
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Relatórios</h1><p class="sutil">A nota e o boleto têm datas diferentes (emissão, vencimento, pagamento). Cada relatório diz qual data usa no filtro e mostra as outras nas colunas.</p></div></div>
    <nav class="abas" aria-label="Relatórios"><a href="#/relatorios" class="ativo">Relatórios</a><a href="#/relatorios/documentacao">Documentação</a></nav>
    <form id="form-rel" class="filtros grade">
      <label class="largo">Relatório <select name="rel">${cat.map((c) => `<option value="${c.id}" ${c.id === est.rel ? 'selected' : ''}>${esc(c.titulo)}</option>`).join('')}</select><span class="dica" id="desc-rel"></span></label>
      <label>De <input type="date" name="de" required value="${est.de}"></label>
      <label>Até <input type="date" name="ate" required value="${est.ate}"></label>
      <label>Cliente <select name="tomadorId"><option value="">Todos</option>${clientes.map((c) => `<option value="${c.id}" ${String(c.id) === String(est.tomadorId) ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      <label id="lbl-sit">Situação <select name="situacao"><option value="">Todas</option><option>Vencido</option><option>A vencer</option></select></label>
      <div class="acoes"><button class="primario" type="submit">Gerar</button> <button type="button" id="rel-csv">Excel (CSV)</button> <button type="button" id="rel-pdf">PDF</button></div>
    </form>
    <div id="res-rel"><div class="vazio">Escolha o relatório e o período e clique em Gerar.</div></div>`;
  const f = $('#form-rel');
  const atual = () => ({ rel: f.rel.value, de: f.de.value, ate: f.ate.value, tomadorId: f.tomadorId.value, situacao: f.situacao.value });
  const ajustar = () => { const c = cat.find((x) => x.id === f.rel.value); $('#desc-rel').textContent = `${c.descricao} Filtra por: ${c.filtroData}.`; $('#lbl-sit').hidden = !c.situacoes; if (!c.situacoes) f.situacao.value = ''; };
  f.rel.onchange = ajustar; ajustar(); f.situacao.value = est.situacao;
  const qs = (formato) => { const a = atual(); return new URLSearchParams({ de: a.de, ate: a.ate, formato, ...(a.tomadorId && { tomadorId: a.tomadorId }), ...(a.situacao && { situacao: a.situacao }) }).toString(); };
  f.onsubmit = async (ev) => {
    ev.preventDefault(); Object.assign(est, atual());
    const box = $('#res-rel'); box.innerHTML = '<p class="sutil">Gerando…</p>';
    try {
      const r = await api('GET', `/api/empresas/${estado.empresaId}/relatorios/${est.rel}?${qs('json')}`);
      box.innerHTML = `<h2>${esc(r.titulo)}</h2><p class="sutil">${esc(r.subtitulo)} · ${r.linhas.length} registro(s)</p>
        ${r.linhas.length ? `<div class="rolagem"><table class="tabela"><thead><tr>${r.colunas.map((c) => `<th class="${c.tipo === 'moeda' || c.tipo === 'inteiro' ? 'num' : ''}">${esc(c.nome)}</th>`).join('')}</tr></thead><tbody>
          ${r.linhas.map((l) => `<tr>${r.colunas.map((c) => `<td class="${c.tipo === 'moeda' || c.tipo === 'inteiro' ? 'num' : ''}">${fmtCel(l[c.k], c.tipo)}</td>`).join('')}</tr>`).join('')}
          ${r.colunas.some((c) => c.soma) ? `<tr><td><strong>TOTAL</strong></td>${r.colunas.slice(1).map((c) => `<td class="num"><strong>${c.soma ? fmtCel(r.totais[c.k], c.tipo) : ''}</strong></td>`).join('')}</tr>` : ''}
          </tbody></table></div>` : '<div class="vazio">Nenhum registro neste período.</div>'}`;
    } catch (e) { box.innerHTML = `<p class="erro">${esc(mensagemErro(e))}</p>`; }
  };
  $('#rel-csv').onclick = () => { Object.assign(est, atual()); baixar(`/api/empresas/${estado.empresaId}/relatorios/${est.rel}?${qs('csv')}`, `${est.rel}.csv`); };
  $('#rel-pdf').onclick = () => { Object.assign(est, atual()); baixar(`/api/empresas/${estado.empresaId}/relatorios/${est.rel}?${qs('pdf')}`, `${est.rel}.pdf`); };
}

const STATUS_AGENDA = { SEM_AGENDA: ['Sem agenda', ''], AGENDADA: ['Agendada', ''], PRONTA: ['Pronta para confirmar', 'cor-ambar'], EMITIDA: ['Emitida', 'cor-verde'], ERRO: ['Com erro', 'cor-vermelho'], PULADA: ['Pulada neste mês', ''] };

async function telaAgenda() {
  const mes = telaAgenda.mes ?? mesAtual();
  const base = `/api/empresas/${estado.empresaId}/agenda`;
  const d = await api('GET', `${base}?mes=${mes}`);
  const porCliente = new Map();
  for (const i of d.itens) (porCliente.get(i.tomador_id) ?? porCliente.set(i.tomador_id, []).get(i.tomador_id)).push(i);
  const prontas = d.itens.filter((i) => i.status === 'PRONTA' || i.status === 'ERRO');
  const totalProntas = prontas.reduce((t, i) => t + i.valor, 0);
  const acaoTxt = (m) => ({ NOTA: 'nota', NOTA_BOLETO: 'nota + boleto', BOLETO: 'boleto' }[m] ?? m);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Emissão automática</h1><p class="sutil">Todo mês, na data de cada cliente, o sistema deixa a emissão pronta com o serviço padrão e o valor cadastrados. Você confere e confirma; nada é emitido sem a sua confirmação.</p></div>
      <div><label>Mês <input type="month" id="mes-ag" value="${mes}"></label>
        <button class="primario" id="todas" ${prontas.length ? '' : 'disabled'}>Emitir ${prontas.length ? prontas.length + ' pronta(s)' : 'prontas'}</button></div></div>
    ${porCliente.size ? `<div class="resumo">
      <div class="cartao"><div class="sutil">Prontas para confirmar</div><div class="valor" style="color:${COR.laranja}">${d.resumo.prontas}</div><div class="dica">${prontas.length ? brl(totalProntas) + ' em serviços' : 'nada pendente'}</div></div>
      <div class="cartao"><div class="sutil">Agendadas</div><div class="valor">${d.resumo.agendadas}</div><div class="dica">ainda não chegou a data</div></div>
      <div class="cartao"><div class="sutil">Com erro</div><div class="valor" style="color:${d.resumo.erros ? COR.vermelho : COR.verde}">${d.resumo.erros}</div></div>
    </div>
    <div class="rolagem"><table class="tabela"><thead><tr><th>Cliente</th><th>Serviço</th><th class="num">Valor</th><th>O que gera</th><th>Data</th><th>Situação</th><th></th></tr></thead><tbody>
    ${[...porCliente.values()].map((itens) => itens.map((i, k) => `<tr>
      ${k === 0 ? `<td rowspan="${itens.length}"><strong>${esc(i.tomador)}</strong><br>${i.agenda_ativa ? `<span class="dica">todo dia ${i.agenda_dia}</span> ` : ''}<button data-cfg="${i.tomador_id}">${i.agenda_ativa ? 'Alterar' : 'Agendar'}</button></td>` : ''}
      <td>${esc(i.servico)}</td><td class="num">${brl(i.valor)}</td><td>${acaoTxt(i.modo)}</td><td>${i.data_prevista ? dataBr(i.data_prevista) : '—'}</td>
      <td><span class="${STATUS_AGENDA[i.status][1]}">${STATUS_AGENDA[i.status][0]}</span>${i.mensagem && i.status !== 'PULADA' ? `<br><span class="dica">${esc(i.mensagem)}</span>` : ''}</td>
      <td class="acoes-linha">${i.status === 'PRONTA' || i.status === 'ERRO' ? `<button data-exe="${i.tomador_id}:${i.servico_id}">${i.status === 'ERRO' ? 'Tentar de novo' : 'Emitir'}</button> <button data-pul="${i.tomador_id}:${i.servico_id}">Pular</button>` : i.status === 'PULADA' ? `<button data-des="${i.tomador_id}:${i.servico_id}">Desfazer</button>` : i.nota_id ? `<a href="#/nota/${i.nota_id}">Ver nota</a>` : ''}</td></tr>`).join('')).join('')}
    </tbody></table></div>`
    : '<div class="vazio">Nenhum cliente com serviço padrão. Abra um cliente, cadastre o serviço e o valor na aba <strong>Serviços padrão</strong> e volte aqui para agendar. <a href="#/tomadores">Ir para Clientes</a></div>'}`;
  $('#mes-ag').onchange = (ev) => { telaAgenda.mes = ev.target.value || mesAtual(); telaAgenda(); };
  const recarregar = async () => { const y = window.scrollY; await telaAgenda(); window.scrollTo(0, y); };
  const par = (v) => v.split(':').map(Number);
  conteudo.querySelectorAll('[data-cfg]').forEach((b) => (b.onclick = () => {
    const i = d.itens.find((x) => x.tomador_id === Number(b.dataset.cfg));
    abrirDialogo(`<form id="form-ag"><h2>Emissão automática — ${esc(i.tomador)}</h2>
      <p class="sutil">Gera ${acaoTxt(i.modo)} com os serviços padrão e valores do cadastro do cliente. Se o dia cair em fim de semana ou feriado, passa para o próximo dia útil.</p>
      <div class="grade"><label class="largo"><span><input type="checkbox" name="ativa" ${i.agenda_ativa ? 'checked' : ''}> Agendar todo mês</span></label>
        <label>Dia do mês <input name="dia" type="number" min="1" max="31" value="${i.agenda_dia ?? 5}"></label></div>
      <p class="erro" id="erro-ag"></p><div class="acoes"><button class="primario" type="submit">Salvar</button><button type="button" data-fechar>Fechar</button></div></form>`, (dlg) => {
      $('#form-ag').onsubmit = async (ev) => {
        ev.preventDefault(); const f = ev.target;
        try { await api('POST', `${base}/config`, { tomadorId: i.tomador_id, ativa: f.ativa.checked, dia: Number(f.dia.value) }); dlg.close(); await recarregar(); }
        catch (e) { $('#erro-ag').textContent = mensagemErro(e); }
      };
    });
  }));
  const exec = async (b, rotulo) => {
    const [t, sv] = par(b.dataset.exe); b.disabled = true; b.textContent = 'Emitindo…';
    try { const r = await api('POST', `${base}/executar`, { tomadorId: t, servicoId: sv, mes }); aviso(r.status === 'EMITIDA' ? 'Emitido.' : (r.mensagem ?? 'Não foi possível emitir.')); }
    catch (e) { aviso(mensagemErro(e)); }
    await recarregar();
  };
  conteudo.querySelectorAll('[data-exe]').forEach((b) => (b.onclick = () => exec(b)));
  conteudo.querySelectorAll('[data-pul],[data-des]').forEach((b) => (b.onclick = async () => {
    const [t, sv] = par(b.dataset.pul ?? b.dataset.des);
    await api('POST', `${base}/pular`, { tomadorId: t, servicoId: sv, mes, desfazer: !!b.dataset.des }); await recarregar();
  }));
  $('#todas').onclick = async () => {
    if (!confirm(`Emitir agora ${prontas.length} item(ns), no total de ${brl(totalProntas)} em serviços?\nSerão geradas as notas e/ou boletos de cada cliente.`)) return;
    const b = $('#todas'); b.disabled = true; b.textContent = 'Emitindo…';
    try { const r = await api('POST', `${base}/executar-todas`, { mes }); aviso(`${r.emitidas} emitido(s)${r.erros ? `, ${r.erros} com erro` : ''}.`); }
    catch (e) { aviso(mensagemErro(e)); }
    await recarregar();
  };
}

async function telaExtrato() {
  const mes = telaExtrato.mes ?? mesAtual();
  const filtro = telaExtrato.filtro ?? 'todos';
  const semelhantes = telaExtrato.semelhantes ?? true;
  const base = `/api/empresas/${estado.empresaId}/extrato`;
  const d = await api('GET', `${base}?mes=${mes}`);
  const vis = d.lancamentos.filter((l) => ({ todos: true, sem: !l.categoria, entradas: l.valor > 0, saidas: l.valor < 0 }[filtro]));
  const soma = (l) => l.reduce((t, x) => t + Math.abs(x.valor), 0);
  const agrupar = (l) => Object.entries(l.reduce((a, x) => ({ ...a, [x.categoria ?? 'Sem classificação']: (a[x.categoria ?? 'Sem classificação'] ?? 0) + Math.abs(x.valor) }), {})).sort((a, b) => b[1] - a[1]);
  const ent = d.lancamentos.filter((l) => l.valor > 0), sai = d.lancamentos.filter((l) => l.valor < 0);
  const tabCat = (titulo, l, cor) => `<div class="cartao"><h2 style="margin-top:0">${titulo} <span class="sutil">· ${brl(soma(l))}</span></h2>
    ${l.length ? `<table class="tabela"><tbody>${agrupar(l).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num" style="color:${cor}">${brl(v)}</td><td class="num sutil">${Math.round(v / soma(l) * 100)}%</td></tr>`).join('')}</tbody></table>` : '<p class="sutil">Nada neste mês.</p>'}</div>`;
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Extrato e conciliação</h1><p class="sutil">Importe o extrato em PDF do Ailos, classifique entradas e saídas e ligue os recebimentos aos boletos.</p></div>
      <div><label>Mês ${d.meses.length ? `<select id="mes-ext">${[...new Set([mes, ...d.meses])].sort().reverse().map((m) => `<option value="${m}" ${m === mes ? 'selected' : ''}>${nomeMes(m)}</option>`).join('')}</select>` : `<input type="month" id="mes-ext" value="${mes}">`}</label>
        <button class="primario" id="imp-ext">Importar extrato (PDF)</button><input type="file" id="arq-ext" accept="application/pdf,.pdf" hidden></div></div>
    <div id="res-import"></div>
    ${d.lancamentos.length ? `<div class="resumo">
      <div class="cartao"><div class="sutil">Entradas</div><div class="valor" style="color:${COR.verde}">${compacto(d.entradas)}</div><div class="dica">${ent.length} lançamento(s)</div></div>
      <div class="cartao"><div class="sutil">Saídas</div><div class="valor" style="color:${COR.vermelho}">${compacto(d.saidas)}</div><div class="dica">${sai.length} lançamento(s)</div></div>
      <div class="cartao"><div class="sutil">Resultado do mês</div><div class="valor" style="color:${d.resultado < 0 ? COR.vermelho : COR.verde}">${compacto(d.resultado)}</div></div>
      <div class="cartao"><div class="sutil">Sem classificação</div><div class="valor" style="color:${d.semClassificacao ? COR.laranja : COR.verde}">${d.semClassificacao}</div><div class="dica">${d.semClassificacao ? 'classifique para fechar o balanço' : 'tudo classificado'}</div></div>
    </div>
    <div class="duas-colunas">${tabCat('Entradas por categoria', ent, COR.verde)}${tabCat('Saídas por categoria', sai, COR.vermelho)}</div>
    <div class="topo"><h2>Lançamentos de ${nomeMes(mes)}</h2>
      <div><nav class="abas" id="filtros-ext">${[['todos', 'Todos'], ['sem', `Sem classificação (${d.semClassificacao})`], ['entradas', 'Entradas'], ['saidas', 'Saídas']].map(([k, n]) => `<a href="#" data-f="${k}" class="${k === filtro ? 'ativo' : ''}">${n}</a>`).join('')}</nav></div></div>
    <label class="sutil" style="flex-direction:row;display:flex;gap:8px;align-items:center;margin:8px 0"><input type="checkbox" id="semelhantes" style="width:auto" ${semelhantes ? 'checked' : ''}> Ao classificar, aplicar também aos lançamentos parecidos (mesma descrição) e lembrar nas próximas importações</label>
    <datalist id="cat-ent">${d.categorias.entradas.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="cat-sai">${d.categorias.saidas.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="rolagem"><table class="tabela"><thead><tr><th>Data</th><th>Descrição</th><th class="num">Valor</th><th>Categoria</th><th>Boleto</th></tr></thead><tbody>
      ${vis.map((l) => `<tr><td>${dataBr(l.data)}</td><td>${esc(l.descricao)}${l.documento ? ` <span class="sutil">${esc(l.documento)}</span>` : ''}</td>
        <td class="num" style="color:${l.valor < 0 ? COR.vermelho : COR.verde}">${brl(l.valor)}</td>
        <td><input data-cat="${l.id}" list="${l.valor > 0 ? 'cat-ent' : 'cat-sai'}" value="${esc(l.categoria ?? '')}" placeholder="Classificar…" ${l.categoria ? '' : 'style="border-color:' + (COR.laranja) + '"'}></td>
        <td>${l.cobranca_id ? `<span title="Boleto com vencimento em ${dataBr(l.boleto_venc)}">✔ ${esc(l.tomador ?? 'boleto')}</span> <a href="#" data-des="${l.id}">desfazer</a>` : l.valor > 0 ? `<button data-bol="${l.id}">Ligar a boleto</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="sutil">Nenhum lançamento neste filtro.</td></tr>'}
    </tbody></table></div>
    <h3>Importações</h3>
    <table class="tabela"><tbody>${d.importacoes.map((i) => `<tr><td>${esc(i.arquivo)}</td><td>${i.periodo_ini ? dataBr(i.periodo_ini) + ' a ' + dataBr(i.periodo_fim) : ''}</td><td class="num">${i.qtd} lançamentos</td><td class="num">${podeExcluirRegistros() ? `<a href="#" data-exi="${i.id}">excluir</a>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="vazio">Nenhum lançamento neste mês. Importe o extrato em PDF (Ailos Conta Online → Extrato → Conta corrente → exportar PDF).</div>'}`;

  $('#mes-ext').onchange = (ev) => { telaExtrato.mes = ev.target.value || mesAtual(); telaExtrato(); };
  const arq = $('#arq-ext');
  $('#imp-ext').onclick = () => arq.click();
  arq.onchange = async () => {
    const f = arq.files[0]; if (!f) return;
    const box = $('#res-import'); box.innerHTML = '<p class="sutil">Lendo o extrato…</p>';
    try {
      const b64 = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f); });
      const r = await api('POST', `${base}/importar`, { nome: f.name, pdfBase64: b64 });
      if (r.periodo?.[0]) telaExtrato.mes = r.periodo[1].slice(0, 7);
      await telaExtrato();
      $('#res-import').innerHTML = `<div class="banner"><strong>Extrato importado:</strong> ${r.novos} lançamento(s) novo(s)${r.repetidos ? `, ${r.repetidos} já existiam` : ''}${r.conciliados ? `, ${r.conciliados} ligado(s) a boletos automaticamente` : ''}. Os saldos e totais do PDF foram conferidos.
        ${r.avisos.map((a) => `<br><span class="erro">⚠ ${esc(a)}</span>`).join('')}</div>`;
    } catch (e) { box.innerHTML = `<p class="erro">${esc(mensagemErro(e))}</p>`; }
    arq.value = '';
  };
  if (!d.lancamentos.length) return;
  const recarregar = async () => { const y = window.scrollY; await telaExtrato(); window.scrollTo(0, y); };
  $('#semelhantes').onchange = (ev) => { telaExtrato.semelhantes = ev.target.checked; };
  conteudo.querySelectorAll('#filtros-ext a').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); telaExtrato.filtro = a.dataset.f; telaExtrato(); }));
  conteudo.querySelectorAll('[data-cat]').forEach((i) => (i.onchange = async () => {
    try { await api('PUT', `${base}/${i.dataset.cat}`, { categoria: i.value.trim() || null, aplicarSemelhantes: $('#semelhantes').checked }); await recarregar(); }
    catch (e) { aviso(mensagemErro(e)); }
  }));
  conteudo.querySelectorAll('[data-des]').forEach((a) => (a.onclick = async (ev) => { ev.preventDefault(); await api('POST', `${base}/${a.dataset.des}/conciliar`, { cobrancaId: null }); await recarregar(); }));
  conteudo.querySelectorAll('[data-exi]').forEach((a) => (a.onclick = async (ev) => {
    ev.preventDefault();
    if (!confirm('Excluir esta importação e todos os lançamentos dela (inclusive as classificações)?')) return;
    await api('DELETE', `${base}/importacoes/${a.dataset.exi}`); await recarregar();
  }));
  conteudo.querySelectorAll('[data-bol]').forEach((b) => (b.onclick = async () => {
    const l = d.lancamentos.find((x) => x.id === Number(b.dataset.bol));
    const c = await api('GET', `${base}/${l.id}/boletos`);
    abrirDialogo(`<form id="form-lig"><h2>Ligar a um boleto</h2>
      <p class="sutil">${dataBr(l.data)} · ${esc(l.descricao)} · <strong>${brl(l.valor)}</strong></p>
      ${c.length ? `<div class="rolagem"><table class="tabela"><tbody>${c.map((x) => `<tr><td>${esc(x.tomador)}</td><td>${esc(x.descricao ?? '')}</td><td>venc. ${dataBr(x.vencimento)}</td><td>${x.status === 'PAGO' ? 'pago' : 'em aberto'}</td><td><button type="button" data-lig="${x.id}" data-st="${x.status}">Ligar</button></td></tr>`).join('')}</tbody></table></div>
      <label><input type="checkbox" name="baixa" checked> Se o boleto estiver em aberto, dar baixa como pago nesta data</label>`
      : '<p class="sutil">Nenhum boleto com este valor e data próxima. Confira se o valor recebido é o do boleto (descontos e juros mudam o valor).</p>'}
      <p class="erro" id="erro-lig"></p><div class="acoes"><button type="button" data-fechar>Fechar</button></div></form>`, (dlg) => {
      dlg.querySelectorAll('[data-lig]').forEach((x) => (x.onclick = async () => {
        try { await api('POST', `${base}/${l.id}/conciliar`, { cobrancaId: Number(x.dataset.lig), darBaixa: $('#form-lig').baixa?.checked ?? false }); dlg.close(); await recarregar(); }
        catch (e) { $('#erro-lig').textContent = mensagemErro(e); }
      }));
    });
  }));
}

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
        <td class="acoes-linha"><button data-ed="${x.id}">Editar</button> ${podeExcluirRegistros() ? `<button data-ex="${x.id}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
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
        ${empresa()?.modo_emissao === 'PORTAL' ? '<button type="button" class="primario" id="imp-xml">Importar nota do portal</button><input type="file" id="arq-xml" accept=".xml,text/xml" multiple hidden>' : ''}
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
  if ($('#imp-xml')) {
    $('#imp-xml').onclick = () => $('#arq-xml').click();
    $('#arq-xml').onchange = async (ev) => {
      const ok = [], erros = [];
      for (const arq of ev.target.files) {
        try { const r = await api('POST', `/api/empresas/${estado.empresaId}/notas/importar-xml`, { xml: await arq.text() }); ok.push(r); }
        catch (er) { erros.push(`${arq.name}: ${mensagemErro(er)}`); }
      }
      if (ok.length) aviso(`${ok.length} nota(s) importada(s).`);
      if (erros.length) aviso(erros.join(' · '));
      telaNotas();
    };
  }
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
  const podeExcluir = ['REJEITADA', 'ERRO_COMUNICACAO', 'PENDENTE'].includes(n.status) && !n.chave_acesso && estado.usuario.papel !== 'cliente' && podeExcluirRegistros();
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
      ${podeExcluir ? '<button class="perigo" id="b-excluir">Excluir nota</button>' : ''}
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
  $('#b-excluir') && ($('#b-excluir').onclick = async () => {
    const aviso2 = n.status === 'REJEITADA' ? '' : '\n\nAtenção: a Sefin pode já ter gerado esta nota. Use "Consultar na Sefin" antes, se tiver dúvida.';
    if (!confirm(`Excluir esta nota (DPS ${n.serie}/${n.n_dps})? Ela não foi autorizada e some do sistema. Não dá para desfazer.${aviso2}`)) return;
    try { await api('DELETE', `/api/notas/${id}`); aviso('Nota excluída.'); location.hash = '#/notas'; } catch (e) { aviso(mensagemErro(e)); }
  });
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
async function formTomador(t, aoSalvar) {
  const servicosEmpresa = await api('GET', `/api/empresas/${estado.empresaId}/servicos`).catch(() => []);
  t ??= { tipo_doc: 'CNPJ', modo_faturamento: 'NOTA', vencimento_tipo: 'PRAZO', vencimento_valor: 10, enviar_email_auto: 0 };
  abrirDialogo(`
    <form id="form-tomador"><h2>${t.id ? 'Editar cliente' : 'Novo cliente'}</h2>
      <nav class="abas" id="abas-cliente"><a href="#" data-aba="cadastro" class="ativo">Cadastro</a><a href="#" data-aba="servicos">Serviços padrão${t.servicos_padrao?.length ? ' •' : ''}</a><a href="#" data-aba="descontos">Descontos${t.desconto_valor ? ' •' : ''}</a></nav>
      <div data-painel="cadastro">
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
      </div>
      <div data-painel="servicos" hidden>
        <fieldset class="sub"><legend>Serviços que sempre são cobrados deste cliente</legend>
          <p class="dica">Escolha os serviços e o valor de cada um. Ao selecionar este cliente na emissão, o serviço principal e o valor já vêm preenchidos para a nota e para o boleto. Esses dados também serão a base da emissão agendada.</p>
          <div id="lista-serv-padrao"></div>
          <div class="acoes"><button type="button" id="add-serv-padrao" ${servicosEmpresa.length ? '' : 'disabled'}>Adicionar serviço</button></div>
          ${servicosEmpresa.length ? '' : '<p class="dica">Cadastre antes os serviços da empresa em Serviços.</p>'}
        </fieldset>
      </div>
      <div data-painel="descontos" hidden>
        <fieldset class="sub"><legend>Desconto fixo deste cliente</legend><div class="grade">
          <label>Valor do desconto (R$) <input name="desconto_valor" data-num inputmode="decimal" value="${t.desconto_valor ? String(t.desconto_valor).replace('.', ',') : ''}" placeholder="0,00"></label>
          <label class="largo">Motivo do desconto <input name="desconto_motivo" maxlength="80" value="${esc(t.desconto_motivo ?? '')}" placeholder="ex.: Desconto contratual de fidelidade"></label>
        </div>
        <p class="dica">O valor é abatido de <strong>todos os boletos</strong> deste cliente (emitidos com nota, só boleto ou reemitidos), e o motivo sai nas instruções do boleto. Na emissão da NFS-e o sistema lembra que o cliente tem desconto e deixa você decidir se lança também como desconto na nota. Deixe em branco para não ter desconto.</p></fieldset>
      </div>
      <p class="erro" id="erro-tomador"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar cliente</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-tomador');
    f.querySelectorAll('#abas-cliente a').forEach((a) => (a.onclick = (ev) => {
      ev.preventDefault();
      f.querySelectorAll('#abas-cliente a').forEach((x) => x.classList.toggle('ativo', x === a));
      f.querySelectorAll('[data-painel]').forEach((p) => (p.hidden = p.dataset.painel !== a.dataset.aba));
    }));
    // serviços padrão do cliente
    let padroes = (t.servicos_padrao ?? []).map((x) => ({ ...x }));
    const desenharPadroes = () => {
      const box = $('#lista-serv-padrao');
      box.innerHTML = padroes.length ? padroes.map((x, i) => `
        <div class="linha-serv">
          <label>Serviço <select data-sp="servico_id" data-i="${i}">${servicosEmpresa.some((sv) => sv.id === x.servico_id) ? '' : `<option value="${x.servico_id}">(serviço removido)</option>`}${servicosEmpresa.map((sv) => `<option value="${sv.id}" ${sv.id === x.servico_id ? 'selected' : ''}>${esc(sv.nome)}</option>`).join('')}</select></label>
          <label>Valor (R$) <input data-sp="valor" data-i="${i}" inputmode="decimal" value="${x.valor ? String(x.valor).replace('.', ',') : ''}"></label>
          <label class="largo">Texto na nota (opcional) <input data-sp="descricao" data-i="${i}" maxlength="2000" value="${esc(x.descricao ?? '')}" placeholder="vazio = descrição padrão do serviço"></label>
          <label><span><input type="radio" name="sp_principal" data-i="${i}" ${x.padrao ? 'checked' : ''}> Principal</span></label>
          <button type="button" data-sp-del="${i}">Remover</button>
        </div>`).join('') : '<p class="sutil">Nenhum serviço padrão cadastrado.</p>';
      box.querySelectorAll('[data-sp]').forEach((el) => (el.oninput = el.onchange = () => {
        const x = padroes[Number(el.dataset.i)], k = el.dataset.sp;
        x[k] = k === 'servico_id' ? Number(el.value) : k === 'valor' ? (numero(el.value) ?? 0) : el.value;
      }));
      box.querySelectorAll('[name=sp_principal]').forEach((r) => (r.onchange = () => padroes.forEach((x, j) => (x.padrao = j === Number(r.dataset.i)))));
      box.querySelectorAll('[data-sp-del]').forEach((b) => (b.onclick = () => { padroes.splice(Number(b.dataset.spDel), 1); if (padroes.length && !padroes.some((x) => x.padrao)) padroes[0].padrao = true; desenharPadroes(); }));
    };
    $('#add-serv-padrao').onclick = () => {
      const livre = servicosEmpresa.find((sv) => !padroes.some((x) => x.servico_id === sv.id)) ?? servicosEmpresa[0];
      padroes.push({ servico_id: livre.id, valor: livre.valor_padrao ?? 0, descricao: '', padrao: !padroes.length }); desenharPadroes();
    };
    desenharPadroes();
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
        if (padroes.some((x) => !(x.valor > 0))) throw new Error('Informe o valor de cada serviço padrão (aba Serviços padrão).');
        corpo.servicos_padrao = padroes.map((x) => ({ servico_id: x.servico_id, valor: x.valor, descricao: (x.descricao || '').trim() || null, padrao: !!x.padrao }));
        corpo.desconto_valor = numero(f.desconto_valor.value) || null; corpo.desconto_motivo = f.desconto_motivo.value.trim() || null;
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
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Documento</th><th>E-mail</th><th>Faturamento</th><th>Desconto</th></tr></thead><tbody>
      ${lista.map((t, i) => `<tr class="clicavel" data-i="${i}"><td>${esc(t.nome)}</td><td>${fmtDoc(t.documento)}</td><td>${esc(t.email ?? '')}</td><td>${NOME_MODO[t.modo_faturamento] ?? 'Nota'}</td><td>${t.desconto_valor ? `${brl(t.desconto_valor)}<br><span class="dica">${esc(t.desconto_motivo ?? '')}</span>` : ''}</td></tr>`).join('')}
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
  const tr = s.tributacao ?? {};
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
      <fieldset style="margin-top:16px"><legend>Tributação padrão do serviço</legend>
        <p class="dica">Estes dados vêm preenchidos na emissão sempre que o serviço for escolhido; você ainda pode alterar na nota.</p>
        <div class="grade">
          <label>ISSQN
            <select name="tribISSQN">${[[1, 'Operação tributável'], [2, 'Imunidade'], [3, 'Exportação de serviço'], [4, 'Não incidência']].map(([v, n]) => `<option value="${v}" ${(tr.tribISSQN ?? 1) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Retenção do ISSQN
            <select name="issRetido">${[[1, 'Não retido'], [2, 'Retido pelo tomador'], [3, 'Retido pelo intermediário']].map(([v, n]) => `<option value="${v}" ${(tr.issRetido ?? 1) === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Tipo de imunidade <select name="tpImunidade"><option value="">—</option>${[[0, 'Imunidade não informada'], [1, 'Patrimônio, renda ou serviços (art. 150, VI, a)'], [2, 'Templos de qualquer culto'], [3, 'Partidos, sindicatos, educação e assistência social'], [4, 'Livros, jornais e periódicos'], [5, 'Fonogramas e videofonogramas musicais']].map(([v, n]) => `<option value="${v}" ${tr.tpImunidade === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="dica">Só quando o ISSQN for “Imunidade”</span></label>
          <label>Município da prestação (IBGE) <input name="municipioPrestacao" maxlength="7" placeholder="Vazio = município da empresa" value="${esc(tr.municipioPrestacao ?? '')}"></label>
          <fieldset class="largo retencoes"><legend>Retenções federais padrão (%)</legend>
            <p class="dica">Percentuais que o tomador costuma reter. Na emissão eles calculam os valores sozinhos. Deixe em branco o que não se aplica.</p>
            <div class="grade">
              <label>PIS (%) <input name="pPis" data-num inputmode="decimal" value="${tr.pPis ?? ''}"></label>
              <label>COFINS (%) <input name="pCofins" data-num inputmode="decimal" value="${tr.pCofins ?? ''}"></label>
              <label>CSLL (%) <input name="pCsll" data-num inputmode="decimal" value="${tr.pCsll ?? ''}"></label>
              <label>IRRF (%) <input name="pIrrf" data-num inputmode="decimal" value="${tr.pIrrf ?? ''}"></label>
              <label>INSS / CP (%) <input name="pCp" data-num inputmode="decimal" value="${tr.pCp ?? ''}"></label>
              <label><span>&nbsp;</span><button type="button" id="ret-padrao-serv">Sugerir retenções usuais</button></label>
            </div>
          </fieldset>
          <fieldset class="largo retencoes"><legend>Totais aproximados de tributos (Lei 12.741) — % </legend>
            <div class="grade">
              <label>Federais <input name="tFed" data-num inputmode="decimal" value="${tr.pTotTrib?.fed ?? ''}"></label>
              <label>Estaduais <input name="tEst" data-num inputmode="decimal" value="${tr.pTotTrib?.est ?? ''}"></label>
              <label>Municipais <input name="tMun" data-num inputmode="decimal" value="${tr.pTotTrib?.mun ?? ''}"></label>
            </div>
          </fieldset>
          <label class="largo">Informações complementares padrão <textarea name="infoComplementar" maxlength="2000">${esc(tr.infoComplementar ?? '')}</textarea></label>
        </div>
      </fieldset>
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
        ${s.id && podeExcluirRegistros() ? '<button type="button" class="perigo" id="excluir">Desativar</button>' : ''}<button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-servico');
    ligarBuscaServicos(f);
    ligarBuscaNbs(f);
    $('#ret-padrao-serv').onclick = () => { ({ pPis: '0,65', pCofins: '3,00', pCsll: '1,00', pIrrf: '1,50' }, Object.entries({ pPis: '0,65', pCofins: '3,00', pCsll: '1,00', pIrrf: '1,50' }).forEach(([k, v]) => (f.elements[k].value = v))); };
    $('#excluir') && ($('#excluir').onclick = async () => { await api('DELETE', `/api/servicos/${s.id}`); d.close(); telaServicos(); });
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const x = lerForm(f);
      const corpo = {
        nome: x.nome, descricao: x.descricao, c_trib_nac: x.c_trib_nac, c_trib_mun: x.c_trib_mun, c_nbs: x.c_nbs,
        aliquota: x.aliquota, valor_padrao: x.valor_padrao,
        tributacao: {
          tribISSQN: Number(x.tribISSQN), issRetido: Number(x.issRetido), tpImunidade: x.tpImunidade === '' || x.tpImunidade == null ? null : Number(x.tpImunidade),
          pPis: x.pPis, pCofins: x.pCofins, pCsll: x.pCsll, pIrrf: x.pIrrf, pCp: x.pCp,
          pTotTrib: { fed: x.tFed, est: x.tEst, mun: x.tMun },
          municipioPrestacao: x.municipioPrestacao || null, infoComplementar: x.infoComplementar || null,
        },
        ibscbs: x.usaIbs ? { cIndOp: x.cIndOp, cst: x.cst, cClassTrib: x.cClassTrib, indFinal: Number(x.indFinal), indDest: Number(x.indDest) } : null,
      };
      try {
        s.id ? await api('PUT', `/api/servicos/${s.id}`, corpo) : await api('POST', `/api/empresas/${estado.empresaId}/servicos`, corpo);
        d.close(); aviso('Serviço salvo.'); telaServicos();
      } catch (e) { $('#erro-servico').textContent = mensagemErro(e); }
    };
  });
}

function resumoTributacao(s) {
  const t = s.tributacao ?? {}, p = [];
  p.push({ 1: 'Tributável', 2: 'Imunidade', 3: 'Exportação', 4: 'Não incidência' }[t.tribISSQN ?? 1]);
  if ((t.issRetido ?? 1) !== 1) p.push('ISS retido');
  const r = [['PIS', t.pPis], ['COFINS', t.pCofins], ['CSLL', t.pCsll], ['IRRF', t.pIrrf], ['CP', t.pCp]].filter(([, v]) => v);
  if (r.length) p.push('Ret.: ' + r.map(([n]) => n).join('/'));
  if (s.ibscbs) p.push('IBS/CBS ' + s.ibscbs.cClassTrib);
  return esc(p.join(' · '));
}

async function telaServicos() {
  const lista = await api('GET', `/api/empresas/${estado.empresaId}/servicos`);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Serviços</h1><p class="sutil">Modelos com código de tributação e alíquota, para emitir em poucos cliques.</p></div>
      <button class="primario" id="novo">Cadastrar serviço</button></div>
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Código nacional</th><th>NBS</th><th>Tributação</th><th class="num">Alíquota</th><th class="num">Valor padrão</th></tr></thead><tbody>
      ${lista.map((s, i) => `<tr class="clicavel" data-i="${i}"><td>${esc(s.nome)}</td><td>${s.c_trib_nac}${s.c_trib_mun ? ' / ' + s.c_trib_mun : ''}</td><td>${s.c_nbs ?? ''}</td><td>${resumoTributacao(s)}</td>
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
        <label class="largo">Como esta empresa emite as notas?
          <select name="modo_emissao"><option value="CERTIFICADO">Pelo sistema, com certificado digital A1</option><option value="PORTAL">Pelo portal do Emissor Nacional (CNPJ e senha), sem certificado</option></select></label>
        <div class="largo" id="bloco-portal" hidden>
          <p class="dica">Sem certificado o sistema não assina nem envia a nota. A nota é emitida no portal e o XML é importado aqui (Notas emitidas → Importar nota do portal), para gerar boletos, cobrança e contabilidade. A senha fica guardada criptografada neste computador e nunca aparece na tela.</p>
          <div class="grade">
            <label>Usuário do portal (CNPJ) <input name="portal_login" autocomplete="off" value="${esc(e.portal_login ?? '')}"></label>
            <label>Senha do portal <input name="portal_senha" type="password" autocomplete="new-password" placeholder="${e.tem_senha_portal ? 'Senha guardada — digite só para trocar' : ''}"></label>
          </div>
        </div>
      </div>
      <p class="erro" id="erro-empresa"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar empresa</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-empresa');
    for (const c of ['op_simp_nac', 'reg_ap_trib_sn', 'reg_esp_trib', 'ambiente']) if (e[c] != null) f[c].value = e[c];
    f.modo_emissao.value = e.modo_emissao ?? 'CERTIFICADO';
    const modo = () => ($('#bloco-portal').hidden = f.modo_emissao.value !== 'PORTAL');
    f.modo_emissao.onchange = modo; modo();
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
        <td>${e.ambiente === 1 ? 'Produção' : 'Testes'}</td><td>${e.modo_emissao === 'PORTAL' ? 'Portal (CNPJ e senha)' : e.tem_certificado ? `até ${dataBr(e.cert_validade)}` : '<span class="pendente-txt">Falta enviar</span>'}</td>
        <td><button data-editar="${i}">Editar</button> ${e.modo_emissao === 'PORTAL' ? '' : `<button data-cert="${i}">Certificado</button>`} <button data-logo="${i}">${e.tem_logo ? 'Logo ✓' : 'Logo'}</button> <button data-banco="${i}">Dados bancários</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Cadastre a primeira empresa cliente do escritório.</div>'}`;
  $('#novo').onclick = () => formEmpresa();
  conteudo.querySelectorAll('[data-editar]').forEach((b) => (b.onclick = () => formEmpresa(lista[b.dataset.editar])));
  conteudo.querySelectorAll('[data-cert]').forEach((b) => (b.onclick = () => formCertificado(lista[b.dataset.cert])));
  conteudo.querySelectorAll('[data-logo]').forEach((b) => (b.onclick = () => formLogo(lista[b.dataset.logo])));
  conteudo.querySelectorAll('[data-banco]').forEach((b) => (b.onclick = () => {
    estado.empresaId = lista[b.dataset.banco].id; localStorage.setItem('empresaId', estado.empresaId);
    api('PUT', '/api/me/empresa', { id: estado.empresaId }).catch(() => {});
    $('#empresa-atual').value = estado.empresaId; infoEmpresa(); location.hash = '#/banco';
  }));
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
    ['aparencia', 'Aparência', true], ['backup', 'Backup', adm], ['contabilidade', 'Contabilidade', adm], ['licenca', 'Licença', true], ['atualizacoes', 'Atualizações', true],
  ].filter((x) => x[2]);
  if (!abas.some((x) => x[0] === aba)) aba = abas[0][0];
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Configurações</h1><p class="sutil">Ajustes gerais do sistema${adm ? '' : ' e da sua conta'}.</p></div></div>
    <nav class="abas" aria-label="Configurações">${abas.map(([k, nome]) => `<a href="#/config/${k}" class="${k === aba ? 'ativo' : ''}">${nome}</a>`).join('')}</nav>
    <div id="cfg-corpo"></div>`;
  const tela = { conta: telaMinhaConta, usuarios: telaUsuarios, email: telaEmail, aparencia: telaAparencia, backup: telaBackup, contabilidade: telaContabilidade, licenca: telaLicenca, atualizacoes: telaAtualizacoes }[aba];
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

const TEMAS = [
  { id: 'preto-laranja', nome: 'Preto e laranja', cores: ['#0f0f0f', '#0a0a0a', '#fb923d'] },
  { id: 'branco-laranja', nome: 'Branco e laranja', cores: ['#ffffff', '#f6f3ef', '#d9600c'] },
  { id: 'azul-dourado', nome: 'Azul e dourado', cores: ['#060d1d', '#091226', '#dcb25a'] },
];
function aplicarTema(id) {
  document.documentElement.dataset.tema = id;
  try { localStorage.setItem('tema', id); } catch { /* sem armazenamento: vale só nesta sessão */ }
}

function telaAparencia() {
  const atual = document.documentElement.dataset.tema || 'preto-laranja';
  corpoConfig().innerHTML = `
    <h2>Aparência</h2>
    <div class="cartao"><p class="sutil">Escolha as cores do sistema. A escolha vale para este computador e é guardada para as próximas vezes.</p>
      <div class="temas">${TEMAS.map((t) => `<button type="button" class="tema-opcao ${t.id === atual ? 'ativo' : ''}" data-tema="${t.id}" aria-pressed="${t.id === atual}">
        <span class="tema-amostra" style="background:${t.cores[1]}"><i style="background:${t.cores[0]}"></i><b style="background:${t.cores[2]}"></b></span>
        <strong>${t.nome}</strong></button>`).join('')}</div></div>`;
  corpoConfig().querySelectorAll('[data-tema]').forEach((b) => (b.onclick = () => { aplicarTema(b.dataset.tema); telaAparencia(); }));
}

async function telaContabilidade() {
  const e = empresa();
  const hoje0 = new Date(Date.now() - 3 * 3600e3), ini = new Date(Date.UTC(hoje0.getUTCFullYear(), hoje0.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const fim = new Date(Date.UTC(hoje0.getUTCFullYear(), hoje0.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  corpoConfig().innerHTML = `
    <h2>Exportar para a contabilidade</h2>
    <div class="cartao">
      <p class="sutil">Gera um único arquivo ZIP para enviar ao contador, da empresa selecionada${e ? ': <strong>' + esc(e.razao_social) + '</strong>' : ''}. Para trocar a empresa, use o seletor no topo.</p>
      <form id="form-contab" class="grade">
        <label>De <input type="date" name="de" required value="${ini}"></label>
        <label>Até <input type="date" name="ate" required value="${fim}"></label>
        <label class="largo"><span><input type="checkbox" name="xml" checked> XML das notas emitidas</span></label>
        <label class="largo"><span><input type="checkbox" name="pdf" checked> PDF (DANFSe) das notas emitidas</span></label>
        <label class="largo"><span><input type="checkbox" name="ofx" checked> Extrato em OFX (do extrato importado; sem ele, boletos recebidos e despesas lançadas)</span>
          <span class="dica">Também vai uma planilha com a mesma movimentação, e outra com a lista das notas. As notas são escolhidas pela competência.</span></label>
        <p class="erro" id="erro-contab"></p>
        <div class="acoes largo"><button class="primario" type="submit" ${e ? '' : 'disabled'}>Gerar pacote (ZIP)</button></div>
      </form>
    </div>`;
  $('#form-contab').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target, b = f.querySelector('[type=submit]');
    b.disabled = true; b.textContent = 'Gerando…'; $('#erro-contab').textContent = '';
    const p = new URLSearchParams({ empresaId: estado.empresaId, de: f.de.value, ate: f.ate.value, xml: +f.xml.checked, pdf: +f.pdf.checked, ofx: +f.ofx.checked });
    try { await baixar(`/api/contabilidade/exportar?${p}`, `contabilidade_${f.de.value}_${f.ate.value}.zip`); } finally { b.disabled = false; b.textContent = 'Gerar pacote (ZIP)'; }
  };
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
        <div id="atu-notas" class="novidades-caixa" hidden></div>
        <div class="acoes"><button class="primario" id="atu-verificar">Verificar agora</button><button id="atu-instalar" hidden>Atualizar agora</button></div>`
        : '<p class="sutil">A busca automática de atualizações funciona no aplicativo instalado no Windows. Neste modo de uso, a atualização é feita com o instalador novo.</p>'}
    </div>`;
  if (!ponte?.verificarAtualizacao) return;
  const mostrar = (e) => {
    $('#atu-status').textContent = desc(e) + (e?.em ? ` (verificado às ${new Date(e.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : '');
    $('#atu-instalar').hidden = e?.situacao !== 'nova';
    const n = $('#atu-notas'); n.hidden = !(e?.situacao === 'nova' && e.notas);
    if (!n.hidden) n.innerHTML = `<strong>Novidades da versão ${esc(e.versao)}</strong><br>${esc(e.notas).replace(/\n/g, '<br>')}`;
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
    faixa.innerHTML = `<span><strong>Nova versão ${esc(info.versao)} disponível.</strong> Seus dados são preservados e uma cópia de segurança é feita antes de atualizar.
      ${info.notas ? `<details class="novidades"><summary>Ver novidades</summary><div>${esc(info.notas).replace(/\n/g, '<br>')}</div></details>` : ''}</span>
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
