/* =========================================================
   Formulare – Versand über Netlify Forms (Benachrichtigung per E-Mail)
   ========================================================= */
var LKB = (function () {

  /* Foto auf max. 1600 px verkleinern und als JPEG liefern.
     Kann der Browser das Bild nicht lesen (z. B. HEIC am PC), geht
     das Original mit, solange es klein genug ist. */
  function verkleinern(datei) {
    return new Promise(function (fertig) {
      var url = URL.createObjectURL(datei);
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * f);
        c.height = Math.round(img.naturalHeight * f);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { fertig(b); }, 'image/jpeg', 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        fertig(datei.size <= 1200000 ? datei : null);
      };
      img.src = url;
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
    daten().then(function (fd) {
      for (var i = 1; i <= 6; i++) {
        var f = fd.get('foto' + i);
        if (f && typeof f === 'object' && !f.size) fd.delete('foto' + i);
      }
      return fetch('/', { method: 'POST', body: fd });
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
  document.querySelectorAll('form[data-netlify]:not(.wz-form)').forEach(function (form) {
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

  return { verkleinern: verkleinern, senden: senden };
})();
