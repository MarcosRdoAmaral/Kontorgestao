import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { migrar } from './db.js';
import { garantirAdmin } from './auth.js';
import { rotas } from './rotas.js';
import { ErroNegocio } from './servicos/emissao.js';
import { backupAutomatico } from './servicos/backup.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function criarApp() {
  migrar();
  garantirAdmin();

  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 2 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: path.join(raiz, 'public') });

  app.setErrorHandler((err: Error & { code?: string; statusCode?: number }, req, reply) => {
    if (err.statusCode && err.statusCode < 500 && !(err instanceof ErroNegocio)) return reply.code(err.statusCode).send({ erro: err.message });
    if (err instanceof ZodError) {
      return reply.code(400).send({ erro: 'Dados inválidos', campos: err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
    }
    if (err instanceof ErroNegocio) return reply.code(err.status).send({ erro: err.message, detalhes: err.detalhes });
    if (/UNIQUE constraint failed/i.test(err.message)) return reply.code(409).send({ erro: 'Registro já existe (duplicado).' });
    if (/certificado|pfx/i.test(err.message)) return reply.code(400).send({ erro: err.message });
    req.log.error(err);
    return reply.code(500).send({ erro: 'Erro interno. Veja o log do servidor.' });
  });

  await app.register(rotas);

  backupAutomatico();
  const timer = setInterval(backupAutomatico, 3600e3);
  timer.unref();
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = await criarApp();
  await app.listen({ port: config.port, host: config.host });
}
