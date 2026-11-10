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
    const n = proxima(x); if (n) doc.itens.push({...n, origem: x.id});
  }
  doc.savedAt = Date.now(); // o app usa isso para saber qual versão é a mais nova
  const r = await gravar('tarefas', doc, tk);
  return r.error ? 'Não deu para salvar agora. Tente de novo com internet.' : `Feito: ${x.titulo}`;
}

/* ---------- desenho: poucos blocos, bem separados ---------- */
function txt(st, texto, cor, tam, peso) {
  const t = st.addText(texto); t.textColor = cor; t.lineLimit = 1; t.minimumScaleFactor = 0.8;
  t.font = peso === 'serif' ? new Font('Georgia-Bold', tam) : peso === 2 ? Font.boldSystemFont(tam) : peso ? Font.semiboldSystemFont(tam) : Font.systemFont(tam);
  return t;
}
function icone(st, nome, cor, tam) {
  const s = SFSymbol.named(nome); if (!s) return;
  const i = st.addImage(s.image); i.tintColor = cor; i.imageSize = new Size(tam, tam);
}
function cartao(pai, fundo, pad) { const b = pai.addStack(); b.layoutVertically(); b.backgroundColor = fundo; b.cornerRadius = 14; b.setPadding(pad, pad + 2, pad, pad + 2); return b; }
function titulo(pai, ic, texto, cor, extra) {
  const l = pai.addStack(); l.centerAlignContent(); l.spacing = 5;
  icone(l, ic, cor, 11); txt(l, texto, COR.suave, 10, 1);
  if (extra) { l.addSpacer(); txt(l, extra, COR.suave, 10); }
  return l;
}
const quandoTarefa = x => {
  if (!x.data) return '';
  const hoje = dkey(), amanha = dkey(new Date(Date.now() + 864e5));
  const dia = x.data < hoje ? 'atrasada' : x.data === hoje ? '' : x.data === amanha ? 'amanhã' : (() => { const d = fromKey(x.data); return `${d.getDate()}/${d.getMonth() + 1}`; })();
  return [dia, x.hora].filter(Boolean).join(' · ');
};
function montar(d, msg) {
  const fam = config.widgetFamily || 'large', grande = fam === 'large', pequeno = fam === 'small';
  const w = new ListWidget();
  w.backgroundColor = COR.fundo; w.setPadding(14, 14, 14, 14); w.url = SITE;
  w.refreshAfterDate = new Date(Date.now() + 60 * 1000); // pede atualização rápida (o iPhone decide quando)
  const hoje = new Date();
  const topo = w.addStack(); topo.centerAlignContent();
  txt(topo, 'Meu Ritual', COR.salvia, grande ? 17 : 15, 'serif'); topo.addSpacer();
  txt(topo, pequeno ? `${DIAS[hoje.getDay()]} ${hoje.getDate()}` : `${DIAS[hoje.getDay()]}, ${hoje.getDate()} de ${MESES[hoje.getMonth()]}`, COR.suave, 11);
  w.addSpacer(grande ? 10 : 8);
  if (msg) { txt(w, msg, COR.alerta, 12); w.addSpacer(); return w; }

  // 1) hoje: treino e skincare, um cartão cada
  if (!pequeno) {
    const linha = w.addStack(); linha.spacing = 8;
    const tr = d.treino || {nome: 'Descanso', status: 'sem treino hoje'};
    const c1 = cartao(linha, tr.ok ? COR.salviaClara : COR.cartao, grande ? 9 : 7);
    titulo(c1, 'figure.strengthtraining.traditional', 'TREINO', COR.salvia); c1.addSpacer(3);
    txt(c1, tr.nome, COR.texto, grande ? 14 : 12, 1);
    txt(c1, tr.ok ? '✓ feito' : tr.status, tr.ok ? COR.ok : COR.suave, 11);
    const pele = d.pele || {manha: {f: 0, t: 0}, noite: {f: 0, t: 0}};
    const okM = pele.manha.t && pele.manha.f >= pele.manha.t, okN = pele.noite.t && pele.noite.f >= pele.noite.t;
    const c2 = cartao(linha, okM && okN ? COR.salviaClara : COR.cartao, grande ? 9 : 7);
    titulo(c2, 'sparkles', 'SKINCARE', COR.salvia); c2.addSpacer(3);
    const per = (n, x, ok) => txt(c2, x.t ? `${n} ${ok ? '✓' : `${x.f}/${x.t}`}` : `${n} —`, ok ? COR.ok : COR.texto, grande ? 13 : 12, 1);
    per('Manhã', pele.manha, okM); per('Noite', pele.noite, okN);
    w.addSpacer(grande ? 10 : 8);
  } else if (d.treino) {
    txt(w, d.treino.nome, COR.texto, 12, 1); txt(w, d.treino.ok ? '✓ feito' : d.treino.status, COR.suave, 10); w.addSpacer(6);
  }

  // 2) tarefas, num cartão só
  const lista = d.tarefas.deHoje.length ? d.tarefas.deHoje : d.tarefas.proximas;
  const max = pequeno ? 2 : grande ? 4 : 2;
  const ct = cartao(w, COR.cartao, grande ? 10 : 8);
  titulo(ct, 'checklist', d.tarefas.deHoje.length ? 'TAREFAS DE HOJE' : 'PRÓXIMAS TAREFAS', COR.salvia, lista.length > max ? `+${lista.length - max} no app` : '');
  ct.addSpacer(grande ? 6 : 4);
  if (!lista.length) txt(ct, 'Nada pendente ✓', COR.ok, 12);
  lista.slice(0, max).forEach((x, k) => {
    if (k) ct.addSpacer(grande ? 7 : 4);
    const s = ct.addStack(); s.centerAlignContent(); s.spacing = 8;
    if (!pequeno) s.url = `scriptable:///run/${encodeURIComponent(Script.name())}?marcar=${x.id}`;
    const late = x.data && x.data < dkey();
    icone(s, 'circle', late ? COR.alerta : COR.salvia, grande ? 15 : 13);
    txt(s, x.titulo, COR.texto, grande ? 14 : 12);
    s.addSpacer();
    const q = quandoTarefa(x); if (q && !pequeno) txt(s, q, late ? COR.alerta : COR.suave, 11);
  });

  // 3) contas: só a próxima, numa linha
  if (grande && d.contas.length) {
    w.addSpacer();
    const c = d.contas[0], q = quando(c.venc), urg = q.startsWith('vencida') || q === 'vence hoje';
    const l = w.addStack(); l.centerAlignContent(); l.spacing = 6;
    icone(l, 'creditcard', urg ? COR.alerta : COR.salvia, 13);
    txt(l, c.nome, COR.texto, 13, 1); txt(l, q, urg ? COR.alerta : COR.suave, 12);
    l.addSpacer(); txt(l, brl(c.valor), COR.texto, 13, 1);
    if (d.contas.length > 1) { w.addSpacer(2); const r = w.addStack(); r.addSpacer(19); txt(r, `e mais ${d.contas.length - 1} até ${dataCurta(d.contas[Math.min(d.contas.length, 3) - 1].venc)}`, COR.suave, 11); }
  } else w.addSpacer();
  return w;
}

/* ---------- avisos no iPhone (agendados pelo Scriptable a cada atualização do widget) ---------- */
async function agendarAvisos(d) {
  const agora = Date.now(), limite = agora + 7 * 864e5, quer = {};
  for (const x of d.tarefasDoc && d.tarefasDoc.itens || []) {
    if (x.feito || !x.data || !x.hora) continue;
    const [h, m] = x.hora.split(':').map(Number), q = fromKey(x.data); q.setHours(h, m || 0, 0, 0);
    if (q > agora && q < limite) quer[`mr-t-${x.id}-${x.data}-${x.hora}`] = {quando: q, corpo: x.titulo + (x.nota ? ' — ' + x.nota : '')};
  }
  for (const c of d.contas) {
    const q = fromKey(c.venc); q.setHours(9, 0, 0, 0);
    if (q > agora && q < limite) quer[`mr-c-${c.nome}-${c.venc}`] = {quando: q, corpo: `Conta vence hoje: ${c.nome}${c.valor ? ' · ' + brl(c.valor) : ''}`};
  }
  const nossos = (await Notification.allPending()).filter(n => n.threadIdentifier === 'meu-ritual');
  const sobra = nossos.filter(n => !quer[n.identifier]).map(n => n.identifier);
  if (sobra.length) await Notification.removePending(sobra);
  const ja = new Set(nossos.map(n => n.identifier));
  for (const [id, a] of Object.entries(quer)) {
    if (ja.has(id)) continue;
    const n = new Notification(); n.identifier = id; n.threadIdentifier = 'meu-ritual';
    n.title = 'Meu Ritual'; n.body = a.corpo; n.sound = 'default'; n.setTriggerDate(a.quando);
    await n.schedule();
  }
}

async function aviso(t, m) { const a = new Alert(); a.title = t; a.message = m; a.addAction('OK'); await a.presentAlert(); }
async function dados(tk) {
  const mes = dkey().slice(0, 7);
  const [tar, fin, tre, pel, hist] = await Promise.all(['tarefas', 'financas', 'treinos', 'skincare', 'treinos-hist-' + mes].map(id => ler(id, tk).catch(() => null)));
  return {
    tarefas: tarefas(tar), tarefasDoc: tar,
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
    const dd = tk ? await dados(tk) : null;
    if (dd) try { await agendarAvisos(dd); } catch (e) {}
    const w = dd ? montar(dd) : montar(null, 'Entre de novo com a sua conta.');
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
  else { try { const dd = await dados(tk); w = montar(dd); try { await agendarAvisos(dd); } catch (e) {} } catch (e) { w = montar(null, 'Sem conexão agora.'); } }
  Script.setWidget(w);
}
Script.complete();
