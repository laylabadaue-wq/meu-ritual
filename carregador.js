// Meu Ritual — widget (cole no Scriptable com o nome "Meu Ritual")
// Este script curto busca sempre a versão mais nova do widget no site. Sem internet, usa a última que baixou.
const ENDERECO = 'https://laylabadaue-wq.github.io/meu-ritual/meu-ritual-widget.js';
const fm = FileManager.local(), copia = fm.joinPath(fm.documentsDirectory(), 'meu-ritual-widget-copia.js');
let codigo = null;
try {
  const r = new Request(ENDERECO + '?t=' + Date.now());
  r.timeoutInterval = 8;
  const t = await r.loadString();
  if (t.startsWith('// Meu Ritual')) { codigo = t; fm.writeString(copia, t); }
} catch (e) {}
if (!codigo && fm.fileExists(copia)) codigo = fm.readString(copia);
if (codigo) {
  await (new Function('return (async () => {\n' + codigo + '\n})()'))();
} else {
  const w = new ListWidget(); w.backgroundColor = new Color('#F6F1E9');
  const t = w.addText('Meu Ritual: conecte à internet uma vez para carregar o widget.'); t.textColor = new Color('#A6483A'); t.font = Font.systemFont(12);
  Script.setWidget(w); Script.complete();
}
