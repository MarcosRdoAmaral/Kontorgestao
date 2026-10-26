import crypto from 'node:crypto';
import tls from 'node:tls';
import forge from 'node-forge';
import { unzipSync } from 'fflate';
import { db } from '../db.js';

/**
 * Confiança no servidor da SEFAZ (Ambiente Nacional da NF-e).
 *
 * Os web services da NF-e usam certificados da cadeia ICP-Brasil, que não está na lista de
 * autoridades do Node/Electron. Para a conexão com a SEFAZ (e só para ela) o sistema confia em:
 *  1. autoridades padrão do Node;
 *  2. autoridades do sistema operacional (repositório do Windows), quando o Node permite ler;
 *  3. a cadeia ICP-Brasil guardada no banco — baixada do repositório oficial do ITI ou enviada
 *     pelo administrador (arquivo .zip/.crt/.cer/.pem/.p7b).
 * Como último recurso o administrador pode desligar a verificação do servidor (não recomendado).
 */

const P_CADEIA = 'sefaz_cadeia_icp';
const P_VERIFICAR = 'sefaz_verificar_servidor';

/** Repositório oficial do ITI: pacote com todas as ACs da ICP-Brasil e, em separado, as raízes. */
export const URLS_CADEIA_ICP = [
  'https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip',
  'https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv10.crt',
  'https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv5.crt',
  'https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv11.crt',
  'https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv12.crt',
];

export function parametro(nome: string): string | null {
  const r = db.prepare('SELECT valor FROM parametros WHERE nome = ?').get(nome) as { valor: string } | undefined;
  return r?.valor ?? null;
}

export function definirParametro(nome: string, valor: string | null) {
  if (valor == null) db.prepare('DELETE FROM parametros WHERE nome = ?').run(nome);
  else db.prepare('INSERT INTO parametros (nome, valor) VALUES (?, ?) ON CONFLICT(nome) DO UPDATE SET valor = excluded.valor').run(nome, valor);
}

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * Extrai os certificados de autoridade (AC) de um arquivo: PEM (um ou vários), DER (.cer/.crt),
 * PKCS#7 (.p7b, PEM ou DER) ou ZIP contendo esses arquivos. Certificados que não são de AC são ignorados.
 */
export function extrairCertificadosAc(dados: Buffer, profundidade = 0): string[] {
  const saida = new Map<string, string>();
  const tentar = (der: Buffer | string) => {
    try {
      const x = new crypto.X509Certificate(der);
      if (x.ca) saida.set(x.fingerprint256, x.toString());
    } catch { /* não é certificado */ }
  };
  const ehZip = dados.length > 4 && dados.readUInt32LE(0) === 0x04034b50;
  if (ehZip) {
    if (profundidade > 2) return [];
    let arquivos: Record<string, Uint8Array> = {};
    try { arquivos = unzipSync(new Uint8Array(dados)); } catch { return []; }
    for (const [nome, conteudo] of Object.entries(arquivos)) {
      if (nome.endsWith('/') || !conteudo.length) continue;
      for (const pem of extrairCertificadosAc(Buffer.from(conteudo), profundidade + 1)) tentar(pem);
    }
    return [...saida.values()];
  }
  const texto = dados.toString('latin1');
  const pems = texto.match(PEM_RE);
  if (pems) pems.forEach(tentar);
  if (/-----BEGIN PKCS7-----/.test(texto)) {
    for (const der of certificadosDoPkcs7(forge.pem.decode(texto).find((b) => b.type === 'PKCS7')?.body)) tentar(der);
  }
  if (!pems && !/-----BEGIN/.test(texto)) {
    const antes = saida.size;
    tentar(dados);
    if (saida.size === antes) for (const der of certificadosDoPkcs7(dados.toString('binary'))) tentar(der);
  }
  return [...saida.values()];
}

/** Lê os certificados de um PKCS#7 (SignedData) direto da estrutura ASN.1, aceitando qualquer tipo de chave. */
function certificadosDoPkcs7(binario: string | undefined): Buffer[] {
  if (!binario) return [];
  try {
    const raiz = forge.asn1.fromDer(binario);
    // ContentInfo ::= SEQUENCE { contentType, [0] EXPLICIT SignedData }
    const signedData = ((raiz.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0];
    const campos = signedData.value as forge.asn1.Asn1[];
    // SignedData: version, digestAlgorithms, contentInfo, [0] IMPLICIT certificates, ...
    const certs = campos.find((c) => c.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && c.type === 0);
    return ((certs?.value ?? []) as forge.asn1.Asn1[]).map((c) => Buffer.from(forge.asn1.toDer(c).getBytes(), 'binary'));
  } catch {
    return [];
  }
}

export function cadeiaIcpGuardada(): string[] {
  const v = parametro(P_CADEIA);
  return v ? v.match(PEM_RE) ?? [] : [];
}

/** Acrescenta certificados de AC à cadeia guardada. Retorna quantos ficaram no total. */
export function guardarCadeiaIcp(pems: string[]): number {
  const todos = new Map<string, string>();
  for (const p of [...cadeiaIcpGuardada(), ...pems]) {
    try { const x = new crypto.X509Certificate(p); if (x.ca) todos.set(x.fingerprint256, x.toString()); } catch { /* ignora */ }
  }
  definirParametro(P_CADEIA, [...todos.values()].join(''));
  return todos.size;
}

export function apagarCadeiaIcp() { definirParametro(P_CADEIA, null); }

export function verificarServidorSefaz(): boolean { return parametro(P_VERIFICAR) !== '0'; }
export function definirVerificacaoServidor(verificar: boolean) { definirParametro(P_VERIFICAR, verificar ? null : '0'); }

function listaCa(tipo: 'default' | 'system'): string[] {
  try {
    if (typeof tls.getCACertificates === 'function') return tls.getCACertificates(tipo);
  } catch { /* sistema sem acesso ao repositório */ }
  return tipo === 'default' ? [...tls.rootCertificates] : [];
}

/** Lista de autoridades usada só na conexão com a SEFAZ. */
export function autoridadesSefaz(): string[] {
  return [...new Set([...listaCa('default'), ...listaCa('system'), ...cadeiaIcpGuardada()])];
}

/**
 * Baixa a cadeia ICP-Brasil do repositório oficial do ITI (por HTTPS, verificado pelas autoridades públicas).
 * Retorna quantos certificados novos foram guardados; 0 se não conseguiu baixar nada.
 */
export async function baixarCadeiaIcp(baixar: (url: string) => Promise<Buffer> = baixarUrl): Promise<{ guardados: number; total: number; falhas: string[] }> {
  const antes = cadeiaIcpGuardada().length;
  const achados: string[] = [];
  const falhas: string[] = [];
  const urls = process.env.SEFAZ_CADEIA_URL_TESTE ? [process.env.SEFAZ_CADEIA_URL_TESTE] : URLS_CADEIA_ICP; // teste automatizado
  for (const url of urls) {
    try {
      achados.push(...extrairCertificadosAc(await baixar(url)));
    } catch (e) {
      falhas.push(`${url}: ${(e as Error).message}`);
    }
  }
  if (!achados.length) return { guardados: 0, total: antes, falhas };
  const total = guardarCadeiaIcp(achados);
  return { guardados: total - antes, total, falhas };
}

async function baixarUrl(url: string): Promise<Buffer> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

export function statusConfianca() {
  const cadeia = cadeiaIcpGuardada().map((p) => new crypto.X509Certificate(p));
  return {
    verificarServidor: verificarServidorSefaz(),
    cadeiaIcp: cadeia.length,
    raizesIcp: cadeia.filter((x) => x.subject === x.issuer).map((x) => (x.subject.match(/CN=([^\n]+)/)?.[1] ?? x.subject)),
    autoridadesDoSistema: listaCa('system').length,
  };
}
