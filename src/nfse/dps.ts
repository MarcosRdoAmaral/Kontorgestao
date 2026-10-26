import { dec, g, t, texto } from './xml.js';
import { limparDoc, soDigitos } from './validacao.js';

export const NS_NFSE = 'http://www.sped.fazenda.gov.br/nfse';
export const VERSAO_DPS = '1.01';

export interface Endereco {
  cMun: string;      // IBGE 7 dígitos
  cep: string;
  xLgr: string;
  nro: string;
  xCpl?: string;
  xBairro: string;
}

export interface DadosDPS {
  tpAmb: 1 | 2;
  dhEmi: string;
  verAplic: string;
  serie: string;
  nDPS: number;
  dCompet: string;   // AAAA-MM-DD
  cLocEmi: string;
  prestador: {
    documento: string;
    im?: string;
    fone?: string;
    email?: string;
    opSimpNac: 1 | 2 | 3;
    regApTribSN?: 1 | 2 | 3;
    regEspTrib: number;
  };
  tomador?: {
    documento?: string;
    nome: string;
    im?: string;
    end?: Endereco;
    fone?: string;
    email?: string;
  };
  servico: {
    cLocPrestacao: string;
    cTribNac: string;
    cTribMun?: string;
    xDescServ: string;
    cNBS?: string;
    xInfComp?: string;
  };
  valores: {
    vServ: number;
    vDescIncond?: number;
    vDescCond?: number;
    /** 1 Tributável, 2 Imunidade, 3 Exportação, 4 Não incidência */
    tribISSQN: 1 | 2 | 3 | 4;
    tpImunidade?: number;
    cPaisResult?: string;
    /** 1 Não retido, 2 Retido pelo tomador, 3 Retido pelo intermediário */
    tpRetISSQN: 1 | 2 | 3;
    pAliq?: number;
    vRetCP?: number;
    vRetIRRF?: number;
    vRetCSLL?: number;
    /** PIS/COFINS (grupo piscofins de tribFed): informado quando há retenção federal. */
    pisCofins?: { cst: string; base?: number; pPis?: number; pCofins?: number; vPis?: number; vCofins?: number; tpRet: number };
    /** % aproximado de tributos — Simples Nacional (ME/EPP) */
    pTotTribSN?: number;
    /** % aproximado de tributos — demais regimes */
    pTotTrib?: { fed: number; est: number; mun: number };
  };
  /** Grupo IBS/CBS (Reforma Tributária). Obrigatório para o regime regular. */
  ibscbs?: {
    finNFSe?: 0;
    indFinal: 0 | 1;
    cIndOp: string;
    indDest: 0 | 1;
    cst: string;
    cClassTrib: string;
    /** Reembolsos/repasses de terceiros: não entram na base do ISSQN, IBS e CBS. */
    reeRepRes?: {
      tipo: string; descricao?: string | null;
      doc: { t: 'DFE'; tipoChave: string; chave: string } | { t: 'FISCAL'; cMun: string; numero: string; descricao: string } | { t: 'OUTRO'; numero: string; descricao: string };
      fornecedorDoc?: string | null; fornecedorNome?: string | null; dtEmi: string; dtComp: string; valor: number;
    }[];
  };
}

function pisCofinsXml(p: NonNullable<DadosDPS['valores']['pisCofins']> | undefined): string {
  if (!p) return '';
  return g('piscofins', t('CST', p.cst), t('vBCPisCofins', dec(p.base)), t('pAliqPis', dec(p.pPis)), t('pAliqCofins', dec(p.pCofins)),
    t('vPis', dec(p.vPis)), t('vCofins', dec(p.vCofins)), t('tpRetPisCofins', p.tpRet));
}

/** "DPS" + cMun(7) + tipo inscrição(1: 1=CPF, 2=CNPJ) + inscrição(14) + série(5) + número(15) = 45 posições */
export function gerarIdDps(cLocEmi: string, documentoPrestador: string, serie: string, nDPS: number): string {
  const doc = limparDoc(documentoPrestador);
  const tipo = doc.length === 11 ? '1' : '2';
  return `DPS${cLocEmi}${tipo}${doc.padStart(14, '0')}${soDigitos(serie).padStart(5, '0')}${String(nDPS).padStart(15, '0')}`;
}

/** Identificação de pessoa: CNPJ ou CPF conforme o tamanho do documento. */
function reeRepResXml(l: NonNullable<DadosDPS['ibscbs']>['reeRepRes']): string {
  if (!l?.length) return '';
  return g('gReeRepRes', l.map((r) => {
    const d = r.doc;
    const doc = d.t === 'DFE' ? g('dFeNacional', t('tipoChaveDFe', d.tipoChave), d.tipoChave === '9' ? t('xTipoChaveDFe', 'Outro') : '', t('chaveDFe', d.chave))
      : d.t === 'FISCAL' ? g('docFiscalOutro', t('cMunDocFiscal', d.cMun), t('nDocFiscal', d.numero), t('xDocFiscal', d.descricao))
      : g('docOutro', t('nDoc', d.numero), t('xDoc', d.descricao));
    const fd = limparDoc(r.fornecedorDoc ?? undefined);
    const fornec = fd && r.fornecedorNome ? g('fornec', docPessoa(fd), t('xNome', r.fornecedorNome)) : '';
    return g('documentos', doc, fornec, t('dtEmiDoc', r.dtEmi), t('dtCompDoc', r.dtComp), t('tpReeRepRes', r.tipo), r.tipo === '99' ? t('xTpReeRepRes', r.descricao ?? '') : '', t('vlrReeRepRes', dec(r.valor)));
  }).join(''));
}

function docPessoa(documento?: string): string {
  const d = limparDoc(documento);
  if (!d) return '';
  return d.length === 11 ? t('CPF', d) : t('CNPJ', d);
}

function endereco(e?: Endereco): string {
  if (!e) return '';
  return g(
    'end',
    g('endNac', t('cMun', e.cMun), t('CEP', soDigitos(e.cep))),
    t('xLgr', texto(e.xLgr, 255)),
    t('nro', texto(e.nro, 60)),
    t('xCpl', texto(e.xCpl, 156)),
    t('xBairro', texto(e.xBairro, 60)),
  );
}

/**
 * Monta o XML da DPS (leiaute 1.01) na ordem exata do xs:sequence do XSD oficial.
 * Retorna o XML sem assinatura; a assinatura é aplicada em seguida sobre infDPS.
 */
export function montarDps(d: DadosDPS): { xml: string; id: string } {
  const id = gerarIdDps(d.cLocEmi, d.prestador.documento, d.serie, d.nDPS);
  const p = d.prestador;
  const v = d.valores;

  // Quando o emitente é o próprio prestador (tpEmit=1), nome e endereço NÃO são informados:
  // a Sefin usa o Cadastro Nacional (informá-los gera rejeição).
  const prest = g(
    'prest',
    docPessoa(p.documento),
    t('IM', p.im),
    t('fone', soDigitos(p.fone) || undefined),
    t('email', p.email),
    g('regTrib', t('opSimpNac', p.opSimpNac), p.opSimpNac === 3 ? t('regApTribSN', p.regApTribSN ?? 1) : '', t('regEspTrib', p.regEspTrib)),
  );

  const toma = d.tomador
    ? g(
        'toma',
        docPessoa(d.tomador.documento),
        t('IM', d.tomador.im),
        t('xNome', texto(d.tomador.nome, 300)),
        endereco(d.tomador.end),
        t('fone', soDigitos(d.tomador.fone) || undefined),
        t('email', d.tomador.email),
      )
    : '';

  const serv = g(
    'serv',
    g('locPrest', t('cLocPrestacao', d.servico.cLocPrestacao)),
    g(
      'cServ',
      t('cTribNac', soDigitos(d.servico.cTribNac)),
      t('cTribMun', d.servico.cTribMun),
      t('xDescServ', texto(d.servico.xDescServ, 2000)),
      t('cNBS', soDigitos(d.servico.cNBS) || undefined),
    ),
    d.servico.xInfComp ? g('infoCompl', t('xInfComp', texto(d.servico.xInfComp, 2000))) : '',
  );

  let totTrib: string;
  if (v.pTotTribSN !== undefined && v.pTotTribSN !== null) totTrib = t('pTotTribSN', dec(v.pTotTribSN));
  // E0713: não optante do Simples não pode usar indTotTrib nem pTotTribSN; informa o percentual aproximado (Lei 12.741)
  else if (d.prestador.opSimpNac === 1) totTrib = g('pTotTrib', t('pTotTribFed', dec(v.pTotTrib?.fed ?? 0)), t('pTotTribEst', dec(v.pTotTrib?.est ?? 0)), t('pTotTribMun', dec(v.pTotTrib?.mun ?? 0)));
  else if (v.pTotTrib) totTrib = g('pTotTrib', t('pTotTribFed', dec(v.pTotTrib.fed)), t('pTotTribEst', dec(v.pTotTrib.est)), t('pTotTribMun', dec(v.pTotTrib.mun)));
  else totTrib = t('indTotTrib', 0);

  const valores = g(
    'valores',
    g('vServPrest', t('vServ', dec(v.vServ))),
    v.vDescIncond || v.vDescCond ? g('vDescCondIncond', t('vDescIncond', dec(v.vDescIncond || undefined)), t('vDescCond', dec(v.vDescCond || undefined))) : '',
    g(
      'trib',
      g(
        'tribMun',
        t('tribISSQN', v.tribISSQN),
        v.tribISSQN === 3 ? t('cPaisResult', v.cPaisResult) : '',
        v.tribISSQN === 2 ? t('tpImunidade', v.tpImunidade) : '',
        t('tpRetISSQN', v.tpRetISSQN),
        v.tribISSQN === 1 ? t('pAliq', dec(v.pAliq)) : '',
      ),
      g('tribFed', pisCofinsXml(v.pisCofins), t('vRetCP', dec(v.vRetCP || undefined)), t('vRetIRRF', dec(v.vRetIRRF || undefined)), t('vRetCSLL', dec(v.vRetCSLL || undefined))),
      g('totTrib', totTrib),
    ),
  );

  const ib = d.ibscbs;
  const ibscbs = ib
    ? g(
        'IBSCBS',
        t('finNFSe', ib.finNFSe ?? 0),
        t('indFinal', ib.indFinal),
        t('cIndOp', ib.cIndOp),
        t('indDest', ib.indDest),
        g('valores', reeRepResXml(ib.reeRepRes), g('trib', g('gIBSCBS', t('CST', ib.cst), t('cClassTrib', ib.cClassTrib)))),
      )
    : '';

  const inf =
    `<infDPS Id="${id}">` +
    t('tpAmb', d.tpAmb) +
    t('dhEmi', d.dhEmi) +
    t('verAplic', d.verAplic) +
    t('serie', soDigitos(d.serie)) +
    t('nDPS', d.nDPS) +
    t('dCompet', d.dCompet) +
    t('tpEmit', 1) +
    t('cLocEmi', d.cLocEmi) +
    prest +
    toma +
    serv +
    valores +
    ibscbs +
    `</infDPS>`;

  return { id, xml: `<DPS xmlns="${NS_NFSE}" versao="${VERSAO_DPS}">${inf}</DPS>` };
}
