/* =========================================================
   Formulare – Versand über /api/anfrage (Netlify-Funktion → Resend → E-Mail)
   ========================================================= */
var LKB = (function () {
  var ZIEL = '/api/anfrage';

  /* Prüfwert gegen Spam: beim Laden holen. Fehlt er beim Absenden, wird er
     nachgeholt und 5,5 s gewartet, weil der Server frühere Absendungen
     als Automat verwirft. */
  var pruef = null;
  function pruefwertHolen() {
    return fetch(ZIEL, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (d) { pruef = { t: d.t, geholt: Date.now() }; return pruef; });
  }
  function pruefwert() {
    var frisch = pruef && Date.now() - pruef.geholt < 23 * 3600 * 1000;
    var bereit = frisch ? Promise.resolve(pruef) : pruefwertHolen();
    return bereit.then(function (p) {
      var warten = 5500 - (Date.now() - p.geholt);
      return new Promise(function (ok) { setTimeout(function () { ok(p.t); }, Math.max(0, warten)); });
    });
  }
  if (document.querySelector('form[name]')) pruefwertHolen().catch(function () {});

  /* Foto verkleinern und als JPEG liefern. Kann der Browser das Bild nicht
     lesen (z. B. HEIC am PC), geht das Original mit, solange es klein ist. */
  function verkleinern(datei, max, qualitaet) {
    return new Promise(function (fertig) {
      var url = URL.createObjectURL(datei);
      var img = new Image();
      img.onload = function () {
        var f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * f);
        c.height = Math.round(img.naturalHeight * f);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { fertig(b); }, 'image/jpeg', qualitaet);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        fertig(datei.size <= 900000 ? datei : null);
      };
      img.src = url;
    });
  }

  /* Netlify-Funktionen nehmen höchstens 6 MB je Anfrage an. Ziel 3,5 MB für
     alle Fotos zusammen, sonst ein zweiter, kleinerer Durchgang. */
  function fotosVorbereiten(dateien) {
    function summe(liste) { return liste.reduce(function (s, b) { return s + (b ? b.size : 0); }, 0); }
    return Promise.all(dateien.map(function (d) { return verkleinern(d, 1600, 0.82); })).then(function (bilder) {
      if (summe(bilder) <= 3500000) return bilder;
      return Promise.all(dateien.map(function (d) { return verkleinern(d, 1100, 0.7); }));
    });
  }

  function meldung(form, text) {
    var el = form.querySelector('.form-fehler');
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-fehler';
      el.setAttribute('role', 'alert');
      form.appendChild(el);
    }
    el.innerHTML = text;
  }

  /* daten: Funktion, die ein Promise auf FormData liefert */
  function senden(form, btn, daten, danach) {
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Wird gesendet …'; }
    meldung(form, '');
    Promise.all([daten(), pruefwert()]).then(function (e) {
      var fd = e[0];
      fd.set('pruefwert', e[1]);
      return fetch(ZIEL, { method: 'POST', body: fd });
    }).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      danach();
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.textContent = label; }
      meldung(form, 'Das Senden hat leider nicht geklappt. Bitte erneut versuchen oder direkt anrufen: ' +
        '<a href="tel:+498631987077">08631 987077</a>.');
    });
  }

  /* Einfache Formulare (Kontakt, Bewerbung) */
  document.querySelectorAll('form[name]:not(.wz-form)').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      senden(form, btn, function () { return Promise.resolve(new FormData(form)); }, function () {
        var box = document.createElement('div');
        box.className = 'form-danke';
        box.setAttribute('role', 'status');
        box.innerHTML = '<div class="wz-check">✓</div><h3>Vielen Dank!</h3>' +
          '<p>' + (form.dataset.danke || 'Ihre Nachricht ist bei uns eingegangen. Wir melden uns schnellstmöglich.') + '</p>';
        form.replaceWith(box);
      });
    });
  });

  return { fotosVorbereiten: fotosVorbereiten, senden: senden };
})();
