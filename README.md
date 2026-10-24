# Kontor Gestão — Emissor de NFS-e (Sistema Nacional)

Emissor de NFS-e pelo **Emissor Nacional** (API Sefin Nacional, leiaute DPS 1.01), multiempresa, em dois formatos:

- **Aplicativo de Windows** (instalador `.exe`, banco local, sem servidor): o formato para o escritório e os clientes.
- **Servidor** (`npm start`): o mesmo sistema acessado pelo navegador, caso um dia queiram centralizar.

## Aplicativo de Windows
- Instalação com "próximo, próximo, concluir", **sem pedir senha de administrador** (instala na pasta do usuário).
- Banco SQLite local em `%APPDATA%\Kontor Gestão\dados`. Desinstalar **não apaga** os dados.
- No primeiro uso, tela de boas-vindas cria o escritório e o administrador.
- A chave que protege os certificados A1 fica no **cofre do Windows (DPAPI)**, atrelada ao usuário do computador.
- Backup automático diário (últimos 30) + botão "Baixar backup" + menu Arquivo > Salvar/Restaurar backup.
- O servidor interno escuta só em `127.0.0.1`: nada é exposto na rede.

### Gerar o instalador
```bash
npm install
npm run dist          # build + instalador (usa makensis, não precisa de Windows nem wine)
```
Saída: `release/Kontor-Gestao-Instalador-<versão>.exe`.
Para o instalador oficial do electron-builder (ícone embutido pelo rcedit, assinatura de código), use o workflow
`.github/workflows/instalador-windows.yml` (Actions > Instalador Windows > Run workflow).

### Testar sem instalar
```bash
npm run desktop       # abre o app em modo desenvolvimento
```

## O que o sistema faz
- Cadastro de empresas, tomadores e serviços; certificado A1 por empresa (AES-256-GCM em repouso).
- Emissão: monta a DPS na ordem do XSD, assina (XMLDSig RSA-SHA1, C14N), envia por mTLS e arquiva o XML.
- Numeração de DPS atômica; a nota é gravada **antes** do envio. Se a conexão cair, "Consultar na Sefin" recupera a nota sem duplicar.
- Rejeições mostram código e texto da Sefin; corrigir e reenviar mantém o mesmo número de DPS.
- DANFSe em PDF gerado localmente, download do XML, cancelamento (evento e101101), painel mensal.
- Perfis: administrador, operador, cliente (vê só as empresas vinculadas). CNPJ alfanumérico; grupo IBS/CBS opcional por serviço.

## Servidor
```bash
cp .env.example .env     # MASTER_KEY, SESSION_SECRET (e ADMIN_SENHA, ou use a tela de boas-vindas)
npm run dev              # http://localhost:3000
npm test
```
Produção: `npm run build && npm start` atrás de HTTPS. **Guarde a MASTER_KEY**: sem ela os certificados salvos não abrem.

## Antes de emitir de verdade
1. Cadastre a empresa em **produção restrita** (padrão) e emita notas de teste com o certificado real.
2. Confirme que o município é aderente ao Emissor Nacional e os códigos aceitos (cTribNac de 6 dígitos, desdobro cTribMun).
3. Só então troque a empresa para Produção.

## Limites conhecidos
- Testado contra uma Sefin simulada que valida o XML nos XSDs oficiais 1.01; **não foi testado contra a Sefin real** (exige certificado ICP-Brasil).
- O instalador foi gerado e o app empacotado foi executado em Linux (Electron); **a instalação em Windows ainda não foi testada**.
- Sem atualização automática: novas versões são distribuídas reinstalando por cima (os dados são mantidos).
- Dados presos ao computador: cada instalação tem o seu banco. Para vários usuários compartilhando as mesmas notas, usar o modo servidor.
- Ainda não há: tomador estrangeiro, obra, substituição de NFS-e, dedução/redução, consulta de notas tomadas (ADN).

## Lista nacional de serviços

`public/servicos-nacionais.json` contém os 338 códigos de tributação nacional (cTribNac) extraídos do
Anexo B oficial (`anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx`). No cadastro de
serviço há uma busca por código ou texto que preenche o código nacional, a descrição e o nome.
A alíquota **não** é preenchida automaticamente: confirme a alíquota/habilitação do serviço no
município (Blumenau) antes de emitir.

## Retenções, IBS/CBS, logo e lote (1.0.2)

- Emissão: retenções federais PIS, COFINS, CSLL, IRRF e INSS/CP (grupo `piscofins` + `tpRetPisCofins` calculado).
- IBS/CBS: CST com 3 dígitos (ex.: 000), cClassTrib e cIndOp com 6. Exige endereço completo do tomador (E0234).
- Logo por empresa (Empresas → Logo): aparece no cabeçalho do DANFSe.
- Notas emitidas → Baixar em lote: ZIP com XML e/ou PDF.

## Atualização automática (GitHub Releases)

1. Crie um repositório no GitHub (as releases precisam ser públicas para os computadores baixarem sem login) e
   preencha `"kontor": { "repositorioAtualizacoes": "usuario/repositorio" }` no `package.json`.
2. Para publicar: aumente `version` no `package.json`, faça o commit e crie a tag `vX.Y.Z` (`git tag v1.0.7 && git push origin v1.0.7`).
   O fluxo `.github/workflows/instalador-windows.yml` testa, gera o instalador e cria a release com o `.exe` e o `.sha256`.
3. O aplicativo verifica ao abrir e a cada 6 horas (e em Ajuda → Verificar atualizações). Ao aceitar, faz a cópia de
   segurança dos dados, baixa o instalador, confere o SHA-256 e o abre. Os dados não são alterados.
Observação: o instalador não é assinado digitalmente; o Windows SmartScreen pode avisar na primeira execução.

## E-mail da NFS-e e aviso de versão (1.0.11)

- Menu **E-mail**: configure o SMTP do escritório (Gmail/Outlook usam senha de aplicativo). A senha fica criptografada.
- Na nota (Produção): **Enviar por e-mail** manda o PDF (DANFSe) e o XML. Na emissão, a caixa "Enviar por e-mail ao tomador"
  envia automaticamente quando autorizar. O histórico de envios aparece na nota.
- Quando sai uma versão nova, uma faixa fixa no topo da tela avisa ("Atualizar agora" / "Depois").
