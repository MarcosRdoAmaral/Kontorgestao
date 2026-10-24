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
    const info = form.querySelector('[data-municipio]');
    if (info) info.textContent = `${r.localidade}/${r.uf} — IBGE ${r.ibge}`;
  } catch { /* sem internet: preenchimento manual */ }
}

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
      body: JSON.stringify({ escritorio: f.escritorio.value, nome: f.nome.value, email: f.email.value, senha: f.senha.value }) });
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
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value, senha: f.senha.value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro);
    estado.token = j.token;
    localStorage.setItem('token', j.token);
    iniciar();
  } catch (e) { $('#erro-login').textContent = e.message; }
};
$('#sair').onclick = sair;

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
  $('#nome-usuario').textContent = estado.usuario.nome;
  document.querySelectorAll('[data-papel]').forEach((a) => (a.hidden = !a.dataset.papel.split(' ').includes(estado.usuario.papel)));
  await carregarEmpresas();
  rotear();
}

const rotas = {
  painel: telaPainel, emitir: telaEmitir, notas: telaNotas, nota: telaNota,
  tomadores: telaTomadores, servicos: telaServicos, empresas: telaEmpresas, usuarios: telaUsuarios, email: telaEmail, backup: telaBackup,
};

function rotear() {
  const [, nome = 'painel', param] = location.hash.split('/');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('ativo', a.getAttribute('href') === `#/${nome}`));
  const precisaEmpresa = !['painel', 'empresas', 'usuarios', 'nota', 'backup', 'email'].includes(nome);
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
  conteudo.innerHTML = `
    <div class="topo">
      <div><h1>Painel do mês</h1><p class="sutil">Notas por competência, em todas as empresas que você acompanha.</p></div>
      <label>Competência <input type="month" id="mes" value="${mes}"></label>
    </div>
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
        <div class="acoes"><button type="button" id="novo-tomador">Cadastrar novo tomador</button></div>
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
          ${empresa()?.ambiente === 1 && estado.usuario.papel !== 'cliente' ? '<label class="largo"><span><input type="checkbox" name="enviarEmail"> Enviar por e-mail ao tomador quando a nota for autorizada</span><span class="dica">Usa o e-mail do cadastro do tomador. Configure o servidor em E-mail.</span></label>' : ''}
          <label class="largo">Informações complementares <textarea name="infoComplementar" maxlength="2000">${esc(p.infoComplementar ?? '')}</textarea></label>
        </div>
      </fieldset>
      <p class="erro" id="erro-emitir" role="alert"></p>
      <div class="acoes"><button class="primario" type="submit">${corrigindo ? 'Reenviar à Sefin' : 'Emitir nota'}</button></div>
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
      const nota = corrigindo ? await api('POST', `/api/notas/${corrigindo.id}/reenviar`, corpo) : await api('POST', '/api/notas', corpo);
      aviso(nota.status === 'AUTORIZADA' ? `NFS-e nº ${nota.n_nfse} autorizada.` : `A nota ficou ${STATUS[nota.status].toLowerCase()}. Veja o motivo.`);
      if (nota.status === 'AUTORIZADA' && d.enviarEmail) {
        // o envio é opcional: se falhar (sem e-mail no tomador, SMTP errado), a nota continua válida
        try {
          const completa = await api('GET', `/api/notas/${nota.id}`);
          if (!completa.tomador_email) throw new Error('o tomador não tem e-mail cadastrado');
          await api('POST', `/api/notas/${nota.id}/email`, { para: [completa.tomador_email] });
          aviso(`NFS-e nº ${nota.n_nfse} autorizada e enviada para ${completa.tomador_email}.`);
        } catch (e2) { aviso(`NFS-e autorizada, mas o e-mail não foi enviado: ${mensagemErro(e2)}`); }
      }
      location.hash = `#/nota/${nota.id}`;
    } catch (err) {
      $('#erro-emitir').textContent = mensagemErro(err);
      botao.disabled = false; botao.textContent = corrigindo ? 'Reenviar à Sefin' : 'Emitir nota';
    }
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
      ${n.chave_acesso ? `<button class="primario" id="b-pdf">Abrir DANFSe</button><button id="b-xml">Baixar XML</button><button id="b-portal">Consultar no portal nacional</button>${estado.usuario.papel !== 'cliente' && n.ambiente === 1 ? '<button id="b-email">Enviar por e-mail</button>' : ''}` : ''}
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
    <form id="form-email"><h2>Enviar NFS-e nº ${n.n_nfse} por e-mail</h2>
      <p class="sutil">Segue o PDF (DANFSe) e o XML em anexo. Separe vários e-mails com vírgula (até 5).</p>
      <label>Para <input name="para" required placeholder="cliente@empresa.com.br" value="${esc(n.tomador_email ?? '')}"></label>
      <p class="erro" id="erro-email"></p>
      <div class="acoes"><button class="primario" type="submit">Enviar</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    $('#form-email').onsubmit = async (ev) => {
      ev.preventDefault();
      const botao = ev.target.querySelector('[type=submit]');
      botao.disabled = true; botao.textContent = 'Enviando…';
      try {
        await api('POST', `/api/notas/${id}/email`, { para: ev.target.para.value.split(/[,;\s]+/).filter(Boolean) });
        d.close(); aviso('E-mail enviado.'); telaNota(id);
      } catch (er) { $('#erro-email').textContent = mensagemErro(er); botao.disabled = false; botao.textContent = 'Enviar'; }
    };
  }));
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
      </div>
      <p class="erro" id="erro-cancelar"></p>
      <div class="acoes"><button class="perigo" type="submit">Cancelar nota</button><button type="button" data-fechar>Voltar</button></div>
    </form>`, (d) => {
    $('#form-cancelar').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try { await api('POST', `/api/notas/${id}/cancelar`, { cMotivo: Number(f.cMotivo.value), xMotivo: f.xMotivo.value }); d.close(); aviso('Nota cancelada.'); telaNota(id); }
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

function formTomador(t, aoSalvar) {
  t ??= { tipo_doc: 'CNPJ' };
  abrirDialogo(`
    <form id="form-tomador"><h2>${t.id ? 'Editar tomador' : 'Novo tomador'}</h2>
      <div class="grade">
        <label>Tipo <select name="tipo_doc">${['CNPJ', 'CPF', 'SEM'].map((v) => `<option value="${v}" ${t.tipo_doc === v ? 'selected' : ''}>${v === 'SEM' ? 'Sem documento' : v}</option>`).join('')}</select></label>
        <label>CNPJ / CPF <span class="linha-campo"><input name="documento" value="${esc(t.documento ?? '')}"><button type="button" data-buscar-cnpj>Buscar CNPJ</button></span><span class="dica" data-cnpj-info>Digite o CNPJ e clique em Buscar para preencher os dados.</span></label>
        <label class="largo">Nome / Razão social <input name="nome" required value="${esc(t.nome ?? '')}"></label>
        <label>E-mail <input name="email" type="email" value="${esc(t.email ?? '')}"></label>
        <label>Telefone <input name="fone" value="${esc(t.fone ?? '')}"></label>
        <label>Inscrição municipal <input name="inscricao_municipal" value="${esc(t.inscricao_municipal ?? '')}"></label>
        <label>CEP <input name="cep" value="${esc(t.cep ?? '')}"><span class="dica" data-municipio></span></label>
        <label>Município (IBGE) <input name="cod_municipio" maxlength="7" value="${esc(t.cod_municipio ?? '')}"></label>
        <label class="largo">Logradouro <input name="logradouro" value="${esc(t.logradouro ?? '')}"></label>
        <label>Número <input name="numero" value="${esc(t.numero ?? '')}"></label>
        <label>Complemento <input name="complemento" value="${esc(t.complemento ?? '')}"></label>
        <label>Bairro <input name="bairro" value="${esc(t.bairro ?? '')}"></label>
      </div>
      <p class="dica">Endereço é opcional; se preencher, informe CEP, município, logradouro e bairro.</p>
      <p class="erro" id="erro-tomador"></p>
      <div class="acoes"><button class="primario" type="submit">Salvar tomador</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    const f = $('#form-tomador');
    f.cep.onblur = () => buscarCep(f);
    ligarConsultaCnpj(f, 'tomador');
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const corpo = lerForm(f);
        const r = t.id ? await api('PUT', `/api/tomadores/${t.id}`, corpo) : await api('POST', `/api/empresas/${estado.empresaId}/tomadores`, corpo);
        d.close(); aviso('Tomador salvo.');
        aoSalvar?.(t.id ?? r.id);
      } catch (e) { $('#erro-tomador').textContent = mensagemErro(e); }
    };
  });
}

async function telaTomadores() {
  const lista = await api('GET', `/api/empresas/${estado.empresaId}/tomadores`);
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Tomadores</h1><p class="sutil">Clientes de ${esc(empresa().razao_social)}.</p></div>
      <button class="primario" id="novo">Cadastrar tomador</button></div>
    ${lista.length ? `<div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>Documento</th><th>E-mail</th><th>Município</th></tr></thead><tbody>
      ${lista.map((t, i) => `<tr class="clicavel" data-i="${i}"><td>${esc(t.nome)}</td><td>${fmtDoc(t.documento)}</td><td>${esc(t.email ?? '')}</td><td>${esc(t.cod_municipio ?? '')}</td></tr>`).join('')}
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

async function telaUsuarios() {
  const lista = await api('GET', '/api/usuarios');
  const papeis = { admin: 'Administrador', operador: 'Operador do escritório', cliente: 'Cliente (só as próprias empresas)' };
  conteudo.innerHTML = `
    <div class="topo"><div><h1>Usuários</h1><p class="sutil">Equipe do escritório e, quando quiser, acesso dos próprios clientes.</p></div>
      <button class="primario" id="novo">Adicionar usuário</button></div>
    <div class="rolagem"><table class="tabela"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Empresas</th></tr></thead><tbody>
      ${lista.map((x) => `<tr><td>${esc(x.nome)}</td><td>${esc(x.email)}</td><td>${papeis[x.papel]}</td>
        <td>${x.papel === 'cliente' ? (x.empresas ?? '').split(',').filter(Boolean).map((id) => esc(estado.empresas.find((e) => e.id === Number(id))?.razao_social ?? id)).join(', ') : 'Todas'}</td></tr>`).join('')}
    </tbody></table></div>`;
  $('#novo').onclick = () => abrirDialogo(`
    <form id="form-usuario"><h2>Novo usuário</h2>
      <div class="grade">
        <label>Nome <input name="nome" required></label>
        <label>E-mail <input name="email" type="email" required></label>
        <label>Senha inicial <input name="senha" type="password" minlength="8" required></label>
        <label>Perfil <select name="papel">${Object.entries(papeis).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <fieldset style="margin-top:16px"><legend>Empresas que o cliente pode ver</legend>
        ${estado.empresas.map((e) => `<label><span><input type="checkbox" name="emp" value="${e.id}"> ${esc(e.razao_social)}</span></label>`).join('')}
      </fieldset>
      <p class="erro" id="erro-usuario"></p>
      <div class="acoes"><button class="primario" type="submit">Adicionar usuário</button><button type="button" data-fechar>Fechar</button></div>
    </form>`, (d) => {
    $('#form-usuario').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const empresas = [...f.querySelectorAll('[name=emp]:checked')].map((c) => Number(c.value));
      try {
        await api('POST', '/api/usuarios', { nome: f.nome.value, email: f.email.value, senha: f.senha.value, papel: f.papel.value, empresas });
        d.close(); aviso('Usuário adicionado.'); telaUsuarios();
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
  conteudo.innerHTML = `
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
  $('#testar').onclick = async (ev) => {
    const para = prompt('Enviar e-mail de teste para qual endereço?', estado.usuario.email);
    if (!para) return;
    ev.target.disabled = true; ev.target.textContent = 'Enviando…';
    try { await api('POST', '/api/email/testar', { para }); aviso('E-mail de teste enviado. Confira a caixa de entrada.'); }
    catch (e) { $('#erro-smtp').textContent = mensagemErro(e); }
    ev.target.disabled = false; ev.target.textContent = 'Enviar e-mail de teste';
  };
}

async function telaBackup() {
  const b = await api('GET', '/api/backup');
  const tam = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  conteudo.innerHTML = `
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
