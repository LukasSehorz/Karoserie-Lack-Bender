/* =====================================================================
   GEGENSTELLE DER FORMULARE — seit 22.10.2026 (vorher Netlify Forms)
   =====================================================================
   Nimmt Schadenmeldung (mit Fotos), Kontakt und Bewerbung entgegen und
   schickt sie über Resend an Info@jb-color.de. Bei Netlify wird nichts
   gespeichert, die Funktion reicht nur durch. Resend bewahrt die Mail
   30 Tage auf und löscht sie dann selbst.

   DER SCHLÜSSEL STEHT NICHT IN DIESER DATEI. Er kommt aus der
   Netlify-Umgebungsvariable RESEND_API_KEY (nur Senderecht, nur jb-color.de).

   Vorlage: Estera (netlify/functions/anfrage.js), dort seit 09.10.2026
   mit demselben Spamschutz im Betrieb.
   ===================================================================== */
import crypto from 'node:crypto';

export const config = { path: '/api/anfrage' };

const EMPFAENGER = process.env.EMPFAENGER || 'Info@jb-color.de';
const ABSENDER = process.env.ABSENDER || 'formular@jb-color.de';

/* Feldname → Beschriftung in der Mail, Reihenfolge = Reihenfolge in der Mail. */
const FORMULARE = {
  schadenmeldung: {
    titel: 'Neue Schadenmeldung über die Webseite',
    pflicht: ['telefon'],
    felder: [
      ['vorname', 'Vorname'], ['nachname', 'Nachname'], ['telefon', 'Telefon'], ['email', 'E-Mail'],
      ['bereich', 'Bereich am Fahrzeug'], ['unfallart', 'Art des Schadens'], ['schaden', 'Betroffene Teile'],
      ['fahrbereit', 'Fahrbereit'], ['details', 'Weitere Details'],
    ],
    betreff: (w) => 'Schadenmeldung: ' + [w.bereich, w.unfallart].filter(Boolean).join(', ') +
      ' – ' + ([w.vorname, w.nachname].filter(Boolean).join(' ') || w.telefon),
  },
  kontakt: {
    titel: 'Neue Nachricht über das Kontaktformular',
    pflicht: ['email', 'nachricht'],
    felder: [['vorname', 'Vorname'], ['nachname', 'Nachname'], ['email', 'E-Mail'], ['nachricht', 'Nachricht']],
    betreff: (w) => 'Kontaktanfrage: ' + ([w.vorname, w.nachname].filter(Boolean).join(' ') || w.email),
  },
  bewerbung: {
    titel: 'Neue Bewerbung über die Karriereseite',
    pflicht: ['name', 'telefon'],
    felder: [
      ['name', 'Name'], ['telefon', 'Telefon'], ['email', 'E-Mail'], ['erreichbarkeit', 'Beste Erreichbarkeit'],
      ['ausbildung', 'Abgeschlossene Ausbildung'], ['beruf', 'Berufsbezeichnung'], ['erfahrung', 'Berufserfahrung'],
      ['deutsch', 'Deutschkenntnisse (1–10)'], ['eintritt', 'Möglicher Eintrittstermin'], ['info', 'Zusätzliche Informationen'],
    ],
    betreff: (w) => 'Bewerbung: ' + w.name + (w.beruf ? ' (' + w.beruf + ')' : ''),
  },
};

const MAX_FOTOS = 6;
const MAX_FOTO_BYTES = 8 * 1024 * 1024;

/* =====================================================================
   SPAMSCHUTZ, unsichtbar für echte Besucher (wie Estera):
   1  Feldfalle „bot-field“: kein Mensch sieht sie, also bleibt sie leer.
   2  Prüfwert: Die Seite holt beim Laden per GET die Serverzeit mit
      Unterschrift. Wer direkt an /api/anfrage schickt, hat keinen.
   3  Zeitfalle: Wer schneller als 5 s nach dem Laden absendet, ist kein Mensch.
   4  Inhaltsfilter für eindeutige Spam-Muster.
   Verworfen wird still mit 200, damit der Automat nichts lernt. Der Grund
   steht im Funktionsprotokoll, ohne Inhalt.
   ===================================================================== */
const MINDESTALTER_MS = 5000;
const HOECHSTALTER_MS = 24 * 60 * 60 * 1000;

function pruefSchluessel() {
  const quelle = process.env.FORMULAR_GEHEIMNIS || process.env.RESEND_API_KEY || '';
  return crypto.createHash('sha256').update('benda-formular:' + quelle).digest();
}
function unterschrift(zeit) {
  return crypto.createHmac('sha256', pruefSchluessel()).update(zeit).digest('base64url').slice(0, 22);
}
function pruefwertAusstellen() {
  const zeit = Date.now().toString(36);
  return zeit + '.' + unterschrift(zeit);
}
function pruefwertAlter(wert) {
  const m = /^([0-9a-z]{6,12})\.([A-Za-z0-9_-]{22})$/.exec(String(wert || '').trim());
  if (!m) return null;
  const soll = Buffer.from(unterschrift(m[1]));
  const ist = Buffer.from(m[2]);
  if (soll.length !== ist.length || !crypto.timingSafeEqual(soll, ist)) return null;
  return Date.now() - parseInt(m[1], 36);
}

const EINDEUTIG = [
  /freeb2bdata|b2b ?data/i,
  /wanted to know your price/i,
  /\b(seo|backlinks?|casino|crypto|bitcoin|viagra|forex)\b/i,
  /[Ѐ-ӿ一-鿿]/, /* kyrillisch, chinesisch */
];

function json(status, daten) {
  return new Response(JSON.stringify(daten), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
function verwerfen(grund, formular) {
  console.log('Formular verworfen:', grund, '| formular=' + formular);
  return json(200, { ok: true });
}
function html(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function istEmail(s) {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(String(s || '').trim());
}

function mailHtml(def, werte, anzahlFotos) {
  const zeilen = def.felder.filter(([k]) => werte[k]).map(([k, titel]) => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #e8eaec;font:400 13px/1.5 Arial,sans-serif;color:#565b60;white-space:nowrap;vertical-align:top;">${html(titel)}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #e8eaec;font:400 15px/1.5 Arial,sans-serif;color:#111315;white-space:pre-wrap;">${html(werte[k])}</td>
      </tr>`).join('');
  const fotos = anzahlFotos
    ? `<tr><td colspan="2" style="padding:12px 16px;font:600 14px/1.5 Arial,sans-serif;color:#111315;">${anzahlFotos} ${anzahlFotos === 1 ? 'Foto' : 'Fotos'} im Anhang</td></tr>`
    : '';
  return `<!doctype html>
<html lang="de"><body style="margin:0;padding:24px;background:#f4f5f6;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e8eaec;border-radius:6px;">
    <tr><td style="padding:22px 16px;background:#2b2f33;border-radius:6px 6px 0 0;">
      <div style="font:700 17px/1.3 Arial,sans-serif;color:#fff;letter-spacing:.04em;">LACK &amp; KAROSSERIE BENDA</div>
      <div style="font:400 13px/1.5 Arial,sans-serif;color:#e8620c;margin-top:6px;">${html(def.titel)}</div>
    </td></tr>
    <tr><td style="padding:8px 0;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">${zeilen}${fotos}</table></td></tr>
    <tr><td style="padding:16px;font:400 12px/1.6 Arial,sans-serif;color:#8a8f94;border-top:1px solid #e8eaec;">
      Gesendet über das Formular auf jb-color.de.${werte.email ? ' Ein Klick auf „Antworten“ geht direkt an die absendende Person.' : ''}
    </td></tr>
  </table>
</body></html>`;
}

export default async (req) => {
  if (req.method === 'GET') return json(200, { t: pruefwertAusstellen() });
  if (req.method !== 'POST') return json(405, { fehler: 'Nur GET und POST.' });

  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    /* Nicht so tun, als sei es gutgegangen: sonst sieht der Besucher
       „Danke“ und die Anfrage ist trotzdem verloren. */
    console.error('RESEND_API_KEY fehlt in den Umgebungsvariablen.');
    return json(503, { fehler: 'Der Versand ist nicht eingerichtet.' });
  }

  let daten;
  try {
    daten = await req.formData();
  } catch (fehler) {
    console.error('Formular ließ sich nicht lesen:', fehler.message);
    return json(400, { fehler: 'Die Angaben waren nicht lesbar.' });
  }

  const formular = String(daten.get('form-name') || '');
  const def = FORMULARE[formular];
  if (!def) return json(400, { fehler: 'Unbekanntes Formular.' });

  const werte = {};
  for (const [k] of def.felder) {
    const v = daten.get(k);
    if (typeof v === 'string' && v.trim()) werte[k] = v.trim().slice(0, 5000);
  }

  if (String(daten.get('bot-field') || '').trim()) return verwerfen('Feldfalle gefüllt', formular);
  const alter = pruefwertAlter(daten.get('pruefwert'));
  if (alter === null) return verwerfen('ohne gültigen Prüfwert', formular);
  if (alter < MINDESTALTER_MS) return verwerfen('zu schnell (' + Math.round(alter / 100) / 10 + ' s)', formular);
  if (alter > HOECHSTALTER_MS) return verwerfen('Prüfwert abgelaufen', formular);
  const alles = Object.values(werte).join(' \n ');
  const muster = EINDEUTIG.find((m) => m.test(alles));
  if (muster) return verwerfen('Muster ' + muster.source.slice(0, 24), formular);

  /* Dieselben Pflichtfelder wie im Browser, denn dort lässt es sich umgehen. */
  if (!String(daten.get('datenschutz') || '').trim()) return json(400, { fehler: 'Datenschutz nicht bestätigt.' });
  const fehlt = def.pflicht.find((k) => !werte[k]);
  if (fehlt) return json(400, { fehler: 'Pflichtfeld fehlt: ' + fehlt });
  if (werte.email && !istEmail(werte.email)) return json(400, { fehler: 'E-Mail-Adresse ungültig.' });

  /* Fotos nur bei der Schadenmeldung, nur Bilder, höchstens sechs. */
  const anhaenge = [];
  if (formular === 'schadenmeldung') {
    let summe = 0;
    for (let i = 1; i <= MAX_FOTOS; i++) {
      const f = daten.get('foto' + i);
      if (!f || typeof f === 'string' || !f.size) continue;
      if (!/^image\//.test(f.type || '')) continue;
      summe += f.size;
      if (summe > MAX_FOTO_BYTES) break;
      const endung = (f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
      anhaenge.push({
        filename: 'foto-' + i + '.' + endung,
        content: Buffer.from(await f.arrayBuffer()).toString('base64'),
      });
    }
  }

  const text = def.felder.filter(([k]) => werte[k]).map(([k, t]) => t + ': ' + werte[k]).join('\n') +
    (anhaenge.length ? '\n\n' + anhaenge.length + ' Foto(s) im Anhang' : '');
  const nachricht = {
    from: `Webseite Lack & Karosserie Benda <${ABSENDER}>`,
    to: [EMPFAENGER],
    subject: def.betreff(werte).slice(0, 180),
    text,
    html: mailHtml(def, werte, anhaenge.length),
  };
  if (werte.email) nachricht.reply_to = werte.email;
  if (anhaenge.length) nachricht.attachments = anhaenge;

  try {
    const antwort = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + schluessel, 'content-type': 'application/json' },
      body: JSON.stringify(nachricht),
    });
    if (!antwort.ok) {
      console.error('Resend hat abgelehnt:', antwort.status, (await antwort.text()).slice(0, 300));
      return json(502, { fehler: 'Der Versand ist fehlgeschlagen.' });
    }
    const { id } = await antwort.json();
    console.log('Formular zugestellt an Resend:', formular, id, anhaenge.length + ' Fotos');
    return json(200, { ok: true });
  } catch (fehler) {
    console.error('Versand gescheitert:', fehler.message);
    return json(502, { fehler: 'Der Versand ist fehlgeschlagen.' });
  }
};
