/*───────────────────────────────────────────────────────────────
  VocabMaster — Text Profile (CEFR)   vm-textprofile.js
  Ported from LisDictation (student.html, PR #14–#16). Imitates the EC Text Profiler:
  tiles, a CEFR bar chart (running words vs different words) and an Analysis Summary.
  Everything is computed in the browser from cefr-dict.js (cefrOf) — no AI call.

  Language rule: every heading / label / legend is English; the summary text is Vietnamese.
  API:  VMTP.mount(el, text, vocab)   render into el (vocab = assignment words, optional)
        VMTP.profile(sentences)       raw numbers (used by tests)
───────────────────────────────────────────────────────────────*/
(function (global) {
'use strict';

var LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
function safeCefrOf(word) {
  if (typeof cefrOf === 'function') { try { return cefrOf(word); } catch (e) { return null; } }
  return null;
}
// Sentences per paragraph. Section labels such as "A" / "B" (reading passages) are dropped.
function splitForProfile(text) {
  if (Array.isArray(text)) return text.map(function (x) { return String(x).trim(); }).filter(Boolean);
  var out = [];
  String(text || '').split(/\n+/).forEach(function (line) {
    line = line.trim();
    if (!line || /^[A-Za-z]{1,2}\.?$/.test(line)) return;
    (line.match(/[^.!?]+[.!?]*/g) || []).forEach(function (s) { s = s.trim(); if (s) out.push(s); });
  });
  return out;
}

var PROFILE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'Off'];
var LEVEL_NAME = { A1: 'Beginner', A2: 'Elementary', B1: 'Intermediate', B2: 'Upper-intermediate', C1: 'Advanced', C2: 'Proficiency' };
var CONTRACTIONS = { "don't": 'do', "doesn't": 'does', "didn't": 'did', "can't": 'can', "cannot": 'can', "won't": 'will', "isn't": 'is', "aren't": 'are',
  "wasn't": 'was', "weren't": 'were', "haven't": 'have', "hasn't": 'has', "hadn't": 'had', "couldn't": 'could', "wouldn't": 'would',
  "shouldn't": 'should', "mustn't": 'must', "needn't": 'need', "let's": 'let', "shan't": 'shall' };
// word in the text → dictionary key: drop possessive 's, split contractions (don't → do, they're → they)
function profileKey(w) {
  var l = String(w).toLowerCase().replace(/[‘’]/g, "'");
  if (CONTRACTIONS[l]) return CONTRACTIONS[l];
  if (/'/.test(l)) l = l.replace(/'(s|re|ve|ll|d|m)$/, '').replace(/s'$/, 's').replace(/'$/, '');
  return l;
}
// Proper names: capitalised mid-sentence (except "I"), never lower-case, AND (not in the dictionary, or capitalised
// ≥ 2 times, or next to another capitalised word: "Mount Everest"). Not counted, even at the start of a sentence
// (otherwise a sentence-initial "Everest" is looked up as "ever" A1). "However" after ";" still counts as a word.
function findNames(sentences) {
  var capMid = {}, lower = {};
  sentences.forEach(function (sent) {
    var ws = sent.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    ws.forEach(function (w, i) {
      var k = profileKey(w);
      if (/^[A-Z]/.test(w)) {
        if (i > 0 && k !== 'i') {
          var c = capMid[k] || (capMid[k] = { n: 0, pair: false });
          c.n++;
          if ((/^[A-Z]/.test(ws[i - 1] || '') && profileKey(ws[i - 1]) !== 'i') || /^[A-Z]/.test(ws[i + 1] || '')) c.pair = true;
        }
      } else lower[k] = 1;
    });
  });
  var names = {};
  Object.keys(capMid).forEach(function (k) {
    var c = capMid[k];
    if (!lower[k] && (!safeCefrOf(k) || c.n >= 2 || c.pair)) names[k] = 1;
  });
  return names;
}
// CEFR level of one word: the EASIER of the form as written and its base forms (-s/-es/-ies/-ed/-ing)
// ("going" has its own B2 entry — a noun — but here it is "go" A1)
var LV_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
function cefrInfo(k) {
  var best = safeCefrOf(k), tries = [];
  if (k.length > 3) {
    if (/ies$|ied$/.test(k)) tries.push(k.slice(0, -3) + 'y');
    if (/(s|x|z|ch|sh)es$/.test(k)) tries.push(k.slice(0, -2));
    if (/s$/.test(k) && !/ss$/.test(k)) tries.push(k.slice(0, -1));
    if (/ed$/.test(k)) tries.push(k.slice(0, -2), k.slice(0, -1));
    if (/ing$/.test(k)) tries.push(k.slice(0, -3), k.slice(0, -3) + 'e');
    var m = k.match(/^(.*?)([bcdfgklmnprtvz])\2(ed|ing)$/); if (m) tries.push(m[1] + m[2]);
  }
  tries.forEach(function (t) {
    var i = safeCefrOf(t);
    if (i && i.level && (!best || !best.level || LV_ORDER[i.level] < LV_ORDER[best.level])) best = i;
  });
  return best;
}
function syllables(w) {
  w = String(w).toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  var m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
function textProfile(sentences) {
  var names = findNames(sentences);
  var P = { sentences: sentences.length, words: 0, counted: 0, notCounted: 0, syll: 0, names: {}, longest: { n: 0, i: -1 },
            tokens: {}, types: {}, typeList: {}, freq: {} };
  PROFILE_LEVELS.forEach(function (lv) { P.tokens[lv] = 0; P.types[lv] = 0; P.typeList[lv] = []; });
  var seen = {};
  sentences.forEach(function (sent, si) {
    var ws = sent.match(/[A-Za-z][A-Za-z'’-]*|\d[\d,.]*/g) || [];
    if (ws.length > P.longest.n) P.longest = { n: ws.length, i: si };
    ws.forEach(function (w) {
      P.words++; P.syll += /^\d/.test(w) ? 2 : syllables(w);
      var k = profileKey(w);
      if (/^\d/.test(w) || names[k]) { P.notCounted++; if (names[k]) P.names[w] = 1; return; }
      var info = cefrInfo(k), lv = info && info.level && P.tokens[info.level] != null ? info.level : 'Off';
      P.counted++; P.tokens[lv]++;
      P.freq[k] = (P.freq[k] || 0) + 1;
      if (!seen[k]) { seen[k] = lv; P.types[lv]++; P.typeList[lv].push(k); }
    });
  });
  P.typeCount = Object.keys(seen).length;
  // vocabulary level: lowest level whose words (A1 → that level) cover ≥ 95 % / 98 % of the running words (Off = not covered)
  var cum = 0;
  P.level95 = P.level98 = 'C2+';
  P.coverage = {};
  LEVELS.forEach(function (lv) {
    cum += P.tokens[lv];
    var c = P.counted ? cum / P.counted : 0;
    P.coverage[lv] = c;
    if (P.level95 === 'C2+' && c >= 0.95) P.level95 = lv;
    if (P.level98 === 'C2+' && c >= 0.98) P.level98 = lv;
  });
  var wps = P.words / Math.max(1, P.sentences), spw = P.syll / Math.max(1, P.words);
  P.wps = wps;
  P.fre = 206.835 - 1.015 * wps - 84.6 * spw;
  P.fkgl = Math.max(0, 0.39 * wps + 11.8 * spw - 15.59);
  // words to learn first: B2 and above + off-list, hardest first, then most frequent
  var rank = { C2: 6, C1: 5, B2: 4, Off: 3 };
  P.hard = Object.keys(seen).filter(function (k) { return rank[seen[k]]; })
    .sort(function (a, b) { return (rank[seen[b]] - rank[seen[a]]) || (P.freq[b] - P.freq[a]) || a.localeCompare(b); })
    .map(function (k) { return { w: k, lv: seen[k], n: P.freq[k] }; });
  return P;
}
function freLabelVi(x) {
  return x >= 90 ? 'rất dễ' : x >= 80 ? 'dễ' : x >= 70 ? 'khá dễ' : x >= 60 ? 'trung bình' : x >= 50 ? 'khá khó' : x >= 30 ? 'khó' : 'rất khó';
}
function freLabel(x) {
  return x >= 90 ? 'Very easy' : x >= 80 ? 'Easy' : x >= 70 ? 'Fairly easy' : x >= 60 ? 'Standard' : x >= 50 ? 'Fairly difficult' : x >= 30 ? 'Difficult' : 'Very difficult';
}
var fmt1 = function (x) { return (Math.round(x * 10) / 10).toLocaleString('vi-VN'); };
var pct = function (n, d) { return d ? Math.round(n / d * 100) : 0; };
var lvName = function (lv) { return lv === 'Off' ? 'Off-list' : lv; };
var esc = function (s) { return global.VM && VM.esc ? VM.esc(s) : String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var OPEN_KEY = 'vm_profile_open';

function render(root, text, vocab) {
  var P = textProfile(splitForProfile(text));
  if (!P.words) { root.innerHTML = ''; return; }
  var hasDict = typeof cefrOf === 'function';
  var lv95 = P.level95, lv98 = P.level98, readMin = P.words / 200;

  var tile = function (label, value, sub, title) {
    return '<div class="tp-tile"' + (title ? ' title="' + esc(title) + '"' : '') + '><div class="tp-label">' + label + '</div>' +
      '<div class="tp-value">' + value + '</div><div class="tp-sub">' + sub + '</div></div>';
  };
  var kpis = '<div class="tp-kpis">' +
    tile('Words', P.words.toLocaleString('en'), P.sentences + ' sentences') +
    tile('Vocabulary level (95%)', lv95, lv95 === 'C2+' ? 'Beyond C2 list' : LEVEL_NAME[lv95], 'Knowing words up to this level covers 95% of the running words') +
    tile('Readability', 'Grade ' + fmt1(P.fkgl), 'Flesch ' + Math.round(P.fre) + ' · ' + freLabel(P.fre), 'Flesch–Kincaid grade level and Flesch Reading Ease (US school grades)') +
    tile('Reading time', '≈ ' + fmt1(readMin) + ' min', 'at 200 words/min', 'Estimate for an average reader') +
    '</div>';

  // ── chart: 2 series (running words / different words) × CEFR levels ──
  var maxPct = 0;
  PROFILE_LEVELS.forEach(function (lv) { maxPct = Math.max(maxPct, pct(P.tokens[lv], P.counted), pct(P.types[lv], P.typeCount)); });
  var top = Math.max(20, Math.ceil(maxPct / 20) * 20), ticks = [0, top / 2, top];
  var chart = '<div class="tp-chart-wrap">' +
    '<h3 class="tp-h">Vocabulary Profile (CEFR)</h3>' +
    '<div class="tp-legend"><span><i class="tp-key tok"></i>Running words (tokens)</span><span><i class="tp-key typ"></i>Different words (types)</span></div>' +
    '<div class="tp-chart" role="img" aria-label="Share of running words and different words at each CEFR level; values in the data table below">' +
      '<div class="tp-yaxis">' + ticks.slice().reverse().map(function (t) { return '<span>' + t + '%</span>'; }).join('') + '</div>' +
      '<div class="tp-plot">' + ticks.map(function (t) { return '<i class="tp-grid-line" style="bottom:' + (t / top * 100) + '%"></i>'; }).join('') +
        PROFILE_LEVELS.map(function (lv) {
          var a = pct(P.tokens[lv], P.counted), b = pct(P.types[lv], P.typeCount);
          return '<div class="tp-group" tabindex="0" data-lv="' + lv + '">' +
            '<div class="tp-bars"><div class="tp-bar tok" style="height:' + (a / top * 100) + '%"><span class="tp-cap">' + a + '%</span></div>' +
            '<div class="tp-bar typ" style="height:' + (b / top * 100) + '%"></div></div>' +
            '<div class="tp-x">' + lvName(lv) + '</div></div>';
        }).join('') +
      '</div><div class="tp-tip" role="status" aria-live="polite"></div></div>' +
    '<details class="tp-table"><summary>Data table</summary><div class="tp-tscroll"><table class="tp-tbl"><thead><tr><th></th>' +
      PROFILE_LEVELS.map(function (lv) { return '<th scope="col">' + lvName(lv) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      '<tr><th scope="row">Running words</th>' + PROFILE_LEVELS.map(function (lv) { return '<td><b>' + pct(P.tokens[lv], P.counted) + '%</b><small>' + P.tokens[lv] + '</small></td>'; }).join('') + '</tr>' +
      '<tr><th scope="row">Different words</th>' + PROFILE_LEVELS.map(function (lv) { return '<td><b>' + pct(P.types[lv], P.typeCount) + '%</b><small>' + P.types[lv] + '</small></td>'; }).join('') + '</tr>' +
      '<tr><th scope="row">Examples</th>' + PROFILE_LEVELS.map(function (lv) { return '<td class="tp-ex">' + P.typeList[lv].slice(0, 4).map(esc).join('<br>') + '</td>'; }).join('') + '</tr>' +
    '</tbody></table></div>' +
    '<p class="tp-note">Not counted: ' + P.notCounted + ' names &amp; numbers' + (Object.keys(P.names).length ? ' (' + esc(Object.keys(P.names).slice(0, 6).join(', ')) + ')' : '') + '</p></details></div>';

  // ── Analysis Summary (English headings, Vietnamese body) ──
  var hard = P.hard.slice(0, 8);
  var nHard = P.hard.filter(function (x) { return x.lv !== 'Off'; }).length, nOff = P.types.Off;
  var items = [];
  if (!hasDict) items.push(['Dictionary missing', 'Không tải được từ điển CEFR (cefr-dict.js) nên chưa xếp cấp được từ nào.']);
  var topW = Object.keys(P.freq).sort(function (a, b) { return P.freq[b] - P.freq[a]; })[0];
  if (topW) items.push(['Running words vs Different words', '<b>Running words</b> (lượt từ) đếm mọi lần một từ xuất hiện; <b>Different words</b> (từ khác nhau) chỉ đếm mỗi từ 1 lần. ' +
    'Ví dụ: “' + esc(topW) + '” xuất hiện ' + P.freq[topW] + ' lần = ' + P.freq[topW] + ' running words nhưng chỉ 1 different word. ' +
    'Vì vậy từ A1 chiếm ' + pct(P.tokens.A1, P.counted) + '% running words nhưng chỉ ' + pct(P.types.A1, P.typeCount) + '% different words: từ cơ bản lặp lại rất nhiều, còn từ khó thường chỉ gặp 1–2 lần.']);
  items.push(['Vocabulary level', lv95 === 'C2+'
    ? 'Bài có nhiều từ ngoài danh sách CEFR: biết hết từ đến C2 vẫn chưa hiểu được 95% số từ. Nên xem trước danh sách từ khó bên dưới.'
    : 'Hồ sơ từ vựng tương ứng <b>' + lv95 + '</b>: biết từ đến ' + lv95 + ' là hiểu khoảng 95% số từ trong bài — đọc được ý chính, cần tra thêm vài từ. ' +
      (lv98 === lv95 ? 'Cũng ở mức này là hiểu được khoảng 98% — đọc khá thoải mái.'
        : lv98 !== 'C2+' ? 'Biết đến <b>' + lv98 + '</b> thì hiểu khoảng 98% — đọc khá thoải mái.' : 'Muốn hiểu 98% thì cần vốn từ trên C2 (có từ ngoài danh sách).')]);
  if (hard.length) items.push(['Words to learn first', 'Có ' + nHard + ' từ từ B2 trở lên' + (nOff ? ' và ' + nOff + ' từ ngoài danh sách' : '') + '. Học trước: ' +
    hard.map(function (x) { return '<button type="button" class="tp-word" data-w="' + esc(x.w) + '">' + esc(x.w) + ' <small>' + lvName(x.lv) + '</small></button>'; }).join(' ')]);
  items.push(['Length', P.words + ' từ trong ' + P.sentences + ' câu, trung bình ' + fmt1(P.wps) + ' từ/câu. Câu dài nhất có ' + P.longest.n + ' từ (câu ' + (P.longest.i + 1) + ')' +
    (P.longest.n > 30 ? ' — câu dài, nên đọc chậm và tách theo cụm.' : '.')]);
  items.push(['Reading time', 'Ước tính khoảng ' + fmt1(readMin) + ' phút đọc ở tốc độ 200 từ/phút.']);
  items.push(['Readability', 'Flesch–Kincaid: lớp ' + fmt1(P.fkgl) + ' (hệ trường học Mỹ); Flesch Reading Ease ' + Math.round(P.fre) + ' (' + freLabelVi(P.fre) + '). ' +
    'Các chỉ số này chỉ dựa trên độ dài câu và độ dài từ, nên xem cùng hồ sơ từ vựng.']);
  items.push(['Lexical diversity', P.typeCount + ' từ khác nhau trên ' + P.counted + ' lượt từ được tính (tỉ lệ ' + fmt1(P.typeCount / Math.max(1, P.counted)) + ').' +
    (P.notCounted ? ' Không tính ' + P.notCounted + ' tên riêng và con số.' : '')]);
  var summary = '<div class="tp-summary"><h3 class="tp-h">Analysis Summary</h3><ul>' +
    items.map(function (it) { return '<li><b class="tp-li-h">' + it[0] + '</b><span>' + it[1] + '</span></li>'; }).join('') + '</ul></div>';

  var open = true;
  try { var s = localStorage.getItem(OPEN_KEY); open = s == null ? !(global.matchMedia && matchMedia('(max-width:760px)').matches) : s !== '0'; } catch (e) {}

  root.innerHTML = '<section class="tp" aria-labelledby="tp-title">' +
    '<div class="tp-head"><h3 id="tp-title">📊 Text Profile</h3>' +
      '<button type="button" class="vm-btn vm-btn-ghost vm-btn-sm tp-toggle" aria-expanded="' + open + '">' + (open ? 'Hide' : 'Show') + '</button></div>' +
    '<div class="tp-body' + (open ? '' : ' hidden') + '">' + kpis + '<div class="tp-grid">' + chart + summary + '</div></div></section>';

  var body = root.querySelector('.tp-body'), tg = root.querySelector('.tp-toggle');
  tg.onclick = function () {
    var show = body.classList.contains('hidden');
    body.classList.toggle('hidden', !show);
    tg.textContent = show ? 'Hide' : 'Show'; tg.setAttribute('aria-expanded', show);
    try { localStorage.setItem(OPEN_KEY, show ? '1' : '0'); } catch (e) {}
  };
  wireTips(root, P);
  wireWords(root, P, vocab || []);
}

// hover / focus a level group → values of both series
function wireTips(root, P) {
  var tip = root.querySelector('.tp-tip'), chart = root.querySelector('.tp-chart');
  var show = function (g) {
    var lv = g.dataset.lv;
    tip.innerHTML = '';
    var h = document.createElement('div'); h.className = 'tp-tip-h'; h.textContent = lvName(lv) + (LEVEL_NAME[lv] ? ' · ' + LEVEL_NAME[lv] : '');
    tip.appendChild(h);
    [['tok', pct(P.tokens[lv], P.counted) + '%', P.tokens[lv] + ' running words'], ['typ', pct(P.types[lv], P.typeCount) + '%', P.types[lv] + ' different words']].forEach(function (r) {
      var row = document.createElement('div'); row.className = 'tp-tip-row';
      var k = document.createElement('i'); k.className = 'tp-line ' + r[0];
      var v = document.createElement('b'); v.textContent = r[1];
      var t = document.createElement('span'); t.textContent = r[2];
      row.appendChild(k); row.appendChild(v); row.appendChild(t); tip.appendChild(row);
    });
    var gr = g.getBoundingClientRect(), cr = chart.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(0, gr.left - cr.left + gr.width / 2 - 90), Math.max(0, cr.width - 180)) + 'px';
    tip.classList.add('on'); g.classList.add('hot');
  };
  var hide = function (g) { tip.classList.remove('on'); if (g) g.classList.remove('hot'); };
  root.querySelectorAll('.tp-group').forEach(function (g) {
    g.addEventListener('pointerenter', function () { show(g); });
    g.addEventListener('pointerleave', function () { hide(g); });
    g.addEventListener('focus', function () { show(g); });
    g.addEventListener('blur', function () { hide(g); });
  });
}

// click a word in "Words to learn first" → word card (from this assignment's list when the word is in it)
function wireWords(root, P, vocab) {
  var section = root.querySelector('.tp');
  var find = function (w) {
    return vocab.filter(function (v) { var k = profileKey(v.word || ''); return k === w || String(v.word || '').toLowerCase() === w; })[0];
  };
  root.querySelectorAll('.tp-word').forEach(function (b) {
    b.onclick = function () {
      var old = section.querySelector('.tp-pop'); if (old) old.remove();
      var w = b.dataset.w, info = P.hard.filter(function (x) { return x.w === w; })[0] || {}, v = find(w);
      var pop = document.createElement('div'); pop.className = 'tp-pop'; pop.setAttribute('role', 'dialog');
      pop.innerHTML = '<button type="button" class="tp-pop-x" aria-label="Close">✕</button>' +
        '<div class="tp-pop-w">' + esc(w) + ' <span>' + lvName(info.lv || 'Off') + '</span></div>' +
        '<div class="tp-pop-m">' + (info.n || 1) + '× in this text</div>' +
        (v ? (v.ipa ? '<div class="tp-pop-i">/' + esc(String(v.ipa).replace(/^\/|\/$/g, '')) + '/</div>' : '') +
             ((v.synonyms && v.synonyms.length) ? '<div>≈ ' + esc(v.synonyms.slice(0, 3).join(', ')) + '</div>' : '') +
             ((v.vi || v.meaningVi) ? '<div class="tp-pop-v">' + esc(v.vi || v.meaningVi) + '</div>' : '')
           : '<div class="tp-pop-m">Not in this assignment’s word list.</div>');
      b.closest('li').appendChild(pop);
      pop.querySelector('.tp-pop-x').onclick = function () { pop.remove(); };
    };
  });
}

global.VMTP = { mount: function (el, text, vocab) { if (el) render(el, text, vocab); }, profile: textProfile, split: splitForProfile };
})(window);
