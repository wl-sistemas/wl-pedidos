# WL Pedidos — WL Sistemas

Cardápio digital com pedidos online para várias lojas, num sistema só.
Cada loja tem o próprio link, o próprio painel e só enxerga os próprios pedidos.

## O que tem nesta versão

**Para o cliente final (celular)**
- Cardápio pelo link `cardapio.html?loja=nome-da-loja`, com a cor e a logo da loja
- Produtos com preço único ou por tamanho (ex.: 300 ml / 500 ml)
- Grupos de opções com mínimo e máximo (ex.: "até 3 frutas", "escolha 1 cobertura")
- Carrinho, entrega / retirada / mesa, pagamento, troco, observações
- Tela de confirmação com número do pedido, chave PIX e botão para avisar a loja no WhatsApp
- Página de acompanhamento que se atualiza sozinha

**Para a loja (painel)**
- Pedidos chegando sozinhos (a cada 5 segundos), com aviso sonoro
- Avançar status: Recebido → Em preparo → Saiu para entrega / Pronto → Finalizado
- Cancelar com motivo (o cliente vê), excluir só depois de cancelado
- Imprimir cupom (impressora térmica 80 mm)
- Mensagem pronta no WhatsApp do cliente para cada status
- Pedido no balcão (garçom/atendente lança pela mesma tela do cardápio, mesmo com a loja fechada)
- Editor de cardápio: categorias, produtos, fotos, tamanhos, opções, "esgotado" com um toque
- Dados da loja: cor, logo, WhatsApp, PIX, taxa de entrega, pedido mínimo, tipos de pedido, formas de pagamento
- Link do cardápio + QR code para imprimir
- Botão Aberta/Fechada

**Para a WL Sistemas (painel master)**
- Criar lojas, mudar o link, dar e tirar acesso de usuários
- Suspender uma loja (por falta de pagamento, por exemplo): o cardápio sai do ar na hora
- Pedidos e vendas de cada loja nos últimos 30 dias

## Segurança (o que o banco garante)
- O preço é **recalculado no banco** a cada pedido. Mudar o valor no navegador não adianta.
- Uma loja nunca vê pedidos, cardápio interno ou dados de outra loja.
- O cliente final não acessa nenhuma tabela: só lê o cardápio e cria pedidos por funções seguras.
- A loja não consegue se reativar sozinha nem trocar o próprio link (só a WL).
- Limite de 5 pedidos em 10 minutos por telefone, para evitar abuso.
- Apenas a chave "publishable" vai no site. A "secret / service_role" nunca.

## Modo demonstração
Enquanto o `config.js` não tiver os dados do Supabase, o sistema abre sozinho em **modo demonstração**:
loja de exemplo pronta, dados salvos só no navegador, faixa amarela no topo avisando.
Entre com **dono@demo.com** (painel da loja) ou **wl@demo.com** (painel da WL), senha **123456**.
Para abrir no computador, os arquivos precisam estar num site (GitHub Pages, por exemplo):
abrir o `index.html` com dois cliques pode não funcionar em alguns navegadores.
Depois de preencher o `config.js`, o modo demonstração desliga sozinho.

---

## Instalação (uma vez só)

### 1. Supabase
1. Crie uma conta **da WL Sistemas** no Supabase e um projeto novo (separado da Mangora).
2. Abra **SQL Editor > New query**, cole todo o arquivo `supabase/01-estrutura.sql` e clique em **Run**. Deve aparecer *Success*.
3. (Opcional) Rode `supabase/03-loja-demonstracao.sql` para ter uma loja de exemplo (`?loja=demo`) para mostrar aos clientes.
4. Em **Authentication > Users > Add user**, crie o seu usuário (seu e-mail e senha) e marque **Auto Confirm User**.
5. Abra `supabase/02-tornar-super-admin.sql`, troque o e-mail pelo seu e rode. Isso faz de você o administrador geral.
6. Em **Authentication > Sign In / Providers**, desligue **Allow new users to sign up**. Assim ninguém cria conta sozinho; só você cria.

### 2. Configurar o site
Abra `config.js` e preencha:
- `supabaseUrl`: o *Project URL* (Project Settings > API)
- `supabaseKey`: a *Publishable key* (começa com `sb_publishable_`)

### 3. Publicar (GitHub Pages, grátis)
1. No GitHub da WL Sistemas, crie um repositório (ex.: `wl-pedidos`) e envie **todos os arquivos desta pasta**.
2. Em **Settings > Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. O sistema fica em `https://SEU-USUARIO.github.io/wl-pedidos/`.
   - Painel: `.../login.html`
   - Cardápio: `.../cardapio.html?loja=nome-da-loja`
4. (Depois) dá para usar um domínio próprio, ex.: `pedidos.wlsistemas.shop`.

---

## Colocando uma loja nova no ar (o dia a dia da WL)
1. Entre em `login.html` com o seu usuário: você cai no painel master.
2. Em **Nova loja**, digite o nome. O link é gerado sozinho (dá para editar).
3. No Supabase, **Authentication > Users > Add user** com o e-mail e uma senha para o dono (marque *Auto Confirm User*).
4. No master, na loja, digite o e-mail em **Dar acesso**.
5. Clique em **Abrir painel** e, se quiser, monte o cardápio para o cliente (você tem acesso a todas as lojas).
6. Envie ao cliente: link do painel, e-mail, senha e o link do cardápio.

Se o cliente atrasar a mensalidade: **Suspender**. Pagou: **Reativar**.

---

## Testes feitos antes da entrega
Testado num banco PostgreSQL local que imita o Supabase, com navegador automatizado:
- 79 testes de banco: preço adulterado, opção de outro produto, mínimos/máximos, loja fechada, loja suspensa,
  loja tentando ver/alterar dados de outra, dono tentando se reativar, imagens na pasta de outra loja etc.
- Fluxo completo no navegador: pedido no celular → painel recebe sozinho → muda status → cliente acompanha;
  cancelamento, editor de produtos, dados da loja, loja fechada, pedido no balcão, painel master.

**Importante:** o Supabase real não foi usado nos testes. Antes de vender, faça um teste completo no seu projeto:
um pedido do celular, mudar status, enviar uma foto de produto, imprimir um cupom.

---

## Trazer a Mangora para cá (quando quiser)
O sistema foi desenhado para receber a Mangora sem perder nada do que ela usa no dia a dia:

| Na Mangora hoje | No WL Pedidos |
|---|---|
| 14 receitas À la Carte com preço 400 ml / 500 ml | 14 produtos com dois tamanhos |
| Monte do Seu Jeito (base + frutas + temperos + coberturas) | 1 produto com tamanhos e 3 grupos de opções, cada opção com seu preço |
| Disponibilidade de ingredientes | "Tem" em cada opção / "Esgotado" no produto |
| Delivery, retirada, mesa/comanda | Entrega, Retirada, Mesa |
| Número curto diário #001 | Número diário por loja #1, #2… |
| Impressão térmica | Botão Imprimir (cupom 80 mm) |

Ainda **não** existem aqui e ficam para a próxima versão (o banco já tem a tabela de despesas pronta):
financeiro por período, despesas, matérias-primas e cadastro de clientes.
Enquanto isso, a Mangora continua no sistema atual, sem mudança nenhuma.

## Próximos passos sugeridos
1. Financeiro e despesas no painel (para trazer a Mangora)
2. Cobrança da mensalidade pelo Mercado Pago com suspensão automática
3. Horário de funcionamento automático (abrir/fechar sozinho)
4. Notificação no celular do lojista quando chega pedido

## Arquivos
```
cardapio.html / js/cardapio.js     cardápio do cliente e modo balcão
acompanhar.html / js/acompanhar.js acompanhamento do pedido
login.html / js/login.js           entrada do painel
painel.html / js/painel.js         painel da loja
master.html / js/master.js         painel da WL Sistemas
js/api.js                          conexão com o Supabase (sem bibliotecas externas)
js/util.js                         funções de apoio
css/                               visual
config.js                          SEUS dados do Supabase
supabase/                          scripts do banco
```

Suporte: WL Sistemas
