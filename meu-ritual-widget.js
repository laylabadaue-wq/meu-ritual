// Meu Ritual — widget para o app Scriptable (iPhone)
// Mostra as tarefas de hoje e a próxima conta. Toque numa tarefa para marcá-la como feita.
// Na primeira vez, rode este script dentro do Scriptable para entrar com a sua conta do Meu Ritual.

const API_KEY = 'AIzaSyC4PCD13mZv0hJtXkuYLHsjAPOPioRhf0Q';
const PROJETO = 'meu-ritual-fb0f0';
const SITE = 'https://laylabadaue-wq.github.io/meu-ritual/';
const K_TOKEN = 'meuRitual.refreshToken', K_UID = 'meuRitual.uid';

const COR = {
  fundo: Color.dynamic(new Color('#F6F1E9'), new Color('#1B1915')),
  texto: Color.dynamic(new Color('#38382F'), new Color('#EFE8DC')),
  suave: Color.dynamic(new Color('#857C6F'), new Color('#A99F90')),
  salvia: Color.dynamic(new Color('#5D7256'), new Color('#AFC2A2')),
  alerta: Color.dynamic(new Color('#A6483A'), new Color('#E9907F')),
};

/* ---------- conta (só o token fica guardado no Chaveiro do iPhone, nunca a senha) ---------- */
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
function proxima(x) {
  if (!x.data || !x.rep || x.rep === 'nao') return null;
  const d = fromKey(x.data);
  if (x.rep === 'diario') d.setDate(d.getDate() + 1);
  else if (x.rep === 'semanal') d.setDate(d.getDate() + 7);
  else { const dia = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(Math.min(dia, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  return {...x, id: uid(), data: dkey(d), feito: false, feitoEm: null, criado: Date.now()};
}
function tarefasDoDia(doc) {
  const hoje = dkey(), itens = (doc && doc.itens || []).filter(x => !x.feito);
  const ordem = (a, b) => (a.data || '9999').localeCompare(b.data || '9999') || (a.hora || '99').localeCompare(b.hora || '99');
  return [...itens.filter(x => x.data && x.data <= hoje).sort(ordem), ...itens.filter(x => !x.data).sort((a, b) => a.criado - b.criado)];
}
function proximaConta(doc) {
  return (doc && doc.contas || []).filter(c => !c.pago).sort((a, b) => a.venc.localeCompare(b.venc))[0] || null;
}
const brl = v => v ? 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') : 'a preencher';
function quando(venc) {
  const n = Math.round((fromKey(venc) - fromKey(dkey())) / 864e5);
  return n < 0 ? `vencida há ${-n} d` : n === 0 ? 'vence hoje' : n === 1 ? 'vence amanhã' : `vence em ${n} dias`;
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

/* ---------- desenho do widget ---------- */
function linha(st, texto, cor, tam, peso) {
  const t = st.addText(texto); t.textColor = cor; t.font = peso ? Font.semiboldSystemFont(tam) : Font.systemFont(tam); t.lineLimit = 1; return t;
}
function montar(tarefas, conta, msg) {
  const w = new ListWidget(), fam = config.widgetFamily || 'large';
  w.backgroundColor = COR.fundo; w.setPadding(14, 14, 12, 14); w.url = SITE;
  w.refreshAfterDate = new Date(Date.now() + 60 * 1000); // pede atualização rápida (o iPhone decide quando)
  const topo = w.addStack(); topo.centerAlignContent();
  linha(topo, 'Meu Ritual', COR.salvia, 13, true); topo.addSpacer();
  linha(topo, tarefas.length ? `${tarefas.length} pendente${tarefas.length > 1 ? 's' : ''}` : 'tudo feito', COR.suave, 11);
  w.addSpacer(8);
  if (msg) { linha(w, msg, COR.alerta, 12); return w; }
  const max = fam === 'small' ? 2 : fam === 'medium' ? 3 : 7;
  if (!tarefas.length) linha(w, 'Nenhuma tarefa para hoje', COR.suave, 13);
  for (const x of tarefas.slice(0, max)) {
    const s = w.addStack(); s.centerAlignContent(); s.spacing = 7;
    if (fam !== 'small') s.url = `scriptable:///run/${encodeURIComponent(Script.name())}?marcar=${x.id}`;
    const late = x.data && x.data < dkey();
    linha(s, '○', late ? COR.alerta : COR.salvia, 15);
    linha(s, x.titulo, COR.texto, 13);
    s.addSpacer();
    if (x.hora) linha(s, x.hora, COR.suave, 11);
    w.addSpacer(5);
  }
  if (conta && fam !== 'small') {
    w.addSpacer();
    const c = w.addStack(); c.centerAlignContent();
    linha(c, `Próxima conta: ${conta.nome}`, COR.texto, 11, true); c.addSpacer();
    linha(c, `${brl(conta.valor)} · ${quando(conta.venc)}`, quando(conta.venc).startsWith('vencida') ? COR.alerta : COR.suave, 11);
  }
  return w;
}
async function aviso(t, m) { const a = new Alert(); a.title = t; a.message = m; a.addAction('OK'); await a.presentAlert(); }

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
    const w = tk ? montar(tarefasDoDia(await ler('tarefas', tk)), proximaConta(await ler('financas', tk))) : montar([], null, 'Entre de novo com a sua conta.');
    await w.presentLarge();
  }
} else if (params.marcar) {
  const tk = await token();
  const msg = tk ? await marcar(params.marcar, tk) : 'Abra o script no Scriptable para entrar com a sua conta.';
  await aviso('Meu Ritual', msg + '\n\nO widget atualiza em instantes.');
} else {
  const tk = await token();
  let w;
  if (!tk) w = montar([], null, 'Abra este script no Scriptable para entrar.');
  else {
    try { w = montar(tarefasDoDia(await ler('tarefas', tk)), proximaConta(await ler('financas', tk))); }
    catch (e) { w = montar([], null, 'Sem conexão agora.'); }
  }
  Script.setWidget(w);
}
Script.complete();
