/**
 * Manual do usuário do Kontor Gestão (mostrado em Relatórios > Documentação).
 * REGRA DO PROJETO: toda funcionalidade nova ou alterada precisa atualizar o tópico correspondente
 * aqui (e a data/versão em MANUAL_VERSAO) antes de publicar a versão.
 * `corpo` é HTML escrito à mão (não recebe dados de usuário).
 */
export const MANUAL_VERSAO = '3.1.1';

export const MANUAL = [
  {
    id: 'primeiros-passos', titulo: 'Primeiros passos', resumo: 'Instalação, primeiro acesso e o que configurar antes de emitir.',
    corpo: `
      <p>O Kontor Gestão emite NFS-e pelo <strong>Emissor Nacional</strong> (Sefin Nacional), para várias empresas ao mesmo tempo, e cuida de boletos, despesas, extrato e relatórios.</p>
      <h3>Antes da primeira nota</h3>
      <ol>
        <li><strong>Primeiro acesso:</strong> informe o nome do escritório e crie o usuário administrador.</li>
        <li><strong>Licença:</strong> em Configurações &gt; Licença, cole o código recebido para liberar a emissão.</li>
        <li><strong>Empresa:</strong> em Empresas, cadastre cada prestador (CNPJ, regime, município, ambiente).</li>
        <li><strong>Certificado A1:</strong> na linha da empresa, botão Certificado (arquivo .pfx e senha). Empresas que emitem só pelo portal com CNPJ e senha não precisam dele (veja <em>Empresas</em>).</li>
        <li><strong>Serviços e clientes:</strong> cadastre os serviços prestados e os clientes (tomadores).</li>
        <li><strong>Teste:</strong> mantenha a empresa em <em>Produção restrita (testes)</em> até validar tudo; só depois mude o ambiente para produção.</li>
      </ol>
      <h3>Como o sistema é organizado</h3>
      <p>No alto do menu lateral fica a <strong>empresa selecionada</strong>: quase todas as telas mostram os dados dela. Troque a empresa ali a qualquer momento. O restante do menu segue o fluxo do dia a dia: emitir, acompanhar notas, cobrar, controlar despesas e consultar relatórios.</p>
      <p class="dica">O menu mostra só o que o seu usuário tem permissão de usar (Configurações &gt; Usuários e acessos). Este manual está liberado para todos os usuários: em Relatórios &gt; Documentação, ou no item Documentação do menu para quem não tem o acesso a Relatórios.</p>`,
  },
  {
    id: 'empresas', titulo: 'Empresas', resumo: 'Cadastro do prestador, certificado, logo, dados bancários e emissão sem certificado.',
    corpo: `
      <h3>Cadastrar</h3>
      <p>Em <strong>Empresas &gt; Cadastrar empresa</strong> informe o CNPJ (o botão de busca preenche razão social e endereço), o regime (não optante, MEI ou Simples ME/EPP), o município e o ambiente. Use <em>Produção restrita</em> para testes: as notas não têm valor fiscal.</p>
      <h3>Certificado A1</h3>
      <p>A API da Sefin exige certificado digital A1 da empresa. Na linha da empresa, <strong>Certificado</strong> envia o arquivo .pfx e a senha; o sistema guarda criptografado e mostra a validade. Renove antes de vencer.</p>
      <h3>Emissão sem certificado (CNPJ e senha)</h3>
      <p>Para empresas que emitem direto no portal do Emissor Nacional, escolha o modo <strong>Portal (CNPJ e senha)</strong> no cadastro. Nesse modo o sistema <em>não emite a nota</em>: você emite no portal e importa o XML em <strong>Notas emitidas &gt; Importar XML</strong>. Os boletos, as cobranças e os relatórios continuam funcionando normalmente. A senha do portal fica guardada criptografada.</p>
      <h3>Logo</h3>
      <p>O botão <strong>Logo</strong> envia a imagem que aparece no DANFSe (PDF da nota) dessa empresa.</p>
      <h3>Dados bancários</h3>
      <p>O botão <strong>Dados bancários</strong> da linha da empresa abre a configuração da cobrança (convênio Ailos): agência, conta, convênio, carteira, formato CNAB, numeração do próximo boleto e da próxima remessa, multa, juros, instrução e <em>feriados municipais</em>. Sem isso não é possível gerar boletos. Se já emitia boletos em outro sistema, informe o próximo número livre para o nosso número nunca repetir.</p>`,
  },
  {
    id: 'clientes', titulo: 'Clientes', resumo: 'Tomadores, forma de faturar, vencimento e serviços padrão.',
    corpo: `
      <p>Em <strong>Clientes</strong> ficam os tomadores de cada empresa. Informe o CNPJ/CPF (a busca preenche os dados), endereço e e-mail.</p>
      <h3>Como faturar</h3>
      <ul>
        <li><strong>Somente nota:</strong> emite a NFS-e.</li>
        <li><strong>Nota + boleto:</strong> emite a nota e gera o boleto.</li>
        <li><strong>Somente boleto:</strong> gera só a cobrança.</li>
      </ul>
      <h3>Vencimento</h3>
      <p>Por prazo (X dias após a emissão) ou em dia fixo do mês. Boleto não vence em sábado, domingo ou feriado: o sistema antecipa para o dia útil anterior.</p>
      <h3>Serviços padrão e agenda</h3>
      <p>Na aba <strong>Serviços padrão</strong> do cliente, cadastre o serviço e o valor que se repetem todo mês; eles alimentam a <em>Emissão automática</em>. Também é ali que se define o envio automático por e-mail.</p>`,
  },
  {
    id: 'servicos', titulo: 'Serviços e tributação', resumo: 'Cadastro do serviço, código nacional, NBS, retenções.',
    corpo: `
      <p>Em <strong>Serviços</strong> cadastre cada serviço prestado pela empresa selecionada: descrição que sai na nota, código de tributação nacional (cTribNac), alíquota e, se for o caso, NBS.</p>
      <h3>Tributação do serviço</h3>
      <p>No cadastro há a seção de tributação, onde se configura o que se repete em toda nota desse serviço: indicador de operação, código de classificação tributária, ISS retido, <strong>retenções federais</strong> (PIS, COFINS, CSLL, IRRF, INSS) e demais campos. Ao escolher o serviço na emissão, esses valores já preenchem o formulário e seguem para o XML da DPS.</p>
      <p class="dica">Confira sempre o enquadramento com o contador. O sistema só repete o que foi cadastrado.</p>`,
  },
  {
    id: 'emitir', titulo: 'Emitir nota', resumo: 'Passo a passo da emissão, F2 para clientes e boleto junto.',
    corpo: `
      <ol>
        <li>Abra <strong>Emitir nota</strong> (confira a empresa no alto do menu).</li>
        <li><strong>Cliente:</strong> comece a <strong>digitar o nome</strong> (ou o CNPJ/CPF): a lista se filtra enquanto você escreve; use as setas e Enter, ou clique no cliente. Apagar o campo volta para <em>Consumidor não identificado</em>. <kbd>F2</kbd> abre a consulta completa, em janela. Também dá para cadastrar um cliente novo ali mesmo.</li>
        <li><strong>Serviço:</strong> ao escolher, descrição, código, alíquotas e retenções do cadastro são preenchidos.</li>
        <li>Informe competência, valor e, se precisar, ajuste descrição e retenções.</li>
        <li>Se o cliente fatura com boleto, defina o vencimento (já sugerido pela regra do cliente).</li>
        <li><strong>Emitir.</strong> O sistema monta a DPS, assina com o certificado e envia à Sefin.</li>
      </ol>
      <h3>Se algo der errado</h3>
      <ul>
        <li><strong>Rejeitada:</strong> a tela da nota mostra o código e o motivo. Use <em>Corrigir e reenviar</em>; o número da DPS é mantido.</li>
        <li><strong>Sem resposta da Sefin:</strong> use <em>Consultar na Sefin</em> antes de reenviar; a nota pode já ter sido gerada e é recuperada sem duplicar.</li>
      </ul>
      <p class="dica">Em produção restrita as notas são de teste e não têm valor fiscal.</p>`,
  },
  {
    id: 'notas', titulo: 'Notas emitidas', resumo: 'Consultar, baixar, enviar, cancelar, excluir e importar XML.',
    corpo: `
      <p>A lista mostra as notas da empresa com situação, número, cliente e valor. Clique na nota para ver o detalhe.</p>
      <h3>O que dá para fazer</h3>
      <ul>
        <li><strong>Abrir DANFSe</strong> (PDF) e <strong>baixar o XML</strong>.</li>
        <li><strong>Consultar no portal nacional</strong>.</li>
        <li><strong>Enviar por e-mail</strong> ou WhatsApp ao cliente (só notas de produção).</li>
        <li><strong>Cancelar nota:</strong> só para nota autorizada, com motivo de pelo menos 15 caracteres. A nota fica <em>Cancelada</em> e continua no histórico.</li>
        <li><strong>Excluir nota:</strong> só para nota <em>não autorizada</em> (rejeitada, pendente ou sem resposta). Nota autorizada ou cancelada <u>nunca</u> pode ser excluída. Os boletos ligados continuam no sistema. Só aparece para o administrador e para usuários com a permissão <em>Excluir registros</em>.</li>
        <li><strong>Importar XML:</strong> traz para o sistema notas emitidas fora (por exemplo, no portal, para empresas sem certificado).</li>
        <li><strong>Baixar em lote</strong> as notas de um período (PDF e XML).</li>
      </ul>
      <p class="dica">Dúvida se a Sefin gerou a nota? Use <em>Consultar na Sefin</em> antes de excluir uma nota pendente.</p>`,
  },
  {
    id: 'agenda', titulo: 'Emissão automática', resumo: 'Preparar as notas e boletos do mês e confirmar de uma vez.',
    corpo: `
      <p>Para clientes com cobrança todo mês. O sistema <strong>prepara</strong> a emissão na data de cada cliente, usando o serviço padrão e o valor cadastrados; <strong>nada é emitido sem a sua confirmação</strong>.</p>
      <h3>Configurar</h3>
      <ol>
        <li>Em <strong>Clientes</strong>, cadastre o serviço e o valor na aba Serviços padrão.</li>
        <li>Em <strong>Emissão automática</strong>, clique em <em>Agendar</em> no cliente e escolha o dia do mês.</li>
      </ol>
      <h3>No dia a dia</h3>
      <p>Escolha o mês. Cada item aparece como <em>Pronta</em>, <em>Agendada</em> (ainda não chegou a data), <em>Emitida</em>, <em>Com erro</em> ou <em>Pulada</em>. Use <em>Emitir</em> em um item, <strong>Emitir prontas</strong> para todos de uma vez, <em>Pular</em> para ignorar o mês ou <em>Tentar de novo</em> nos que deram erro. Conforme o cliente, gera nota, nota + boleto ou só boleto.</p>`,
  },
  {
    id: 'cobrancas', titulo: 'Cobranças e boletos', resumo: 'Boletos Ailos, remessa, retorno e baixas.',
    corpo: `
      <p>A tela <strong>Cobranças</strong> lista os boletos da empresa com situação (pendente, pronto, enviado ao banco, registrado, pago, cancelado).</p>
      <h3>Fluxo com o banco (Ailos)</h3>
      <ol>
        <li>Configure os <em>Dados bancários</em> da empresa (em Empresas).</li>
        <li>Os boletos são gerados na emissão, no faturamento automático ou como <strong>boleto avulso</strong>.</li>
        <li>Gere a <strong>remessa</strong> (arquivo CNAB) e envie no Ailos Conta Online: Cobrança Bancária &gt; Arquivo de Cobrança.</li>
        <li>Depois do pagamento, baixe o <strong>arquivo de retorno</strong> no mesmo menu e importe aqui para dar baixa automática.</li>
      </ol>
      <h3>Outras ações</h3>
      <ul>
        <li><strong>Boleto:</strong> abre o PDF para imprimir ou enviar. <strong>WhatsApp</strong> abre a mensagem pronta.</li>
        <li><strong>Marcar pago:</strong> baixa manual. <strong>Reemitir:</strong> altera vencimento ou valor. <strong>Cancelar:</strong> se já foi ao banco, a baixa vai na próxima remessa.</li>
      </ul>`,
  },
  {
    id: 'despesas', titulo: 'Despesas e balanço', resumo: 'Lançar despesas e acompanhar receitas × despesas.',
    corpo: `
      <p>Em <strong>Despesas e balanço</strong> lance as despesas da empresa por categoria e acompanhe o resultado do mês: o que foi <em>recebido</em> (boletos pagos) contra o que foi gasto. Marcar as cobranças como pagas e lançar as despesas mantém o balanço confiável. O <strong>Painel do mês</strong> resume faturado, recebido, a receber, em atraso e quem ainda falta emitir.</p>`,
  },
  {
    id: 'extrato', titulo: 'Extrato e conciliação', resumo: 'Importar o extrato em PDF, classificar e ligar aos boletos.',
    corpo: `
      <p>Hoje o sistema lê o extrato em PDF do <strong>Ailos</strong> (outros bancos entram depois).</p>
      <ol>
        <li>Em <strong>Extrato e conciliação</strong>, clique em <em>Importar extrato (PDF)</em>. O sistema confere o total lido com o saldo do próprio extrato.</li>
        <li><strong>Classifique</strong> entradas e saídas por categoria. Regras aprendem com o que você classifica e valem para lançamentos parecidos.</li>
        <li>Nas entradas, use <strong>Ligar a boleto</strong> para conciliar o recebimento com o boleto (aparecem os boletos de valor compatível, mesmo com vencimento diferente da data do crédito).</li>
        <li>O balanço do mês só fecha quando não há lançamentos sem classificação.</li>
      </ol>
      <p class="dica">Importar o mesmo extrato duas vezes não duplica os lançamentos. Uma importação errada pode ser excluída na lista de importações.</p>`,
  },
  {
    id: 'relatorios', titulo: 'Relatórios', resumo: 'Os relatórios disponíveis e qual data cada um usa.',
    corpo: `
      <p>A nota é emitida em um dia, o boleto vence em outro e é pago em outro. Por isso cada relatório informa <strong>qual data filtra o período</strong> e mostra as demais nas colunas.</p>
      <ul>
        <li><strong>Receitas emitidas:</strong> por data de emissão da nota.</li>
        <li><strong>Contas a receber por vencimento.</strong></li>
        <li><strong>Em aberto por data de emissão.</strong></li>
        <li><strong>Recebimentos:</strong> por data de pagamento.</li>
        <li><strong>Saldo vencido por cliente</strong> (faixas de atraso) e <strong>Posição por cliente</strong>.</li>
        <li><strong>Notas emitidas e tributos:</strong> ISS e retenções.</li>
        <li><strong>Fluxo de caixa por categoria:</strong> a partir do extrato importado.</li>
      </ul>
      <p>Escolha o relatório, o período, o cliente e a situação (quando houver) e clique em <em>Gerar</em>. Exporte para <strong>Excel (CSV)</strong> ou <strong>PDF</strong>.</p>`,
  },
  {
    id: 'contabilidade', titulo: 'Exportar para a contabilidade', resumo: 'Pacote com extrato em OFX, PDF e XML das notas.',
    corpo: `
      <p>Em <strong>Configurações &gt; Contabilidade</strong> (administrador) escolha a empresa e o mês. O sistema gera um pacote ZIP com o extrato convertido em <strong>OFX</strong>, o extrato em <strong>PDF</strong> e os <strong>XML</strong> de todas as notas emitidas no período, pronto para enviar ao contador.</p>`,
  },
  {
    id: 'configuracoes', titulo: 'Configurações', resumo: 'Usuários, e-mail, aparência, backup, licença e atualizações.',
    corpo: `
      <ul>
        <li><strong>Minha conta:</strong> altere sua senha.</li>
        <li><strong>Usuários e acessos</strong> (administrador): crie usuários e libere por usuário as funcionalidades (emissão, notas, cobranças, relatórios etc.) e as empresas que cada um enxerga. A permissão <strong>Excluir registros</strong> é separada das demais: sem ela o usuário não vê nem consegue usar nenhuma exclusão (nota não autorizada, serviço, despesa, importação de extrato), mesmo tendo acesso à tela. O administrador sempre pode.</li>
        <li><strong>E-mail:</strong> servidor SMTP usado para enviar notas e boletos aos clientes e para a recuperação de senha.</li>
        <li><strong>Aparência:</strong> escolha entre <em>Preto e laranja</em>, <em>Branco e laranja</em> e <em>Azul e dourado</em>. Vale para o computador.</li>
        <li><strong>Backup:</strong> o sistema faz cópia automática diária; também dá para baixar um backup quando quiser. Guarde uma cópia fora do computador.</li>
        <li><strong>Licença:</strong> mostra a situação e permite informar um novo código.</li>
        <li><strong>Atualizações:</strong> o sistema baixa novas versões e pede para reiniciar; os dados são preservados.</li>
      </ul>`,
  },
  {
    id: 'atalhos', titulo: 'Atalhos e dicas', resumo: 'Atalhos de teclado e boas práticas.',
    corpo: `
      <ul>
        <li>Em Emitir nota, digite no campo do cliente para buscar na hora; <kbd>F2</kbd> abre a consulta completa (setas, Enter para escolher, Esc para fechar).</li>
        <li>Confira sempre a <strong>empresa selecionada</strong> no alto do menu antes de emitir.</li>
        <li>Teste primeiro em <em>Produção restrita</em>.</li>
        <li>Mantenha backup fora do computador e renove o certificado A1 antes do vencimento.</li>
      </ul>`,
  },
  {
    id: 'problemas', titulo: 'Problemas comuns', resumo: 'O que fazer nos erros mais frequentes.',
    corpo: `
      <dl class="faq">
        <dt>"Cadastre o certificado A1 da empresa antes de emitir"</dt><dd>Envie o certificado em Empresas &gt; Certificado, ou mude a empresa para o modo Portal se ela emite sem certificado.</dd>
        <dt>Nota rejeitada</dt><dd>Leia o código e o motivo na tela da nota, corrija os dados em <em>Corrigir e reenviar</em>. Se não for possível corrigir, exclua a nota rejeitada e emita outra.</dd>
        <dt>A Sefin não respondeu</dt><dd>Use <em>Consultar na Sefin</em> na nota. Se ela existir, é recuperada; senão, reenvie.</dd>
        <dt>Não consigo gerar boleto</dt><dd>Falta preencher os Dados bancários da empresa (Empresas &gt; Dados bancários).</dd>
        <dt>Não encontro uma opção no menu</dt><dd>Seu usuário pode não ter a permissão; peça ao administrador em Configurações &gt; Usuários e acessos.</dd>
        <dt>Extrato não confere</dt><dd>O sistema compara o total lido com o do PDF e avisa a diferença; confirme se o PDF é do Ailos e do período completo.</dd>
      </dl>`,
  },
];
