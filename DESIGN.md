---
name: Consistem Design System
colors:
  surface: '#f5f5f5'
  surface-dim: '#d9dadb'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#46464a'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#77777b'
  outline-variant: '#c7c6ca'
  surface-tint: '#5f5e60'
  primary: '#2e2e30'
  on-primary: '#ffffff'
  primary-container: '#2e2e30'
  on-primary-container: '#a5a5ab'
  inverse-primary: '#ffffff'
  secondary: '#df5241'
  on-secondary: '#ffffff'
  secondary-container: '#fceeec'
  on-secondary-container: '#df5241'
  tertiary: '#ebaf2d'
  on-tertiary: '#ffffff'
  tertiary-container: '#fcf5e5'
  on-tertiary-container: '#956a0e'
  error: '#c4432e'
  on-error: '#ffffff'
  error-container: '#f5c9c4'
  on-error-container: '#93000a'
  primary-fixed: '#e4e2e4'
  primary-fixed-dim: '#c8c6c8'
  on-primary-fixed: '#1b1b1d'
  on-primary-fixed-variant: '#474649'
  secondary-fixed: '#ffdad5'
  secondary-fixed-dim: '#ffb4a8'
  on-secondary-fixed: '#410000'
  on-secondary-fixed-variant: '#8d160d'
  tertiary-fixed: '#ffdea7'
  tertiary-fixed-dim: '#fabc3a'
  on-tertiary-fixed: '#271900'
  on-tertiary-fixed-variant: '#5e4200'
  background: '#f5f5f5'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
  graphite-pure: '#2e2e30'
  graphite-hover: '#2a2a2c'
  graphite-muted: 'rgba(46,46,48,0.70)'
  graphite-subtle: 'rgba(46,46,48,0.40)'
  graphite-border: '#eaeaea'
  surface-canvas: '#f5f5f5'
  surface-card: '#ffffff'
  surface-sunken: '#f5f5f5'
  coral-primary: '#df5241'
  coral-hover: '#cb4b3b'
  coral-subtle: '#fceeec'
  coral-surface: '#fceeec'
  gold-accent: '#ebaf2d'
  gold-hover: '#e9a616'
  gold-subtle: '#fcf5e5'
  status-success: '#1e7a45'
  status-success-subtle: '#eaf7f0'
# Estilos de texto da DS Consistem (fonte da verdade). Família: DM Sans.
typography:
  Headings/heading-xl:    # H2 de seção
    fontFamily: DM Sans
    fontSize: 40px
    fontWeight: '400'
    lineHeight: 44px
    letterSpacing: -0.8px
  Headings/heading-lg:    # título de destaque / bloco secundário
    fontFamily: DM Sans
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 38.4px
    letterSpacing: -0.64px
  Headings/heading-md:    # título de card (130%)
    fontFamily: DM Sans
    fontSize: 24px
    fontWeight: '400'
    lineHeight: 130%
    letterSpacing: 0
  Headings/heading-sm:    # título de item
    fontFamily: DM Sans
    fontSize: 20px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0
  Body/lead:              # subtítulo de seção e hero
    fontFamily: DM Sans
    fontSize: 20px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.4px
  Body/body-lg:           # corpo de artigo (apenas onde a biblioteca usa)
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 130%
    letterSpacing: 0
  Body/body:              # texto corrido, descrições, botões
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 130%
    letterSpacing: 0
  Body/body-strong:       # ênfase em texto corrido e rótulos de navegação
    fontFamily: DM Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 130%
    letterSpacing: 0
  Body/caption:           # resumos curtos, itens de menu, metadados
    fontFamily: DM Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 130%
    letterSpacing: 0
  Labels/label:           # meta curta, tags, contadores
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 130%
    letterSpacing: 0
  Labels/label-regular:   # links de rodapé, breadcrumb
    fontFamily: DM Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 130%
    letterSpacing: -0.24px
  Labels/label-xs:        # caixa-alta: categoria e selo HELP
    fontFamily: DM Sans
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 130%
    letterSpacing: 0
    textCase: UPPER
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:  # escala da DS Consistem (px)
  space-0: 0px
  space-2: 2px
  space-4: 4px
  space-6: 6px
  space-8: 8px
  space-12: 12px
  space-16: 16px
  space-20: 20px
  space-24: 24px
  space-32: 32px
  space-40: 40px
  space-48: 48px
  space-56: 56px
  space-64: 64px
  space-80: 80px
  space-96: 96px
  space-112: 112px
  space-128: 128px
  space-160: 160px
  space-192: 192px
  space-256: 256px
  layout-margin-mobile: 1rem      # margens de layout do projeto (sem equivalente exato na biblioteca: layout/page-inset = 8px, a confirmar)
  layout-margin-tablet: 1.5rem
  layout-margin-desktop: 2.5rem
  gutter-desktop: 1.5rem
---

## Brand & Style

O design system estabelece a experiência operacional para o ecossistema de soluções da **Consistem**[cite: 1]. A estética une a sobriedade institucional à sofisticação geométrica[cite: 1]: confiança sólida guiada por alto contraste estrutural, layouts bem espaçados ("que respiram") e uso cirúrgico de acentos cromáticos[cite: 1, 3].

### Filosofia da Marca & Audiência
Projetado para gestores operacionais, C-Levels, analistas e usuários do sistema[cite: 1], a interface elimina a fricção cognitiva em fluxos complexos de ERP[cite: 1, 3]. A personalidade reflete o posicionamento da Consistem: autoridade técnica (Sábio) aliada à capacidade prática de resolução (Herói)[cite: 1].

### Estilo Visual
- **Camadas & Superfícies:** Superfícies em Branco Puro (`#ffffff`) sobrepostas a um fundo Neutro Suave (`#f8f9fa`)[cite: 1]. A geometria segue a lógica do símbolo da marca: precisa, com cantos suavemente arredondados (evitar $90^\circ$ secos)[cite: 1].
- **Espaço em Branco (Respiro):** Uso intencional de Macro Espaço (margens generosas entre seções) e Micro Espaço (espaçamento interno de cards, formulários e entrelinhas) para evitar poluição e ruído visual[cite: 3].
- **Acentos Cromáticos:** Grafite (`#2e2e30`) ancora a estrutura e a tipografia principal (55-70% da UI)[cite: 1]. Coral Técnico Desaturado (`#df5241`) atua com precisão clínica em botões de ação (CTA), alertas e acentos (15-20%)[cite: 1]. Amarelo Queimado (`#ebaf2d`) trata destaques secundários e badges informativos (15-20%)[cite: 1].

## Colors

A arquitetura de cor prioriza clareza, legibilidade e suporte à tomada de decisão[cite: 1, 3]:

- **Primary (`#2e2e30` - Grafite):** Ancoragem visual, títulos, textos corporativos e estados de navegação[cite: 1].
- **Secondary (`#df5241` - Coral Técnico Desaturado):** Exclusivo para ações primárias de conversão ("Salvar Alterações", "Confirmar"), estados ativos relevantes e destaques operacionais[cite: 1]. Nunca deve ser usado em grandes áreas de fundo[cite: 1].
- **Tertiary (`#ebaf2d` - Amarelo Queimado):** Orientação de atenção para itens em análise, alertas, pendências e acentos secundários[cite: 1].
- **Neutral (`#f8f9fa` - Canvas Suave):** Fundo padrão da aplicação que garante o respiro e contrasta com módulos flutuantes[cite: 1, 3].

### Gradients & Badges
- **Estados Interativos:** Elementos em Coral migram para `#cb4b3b` no hover[cite: 1]. Grafite migra para `#2a2a2c`[cite: 1].
- **Badges de Status:** Combinam fundo suave desaturado com texto em tom pleno (ex: fundo `#fceeec` com texto `#cb4b3b` para erros/alertas; fundo `#fcf5e5` com texto `#956a0e` para pendências)[cite: 1]. Texto de cor coral sobre fundo claro usa `#cb4b3b` (token `text-accent`, contraste AA); `#df5241` fica para ícones, bordas e fundos.
- **Gradiente Secundário Autorizado:** Transição a $135^\circ$ entre `#df5241` (100%) e `#ebaf2d` (100%), reservada a banners ou cards de alto impacto[cite: 1].

## Typography

A tipografia oficial é a **DM Sans**[cite: 1]. Oferece uma leitura geométrica limpa e fluida[cite: 1].

### Diretrizes de Hierarquia & Tipografia
- **Títulos & Headlines (Headings/*):** Peso `Regular` (400) com tracking `-0.02em` nos títulos de seção (heading-xl 40/44, heading-lg 32/38.4). Para ênfase dentro do título, use peso 600. Os títulos de card e de item (heading-md, heading-sm) seguem o mesmo peso.
- **Texto Corrido (Body/*):** Peso `Regular` (400) com entrelinha de 130% (estilo `Body/body`). Rótulos e metadados usam `Labels/*` (12 SemiBold; 10 SemiBold em caixa-alta apenas para etiquetas curtas).
- **Subtítulo (Body/lead):** 20px com entrelinha de 24px e tracking `-0.4px`.
- **Alinhamento & Estilo:** Alinhamento preferencial à esquerda[cite: 1, 3]. Evitar parágrafos longos centralizados ou justificados[cite: 1, 3]. Caixa alta (uppercase) deve ser restrita a pequenas etiquetas/badges (`label-sm` / `label-md`)[cite: 1].
- **Grafia da Marca:** Sempre escrever **Consistem** em textos corridos (Maiúscula seguida de minúsculas)[cite: 1]. Nunca escrever CONSISTEM[cite: 1].

## Layout & Spacing

Organizado em um grid responsivo fluído de 12 colunas[cite: 3].

### Ritmo Espacial & Visual Space
- **Respiro de Interface:** Evitar layouts sufocados[cite: 3]. Remover elementos decorativos sem função estrutural que gerem ruído visual[cite: 3].
- **Distribuição de Containers:** Manter o limite ideal de **2 a 3 cards/boxes principais por linha visual** no desktop[cite: 1, 3].
- **Breakpoints:**
  - **Mobile (< 768px):** Grid de 4 colunas, margem de `1rem` (16px)[cite: 3].
  - **Tablet (768px – 1024px):** Grid de 8 colunas, margem de `1.5rem` (24px)[cite: 3].
  - **Desktop (> 1024px):** Grid de 12 colunas, margem de `2.5rem` (40px), gutters de `1.5rem` (24px) entre módulos[cite: 3].

## Elevation, Depth & Shapes

Geometria suave com bordas levemente arredondadas e uso moderado de profundidade[cite: 1].

### Tratameno de Forma (Shapes)
- **Cards e Painéis:** Cantos arredondados suavizados (`0.75rem` / 12px a `1rem` / 16px). Evitar cantos de $90^\circ$ totalmente rígidos[cite: 1].
- **Imagens e Ilustrações:** Evitar enclausurar imagens em caixas com fundos carregados[cite: 3]. Imagens e ilustrações recortadas (PNG/SVG) que integram suavemente no fundo neutro facilitam o foco e o respiro[cite: 1, 3].
- **Sombra & Camadas:** Efeitos da biblioteca: `shadow/shadow-float` (0 4px 8px, 10% preto) para elementos flutuantes, `shadow/shadow-media` (0 20px 40px, 10%) para fotos e mídias, `shadow/shadow-overlay` (0 8px 32px, 28%) para popovers e painéis sobre fundo escuro e `shadow/shadow-inner-hairline` (contorno interno 1px, branco 14%). Cards usam borda fina `#eaeaea` (`color/border`) e não sombra.

## Iconography & Button System

### Sistema de Ícones Consistem
- **Construção:** Grid base de `24x24 px` com traço uniforme de `1.75 px` e junções arredondadas[cite: 1].
- **Esquema de Cores:** Corpo em Grafite (`#2e2e30`) ou Branco (`#ffffff`) acompanhado por **apenas 1 ponto de acento de cor** em Coral (`#df5241`) ou Amarelo (`#ebaf2d`)[cite: 1].

### Uso de Ícones em Botões
- **Ícone à Esquerda:** Utilizado quando ajuda a reconhecer previamente a ação (ex: `+ Criar produto`, `Filtrar resultados`, `Baixar arquivo`)[cite: 4].
- **Ícone à Direita:** Utilizado quando indica direção, avanço de etapa ou próximo passo (ex: `Próximo →`, `Enviar →`, `Abrir no app ↗`)[cite: 4]. Ações de retorno usam seta à esquerda (`← Voltar`)[cite: 4].
- **Regras para Ícones em Botões:**
  - Não utilizar ícone quando o botão for simples e óbvio (ex: `Entrar`, `Cadastrar`)[cite: 4].
  - Nunca utilizar dois ícones em um mesmo botão[cite: 4].
  - Ícone e texto devem formar um grupo visual único e centralizado dentro da estrutura do botão[cite: 4].

## UX Writing & Communication Guidelines

A comunicação do sistema deve ser **clara, concisa, humana e orientada à solução**[cite: 1, 5]:

- **Ação em Primeiro Lugar:** Iniciar instruções pelo objetivo (Ex: *"Consulte sua fatura na área financeira"* em vez de *"Acesse a área financeira para consultar sua fatura"*)[cite: 5].
- **Afirmação Direta & Voz Ativa:** Preferir a voz ativa e enunciados afirmativos (Ex: *"Redefina sua senha para acessar"* em vez de *"A senha deve ser redefinida"*; *"Cancelar assinatura"* em vez de *"Não manter assinatura"*)[cite: 5].
- **Erros como Orientação:** Mensagens de erro devem explicar a causa na linguagem do usuário (sem códigos técnicos como "Erro 409") e mostrar exatamente como resolver (Ex: *"Formato de arquivo inválido. Envie um arquivo PDF, DOCX ou XLSX de até 10 MB"*)[cite: 5].
- **Microcopy Transparente:** Explicar a necessidade de dados solicitados (ex: CPF) e explicitar consequências graves antes de confirmações destrutivas[cite: 5].