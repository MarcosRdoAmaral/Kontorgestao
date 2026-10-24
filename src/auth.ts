import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db } from './db.js';

export type Papel = 'admin' | 'operador' | 'cliente';
export interface Usuario {
  id: number;
  escritorio_id: number;
  nome: string;
  email: string;
  papel: Papel;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: Usuario;
  }
}

export function hashSenha(senha: string): string {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}

export function conferirSenha(senha: string, armazenado: string): boolean {
  const [alg, salB64, hB64] = armazenado.split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(senha, Buffer.from(salB64, 'base64'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hB64, 'base64'));
}

const VALIDADE_TOKEN_S = 12 * 3600;

/** Token simples assinado com HMAC: base64url(payload).assinatura */
export function gerarToken(usuarioId: number): string {
  const payload = Buffer.from(JSON.stringify({ u: usuarioId, exp: Math.floor(Date.now() / 1000) + VALIDADE_TOKEN_S })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function lerToken(token: string): number | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const esperado = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (exp < Date.now() / 1000) return null;
  return u;
}

export async function exigirLogin(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization ?? '';
  const id = h.startsWith('Bearer ') ? lerToken(h.slice(7)) : null;
  const u = id ? (db.prepare('SELECT id, escritorio_id, nome, email, papel FROM usuarios WHERE id = ? AND ativo = 1').get(id) as Usuario | undefined) : undefined;
  if (!u) return reply.code(401).send({ erro: 'Sessão expirada. Entre novamente.' });
  req.usuario = u;
}

export function exigirPapel(...papeis: Papel[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.usuario || !papeis.includes(req.usuario.papel)) return reply.code(403).send({ erro: 'Sem permissão para esta ação.' });
  };
}

/**
 * Garante que o usuário pode operar a empresa: admin/operador veem todas do escritório;
 * cliente só as empresas vinculadas a ele.
 */
export function empresaPermitida(u: Usuario, empresaId: number): boolean {
  const e = db.prepare('SELECT escritorio_id FROM empresas WHERE id = ?').get(empresaId) as { escritorio_id: number } | undefined;
  if (!e || e.escritorio_id !== u.escritorio_id) return false;
  if (u.papel !== 'cliente') return true;
  return !!db.prepare('SELECT 1 FROM usuario_empresas WHERE usuario_id = ? AND empresa_id = ?').get(u.id, empresaId);
}

/** Cria o escritório e o administrador na primeira execução. */
export function garantirAdmin(): void {
  const existe = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get() as { n: number };
  if (existe.n > 0) return;
  // Sem ADMIN_SENHA o primeiro acesso é criado pela tela de boas-vindas (modo desktop).
  if (!config.adminSenha) return;
  if (config.adminSenha.length < 8) throw new Error('ADMIN_SENHA deve ter no mínimo 8 caracteres.');
  const esc = db.prepare('INSERT INTO escritorios (nome) VALUES (?)').run('Meu Escritório');
  db.prepare('INSERT INTO usuarios (escritorio_id, nome, email, senha_hash, papel) VALUES (?,?,?,?,?)')
    .run(esc.lastInsertRowid, 'Administrador', config.adminEmail.toLowerCase(), hashSenha(config.adminSenha), 'admin');
  console.log(`Usuário administrador criado: ${config.adminEmail}`);
}

export const sistemaConfigurado = () => (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get() as { n: number }).n > 0;

/** Primeiro acesso: cria o escritório e o administrador. Só funciona enquanto não existe nenhum usuário. */
export function configurarPrimeiroAcesso(d: { escritorio: string; nome: string; email: string; senha: string }) {
  return db.transaction(() => {
    if (sistemaConfigurado()) throw new Error('O sistema já foi configurado.');
    const esc = db.prepare('INSERT INTO escritorios (nome) VALUES (?)').run(d.escritorio);
    const u = db.prepare('INSERT INTO usuarios (escritorio_id, nome, email, senha_hash, papel) VALUES (?,?,?,?,?)')
      .run(esc.lastInsertRowid, d.nome, d.email.toLowerCase(), hashSenha(d.senha), 'admin');
    return Number(u.lastInsertRowid);
  })();
}
