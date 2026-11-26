// PlanX24 – KI-Chat zum Grundstück
// Vercel-Funktion (Node). Ruft die Claude-API auf und lässt die KI in der
// Baurecht-Wissensbasis suchen (Supabase-Funktion "suche", Stufe "oeffentlich").
//
// Umgebungsvariablen (in Vercel eintragen, nie ins Repository):
//   ANTHROPIC_API_KEY   Schlüssel von console.anthropic.com
//   KB_URL              https://<projekt>.supabase.co/functions/v1/suche?key=<Schlüssel der Stufe oeffentlich>
//   CLAUDE_MODEL        optional, Standard claude-sonnet-5-5
//   DAILY_LIMIT         optional, Fragen pro Besucher und Tag, Standard 30

export const config = { maxDuration: 60 };

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 30);

const SYSTEM = `Du bist die Fach-KI von PlanX24 für Grundstücke in Hamburg. Du denkst wie ein erfahrener Hamburger Bauprüfer und Architekt.

Regeln:
- Antworte auf Deutsch, klar und für Laien verständlich, höchstens etwa 220 Wörter.
- Beginne mit einer kurzen Einschätzung in fett: „Ja“, „Wahrscheinlich ja“, „Nur mit Befreiung“, „Eher nein“ oder „Unklar“, und einem Satz warum.
- Prüfe getrennt, was für die Frage zählt: Bauplanungsrecht (Art der Nutzung, Maß der Nutzung, überbaubare Grundstücksfläche; BauGB, BauNVO, Bebauungsplan) und Bauordnungsrecht (HBauO: Abstandsflächen, Brandschutz, Stellplätze).
- Nutze für Rechtsfragen zuerst das Werkzeug „suche_wissensbasis“ und für den Wortlaut „lies_fundstelle“. Übernimm Paragraphen und Fundstellen exakt. Es gilt nur die neue HBauO; nenne Paragraphen einfach als „§ X HBauO“.
- Nenne Fundstellen direkt im Satz. Was nicht aus der Wissensbasis oder den Grundstücksdaten stammt, kennzeichne mit „(eigene Einschätzung)“.
- Nutze die Grundstücksdaten unten. Erfinde keine Zahlen und keine Festsetzungen. Wenn etwas fehlt oder nur in der Planzeichnung steht, sag das und sag, was zu prüfen ist.
- Ist das Vorhaben unklar (Größe, Lage auf dem Grundstück, Nutzung), stelle zuerst eine kurze Rückfrage statt zu raten.
- Schließe mit „Nächste Schritte“ in 2 bis 3 Punkten, zum Beispiel welche Unterlagen nötig sind oder ob eine Bauvoranfrage sinnvoll ist.
- Formatiere nur mit kurzen Absätzen, Aufzählungen mit „- “ und **fett**. Keine Überschriften, keine Tabellen.
- Es ist eine Ersteinschätzung, keine Rechtsberatung und keine Genehmigung.`;

const TOOLS = [
  {
    name: 'suche_wissensbasis',
    description: 'Durchsucht die Baurecht-Wissensbasis (BauGB, BauNVO, HBauO, Hamburger Verordnungen, Bauprüfdienste, FAQs) nach Bedeutung und Stichwort. Liefert Fundstellen mit Wortlaut.',
    input_schema: { type: 'object', properties: { frage: { type: 'string', description: 'Frage oder Stichworte auf Deutsch' }, anzahl: { type: 'integer', description: 'Anzahl Treffer, Standard 6' } }, required: ['frage'] }
  },
  {
    name: 'lies_fundstelle',
    description: 'Liest den vollen Wortlaut einer Fundstelle, zum Beispiel „§ 6 Abs. 5 HBauO“ oder „§ 19 BauNVO“.',
    input_schema: { type: 'object', properties: { fundstelle: { type: 'string' } }, required: ['fundstelle'] }
  }
];

// Einfache Begrenzung pro Besucher und Tag (je Server-Instanz; für mehr Schutz später Upstash/Supabase)
const hits = new Map();
function allowed(ip) {
  const day = new Date().toISOString().slice(0, 10), k = ip + '|' + day;
  const n = (hits.get(k) || 0) + 1; hits.set(k, n);
  if (hits.size > 5000) for (const key of hits.keys()) if (!key.endsWith(day)) hits.delete(key);
  return n <= DAILY_LIMIT;
}

let rpcId = 0;
async function kbCall(name, args) {
  if (!process.env.KB_URL) return 'Die Wissensbasis ist nicht verbunden.';
  const r = await fetch(process.env.KB_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) return 'Die Wissensbasis hat nicht geantwortet.';
  if (j.error) return 'Fehler der Wissensbasis: ' + (j.error.message || '');
  const text = (j.result?.content || []).map(c => c.text || '').join('\n');
  return text.split('\n\n---\n\n').filter(b => !/\|\s*INTERN/.test(b)).join('\n\n---\n\n').slice(0, 9000);
}
async function runTool(name, input) {
  if (name === 'suche_wissensbasis') return kbCall('suche', { frage: String(input.frage || ''), anzahl: Math.min(Number(input.anzahl) || 6, 10) });
  if (name === 'lies_fundstelle') return kbCall('lies_fundstelle', { fundstelle: String(input.fundstelle || '') });
  return 'Unbekanntes Werkzeug.';
}

// Ein Aufruf der Claude-API mit Streaming; Text geht sofort an den Browser.
async function streamOnce(body, onText) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ ...body, stream: true })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Claude-API ' + r.status + ': ' + t.slice(0, 300)); }
  const blocks = []; let stop = null, buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = evt.split('\n').find(l => l.startsWith('data: '));
      if (!line) continue;
      let d; try { d = JSON.parse(line.slice(6)); } catch { continue; }
      if (d.type === 'content_block_start') blocks[d.index] = d.content_block.type === 'tool_use' ? { ...d.content_block, json: '' } : { type: 'text', text: '' };
      else if (d.type === 'content_block_delta') {
        const b = blocks[d.index];
        if (d.delta.type === 'text_delta') { b.text += d.delta.text; onText(d.delta.text); }
        else if (d.delta.type === 'input_json_delta') b.json += d.delta.partial_json;
      } else if (d.type === 'message_delta') stop = d.delta.stop_reason;
      else if (d.type === 'error') throw new Error(d.error?.message || 'Fehler');
    }
  }
  const content = blocks.filter(Boolean).map(b => b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.json ? JSON.parse(b.json) : {} } : { type: 'text', text: b.text }).filter(b => b.type !== 'text' || b.text);
  return { content, stop };
}

function clean(messages) {
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : []).slice(-20)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) continue;
    const c = m.content.slice(0, 4000), last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + c; else out.push({ role: m.role, content: c });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: 'ANTHROPIC_API_KEY fehlt in Vercel.' }); return; }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  if (!allowed(ip)) { res.status(429).json({ error: `Tageslimit erreicht (${DAILY_LIMIT} Fragen). Morgen geht es weiter.` }); return; }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const ctx = String(body.ctx || '').slice(0, 24000);
  const messages = clean(body.messages);
  const system = SYSTEM + '\n\nDATEN ZUM GRUNDSTÜCK\n' + ctx;
  if (body.mode === 'tasks') messages.push({ role: 'user', content: 'Leite aus unserem Gespräch 3 bis 6 konkrete nächste Schritte für den Bauherrn ab, jeweils höchstens 12 Wörter, auf Deutsch. Antworte nur mit einem JSON-Array aus Strings.' });
  if (!messages.length || messages[messages.length - 1].role !== 'user') { res.status(400).json({ error: 'Keine Frage.' }); return; }

  // Aufgaben aus dem Gespräch ableiten (ohne Streaming)
  if (body.mode === 'tasks') {
    try {
      let text = '';
      await streamOnce({ model: MODEL, max_tokens: 600, system, messages }, t => { text += t; });
      const m = text.match(/\[[\s\S]*\]/);
      res.status(200).json({ tasks: m ? JSON.parse(m[0]).filter(x => typeof x === 'string').slice(0, 8) : [] });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const send = obj => res.write('data: ' + JSON.stringify(obj) + '\n\n');
  try {
    let usedKb = false, wrote = false;
    for (let round = 0; round < 5; round++) {
      if (wrote) { send({ t: '\n\n' }); wrote = false; }
      const { content, stop } = await streamOnce({ model: MODEL, max_tokens: 1500, system, messages, tools: TOOLS }, t => { wrote = true; send({ t }); });
      if (stop !== 'tool_use') break;
      messages.push({ role: 'assistant', content });
      const results = [];
      for (const b of content.filter(b => b.type === 'tool_use')) {
        send({ tool: b.name, q: b.input.frage || b.input.fundstelle || '' });
        let out; try { out = await runTool(b.name, b.input); usedKb = true; } catch (e) { out = 'Fehler: ' + (e.message || e); }
        results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
      }
      messages.push({ role: 'user', content: results });
    }
    send({ done: true, kb: usedKb });
  } catch (e) {
    send({ error: String(e.message || e) });
  }
  res.end();
}
