/*───────────────────────────────────────────────────────────────
  vm-cefr.js — CEFR analysis engine for VocabMaster
  Requires: cefr-dict.js (defines CEFR_MAP, CEFR_IRREGULAR)

  Exports (via window.VMCEFR):
    VMCEFR.analyze(text)             → [{token,lemma,level,pos,start,end}, …]
    VMCEFR.breakdown(tokens)         → {A1:n, A2:n, B1:n, B2:n, C1:n, C2:n, unknown:n, total:n}
    VMCEFR.renderPassage(text, opts) → HTML string with inline highlights
    VMCEFR.fetchMeanings(words, key) → Promise<{word→{vi,ipa}}>
    VMCEFR.collocations(text, key)   → Promise<[{phrase, meaning}]>

  Level names: 1=A1  2=A2  3=B1  4=B2  5=C1  6=C2
  POS chars:   n=noun  v=verb  j=adj  r=adv  p=prep  d=det  c=conj  o=pron  x=excl  m=num
───────────────────────────────────────────────────────────────*/
(function (global) {
  'use strict';

  /* ── Guard: cefr-dict.js must be loaded first ── */
  if (typeof CEFR_MAP === 'undefined') {
    console.error('[vm-cefr] CEFR_MAP not found. Load cefr-dict.js before vm-cefr.js.');
    return;
  }

  var LEVEL_NAME = { '1':'A1', '2':'A2', '3':'B1', '4':'B2', '5':'C1', '6':'C2' };
  var LEVEL_NUM  = { 'A1':1, 'A2':2, 'B1':3, 'B2':4, 'C1':5, 'C2':6 };
  var LEVEL_COLOR = {
    '1': '#22C55E',  // A1  green
    '2': '#3B82F6',  // A2  blue
    '3': '#F59E0B',  // B1  amber
    '4': '#EF4444',  // B2  red
    '5': '#8B5CF6',  // C1  purple
    '6': '#EC4899',  // C2  pink
  };
  var LEVEL_BG = {
    '1': 'rgba(34,197,94,.13)',
    '2': 'rgba(59,130,246,.13)',
    '3': 'rgba(245,158,11,.15)',
    '4': 'rgba(239,68,68,.13)',
    '5': 'rgba(139,92,246,.13)',
    '6': 'rgba(236,72,153,.13)',
  };
  var POS_NAME = {
    n:'noun', v:'verb', j:'adj', r:'adv', p:'prep',
    d:'det', c:'conj', o:'pron', x:'excl', m:'num'
  };

  /* ── Lemmatizer ── */
  function lemmatize(w) {
    w = w.toLowerCase().replace(/[^a-z'\-]/g, '');
    if (!w) return null;
    if (CEFR_MAP[w]) return w;
    if (CEFR_IRREGULAR[w] && CEFR_MAP[CEFR_IRREGULAR[w]]) return CEFR_IRREGULAR[w];

    var tries = [];
    if (/ies$/.test(w))  tries.push(w.slice(0,-3)+'y');
    if (/ied$/.test(w))  tries.push(w.slice(0,-3)+'y');
    if (/ier$/.test(w))  tries.push(w.slice(0,-3)+'y');
    if (/iest$/.test(w)) tries.push(w.slice(0,-4)+'y');
    if (/ily$/.test(w))  tries.push(w.slice(0,-3)+'y');
    if (/ves$/.test(w))  tries.push(w.slice(0,-3)+'f', w.slice(0,-3)+'fe');
    if (/(ses|xes|zes|ches|shes)$/.test(w)) tries.push(w.slice(0,-2));
    if (/s$/.test(w) && !/ss$/.test(w)) tries.push(w.slice(0,-1));
    if (/ed$/.test(w))   tries.push(w.slice(0,-2), w.slice(0,-1));
    if (/ing$/.test(w))  tries.push(w.slice(0,-3), w.slice(0,-3)+'e');
    if (/ally$/.test(w)) tries.push(w.slice(0,-4)+'al', w.slice(0,-4), w.slice(0,-2));
    if (/ly$/.test(w))   tries.push(w.slice(0,-2));
    if (/er$/.test(w))   tries.push(w.slice(0,-2), w.slice(0,-2)+'e');
    if (/est$/.test(w))  tries.push(w.slice(0,-3), w.slice(0,-3)+'e');
    if (/ness$/.test(w)) tries.push(w.slice(0,-4));
    if (/ment$/.test(w)) tries.push(w.slice(0,-4));
    if (/tion$/.test(w)) tries.push(w.slice(0,-4), w.slice(0,-4)+'e');
    if (/sion$/.test(w)) tries.push(w.slice(0,-4), w.slice(0,-4)+'d');
    if (/ity$/.test(w))  tries.push(w.slice(0,-3));
    if (/ous$/.test(w))  tries.push(w.slice(0,-3));
    if (/ful$/.test(w))  tries.push(w.slice(0,-3));
    if (/less$/.test(w)) tries.push(w.slice(0,-4));
    if (/ize$/.test(w))  tries.push(w.slice(0,-3));
    if (/ise$/.test(w))  tries.push(w.slice(0,-3));

    for (var i = 0; i < tries.length; i++) {
      if (CEFR_MAP[tries[i]]) return tries[i];
      if (CEFR_IRREGULAR[tries[i]] && CEFR_MAP[CEFR_IRREGULAR[tries[i]]]) return CEFR_IRREGULAR[tries[i]];
    }
    return null;
  }

  /* ── Parse a CEFR_MAP entry → {level:'4', pos:'v'} ── */
  function parseEntry(entry) {
    if (!entry) return null;
    // Take the first code (easiest level listed first per comment in cefr-dict.js)
    var first = entry.split('|')[0];
    return { level: first[0], pos: first[1] };
  }

  /* ── Tokenize text into word-tokens with positions ── */
  function tokenize(text) {
    var tokens = [];
    var re = /[a-zA-Z'-]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var raw    = m[0];
      var clean  = raw.replace(/^['-]+|['-]+$/g, '');
      if (!clean || clean.length < 2) continue;
      tokens.push({ raw: raw, clean: clean, start: m.index, end: m.index + m[0].length });
    }
    return tokens;
  }

  /* ── STOPWORDS: very common words we skip for analysis ── */
  var SKIP = {
    'the':1,'a':1,'an':1,'is':1,'are':1,'was':1,'were':1,'be':1,'been':1,'being':1,
    'have':1,'has':1,'had':1,'do':1,'does':1,'did':1,'will':1,'would':1,'could':1,
    'should':1,'may':1,'might':1,'shall':1,'can':1,'must':1,'i':1,'you':1,'he':1,
    'she':1,'it':1,'we':1,'they':1,'me':1,'him':1,'her':1,'us':1,'them':1,
    'my':1,'your':1,'his':1,'its':1,'our':1,'their':1,'this':1,'that':1,'these':1,
    'those':1,'and':1,'but':1,'or':1,'so':1,'if':1,'not':1,'no':1,'of':1,'in':1,
    'on':1,'at':1,'by':1,'to':1,'for':1,'from':1,'with':1,'about':1,'as':1,'up':1,
    'out':1,'into':1,'than':1,'then':1,'when':1,'which':1,'who':1,'what':1,'how':1,
    'all':1,'also':1,'just':1,'more':1,'very':1,'well':1,'now':1,'here':1,'there':1,
    'some':1,'any':1,'each':1,'both':1,'such':1,'its':1,'over':1,'after':1,'before':1,
  };

  /* ── Main analyze() ── */
  function analyze(text) {
    var tokens = tokenize(text);
    return tokens.map(function (t) {
      var lc = t.clean.toLowerCase();
      if (SKIP[lc]) return Object.assign({ lemma: lc, level: null, pos: null }, t);
      var lemma = lemmatize(lc);
      if (!lemma) return Object.assign({ lemma: lc, level: null, pos: null }, t);
      var info = parseEntry(CEFR_MAP[lemma]);
      if (!info) return Object.assign({ lemma: lemma, level: null, pos: null }, t);
      return Object.assign({ lemma: lemma, level: info.level, pos: info.pos }, t);
    });
  }

  /* ── Breakdown stats ── */
  function breakdown(tokens) {
    var counts = { A1:0, A2:0, B1:0, B2:0, C1:0, C2:0, unknown:0, total:0 };
    tokens.forEach(function (t) {
      if (SKIP[t.clean.toLowerCase()]) return; // don't count stopwords
      counts.total++;
      if (t.level && LEVEL_NAME[t.level]) counts[LEVEL_NAME[t.level]]++;
      else counts.unknown++;
    });
    return counts;
  }

  /* ── renderPassage() — returns HTML with highlights ── */
  function renderPassage(text, opts) {
    opts = opts || {};
    // opts.visibleLevels: set of level names to show, e.g. {A2:true, B1:true, ...}
    // opts.meanings: {word → {vi:'...', ipa:'...'}}
    // opts.vocabHighlight: [words] — words in teacher's vocab list get border
    var visibleLevels = opts.visibleLevels || { A1:true, A2:true, B1:true, B2:true, C1:true, C2:true };
    var meanings  = opts.meanings  || {};
    var vocabList = opts.vocabHighlight || [];
    var vocabSet  = {};
    vocabList.forEach(function (w) { vocabSet[w.toLowerCase()] = true; });

    var tokens = analyze(text);
    if (!tokens.length) return escHtml(text);

    // Build result by splicing in spans
    var result = '';
    var cursor = 0;
    tokens.forEach(function (t) {
      // text before this token
      result += escHtml(text.slice(cursor, t.start));
      cursor = t.end;

      var lname = t.level ? LEVEL_NAME[t.level] : null;
      var show  = lname && visibleLevels[lname];
      var isVocab = vocabSet[t.clean.toLowerCase()];
      var mData   = meanings[t.clean.toLowerCase()] || meanings[t.lemma] || null;

      if (!show && !isVocab) {
        result += escHtml(t.raw);
        return;
      }

      var title = (lname||'?');
      if (mData && mData.vi) title += ' · ' + mData.vi;

      var style = '';
      if (show && t.level) {
        style = 'background:'+LEVEL_BG[t.level]+';border-bottom:2px solid '+LEVEL_COLOR[t.level]+';border-radius:3px;padding:0 1px;';
      }
      if (isVocab) {
        style += 'outline:2px solid var(--vm-primary,#1B7F5E);outline-offset:1px;border-radius:3px;';
      }

      var badge = show && lname
        ? '<span style="font-size:.6rem;font-weight:700;color:'+LEVEL_COLOR[t.level]+';margin-left:2px;vertical-align:super">'+lname+'</span>'
        : '';

      // Inline Vietnamese meaning (italic, grey, smaller — like the screenshot)
      var viMeaning = '';
      if (show && mData && mData.vi) {
        viMeaning = ' <span style="font-size:.78rem;color:#8B6914;font-style:italic;font-family:system-ui">(' + escHtml(mData.vi) + ')</span>';
      }

      result += '<span class="vm-cefr-word" style="'+style+'" data-level="'+(lname||'')+'" data-word="'+escHtml(t.clean)+'" data-lemma="'+escHtml(t.lemma)+'" title="'+escHtml(title)+'">'+
        escHtml(t.raw)+badge+
      '</span>'+viMeaning;
    });
    result += escHtml(text.slice(cursor));
    return result;
  }

  /* ── Gemini: batch fetch meanings + IPA ── */
  function fetchMeanings(words, apiKey, existingVocab) {
    if (!words || !words.length) return Promise.resolve({});
    existingVocab = existingVocab || [];

    // Build a map of words we already have data for (from teacher's vocab list)
    var known = {};
    existingVocab.forEach(function (v) {
      known[v.word.toLowerCase()] = { vi: v.vi || v.meaningVi || '', ipa: v.ipa || '' };
    });

    // Only query Gemini for words we don't already have
    var toFetch = words.filter(function (w) { return !known[w.toLowerCase()]; });
    if (!toFetch.length) return Promise.resolve(known);

    var prompt =
      'For each word below, give: (1) Vietnamese meaning in 3-5 words, (2) IPA pronunciation.\n'+
      'Return ONLY a JSON array, NO markdown:\n'+
      '[{"word":"...","vi":"...","ipa":"..."}]\n\n'+
      'Words:\n' + toFetch.join('\n');

    return fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
        })
      }
    ).then(function (r) {
      if (!r.ok) throw new Error('Gemini HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      var text = ((((d.candidates||[])[0]||{}).content||{}).parts||[]).map(function(p){return p.text||'';}).join('');
      text = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      var arr = JSON.parse(text);
      arr.forEach(function (item) {
        known[item.word.toLowerCase()] = { vi: item.vi || '', ipa: item.ipa || '' };
      });
      return known;
    }).catch(function (err) {
      console.warn('[vm-cefr] fetchMeanings error:', err);
      return known; // return what we have
    });
  }

  /* ── Gemini: extract Phrases & Collocations from passage ── */
  function collocations(text, apiKey) {
    if (!text || !apiKey) return Promise.resolve([]);
    var prompt =
      'Extract the 8-10 most important phrases, collocations, or fixed expressions from this passage.\n'+
      'For each, give: the phrase and its Vietnamese meaning.\n'+
      'Return ONLY a JSON array, NO markdown:\n'+
      '[{"phrase":"...","meaning":"..."}]\n\n'+
      'Passage:\n' + text.slice(0, 2000); // limit to 2000 chars

    return fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
      encodeURIComponent(apiKey),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
        })
      }
    ).then(function (r) {
      if (!r.ok) throw new Error('Gemini HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      var text2 = ((((d.candidates||[])[0]||{}).content||{}).parts||[]).map(function(p){return p.text||'';}).join('');
      text2 = text2.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      return JSON.parse(text2);
    }).catch(function (err) {
      console.warn('[vm-cefr] collocations error:', err);
      return [];
    });
  }

  /* ── Utility ── */
  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  /* ── Public API ── */
  global.VMCEFR = {
    LEVEL_NAME:  LEVEL_NAME,
    LEVEL_NUM:   LEVEL_NUM,
    LEVEL_COLOR: LEVEL_COLOR,
    LEVEL_BG:    LEVEL_BG,
    POS_NAME:    POS_NAME,
    lemmatize:   lemmatize,
    analyze:     analyze,
    breakdown:   breakdown,
    renderPassage: renderPassage,
    fetchMeanings: fetchMeanings,
    collocations:  collocations,
  };

})(window);
