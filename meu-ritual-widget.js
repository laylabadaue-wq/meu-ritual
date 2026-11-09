// Meu Ritual — widget para o app Scriptable (iPhone). Versão completa, carregada pelo script curto que fica no Scriptable.
// Mostra treino, skincare, tarefas e contas de hoje. Toque numa tarefa para marcá-la como feita.

const API_KEY = 'AIzaSyC4PCD13mZv0hJtXkuYLHsjAPOPioRhf0Q';
const PROJETO = 'meu-ritual-fb0f0';
const SITE = 'https://laylabadaue-wq.github.io/meu-ritual/';
const K_TOKEN = 'meuRitual.refreshToken', K_UID = 'meuRitual.uid';

// sempre claro, nas cores do app
const COR = {
  fundo: new Color('#F6F1E9'), cartao: new Color('#FFFDF9'), texto: new Color('#38382F'), suave: new Color('#857C6F'),
  salvia: new Color('#5D7256'), salviaClara: new Color('#E6EADD'), areia: new Color('#EFE6D8'), alerta: new Color('#A6483A'), ok: new Color('#4F7046')
};

/* ---------- conta (só uma chave de acesso fica no Chaveiro do iPhone, nunca a senha) ---------- */
async function entrar() {
  const a = new Alert();
  a.title = 'Meu Ritual';
  a.message = 'Entre com a mesma conta do app (Ajustes → Conta).';
  a.addTextField('e-mail');
  a.addSecureTextField('senha');
  a.addAction('Entrar');
  a.addCancelAction('Cancelar');
  if (await a.presentAlert() === -1) return false;
  const r = new Request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`);
  r.method = 'POST';
  r.headers = {'Content-Type': 'application/json'};
  r.body = JSON.stringify({email: a.textFieldValue(0).trim(), password: a.textFieldValue(1), returnSecureToken: true});
  const j = await r.loadJSON();
  if (!j.refreshToken) { await aviso('Não deu para entrar', 'Confira o e-mail e a senha. Se esqueceu a senha, use "Esqueci a senha" no app.'); return false; }
  Keychain.set(K_TOKEN, j.refreshToken); Keychain.set(K_UID, j.localId);
  return true;
}
async function token() {
  if (!Keychain.contains(K_TOKEN)) return null;
  const r = new Request(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`);
  r.method = 'POST';
  r.headers = {'Content-Type': 'application/x-www-form-urlencoded'};
  r.body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(Keychain.get(K_TOKEN));
  const j = await r.loadJSON();
  if (!j.id_token) return null;
  Keychain.set(K_TOKEN, j.refresh_token); Keychain.set(K_UID, j.user_id);
  return j.id_token;
}

/* ---------- Firestore (formato de valores da API REST) ---------- */
function de(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(de);
  if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = de(x); return o; }
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
function para(x) {
  if (x === null || x === undefined) return {nullValue: null};
  if (typeof x === 'boolean') return {booleanValue: x};
  if (typeof x === 'number') return Number.isInteger(x) ? {integerValue: String(x)} : {doubleValue: x};
  if (typeof x === 'string') return {stringValue: x};
  if (Array.isArray(x)) return {arrayValue: {values: x.map(para)}};
  const fields = {}; for (const [k, v] of Object.entries(x)) if (v !== undefined) fields[k] = para(v);
  return {mapValue: {fields}};
}
const url = id => `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents/users/${Keychain.get(K_UID)}/docs/${id}`;
async function ler(id, tk) {
  const r = new Request(url(id)); r.headers = {Authorization: 'Bearer ' + tk};
  const j = await r.loadJSON();
  return j.fields ? de({mapValue: {fields: j.fields}}) : null;
}
async function gravar(id, doc, tk) {
  const r = new Request(url(id)); r.method = 'PATCH';
  r.headers = {Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json'};
  r.body = JSON.stringify({fields: para(doc).mapValue.fields});
  return r.loadJSON();
}

/* ---------- datas e regras iguais às do app ---------- */
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const dataCurta = k => { const d = fromKey(k); return `${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };
function proxima(x) {
  if (!x.data || !x.rep || x.rep === 'nao') return null;
  const d = fromKey(x.data);
  if (x.rep === 'diario') d.setDate(d.getDate() + 1);
  else if (x.rep === 'semanal') d.setDate(d.getDate() + 7);
  else { const dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return {...x, id: uid(), data: dkey(d), feito: false, feitoEm: null, criado: Date.now()};
}
function tarefas(doc) {
  const hoje = dkey(), itens = (doc && doc.itens || []).filter(x => !x.feito);
  const ordem = (a, b) => (a.data || '9999').localeCompare(b.data || '9999') || (a.hora || '99').localeCompare(b.hora || '99');
  const deHoje = [...itens.filter(x => x.data && x.data <= hoje).sort(ordem), ...itens.filter(x => !x.data).sort((a, b) => a.criado - b.criado)];
  return {deHoje, proximas: itens.filter(x => x.data && x.data > hoje).sort(ordem)};
}
const brl = v => v ? 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') : 'a preencher';
function quando(venc) {
  const n = Math.round((fromKey(venc) - fromKey(dkey())) / 864e5);
  return n < 0 ? `vencida há ${-n}d` : n === 0 ? 'vence hoje' : n === 1 ? 'amanhã' : `em ${n} dias`;
}
function treinoDeHoje(treinos, hist) {
  if (!treinos) return null;
  const hoje = new Date().getDay(), k = dkey();
  const feitos = (hist && hist.sessoes || []).filter(s => dkey(new Date(s.inicio)) === k);
  const fichas = (treinos.treinos || []).filter(t => (t.dias || []).includes(hoje));
  if (treinos.ativa) return {nome: treinos.ativa.nome, status: 'em andamento'};
  if (feitos.length) return {nome: feitos.map(s => s.nome).join(' + '), status: 'feito', ok: true};
  if (fichas.length) return {nome: fichas.map(t => t.nome).join(' + '), status: 'para hoje'};
  return {nome: 'Descanso', status: 'sem treino hoje'};
}
function skincareDeHoje(sk) {
  if (!sk) return null;
  const dia = String(new Date().getDay()), k = dkey(), rot = (sk.rotinas || {})[dia] || {}, ch = (sk.checks || {})[k] || {};
  const conta = per => { const ids = (rot[per] || []).map(x => x.id), feitos = (ch[per] || []).filter(id => ids.includes(id)).length; return {f: feitos, t: ids.length}; };
  return {manha: conta('manha'), noite: conta('noite')};
}

/* ---------- marcar uma tarefa (quando você toca nela no widget) ---------- */
async function marcar(id, tk) {
  const doc = await ler('tarefas', tk);
  const x = doc && doc.itens.find(y => y.id === id);
  if (!x) return 'Essa tarefa não existe mais.';
  if (!x.feito) {
    x.feito = true; x.feitoEm = Date.now();
    const n = proxima(x); if (n) doc.itens.push(n);
  }
  doc.savedAt = Date.now(); // o app usa isso para saber qual versão é a mais nova
  const r = await gravar('tarefas', doc, tk);
  return r.error ? 'Não deu para salvar agora. Tente de novo com internet.' : `Feito: ${x.titulo}`;
}

/* ---------- desenho ---------- */
function txt(st, texto, cor, tam, peso) {
  const t = st.addText(texto); t.textColor = cor; t.font = peso === 2 ? Font.boldSystemFont(tam) : peso ? Font.semiboldSystemFont(tam) : Font.systemFont(tam); t.lineLimit = 1; return t;
}
function bloco(pai, fundo) { const b = pai.addStack(); b.layoutVertically(); b.backgroundColor = fundo; b.cornerRadius = 12; b.setPadding(7, 9, 7, 9); return b; }
function montar(d, msg) {
  const fam = config.widgetFamily || 'large', grande = fam === 'large', pequeno = fam === 'small';
  const w = new ListWidget();
  w.backgroundColor = COR.fundo; w.setPadding(13, 14, 12, 14); w.url = SITE;
  w.refreshAfterDate = new Date(Date.now() + 60 * 1000); // pede atualização rápida (o iPhone decide quando)
  const hoje = new Date();
  const topo = w.addStack(); topo.centerAlignContent();
  txt(topo, 'Meu Ritual', COR.salvia, 13, 2); topo.addSpacer();
  txt(topo, `${DIAS[hoje.getDay()]}, ${hoje.getDate()} de ${MESES[hoje.getMonth()]}`, COR.suave, 11);
  w.addSpacer(7);
  if (msg) { txt(w, msg, COR.alerta, 12); return w; }

  // treino e skincare lado a lado
  if (!pequeno && (d.treino || d.pele)) {
    const linha = w.addStack(); linha.spacing = 6;
    if (d.treino) {
      const b = bloco(linha, d.treino.ok ? COR.salviaClara : COR.cartao);
      txt(b, 'TREINO', COR.suave, 8, 1);
      txt(b, d.treino.nome, COR.texto, 11, 1);
      txt(b, d.treino.ok ? '✓ feito' : d.treino.status, d.treino.ok ? COR.ok : COR.suave, 10);
    }
    if (d.pele) {
      const b = bloco(linha, COR.cartao);
      txt(b, 'SKINCARE', COR.suave, 8, 1);
      const p = (n, x) => x.t ? `${n} ${x.f}/${x.t}${x.f >= x.t ? ' ✓' : ''}` : `${n} —`;
      txt(b, p('Manhã', d.pele.manha), d.pele.manha.t && d.pele.manha.f >= d.pele.manha.t ? COR.ok : COR.texto, 11, 1);
      txt(b, p('Noite', d.pele.noite), d.pele.noite.t && d.pele.noite.f >= d.pele.noite.t ? COR.ok : COR.texto, 11, 1);
    }
    w.addSpacer(8);
  }

  // tarefas
  const cab = w.addStack(); cab.centerAlignContent();
  txt(cab, d.tarefas.deHoje.length ? 'TAREFAS DE HOJE' : 'PRÓXIMAS TAREFAS', COR.suave, 9, 1); cab.addSpacer();
  if (d.tarefas.deHoje.length) txt(cab, `${d.tarefas.deHoje.length} pendente${d.tarefas.deHoje.length > 1 ? 's' : ''}`, COR.suave, 9);
  w.addSpacer(4);
  const max = pequeno ? 3 : grande ? 6 : 2;
  const lista = d.tarefas.deHoje.length ? d.tarefas.deHoje : d.tarefas.proximas;
  if (!lista.length) txt(w, 'Nenhuma tarefa pendente ✓', COR.ok, 12);
  for (const x of lista.slice(0, max)) {
    const s = w.addStack(); s.centerAlignContent(); s.spacing = 7;
    if (!pequeno) s.url = `scriptable:///run/${encodeURIComponent(Script.name())}?marcar=${x.id}`;
    const late = x.data && x.data < dkey();
    txt(s, '○', late ? COR.alerta : COR.salvia, 14);
    txt(s, x.titulo, COR.texto, 12);
    s.addSpacer();
    const info = [x.data && x.data !== dkey() ? dataCurta(x.data) : '', x.hora || ''].filter(Boolean).join(' · ');
    if (info) txt(s, info, late ? COR.alerta : COR.suave, 10);
    w.addSpacer(3);
  }
  if (lista.length > max) txt(w, `+ ${lista.length - max} no app`, COR.suave, 10);

  // contas
  if (!pequeno && d.contas.length) {
    w.addSpacer();
    const n = grande ? 3 : 1;
    if (grande) { txt(w, 'PRÓXIMAS CONTAS', COR.suave, 9, 1); w.addSpacer(3); }
    for (const c of d.contas.slice(0, n)) {
      const s = w.addStack(); s.centerAlignContent();
      txt(s, grande ? c.nome : `Próxima conta: ${c.nome}`, COR.texto, 11, 1); s.addSpacer();
      const q = quando(c.venc);
      txt(s, `${brl(c.valor)} · ${q}`, q.startsWith('vencida') || q === 'vence hoje' ? COR.alerta : COR.suave, 11);
      w.addSpacer(2);
    }
  } else w.addSpacer();
  return w;
}
async function aviso(t, m) { const a = new Alert(); a.title = t; a.message = m; a.addAction('OK'); await a.presentAlert(); }
async function dados(tk) {
  const mes = dkey().slice(0, 7);
  const [tar, fin, tre, pel, hist] = await Promise.all(['tarefas', 'financas', 'treinos', 'skincare', 'treinos-hist-' + mes].map(id => ler(id, tk).catch(() => null)));
  return {
    tarefas: tarefas(tar),
    contas: (fin && fin.contas || []).filter(c => !c.pago).sort((a, b) => a.venc.localeCompare(b.venc)),
    treino: treinoDeHoje(tre, hist),
    pele: skincareDeHoje(pel)
  };
}

/* ---------- execução ---------- */
const params = args.queryParameters || {};
if (config.runsInApp && !params.marcar) {
  const a = new Alert(); a.title = 'Meu Ritual';
  a.message = Keychain.contains(K_TOKEN) ? 'Você já está conectada.' : 'Entre com a sua conta para o widget funcionar.';
  a.addAction(Keychain.contains(K_TOKEN) ? 'Ver o widget' : 'Entrar');
  if (Keychain.contains(K_TOKEN)) a.addAction('Entrar com outra conta');
  a.addCancelAction('Fechar');
  const op = await a.presentAlert();
  if (op === 1 || (op === 0 && !Keychain.contains(K_TOKEN))) await entrar();
  if (op !== -1 && Keychain.contains(K_TOKEN)) {
    const tk = await token();
    const w = tk ? montar(await dados(tk)) : montar(null, 'Entre de novo com a sua conta.');
    await w.presentLarge();
  }
} else if (params.marcar) {
  const tk = await token();
  const msg = tk ? await marcar(params.marcar, tk) : 'Abra o script no Scriptable para entrar com a sua conta.';
  await aviso('Meu Ritual', msg + '\n\nO widget atualiza em instantes.');
} else {
  const tk = await token();
  let w;
  if (!tk) w = montar(null, 'Abra este script no Scriptable para entrar.');
  else { try { w = montar(await dados(tk)); } catch (e) { w = montar(null, 'Sem conexão agora.'); } }
  Script.setWidget(w);
}
Script.complete();
