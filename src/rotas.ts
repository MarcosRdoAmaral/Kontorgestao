import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from './db.js';
import { cifrar, cifrarTexto } from './cofre.js';
import { conferirSenha, configurarPrimeiroAcesso, empresaPermitida, exigirLogin, exigirPapel, gerarToken, hashSenha, sistemaConfigurado, type Usuario } from './auth.js';
import { config } from './config.js';
import { ConfigSmtp, ListaEmails, configPublica, enviarNotaPorEmail, historicoEmails, salvarConfig, testarConfig } from './servicos/email.js';
import { ativarLicenca, exigirLicenca, statusLicenca } from './licenca.js';
import { EntradaFaturamento, faturar, listarCobrancas } from './servicos/faturamento.js';
import { criarBackup, listarBackups } from './servicos/backup.js';
import { consultarCnpj } from './servicos/consulta-cnpj.js';
import { strToU8, zipSync } from 'fflate';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerPfx } from './nfse/certificado.js';
import { codMunicipioValido, cTribNacValido, documentoValido, limparDoc, soDigitos } from './nfse/validacao.js';
import { EntradaEmissao, ErroNegocio, cancelar, danfse, emitir, enviar, obterNota, reconciliar } from './servicos/emissao.js';
import { MOTIVOS_CANCELAMENTO } from './nfse/evento.js';

const u = (req: FastifyRequest) => req.usuario as Usuario;

function checarEmpresa(req: FastifyRequest, empresaId: number) {
  if (!empresaPermitida(u(req), empresaId)) throw new ErroNegocio('Empresa não encontrada.', 404);
}

function notaDoUsuario(req: FastifyRequest, id: number) {
  const n = db.prepare('SELECT empresa_id FROM notas WHERE id = ?').get(id) as { empresa_id: number } | undefined;
  if (!n) throw new ErroNegocio('Nota não encontrada.', 404);
  checarEmpresa(req, n.empresa_id);
}

const Empresa = z.object({
  documento: z.string().transform(limparDoc).refine(documentoValido, 'CNPJ/CPF inválido'),
  razao_social: z.string().min(2),
  nome_fantasia: z.string().nullish(),
  inscricao_municipal: z.string().nullish(),
  cod_municipio: z.string().refine(codMunicipioValido, 'Código IBGE do município deve ter 7 dígitos'),
  uf: z.string().length(2).nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  op_simp_nac: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  reg_ap_trib_sn: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
  reg_esp_trib: z.number().int().min(0).max(9).default(0),
  p_tot_trib_sn: z.number().min(0).max(100).nullish(),
  ambiente: z.union([z.literal(1), z.literal(2)]).default(2),
  serie: z.string().regex(/^\d{1,5}$/, 'Série deve ser numérica, até 5 dígitos').default('1'),
});

const Tomador = z.object({
  tipo_doc: z.enum(['CPF', 'CNPJ', 'SEM']),
  documento: z.string().nullish().transform((d) => (d ? limparDoc(d) : null)),
  nome: z.string().min(2).max(300),
  inscricao_municipal: z.string().nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  fone: z.string().nullish().transform((f) => (f ? soDigitos(f) : null)),
  cep: z.string().nullish().transform((c) => (c ? soDigitos(c) : null)),
  cod_municipio: z.string().nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  // faturamento do cliente
  modo_faturamento: z.enum(['NOTA', 'NOTA_BOLETO', 'BOLETO']).default('NOTA'),
  vencimento_tipo: z.enum(['PRAZO', 'DIA_FIXO']).default('PRAZO'),
  vencimento_valor: z.number().int().min(0).max(60).default(10),
  email_cobranca: z.string().nullish().refine((v) => !v || v.split(/[,;\s]+/).filter(Boolean).every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)), 'E-mail de cobrança inválido'),
  enviar_email_auto: z.union([z.boolean(), z.literal(0), z.literal(1)]).default(false).transform((v) => (v ? 1 : 0)),
}).refine((t) => t.modo_faturamento === 'NOTA' || t.vencimento_tipo === 'PRAZO' || (t.vencimento_valor >= 1 && t.vencimento_valor <= 31), { message: 'Dia do vencimento deve ser de 1 a 31', path: ['vencimento_valor'] })
.refine((t) => t.tipo_doc === 'SEM' || (t.documento && documentoValido(t.documento)), { message: 'CPF/CNPJ do tomador inválido', path: ['documento'] });

const Servico = z.object({
  nome: z.string().min(1),
  descricao: z.string().min(1).max(2000),
  c_trib_nac: z.string().transform(soDigitos).refine(cTribNacValido, 'Código de tributação nacional tem 6 dígitos (ex.: 171901)'),
  c_trib_mun: z.string().nullish(),
  c_nbs: z.string().nullish().transform((c) => (c ? soDigitos(c) : null)),
  aliquota: z.number().min(0).max(100).nullish(),
  valor_padrao: z.number().min(0).nullish(),
  ibscbs: z.object({
    indFinal: z.union([z.literal(0), z.literal(1)]),
    cIndOp: z.string().regex(/^\d{6}$/, 'Indicador da operação (cIndOp) precisa ter 6 dígitos'),
    indDest: z.union([z.literal(0), z.literal(1)]),
    cst: z.string().regex(/^\d{3}$/, 'CST do IBS/CBS precisa ter 3 dígitos (ex.: 000 = tributação integral)'),
    cClassTrib: z.string().regex(/^\d{6}$/, 'Classificação tributária (cClassTrib) precisa ter 6 dígitos (ex.: 000001)'),
  }).nullish(),
}).refine((s) => !s.ibscbs || !!s.c_nbs, { path: ['c_nbs'], message: 'Com IBS/CBS o código NBS é obrigatório' });

const semCert = (e: any) => {
  const { cert_pfx_enc, cert_senha_enc, logo, ...resto } = e;
  return { ...resto, tem_certificado: !!cert_pfx_enc, tem_logo: !!logo };
};

const VERSAO: string = (() => {
  try { return JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version; } catch { return ''; }
})();

export async function rotas(app: FastifyInstance) {
  // ---------- Primeiro acesso ----------
  app.get('/api/setup/status', async () => ({ configurado: sistemaConfigurado(), desktop: config.desktop, versao: VERSAO }));

  app.post('/api/setup', async (req, reply) => {
    const d = z.object({
      escritorio: z.string().min(2, 'Informe o nome do escritório'),
      nome: z.string().min(2, 'Informe seu nome'),
      email: z.string().email('E-mail inválido'),
      senha: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres'),
    }).parse(req.body);
    if (sistemaConfigurado()) return reply.code(409).send({ erro: 'O sistema já foi configurado.' });
    const id = configurarPrimeiroAcesso(d);
    return { token: gerarToken(id) };
  });

  // ---------- Autenticação ----------
  app.post('/api/login', async (req, reply) => {
    const { email, senha } = z.object({ email: z.string(), senha: z.string() }).parse(req.body);
    const usr = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(email.toLowerCase().trim()) as any;
    if (!usr || !conferirSenha(senha, usr.senha_hash)) return reply.code(401).send({ erro: 'E-mail ou senha incorretos.' });
    return { token: gerarToken(usr.id), usuario: { id: usr.id, nome: usr.nome, email: usr.email, papel: usr.papel } };
  });

  app.register(async (api) => {
    api.addHook('preHandler', exigirLogin);

    api.get('/api/me', async (req) => {
      const { senha_hash, ...resto } = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u(req).id) as any;
      return resto;
    });
    api.put('/api/me/empresa', async (req) => {
      const { id } = z.object({ id: z.number().int() }).parse(req.body);
      if (!empresaPermitida(u(req), id)) throw new ErroNegocio('Empresa não permitida.', 403);
      db.prepare('UPDATE usuarios SET ultima_empresa_id = ? WHERE id = ?').run(id, u(req).id);
      return { ok: true };
    });

    // ---------- Usuários (admin) ----------
    api.get('/api/usuarios', { preHandler: exigirPapel('admin') }, async (req) =>
      db.prepare(`SELECT id, nome, email, papel, ativo,
        (SELECT group_concat(empresa_id) FROM usuario_empresas ue WHERE ue.usuario_id = usuarios.id) AS empresas
        FROM usuarios WHERE escritorio_id = ? ORDER BY nome`).all(u(req).escritorio_id),
    );
    api.post('/api/usuarios', { preHandler: exigirPapel('admin') }, async (req) => {
      const d = z.object({
        nome: z.string().min(2), email: z.string().email(), senha: z.string().min(8),
        papel: z.enum(['admin', 'operador', 'cliente']), empresas: z.array(z.number()).default([]),
      }).parse(req.body);
      const r = db.prepare('INSERT INTO usuarios (escritorio_id, nome, email, senha_hash, papel) VALUES (?,?,?,?,?)')
        .run(u(req).escritorio_id, d.nome, d.email.toLowerCase(), hashSenha(d.senha), d.papel);
      const ins = db.prepare('INSERT OR IGNORE INTO usuario_empresas VALUES (?,?)');
      d.empresas.forEach((e) => empresaPermitida(u(req), e) && ins.run(r.lastInsertRowid, e));
      return { id: Number(r.lastInsertRowid) };
    });

    // ---------- Empresas (prestadores) ----------
    api.get('/api/empresas', async (req) => {
      const usr = u(req);
      const linhas = usr.papel === 'cliente'
        ? db.prepare('SELECT e.* FROM empresas e JOIN usuario_empresas ue ON ue.empresa_id = e.id WHERE ue.usuario_id = ? ORDER BY razao_social').all(usr.id)
        : db.prepare('SELECT * FROM empresas WHERE escritorio_id = ? ORDER BY razao_social').all(usr.escritorio_id);
      return linhas.map(semCert);
    });

    api.post('/api/empresas', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const d = Empresa.parse(req.body);
      const r = db.prepare(`INSERT INTO empresas (escritorio_id, documento, razao_social, nome_fantasia, inscricao_municipal, cod_municipio, uf, email,
        op_simp_nac, reg_ap_trib_sn, reg_esp_trib, p_tot_trib_sn, ambiente, serie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(u(req).escritorio_id, d.documento, d.razao_social, d.nome_fantasia ?? null, d.inscricao_municipal ?? null, d.cod_municipio,
          d.uf ?? null, d.email || null, d.op_simp_nac, d.op_simp_nac === 3 ? d.reg_ap_trib_sn ?? 1 : null, d.reg_esp_trib,
          d.p_tot_trib_sn ?? null, d.ambiente, d.serie);
      return { id: Number(r.lastInsertRowid) };
    });

    api.put('/api/empresas/:id', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      const d = Empresa.parse(req.body);
      db.prepare(`UPDATE empresas SET documento=?, razao_social=?, nome_fantasia=?, inscricao_municipal=?, cod_municipio=?, uf=?, email=?,
        op_simp_nac=?, reg_ap_trib_sn=?, reg_esp_trib=?, p_tot_trib_sn=?, ambiente=?, serie=? WHERE id=?`)
        .run(d.documento, d.razao_social, d.nome_fantasia ?? null, d.inscricao_municipal ?? null, d.cod_municipio, d.uf ?? null, d.email || null,
          d.op_simp_nac, d.op_simp_nac === 3 ? d.reg_ap_trib_sn ?? 1 : null, d.reg_esp_trib, d.p_tot_trib_sn ?? null, d.ambiente, d.serie, id);
      return { ok: true };
    });

    /** Upload do certificado A1: multipart com campos "arquivo" (.pfx) e "senha". */
    api.post('/api/empresas/:id/certificado', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      let pfx: Buffer | null = null;
      let senha = '';
      for await (const parte of req.parts()) {
        if (parte.type === 'file') pfx = await parte.toBuffer();
        else if (parte.fieldname === 'senha') senha = String(parte.value);
      }
      if (!pfx) throw new ErroNegocio('Envie o arquivo .pfx do certificado.');
      const cert = lerPfx(pfx, senha);
      const empresa = db.prepare('SELECT documento FROM empresas WHERE id = ?').get(id) as { documento: string };
      if (cert.documento && cert.documento.slice(0, 8) !== empresa.documento.slice(0, 8)) {
        throw new ErroNegocio(`O certificado pertence ao documento ${cert.documento}, diferente do cadastro da empresa.`);
      }
      if (cert.validoAte < new Date()) throw new ErroNegocio('Certificado vencido.');
      db.prepare('UPDATE empresas SET cert_pfx_enc = ?, cert_senha_enc = ?, cert_titular = ?, cert_validade = ? WHERE id = ?')
        .run(cifrar(pfx), cifrarTexto(senha), cert.titular, cert.validoAte.toISOString(), id);
      return { titular: cert.titular, validade: cert.validoAte };
    });

    /** Logo da empresa (PNG ou JPG, até 1 MB) usada no cabeçalho do DANFSe. */
    api.post('/api/empresas/:id/logo', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      let img: Buffer | null = null;
      for await (const parte of req.parts()) if (parte.type === 'file') img = await parte.toBuffer();
      if (!img) throw new ErroNegocio('Envie a imagem da logo.');
      const png = img.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const jpg = img[0] === 0xff && img[1] === 0xd8;
      if (!png && !jpg) throw new ErroNegocio('A logo precisa ser um arquivo PNG ou JPG.');
      db.prepare('UPDATE empresas SET logo = ? WHERE id = ?').run(img, id);
      return { ok: true };
    });
    api.delete('/api/empresas/:id/logo', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      db.prepare('UPDATE empresas SET logo = NULL WHERE id = ?').run(id);
      return { ok: true };
    });

    // ---------- Tomadores ----------
    api.get('/api/empresas/:id/tomadores', async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      const q = `%${((req.query as any).q ?? '').trim()}%`;
      return db.prepare('SELECT * FROM tomadores WHERE empresa_id = ? AND (nome LIKE ? OR documento LIKE ?) ORDER BY nome LIMIT 200').all(id, q, q);
    });
    api.post('/api/empresas/:id/tomadores', async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      const d = Tomador.parse(req.body);
      const r = db.prepare(`INSERT INTO tomadores (empresa_id, tipo_doc, documento, nome, inscricao_municipal, email, fone, cep, cod_municipio, logradouro, numero, complemento, bairro,
        modo_faturamento, vencimento_tipo, vencimento_valor, email_cobranca, enviar_email_auto)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, d.tipo_doc, d.documento, d.nome, d.inscricao_municipal ?? null, d.email || null, d.fone, d.cep,
        d.cod_municipio ?? null, d.logradouro ?? null, d.numero ?? null, d.complemento ?? null, d.bairro ?? null,
        d.modo_faturamento, d.vencimento_tipo, d.vencimento_valor, d.email_cobranca || null, d.enviar_email_auto);
      return { id: Number(r.lastInsertRowid) };
    });
    api.put('/api/tomadores/:id', async (req) => {
      const id = Number((req.params as any).id);
      const t = db.prepare('SELECT empresa_id FROM tomadores WHERE id = ?').get(id) as any;
      if (!t) throw new ErroNegocio('Tomador não encontrado.', 404);
      checarEmpresa(req, t.empresa_id);
      const d = Tomador.parse(req.body);
      db.prepare(`UPDATE tomadores SET tipo_doc=?, documento=?, nome=?, inscricao_municipal=?, email=?, fone=?, cep=?, cod_municipio=?, logradouro=?, numero=?, complemento=?, bairro=?,
        modo_faturamento=?, vencimento_tipo=?, vencimento_valor=?, email_cobranca=?, enviar_email_auto=? WHERE id=?`)
        .run(d.tipo_doc, d.documento, d.nome, d.inscricao_municipal ?? null, d.email || null, d.fone, d.cep, d.cod_municipio ?? null,
          d.logradouro ?? null, d.numero ?? null, d.complemento ?? null, d.bairro ?? null,
          d.modo_faturamento, d.vencimento_tipo, d.vencimento_valor, d.email_cobranca || null, d.enviar_email_auto, id);
      return { ok: true };
    });

    // ---------- Serviços ----------
    api.get('/api/empresas/:id/servicos', async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      return db.prepare('SELECT * FROM servicos WHERE empresa_id = ? AND ativo = 1 ORDER BY nome').all(id)
        .map((s: any) => ({ ...s, ibscbs: s.ibscbs_json ? JSON.parse(s.ibscbs_json) : null }));
    });
    api.post('/api/empresas/:id/servicos', async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      const d = Servico.parse(req.body);
      const r = db.prepare(`INSERT INTO servicos (empresa_id, nome, descricao, c_trib_nac, c_trib_mun, c_nbs, aliquota, valor_padrao, ibscbs_json) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, d.nome, d.descricao, d.c_trib_nac, d.c_trib_mun || null, d.c_nbs, d.aliquota ?? null, d.valor_padrao ?? null, d.ibscbs ? JSON.stringify(d.ibscbs) : null);
      return { id: Number(r.lastInsertRowid) };
    });
    api.put('/api/servicos/:id', async (req) => {
      const id = Number((req.params as any).id);
      const s = db.prepare('SELECT empresa_id FROM servicos WHERE id = ?').get(id) as any;
      if (!s) throw new ErroNegocio('Serviço não encontrado.', 404);
      checarEmpresa(req, s.empresa_id);
      const d = Servico.parse(req.body);
      db.prepare(`UPDATE servicos SET nome=?, descricao=?, c_trib_nac=?, c_trib_mun=?, c_nbs=?, aliquota=?, valor_padrao=?, ibscbs_json=? WHERE id=?`)
        .run(d.nome, d.descricao, d.c_trib_nac, d.c_trib_mun || null, d.c_nbs, d.aliquota ?? null, d.valor_padrao ?? null, d.ibscbs ? JSON.stringify(d.ibscbs) : null, id);
      return { ok: true };
    });
    api.delete('/api/servicos/:id', async (req) => {
      const id = Number((req.params as any).id);
      const s = db.prepare('SELECT empresa_id FROM servicos WHERE id = ?').get(id) as any;
      if (!s) throw new ErroNegocio('Serviço não encontrado.', 404);
      checarEmpresa(req, s.empresa_id);
      db.prepare('UPDATE servicos SET ativo = 0 WHERE id = ?').run(id);
      return { ok: true };
    });

    // ---------- Notas ----------
    api.get('/api/notas', async (req) => {
      const q = req.query as any;
      const usr = u(req);
      const filtros: string[] = ['e.escritorio_id = ?'];
      const params: unknown[] = [usr.escritorio_id];
      if (usr.papel === 'cliente') { filtros.push('e.id IN (SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?)'); params.push(usr.id); }
      if (q.empresaId) { filtros.push('n.empresa_id = ?'); params.push(Number(q.empresaId)); }
      if (q.status) { filtros.push('n.status = ?'); params.push(q.status); }
      if (q.mes) { filtros.push("substr(n.competencia, 1, 7) = ?"); params.push(q.mes); }
      if (q.q) { filtros.push('(n.tomador_nome LIKE ? OR n.n_nfse = ? OR n.descricao LIKE ?)'); params.push(`%${q.q}%`, q.q, `%${q.q}%`); }
      return db.prepare(`SELECT n.id, n.empresa_id, e.razao_social AS empresa, n.ambiente, n.serie, n.n_dps, n.n_nfse, n.status, n.competencia,
        n.valor_servico, n.tomador_nome, n.tomador_documento, n.descricao, n.chave_acesso, n.criado_em, n.erros_json
        FROM notas n JOIN empresas e ON e.id = n.empresa_id WHERE ${filtros.join(' AND ')} ORDER BY n.id DESC LIMIT 500`).all(...params);
    });

    // ---------- E-mail (SMTP do escritório) ----------
    api.get('/api/email/config', { preHandler: exigirPapel('admin') }, async (req) => configPublica(u(req).escritorio_id));
    api.put('/api/email/config', { preHandler: exigirPapel('admin') }, async (req) => {
      salvarConfig(u(req).escritorio_id, ConfigSmtp.parse(req.body));
      return { ok: true };
    });
    api.post('/api/email/testar', { preHandler: exigirPapel('admin') }, async (req) => {
      const { para } = z.object({ para: z.string().email('E-mail de destino inválido') }).parse(req.body);
      await testarConfig(u(req).escritorio_id, para);
      return { ok: true };
    });
    api.post('/api/notas/:id/email', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      const { para, tipo } = z.object({ para: ListaEmails, tipo: z.enum(['emissao', 'cancelamento']).default('emissao') }).parse(req.body);
      return enviarNotaPorEmail(id, u(req).escritorio_id, para, u(req).id, tipo);
    });
    api.get('/api/notas/:id/emails', async (req) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      return historicoEmails(id);
    });

    /** Download em lote: ZIP com XML e/ou PDF (DANFSe) das notas autorizadas/canceladas do filtro. */
    api.get('/api/notas-lote', async (req, reply) => {
      const q = req.query as any;
      const usr = u(req);
      const filtros: string[] = ['e.escritorio_id = ?', "n.xml_nfse IS NOT NULL"];
      const params: unknown[] = [usr.escritorio_id];
      if (usr.papel === 'cliente') { filtros.push('e.id IN (SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?)'); params.push(usr.id); }
      if (!q.empresaId) throw new ErroNegocio('Escolha a empresa.');
      filtros.push('n.empresa_id = ?'); params.push(Number(q.empresaId));
      if (q.mes) { filtros.push('substr(n.competencia, 1, 7) = ?'); params.push(String(q.mes)); }
      if (q.status) { filtros.push('n.status = ?'); params.push(String(q.status)); }
      const formato = ['xml', 'pdf', 'ambos'].includes(q.formato) ? q.formato : 'ambos';
      const notas = db.prepare(`SELECT n.id, n.n_nfse, n.xml_nfse FROM notas n JOIN empresas e ON e.id = n.empresa_id
        WHERE ${filtros.join(' AND ')} ORDER BY n.id LIMIT 1000`).all(...params) as { id: number; n_nfse: string; xml_nfse: string }[];
      if (!notas.length) throw new ErroNegocio('Nenhuma nota autorizada neste filtro.', 404);
      const arquivos: Record<string, Uint8Array> = {};
      for (const n of notas) {
        const base = `NFSe_${n.n_nfse}`;
        if (formato !== 'pdf') arquivos[`${base}.xml`] = strToU8(n.xml_nfse);
        if (formato !== 'xml') arquivos[`${base}.pdf`] = await danfse(n.id);
      }
      const zip = Buffer.from(zipSync(arquivos, { level: 6 }));
      const nome = `notas-${q.mes ?? 'todas'}-${q.empresaId}.zip`;
      return reply.type('application/zip').header('Content-Disposition', `attachment; filename="${nome}"`).send(zip);
    });

    api.get('/api/notas/:id', async (req) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      const { xml_dps, xml_nfse, ...n } = obterNota(id)!;
      return n;
    });

    api.post('/api/notas', async (req) => {
      const entrada = EntradaEmissao.parse(req.body);
      checarEmpresa(req, entrada.empresaId);
      exigirLicenca();
      return emitir(u(req), entrada);
    });

    // "Um comando": nota + boleto + e-mail conforme o cadastro do cliente
    api.post('/api/faturar', async (req) => {
      const entrada = EntradaFaturamento.parse(req.body);
      checarEmpresa(req, entrada.empresaId);
      return faturar(u(req), entrada);
    });

    api.get('/api/empresas/:id/cobrancas', async (req) => {
      const id = Number((req.params as any).id);
      checarEmpresa(req, id);
      return listarCobrancas(id);
    });

    api.get('/api/licenca', async () => statusLicenca());
    api.post('/api/licenca', { preHandler: exigirPapel('admin') }, async (req) => {
      const d = z.object({ codigo: z.string().min(10) }).parse(req.body);
      return ativarLicenca(d.codigo);
    });

    api.post('/api/notas/:id/reenviar', async (req) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      exigirLicenca();
      const corpo = req.body && Object.keys(req.body as object).length ? EntradaEmissao.parse(req.body) : undefined;
      if (corpo) checarEmpresa(req, corpo.empresaId);
      return enviar(id, corpo);
    });

    api.post('/api/notas/:id/reconciliar', async (req) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      return reconciliar(id);
    });

    api.post('/api/notas/:id/cancelar', { preHandler: exigirPapel('admin', 'operador') }, async (req) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      exigirLicenca();
      const d = z.object({ cMotivo: z.union([z.literal(1), z.literal(2), z.literal(9)]), xMotivo: z.string() }).parse(req.body);
      return cancelar(u(req), id, d.cMotivo, d.xMotivo);
    });

    api.get('/api/notas/:id/danfse', async (req, reply) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      const pdf = await danfse(id);
      const n = db.prepare('SELECT n_nfse FROM notas WHERE id = ?').get(id) as any;
      return reply.type('application/pdf').header('Content-Disposition', `inline; filename="DANFSe_${n.n_nfse}.pdf"`).send(pdf);
    });

    api.get('/api/notas/:id/xml', async (req, reply) => {
      const id = Number((req.params as any).id);
      notaDoUsuario(req, id);
      const n = db.prepare('SELECT xml_nfse, xml_dps, n_nfse, n_dps FROM notas WHERE id = ?').get(id) as any;
      const xml = n.xml_nfse ?? n.xml_dps;
      if (!xml) throw new ErroNegocio('Nota sem XML.', 404);
      const nome = n.xml_nfse ? `NFSe_${n.n_nfse}.xml` : `DPS_${n.n_dps}.xml`;
      return reply.type('application/xml').header('Content-Disposition', `attachment; filename="${nome}"`).send(xml);
    });

    // ---------- Relatórios ----------
    api.get('/api/relatorios/resumo', async (req) => {
      const q = req.query as any;
      const usr = u(req);
      const mes = q.mes ?? new Date().toISOString().slice(0, 7);
      const filtroCliente = usr.papel === 'cliente' ? 'AND e.id IN (SELECT empresa_id FROM usuario_empresas WHERE usuario_id = ?)' : '';
      const params: unknown[] = [mes, usr.escritorio_id, ...(usr.papel === 'cliente' ? [usr.id] : [])];
      return db.prepare(`SELECT e.id AS empresa_id, e.razao_social AS empresa,
          SUM(n.status = 'AUTORIZADA') AS autorizadas, SUM(n.status = 'CANCELADA') AS canceladas,
          SUM(n.status IN ('REJEITADA','ERRO_COMUNICACAO','PENDENTE')) AS pendencias,
          ROUND(SUM(CASE WHEN n.status = 'AUTORIZADA' THEN n.valor_servico ELSE 0 END), 2) AS faturado
        FROM empresas e LEFT JOIN notas n ON n.empresa_id = e.id AND substr(n.competencia,1,7) = ? AND n.ambiente = e.ambiente
        WHERE e.escritorio_id = ? ${filtroCliente} GROUP BY e.id ORDER BY faturado DESC`).all(...params);
    });

    // ---------- Consulta pública de CNPJ ----------
    api.get('/api/consulta/cnpj/:cnpj', async (req) => consultarCnpj((req.params as any).cnpj));

    // ---------- Backup ----------
    api.get('/api/backup', { preHandler: exigirPapel('admin') }, async () => ({ automaticos: listarBackups(), pasta: config.backupDir }));

    /** Gera uma cópia consistente do banco e entrega como download. */
    api.get('/api/backup/baixar', { preHandler: exigirPapel('admin') }, async (_req, reply) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-bkp-'));
      const arquivo = criarBackup(dir, 'backup.db');
      const dados = fs.readFileSync(arquivo);
      fs.rmSync(dir, { recursive: true, force: true });
      const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="nfse-backup-${dia}.db"`).send(dados);
    });

    api.get('/api/tabelas', async () => ({ motivosCancelamento: MOTIVOS_CANCELAMENTO }));
  });
}
