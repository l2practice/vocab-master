/*───────────────────────────────────────────────────────────────
  VocabMaster — shared client library  (vm-common.js)
  Exports: window.VM
  Requires: nothing (self-contained)
───────────────────────────────────────────────────────────────*/
(function (global) {
  'use strict';

  /* ── GAS endpoint ─────────────────────────────────────────── */
  var GAS = 'https://script.google.com/macros/s/AKfycbwj-XE8zxBifrn7BgcbIGegqeeoKAPnYIBUPX7dOuCQozNQvkOgmS9bT3tC92W3kwoM/exec';

  var VM = {
    GAS: GAS,
    LOGIN_PAGE:   'login.html',
    STUDENT_HOME: 'student.html',
    TEACHER_HOME: 'teacher.html',
  };

  /* ── JSONP — only cross-origin method that works GH Pages→GAS ── */
  var _cbId = 0;
  function jsonp(action, payload) {
    return new Promise(function (resolve, reject) {
      var cb = '_vmcb' + (++_cbId) + '_' + Date.now();
      var timer = setTimeout(function () {
        cleanup(); reject(new Error('Timeout — check network or GAS deployment.'));
      }, 30000);
      global[cb] = function (data) { cleanup(); resolve(data); };
      function cleanup() {
        clearTimeout(timer);
        try { delete global[cb]; } catch (e) { global[cb] = undefined; }
        if (s && s.parentNode) s.parentNode.removeChild(s);
      }
      var params = new URLSearchParams({
        action: action, callback: cb,
        payload: JSON.stringify(payload || {})
      });
      var s = document.createElement('script');
      s.src = GAS + '?' + params.toString();
      s.onerror = function () { cleanup(); reject(new Error('Network error.')); };
      document.head.appendChild(s);
    });
  }

  VM.api = function (action, payload) { return jsonp(action, payload || {}); };

  /* ── VM.apiLarge — chunked vocab save (parallel) ──────────── */
  VM.apiLarge = function (action, payload) {
    var vocab = (payload.vocab || []).slice();
    var slim  = {};
    for (var k in payload) { if (k !== 'vocab') slim[k] = payload[k]; }
    slim.vocab = [];

    return VM.api(action, slim).then(function (res) {
      if (!res || !res.success) return res;
      if (!vocab.length) return res;
      var aId = (res.data && res.data.assignmentId) || payload.assignmentId;
      var CHUNK = 8, chunks = [];
      for (var i = 0; i < vocab.length; i += CHUNK)
        chunks.push({ words: vocab.slice(i, i + CHUNK), idx: chunks.length });
      // Send ALL chunks in parallel — much faster than sequential
      return Promise.all(chunks.map(function (c) {
        return VM.api('assign.appendVocab', {
          assignmentId: aId, vocab: c.words, replace: c.idx === 0
        });
      })).then(function () { return res; });
    });
  };

  /* ── Session ───────────────────────────────────────────────── */
  var SKEY          = 'vm_session';
  var IDLE_KEY      = 'vm_last_active';
  var IDLE_LIMIT_MS = 45 * 60 * 1000;
  var SESSION_TTL   = 12 * 60 * 60 * 1000;

  function _refreshIdle() { try { localStorage.setItem(IDLE_KEY, String(Date.now())); } catch (e) {} }
  function _isIdle() {
    try { var t = parseInt(localStorage.getItem(IDLE_KEY) || '0', 10); return t > 0 && Date.now() - t > IDLE_LIMIT_MS; }
    catch (e) { return false; }
  }

  VM.session = {
    set: function (obj, opts) {
      var rem = !!(opts && opts.remember);
      var pl  = JSON.stringify({ data: obj, exp: Date.now() + SESSION_TTL });
      try { sessionStorage.removeItem(SKEY); } catch (e) {}
      try { localStorage.removeItem(SKEY);   } catch (e) {}
      try { (rem ? localStorage : sessionStorage).setItem(SKEY, pl); } catch (e) {}
      _refreshIdle();
    },
    get: function () {
      var raw = null;
      try { raw = sessionStorage.getItem(SKEY) || localStorage.getItem(SKEY); } catch (e) {}
      if (!raw) return null;
      try {
        var o = JSON.parse(raw);
        if (!o || !o.data || !o.exp || Date.now() > o.exp || _isIdle()) { VM.session.clear(); return null; }
        return o.data;
      } catch (e) { VM.session.clear(); return null; }
    },
    clear:   function () { try { localStorage.removeItem(SKEY); } catch (e) {} try { sessionStorage.removeItem(SKEY); } catch (e) {} },
    role:    function () { var s = VM.session.get(); return s ? s.role : null; },
    require: function (role) { var s = VM.session.get(); if (!s || (role && s.role !== role)) { location.href = VM.LOGIN_PAGE; return null; } _refreshIdle(); return s; },
    logout:  function () { VM.session.clear(); location.href = VM.LOGIN_PAGE; },
  };

  /* Activity → refresh idle */
  var _it = 0;
  ['click','keydown','touchstart','scroll'].forEach(function (ev) {
    document.addEventListener(ev, function () { var n = Date.now(); if (n - _it > 60000) { _it = n; _refreshIdle(); } }, { passive: true, capture: true });
  });

  /* ── Gemini key ────────────────────────────────────────────── */
  VM.geminiKey = {
    get: function () { return localStorage.getItem('vm_gemini_key') || ''; },
    set: function (k) { localStorage.setItem('vm_gemini_key', k || ''); },
  };

  /* ── Utilities ─────────────────────────────────────────────── */
  VM.el  = function (sel, root) { return (root || document).querySelector(sel); };
  VM.els = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  VM.esc = function (str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  };
  VM.fmtDate = function (val) {
    if (!val) return '—';
    var d = new Date(String(val).trim());
    if (isNaN(d)) return String(val);
    return d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }) +
           (String(val).length > 10 ? ' ' + d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit', hour12:false }) : '');
  };
  VM.fmtDuration = function (sec) {
    sec = parseInt(sec, 10) || 0;
    return Math.floor(sec / 60) + 'm ' + (sec % 60 < 10 ? '0' : '') + (sec % 60) + 's';
  };

  /* ── Toast ─────────────────────────────────────────────────── */
  var _te = null;
  VM.toast = function (msg, kind, ms) {
    if (!_te) { _te = document.createElement('div'); _te.className = 'vm-toast'; document.body.appendChild(_te); }
    _te.textContent = msg;
    _te.className = 'vm-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(_te._t);
    _te._t = setTimeout(function () { _te.className = 'vm-toast' + (kind ? ' ' + kind : ''); }, ms || 2600);
  };

  /* ── Brand ─────────────────────────────────────────────────── */
  VM.logoSVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="currentColor"/><text x="12" y="17" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="system-ui">V</text></svg>';
  VM.brandLockup = function () {
    return '<a class="vm-logo" href="#"><span class="vm-logo-mark">' + VM.logoSVG + '</span><span class="vm-logo-name">VocabMaster</span></a>';
  };
  (function () {
    if (document.getElementById('vm-fonts')) return;
    var l = document.createElement('link'); l.id = 'vm-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap';
    document.head.appendChild(l);
  })();

  /* ── Icons ─────────────────────────────────────────────────── */
  var IC = {
    hw:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>',
    inclass:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    reading:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    results:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    classes:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    assign:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>',
    logout:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    menu:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
    search:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>',
    trash:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>',
    edit:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  };
  VM.icon = function (n) { return IC[n] || ''; };

  /* ── Shell ─────────────────────────────────────────────────── */
  VM.renderShell = function (opts) {
    var s = VM.session.get() || {};
    var name = (opts.user && opts.user.name) || s.name || s.email || 'User';
    var role = s.role === 'teacher' ? 'Teacher' : 'Student';
    var ini  = name.split(/\s+/).map(function(w){return w[0]||'';}).slice(0,2).join('').toUpperCase();
    var nav  = opts.nav.map(function(n){
      return '<a class="vm-nav'+(n.active?' active':'')+'" '+(n.href?'href="'+n.href+'"':'data-nav="'+n.id+'"')+'>'+
             (n.icon?VM.icon(n.icon):'')+' <span>'+n.label+'</span></a>';
    }).join('');
    document.getElementById(opts.mount||'app').innerHTML =
      '<div class="vm-shell">'+
        '<aside class="vm-side" id="vmSide">'+VM.brandLockup()+nav+
          '<div style="margin-top:auto"><button class="vm-nav" id="vmLogout">'+VM.icon('logout')+'<span>Sign out</span></button></div>'+
        '</aside>'+
        '<div class="vm-main">'+
          '<header class="vm-topbar">'+
            '<button class="vm-menu-btn" id="vmMenuBtn">'+VM.icon('menu')+'</button>'+
            '<div><div class="vm-eyebrow">'+(opts.eyebrow||'')+'</div>'+
            '<h1 class="vm-page-title" id="vmPageTitle">'+(opts.title||'')+'</h1></div>'+
            '<div class="vm-topbar-right"><div class="vm-user">'+
              '<div class="vm-avatar">'+ini+'</div>'+
              '<div><div class="vm-user-name">'+VM.esc(name)+'</div><div class="vm-user-role">'+role+'</div></div>'+
            '</div></div>'+
          '</header>'+
          '<main class="vm-content" id="vmContent"></main>'+
        '</div>'+
      '</div>';
    document.getElementById('vmLogout').onclick = function(){ VM.session.logout(); };
    // Idle check
    var warned = false;
    setInterval(function(){
      try {
        var t = parseInt(localStorage.getItem(IDLE_KEY)||'0',10), ago = Date.now()-t;
        if (!t) return;
        if (ago >= IDLE_LIMIT_MS) { VM.session.clear(); location.href = VM.LOGIN_PAGE; return; }
        if (!warned && ago >= IDLE_LIMIT_MS - 5*60*1000) {
          warned = true;
          VM.toast('Session expires in '+ Math.ceil((IDLE_LIMIT_MS-ago)/60000) +' min', 'warn', 8000);
        }
      } catch(e){}
    }, 60000);
    // Mobile sidebar
    var mb = document.getElementById('vmMenuBtn');
    if (mb) mb.onclick = function(e){ e.stopPropagation(); document.getElementById('vmSide').classList.toggle('open'); };
    document.addEventListener('click', function(e){
      var sd = document.getElementById('vmSide');
      if (sd && sd.classList.contains('open') && !sd.contains(e.target) && !(mb&&mb.contains(e.target))) sd.classList.remove('open');
    });
    VM.els('[data-nav]').forEach(function(a){
      a.onclick = function(){ if(opts.onNav) opts.onNav(a.getAttribute('data-nav')); };
    });
    return document.getElementById('vmContent');
  };
  VM.setActiveNav = function(id){ VM.els('.vm-nav').forEach(function(a){a.classList.remove('active');}); var el=VM.el('[data-nav="'+id+'"]'); if(el) el.classList.add('active'); };
  VM.setTitle = function(t,e){ var el=document.getElementById('vmPageTitle');if(el)el.textContent=t; var ee=VM.el('.vm-eyebrow');if(ee&&e)ee.textContent=e; };

  /* ── Today's Word ──────────────────────────────────────────── */
  VM.renderTodaysWord = function(mountId) {
    var m = document.getElementById(mountId||'vmTodaysWord'); if(!m) return;
    var fi = Math.floor(parseInt(localStorage.getItem('vm_login_count')||'0',10)/5);
    VM.api('vocab.today',{index:fi}).then(function(res){
      if(!res||!res.success||!res.data){m.innerHTML='';return;}
      var c=res.data.current, p=res.data.previous;
      m.innerHTML='<div class="vm-tw"><div class="vm-tw-glow"></div><div class="vm-tw-grid">'+
        '<div class="vm-tw-left"><div class="vm-tw-eyebrow">✦ TODAY\'S WORD</div>'+
        '<div class="vm-tw-word">'+VM.esc(c.word)+(c.ipa?'<span class="vm-tw-ipa">/'+VM.esc(c.ipa)+'/</span>':'')+'</div>'+
        (c.meaningVi?'<div class="vm-tw-mean">🇻🇳 '+VM.esc(c.meaningVi)+'</div>':'')+
        (c.synonyms&&c.synonyms.length?'<div class="vm-tw-syn"><span class="vm-tw-lbl">SYNONYMS</span><div class="vm-tw-chips">'+
          c.synonyms.map(function(s){return'<span class="vm-tw-chip">'+VM.esc(s)+'</span>';}).join('')+'</div></div>':'')+
        '</div>'+
        '<div class="vm-tw-right">'+
        (p&&p.word?'<div class="vm-tw-prev"><span class="vm-tw-prev-lbl">PREVIOUSLY</span>'+
          '<div class="vm-tw-prev-word">'+VM.esc(p.word)+'</div>'+
          (p.meaningVi?'<div class="vm-tw-prev-mean">'+VM.esc(p.meaningVi)+'</div>':'')+
        '</div>':'')+
        (c.examples&&c.examples.length?'<div class="vm-tw-ex"><span class="vm-tw-lbl">EXAMPLES</span>'+
          c.examples.map(function(e){return'<p>"'+VM.esc(e)+'"</p>';}).join('')+'</div>':'')+
        '</div></div></div>';
    });
  };
  VM.bumpLoginCount = function(){ var k='vm_login_count'; localStorage.setItem(k,String(parseInt(localStorage.getItem(k)||'0',10)+1)); };

  /* ── Quiz engine — vocab master proven logic ───────────────── */
  function _shuffle(arr) {
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}
    return a;
  }
  VM._shuffle = _shuffle;

  var MC_MODES = ['word-to-synonym','synonym-to-word','word-to-vi','vi-to-word'];

  function _wrd(v){return v.word||v.original||String(v);}
  function _syn(v){return(v.synonyms&&v.synonyms.length?v.synonyms[0]:'')||v.syn||'';}
  function _vi(v) {return v.vi||v.meaningVi||v.vietnamese||'';}
  function _ipa(v){return v.ipa||'';}

  function _buildMC(word, mode, allVocab) {
    var others = _shuffle(allVocab.filter(function(w){return _wrd(w)!==_wrd(word);})).slice(0,3);
    var w=_wrd(word),syn=_syn(word),vi=_vi(word),ipa=_ipa(word);
    var prompt,correct,choices,label;
    if(mode==='word-to-synonym'&&!syn) mode='word-to-vi';
    if(mode==='vi-to-word'&&!vi)      mode='synonym-to-word';
    switch(mode){
      case 'word-to-synonym':
        prompt=w;correct=syn||vi;label='Word → Synonym';ipa=ipa;
        choices=[correct].concat(others.map(function(o){return _syn(o)||_vi(o)||_wrd(o);}));break;
      case 'synonym-to-word':
        prompt=syn||vi||w;correct=w;label='Definition → Word';
        choices=[w].concat(others.map(function(o){return _wrd(o);}));break;
      case 'word-to-vi':
        prompt=w;correct=vi||syn||w;label='Word → Vietnamese';ipa=ipa;
        choices=[correct].concat(others.map(function(o){return _vi(o)||_syn(o)||_wrd(o);}));break;
      case 'vi-to-word':
        prompt=vi||syn||w;correct=w;label='Vietnamese → Word';
        choices=[w].concat(others.map(function(o){return _wrd(o);}));break;
      default:
        prompt=w;correct=syn||vi||w;label='Multiple Choice';
        choices=[correct].concat(others.map(function(o){return _syn(o)||_wrd(o);}));
    }
    return {type:'mc',word:w,prompt:prompt,correct:correct,ipa:ipa,label:label,syn:syn,vi:vi,
            choices:_shuffle(choices)};
  }

  function _buildFITB(word) {
    var w=_wrd(word),syn=_syn(word),vi=_vi(word),ipa=_ipa(word);
    var tmpls=[
      syn  ? 'A word that means "'+syn+'" is: _______'       : 'Fill in: _______',
      vi   ? 'The English word for "'+vi+'" is: _______'     : 'Write the missing word: _______',
      (syn&&vi)?'Word meaning "'+syn+'" ('+vi+'): _______'
              :(syn?'Define "'+syn+'" in one word: _______'  : 'Complete: _______'),
      syn  ? 'We can say "'+syn+'". The word is: _______'    : (vi?'"'+vi+'" in English: _______':'Type the word: _______'),
      syn  ? 'Synonym of "'+syn.split(',')[0].trim()+'": _______'
           : (vi?'Translate "'+vi+'": _______'               : 'Fill in the blank: _______'),
    ];
    return {type:'fitb',word:w,correct:w.toLowerCase(),ipa:ipa,syn:syn,vi:vi,
            label:'Fill in the Blank',
            sentence:tmpls[Math.floor(Math.random()*tmpls.length)],
            firstLetter:w.charAt(0).toUpperCase(),wordLen:w.length};
  }

  VM.buildQuiz = function(vocab, opts) {
    opts = opts||{};
    var isReview = !!opts.isReview;
    var total    = opts.total || 65;
    if(!vocab||!vocab.length) return {questions:[],total:0,check:function(){return{correct:false,correctAnswer:''};} };

    var pool, questions=[];

    if(isReview){
      // In-class: each word ONCE, no repeats
      pool = _shuffle(vocab).slice(0,total);
      pool.forEach(function(word,i){
        var q = (i%4===3)?_buildFITB(word):_buildMC(word,MC_MODES[i%MC_MODES.length],vocab);
        if(q) questions.push(q);
      });
    } else {
      // Homework: spaced repetition — 45 base + 20 repeats = 65, same word may appear with DIFFERENT mode
      var base=[];
      while(base.length<45) base=base.concat(_shuffle(vocab));
      base=base.slice(0,45);
      var repeats=[];
      while(repeats.length<20) repeats=repeats.concat(_shuffle(vocab));
      pool=_shuffle(base.concat(repeats.slice(0,20)));
      pool.forEach(function(word,i){
        var q=(i%4===3)?_buildFITB(word):_buildMC(word,MC_MODES[i%MC_MODES.length],vocab);
        if(q) questions.push(q);
      });
    }

    questions=questions.slice(0,total);
    return {
      questions: questions, total: questions.length, isReview: isReview,
      check: function(idx,answer){
        var q=questions[idx];
        if(!q) return{correct:false,correctAnswer:''};
        var g=String(answer).toLowerCase().trim(), c=String(q.correct).toLowerCase().trim();
        return{correct:g===c,correctAnswer:q.correct,type:q.type,label:q.label};
      }
    };
  };

  /* ── analyzeVocab — vocab master 2-phase pipeline ─────────── */
  VM.analyzeVocab = function(rawList, apiKey, onProgress){
    // Phase 1: client-side parse (0 tokens)
    var lines = rawList.split('\n').map(function(l){return l.trim();}).filter(Boolean);
    var parsed=[];
    for(var li=0;li<lines.length;li++){
      var line=lines[li]
        .replace(/^\d+[\.)]\s*/,'').replace(/^\d+\s+/,'')
        .replace(/^[-\u2022\u2013\u2014*]\s*/,'').trim();
      if(!line) continue;
      var word='',syn='',eqIdx=line.indexOf('='),colIdx=line.indexOf(':'),splitIdx=-1;
      if(eqIdx>=0&&(colIdx<0||eqIdx<=colIdx)) splitIdx=eqIdx;
      else if(colIdx>=0&&colIdx<40) splitIdx=colIdx;
      if(splitIdx>=0){word=line.slice(0,splitIdx).trim();syn=line.slice(splitIdx+1).trim();}
      else word=line.trim();
      word=word.replace(/\s*[\(\[].+[\)\]]\s*$/,'').replace(/[,;:]+$/,'').trim();
      if(word) parsed.push({word:word,syn:syn});
    }
    if(!parsed.length) return Promise.reject(new Error('No words found.'));

    var result=parsed.map(function(p){
      var syns=p.syn?p.syn.split(',').map(function(s){return s.trim();}).filter(Boolean):[];
      return{word:p.word,ipa:'',synonyms:syns,vi:'',meaningVi:''};
    });
    if(onProgress) onProgress(0,parsed.length);

    // Phase 2: AI enrichment — IPA + vi only, 30/batch
    var BATCH=30, MODELS=['gemini-2.5-flash-lite','gemini-2.5-flash','gemini-2.0-flash-001'];
    var words=parsed.map(function(p){return p.word;});
    var batches=[];
    for(var b=0;b<words.length;b+=BATCH) batches.push({words:words.slice(b,b+BATCH),offset:b});

    function callGemini(wordBatch){
      var prompt='You are a vocabulary dictionary. Return ONLY a valid JSON array, no markdown.\n'+
        'For EVERY word: {"word":"...","ipa":"British IPA","vi":"Vietnamese 1-5 words"}\n'+
        'CRITICAL: Include ALL '+wordBatch.length+' words.\nWords:\n'+wordBatch.join('\n')+'\nReturn ONLY the JSON array.';
      var mi=0;
      function tryModel(){
        if(mi>=MODELS.length) return Promise.reject(new Error('All models failed'));
        var model=MODELS[mi++];
        return fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+encodeURIComponent(apiKey),{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:4096,temperature:0.1}})
        }).then(function(r){
          if(r.status===429) return new Promise(function(rs){setTimeout(rs,3000);}).then(tryModel);
          if(!r.ok) return r.json().catch(function(){return{};}).then(function(e){throw new Error((e.error&&e.error.message)||'HTTP '+r.status);});
          return r.json();
        }).then(function(d){
          var parts=(((d.candidates||[])[0]||{}).content||{}).parts||[];
          var text=parts.map(function(p){return p.text||'';}).join('').trim();
          if(!text) throw new Error('Empty response');
          text=text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
          var opens=(text.match(/\{/g)||[]).length,closes=(text.match(/\}/g)||[]).length;
          if(opens>closes) text=text.replace(/,?\s*$/,'')+'}]';
          if(!text.endsWith(']')) text+=']';
          return JSON.parse(text);
        }).catch(function(err){if(mi<MODELS.length)return tryModel();throw err;});
      }
      return tryModel();
    }

    function runBatches(idx){
      if(idx>=batches.length) return Promise.resolve(result);
      var bt=batches[idx];
      return callGemini(bt.words).then(function(arr){
        arr.forEach(function(item,j){
          var ri=bt.offset+j;if(ri>=result.length)return;
          if(item.ipa) result[ri].ipa=item.ipa;
          if(item.vi){result[ri].vi=item.vi;result[ri].meaningVi=item.vi;}
        });
        if(onProgress) onProgress(bt.offset+bt.words.length,parsed.length);
        if(idx<batches.length-1)
          return new Promise(function(rs){setTimeout(rs,600);}).then(function(){return runBatches(idx+1);});
        return result;
      }).catch(function(err){
        console.warn('Batch '+(idx+1)+' failed:',err.message);
        if(onProgress) onProgress(bt.offset+bt.words.length,parsed.length);
        return runBatches(idx+1);
      });
    }
    return runBatches(0);
  };

  global.VM = VM;
})(window);
