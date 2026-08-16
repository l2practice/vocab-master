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

  /* ── VM.apiPost — fire-and-forget POST (vocab master pattern) ── */
  // Vocab master cũ dùng cách này: POST với text/plain → không có CORS preflight
  // GAS nhận và xử lý toàn bộ payload ngay lập tức (kể cả vocab lớn)
  // Browser bị CORS error khi ĐỌC response nhưng GAS đã xử lý xong → ignore
  // Kết quả: save cực nhanh, không cần chunking
  function _gasPost(action, payload) {
    var body = JSON.stringify({
      action:  action,
      payload: payload || {}
    });
    return fetch(GAS, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    body
    }).catch(function () {
      // CORS error on response read is expected — GAS already processed the request
    });
  }

  // VM.apiLarge — vocab master pattern: POST full payload, JSONP just confirms
  // The key insight: GAS processes POST even though browser can't read CORS response.
  // We pre-generate assignmentId client-side so both POST and JSONP use the same ID.
  VM.apiLarge = function (action, payload) {
    // Pre-generate ID if creating (not editing)
    var isEdit = !!(payload.assignmentId);
    var aId = payload.assignmentId || ('VM-' + Date.now().toString(36).toUpperCase());

    // Full payload for POST (includes vocab)
    var fullPayload = {};
    for (var k in payload) fullPayload[k] = payload[k];
    fullPayload.assignmentId = aId;

    // Slim payload for JSONP (no vocab — just metadata to confirm creation)
    var slimPayload = {};
    for (var k in payload) { if (k !== 'vocab') slimPayload[k] = payload[k]; }
    slimPayload.assignmentId = aId;
    slimPayload.vocab = [];

    // Step 1: fire POST with FULL vocab — GAS stores everything
    _gasPost(action, fullPayload);

    // Step 2: after 1.5s, JSONP confirm. Hard 8s total timeout so UI never hangs.
    return new Promise(function(resolve) {
      var done = false;
      var safeResolve = function(v) { if(!done){ done=true; resolve(v); } };

      // Safety: resolve after 8s no matter what
      setTimeout(function(){ safeResolve({ success:true, data:{ assignmentId:aId } }); }, 8000);

      setTimeout(function() {
        VM.api(action, slimPayload)
          .then(function(res) {
            safeResolve(res && res.success ? res : { success:true, data:{ assignmentId:aId } });
          })
          .catch(function() {
            safeResolve({ success:true, data:{ assignmentId:aId } });
          });
      }, 1500);
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

  VM.groqKey = {
    get: function () { return localStorage.getItem('vm_groq_key') || ''; },
    set: function (k) { localStorage.setItem('vm_groq_key', k || ''); },
  };

  // Groq banner HTML helper — shown when all Gemini models fail and no Groq key saved
  VM.groqBanner = function(containerId, onSave) {
    var saved = VM.groqKey.get();
    if (saved) { if(onSave) onSave(); return; }
    var el = document.getElementById(containerId);
    if(!el) return;
    var div = document.createElement('div');
    div.id = 'vmGroqBanner';
    div.style.cssText = 'background:#FEF3D6;border:1.5px solid #F59E0B;border-radius:10px;padding:14px 16px;margin-bottom:14px';
    div.innerHTML =
      '<div style="font-weight:700;font-size:.88rem;color:#7A5000;margin-bottom:6px">⚠️ Gemini API không khả dụng</div>' +
      '<p style="font-size:.8rem;color:#7A5000;margin:0 0 10px">Dùng Groq (miễn phí) thay thế. ' +
        '<a href="https://console.groq.com/keys" target="_blank" style="color:var(--vm-primary);font-weight:600">Lấy Groq key →</a></p>' +
      '<div style="display:flex;gap:8px">' +
        '<input id="vmGroqKeyInput" type="password" placeholder="gsk_…" style="flex:1;border:1px solid #F59E0B;border-radius:7px;padding:7px 10px;font-size:.84rem;background:#fff">' +
        '<button id="vmGroqSaveBtn" style="background:#F59E0B;color:#3A2600;border:none;border-radius:7px;padding:7px 12px;font-weight:700;font-size:.82rem;cursor:pointer">Lưu key</button>' +
      '</div>';
    el.insertBefore(div, el.firstChild);
    document.getElementById('vmGroqSaveBtn').onclick = function(){
      var k = (document.getElementById('vmGroqKeyInput').value||'').trim();
      if(!k) return;
      VM.groqKey.set(k);
      div.remove();
      if(onSave) onSave();
    };
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
    var BATCH=30, MODELS=['gemini-3.5-flash','gemini-3.6-flash','gemini-3.5-flash-lite'];
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
          text=text.replace(/```json[\n]?/g,'').replace(/```[\n]?/g,'').trim();
          var opens=(text.match(/\{/g)||[]).length,closes=(text.match(/\}/g)||[]).length;
          if(opens>closes) text=text.replace(/,?\s*$/,'')+'}]';
          if(!text.endsWith(']')) text+=']';
          return JSON.parse(text);
        }).catch(function(err){if(mi<MODELS.length)return tryModel();throw err;});
      }
      // Final fallback: Groq (llama-3.1-8b-instant)
      function tryGroq(){
        var groqKey = localStorage.getItem('vm_groq_key')||'';
        if(!groqKey) return Promise.reject(new Error('NO_GROQ_KEY'));
        return fetch('https://api.groq.com/openai/v1/chat/completions',{
          method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+groqKey},
          body:JSON.stringify({model:'llama3-70b-8192',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:4096})
        }).then(function(r){
          if(!r.ok) return r.json().catch(function(){return{};}).then(function(e){throw new Error((e.error&&e.error.message)||'Groq HTTP '+r.status);});
          return r.json();
        }).then(function(d){
          var text=((d.choices||[])[0]||{}).message&&d.choices[0].message.content||'';
          if(!text) throw new Error('Empty Groq response');
          text=text.replace(/```json[\n]?/g,'').replace(/```[\n]?/g,'').trim();
          var opens=(text.match(/\{/g)||[]).length,closes=(text.match(/\}/g)||[]).length;
          if(opens>closes) text=text.replace(/,?\s*$/,'')+'}]';
          if(!text.endsWith(']')) text+=']';
          return JSON.parse(text);
        });
      }
      return tryModel().catch(function(err){
        if(err.message!=='NO_GROQ_KEY') return tryGroq().catch(function(){ throw err; });
        throw err;
      });
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

/* ── AI Chat Widget ─────────────────────────────────────────────────
   VM.Chat.init(opts) — mounts a floating chat button + panel
   opts: {
     role:        'student' | 'teacher',
     context:     string — current assignment/article context for AI
     systemExtra: string — extra system instructions
   }
   Student: Gemini 3.5-flash → 3.1-flash-lite → Groq llama
   Teacher: user picks model from dropdown, stored in localStorage
─────────────────────────────────────────────────────────────────── */
VM.Chat = (function(){
  var _open = false;
  var _history = [];  // [{role:'user'|'assistant', content}]
  var _context = '';
  var _role = 'student';
  var _mounted = false;

  var STUDENT_MODELS = [
    {id:'gemini-3.5-flash',      label:'Gemini 3.5 Flash',      type:'gemini'},
    {id:'gemini-3.6-flash', label:'Gemini 3.6 Flash', type:'gemini'},
    {id:'gemini-3.5-flash-lite',      label:'Gemini 3.5 Flash Lite',      type:'gemini'},
    {id:'groq-llama',            label:'Groq Llama 3 70B',        type:'groq'},
  ];
  var TEACHER_MODELS = [
    {id:'gemini-3.5-flash',      label:'Gemini 3.5 Flash',      type:'gemini'},
    {id:'gemini-3.6-flash', label:'Gemini 3.6 Flash', type:'gemini'},
    {id:'gemini-3.5-flash-lite',      label:'Gemini 3.5 Flash Lite',      type:'gemini'},
    {id:'groq-llama',            label:'Groq Llama 3 70B',        type:'groq'},
    {id:'gpt-4o-mini',           label:'GPT-4o Mini',           type:'openai'},
    {id:'claude-3-5-haiku',      label:'Claude 3.5 Haiku',      type:'anthropic'},
    {id:'grok-2',                label:'Grok 2',                type:'xai'},
  ];

  var STUDENT_SYSTEM =
    'You are a helpful English learning assistant for Vietnamese EFL university students. ' +
    'Your job is to explain vocabulary, grammar, and comprehension questions in a clear, encouraging way. ' +
    'You can answer in Vietnamese if the student uses Vietnamese, or in English if they use English. ' +
    'STRICT RULE: Never directly reveal quiz answers. If a student asks "what is the answer to question X" ' +
    'or "is the answer Y?", gently redirect them to think through it: give a hint, explain the meaning, ' +
    'or ask a guiding question instead. ' +
    'Keep responses concise (2-4 sentences) unless a detailed explanation is needed.';

  var TEACHER_SYSTEM =
    'You are an expert English language teaching assistant for a Vietnamese university lecturer. ' +
    'You can help with curriculum design, CLO/PLO alignment, teaching strategies, lesson planning, ' +
    'assessment rubrics, student feedback, and EdTech tools. ' +
    'Be direct, professional, and practical. Responses can be detailed when needed.';

  function _systemPrompt(){
    var base = _role === 'teacher' ? TEACHER_SYSTEM : STUDENT_SYSTEM;
    if(_context) base += '\n\nCurrent context: ' + _context;
    return base;
  }

  function _getModelKey(modelId){
    return localStorage.getItem('vm_chat_key_' + modelId) || '';
  }
  function _setModelKey(modelId, key){
    localStorage.setItem('vm_chat_key_' + modelId, key);
  }
  function _getSavedModel(){
    return localStorage.getItem('vm_chat_model') || (_role==='teacher'?'gemini-3.5-flash':'auto');
  }
  function _setSavedModel(m){ localStorage.setItem('vm_chat_model', m); }

  async function _callAI(messages, modelId){
    var models = _role==='teacher' ? TEACHER_MODELS : STUDENT_MODELS;
    var model  = models.find(function(m){return m.id===modelId;}) || models[0];

    if(model.type === 'gemini'){
      var key = VM.geminiKey.get();
      if(!key) throw new Error('NO_GEMINI_KEY');
      var msgs = [{role:'user', parts:[{text:_systemPrompt()}]}].concat(
        messages.map(function(m){
          return {role: m.role==='assistant'?'model':'user', parts:[{text:m.content}]};
        })
      );
      var r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/'+model.id+':generateContent?key='+encodeURIComponent(key),
        {method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({contents:msgs,generationConfig:{maxOutputTokens:1024,temperature:0.7}})}
      );
      if(!r.ok){var e=await r.json().catch(function(){return{};}); throw new Error((e.error&&e.error.message)||'Gemini HTTP '+r.status);}
      var d = await r.json();
      var parts = (((d.candidates||[])[0]||{}).content||{}).parts||[];
      return parts.map(function(p){return p.text||'';}).join('').trim();
    }

    if(model.type === 'groq'){
      var gk = VM.groqKey.get();
      if(!gk) throw new Error('NO_GROQ_KEY');
      var payload = {
        model:'llama3-70b-8192',
        messages:[{role:'system',content:_systemPrompt()}].concat(messages),
        temperature:0.7, max_tokens:1024
      };
      var r2 = await fetch('https://api.groq.com/openai/v1/chat/completions',
        {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+gk},
         body:JSON.stringify(payload)});
      if(!r2.ok){var e2=await r2.json().catch(function(){return{};}); throw new Error((e2.error&&e2.error.message)||'Groq HTTP '+r2.status);}
      var d2 = await r2.json();
      return ((d2.choices||[])[0]||{}).message&&d2.choices[0].message.content||'';
    }

    if(model.type === 'openai'){
      var ok = _getModelKey(modelId);
      if(!ok) throw new Error('NO_KEY:'+modelId);
      var r3 = await fetch('https://api.openai.com/v1/chat/completions',
        {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+ok},
         body:JSON.stringify({model:model.id,messages:[{role:'system',content:_systemPrompt()}].concat(messages),max_tokens:1024,temperature:0.7})});
      if(!r3.ok){var e3=await r3.json().catch(function(){return{};}); throw new Error((e3.error&&e3.error.message)||'OpenAI HTTP '+r3.status);}
      var d3 = await r3.json();
      return ((d3.choices||[])[0]||{}).message&&d3.choices[0].message.content||'';
    }

    if(model.type === 'anthropic'){
      var ck = _getModelKey(modelId);
      if(!ck) throw new Error('NO_KEY:'+modelId);
      var r4 = await fetch('https://api.anthropic.com/v1/messages',
        {method:'POST',headers:{'Content-Type':'application/json','x-api-key':ck,'anthropic-version':'2023-06-01'},
         body:JSON.stringify({model:'claude-3-5-haiku-20241022',system:_systemPrompt(),messages:messages,max_tokens:1024})});
      if(!r4.ok){var e4=await r4.json().catch(function(){return{};}); throw new Error((e4.error&&e4.error.message)||'Claude HTTP '+r4.status);}
      var d4 = await r4.json();
      return ((d4.content||[])[0]||{}).text||'';
    }

    if(model.type === 'xai'){
      var xk = _getModelKey(modelId);
      if(!xk) throw new Error('NO_KEY:'+modelId);
      var r5 = await fetch('https://api.x.ai/v1/chat/completions',
        {method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+xk},
         body:JSON.stringify({model:'grok-2-1212',messages:[{role:'system',content:_systemPrompt()}].concat(messages),max_tokens:1024,temperature:0.7})});
      if(!r5.ok){var e5=await r5.json().catch(function(){return{};}); throw new Error((e5.error&&e5.error.message)||'Grok HTTP '+r5.status);}
      var d5 = await r5.json();
      return ((d5.choices||[])[0]||{}).message&&d5.choices[0].message.content||'';
    }

    throw new Error('Unknown model type: '+model.type);
  }

  // Student auto-cascade: try Gemini models → Groq
  async function _sendStudent(userMsg){
    var msgs = _history.concat([{role:'user',content:userMsg}]);
    var cascade = ['gemini-3.5-flash','gemini-3.6-flash','gemini-3.5-flash-lite','groq-llama'];
    for(var i=0; i<cascade.length; i++){
      try {
        return await _callAI(msgs, cascade[i]);
      } catch(e) {
        if(i===cascade.length-1) throw e;
        // Continue to next model
      }
    }
  }

  async function _send(userMsg){
    var modelId = _getSavedModel();
    if(_role === 'student'){
      return await _sendStudent(userMsg);
    } else {
      return await _callAI(_history.concat([{role:'user',content:userMsg}]), modelId);
    }
  }

  function _renderMessages(){
    var el = document.getElementById('vmChatMsgs');
    if(!el) return;
    el.innerHTML = _history.map(function(m){
      var isUser = m.role==='user';
      return '<div style="display:flex;justify-content:'+(isUser?'flex-end':'flex-start')+';margin-bottom:10px">'+
        '<div style="max-width:82%;background:'+(isUser?'var(--vm-primary)':'var(--vm-surface-2)')+';'+
          'color:'+(isUser?'#fff':'var(--vm-ink)')+';border-radius:'+(isUser?'16px 16px 4px 16px':'16px 16px 16px 4px')+';'+
          'padding:10px 13px;font-size:.86rem;line-height:1.5;white-space:pre-wrap;word-break:break-word">'+
          VM.esc(m.content)+
        '</div>'+
      '</div>';
    }).join('') +
    (_history.length===0?
      '<div style="text-align:center;color:var(--vm-ink-3);font-size:.82rem;margin-top:20px">'+
        (_role==='student'?'💬 Hỏi tôi về từ vựng, ngữ pháp, hay nội dung bài đọc!':'💬 Hỏi tôi bất cứ điều gì về giảng dạy!')+
      '</div>':'');
    el.scrollTop = el.scrollHeight;
  }

  function _requireKey(){
    // Check if any usable key exists
    var models = _role==='teacher' ? TEACHER_MODELS : STUDENT_MODELS;
    var modelId = _getSavedModel();
    if(_role==='student'||modelId==='auto') return true; // cascade handles it
    var model = models.find(function(m){return m.id===modelId;});
    if(!model) return true;
    if(model.type==='gemini') return !!VM.geminiKey.get();
    if(model.type==='groq') return !!VM.groqKey.get();
    return !!_getModelKey(modelId);
  }

  function _keyInputFor(modelId){
    var models = TEACHER_MODELS;
    var model = models.find(function(m){return m.id===modelId;})||{type:'gemini'};
    if(model.type==='gemini') return {label:'Gemini API Key', placeholder:'AIza…', get:VM.geminiKey.get, set:VM.geminiKey.set};
    if(model.type==='groq')   return {label:'Groq API Key',   placeholder:'gsk_…', get:VM.groqKey.get,   set:VM.groqKey.set};
    return {label:model.label+' API Key', placeholder:'sk-…',
            get:function(){return _getModelKey(modelId);},
            set:function(k){_setModelKey(modelId,k);}};
  }

  function _renderHeader(){
    var models = _role==='teacher' ? TEACHER_MODELS : [];
    var modelId = _getSavedModel();
    return '<div style="background:var(--vm-primary-dk);color:#fff;padding:11px 14px;display:flex;align-items:center;gap:10px;border-radius:14px 14px 0 0">'+
      '<div style="flex:1;font-weight:700;font-size:.9rem">'+(_role==='student'?'💬 AI Assistant':'💬 AI Teaching Assistant')+'</div>'+
      (_role==='teacher'?
        '<select id="vmChatModelSel" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:4px 8px;font-size:.75rem;font-family:inherit;cursor:pointer">'+
          models.map(function(m){return '<option value="'+m.id+'" '+(m.id===modelId?'selected':'')+'>'+m.label+'</option>';}).join('')+
        '</select>':'') +
      '<button onclick="VM.Chat.toggle()" style="background:none;border:none;color:rgba(255,255,255,.7);font-size:1.2rem;cursor:pointer;padding:0;line-height:1">✕</button>'+
    '</div>';
  }

  function _renderKeyPrompt(modelId){
    var ki = _keyInputFor(modelId);
    var saved = ki.get();
    return saved ? '' :
      '<div style="background:#FEF3D6;border-bottom:1px solid #F59E0B;padding:10px 12px;font-size:.78rem">'+
        '<b style="color:#7A5000">'+ki.label+' required:</b> '+
        '<div style="display:flex;gap:6px;margin-top:5px">'+
          '<input id="vmChatKeyIn" type="password" placeholder="'+ki.placeholder+'" '+
            'style="flex:1;border:1px solid #F59E0B;border-radius:6px;padding:5px 8px;font-size:.78rem">'+
          '<button id="vmChatKeySave" style="background:#F59E0B;color:#3A2600;border:none;border-radius:6px;padding:5px 10px;font-weight:700;font-size:.76rem;cursor:pointer">Save</button>'+
        '</div>'+
      '</div>';
  }

  function mount(opts){
    if(_mounted) {
      // Just update context
      _context = opts.context || _context;
      return;
    }
    _role    = opts.role    || 'student';
    _context = opts.context || '';
    _history = [];
    _mounted = true;

    // Floating button
    var btn = document.createElement('button');
    btn.id = 'vmChatBtn';
    btn.innerHTML = '💬';
    btn.style.cssText = 'position:fixed;bottom:24px;right:20px;z-index:7000;width:52px;height:52px;'+
      'border-radius:50%;background:var(--vm-primary);color:#fff;border:none;font-size:1.4rem;'+
      'cursor:pointer;box-shadow:0 4px 20px rgba(27,127,94,.4);transition:transform .15s;line-height:1;'+
      'display:flex;align-items:center;justify-content:center';
    btn.title = 'AI Assistant';
    btn.onclick = function(){ VM.Chat.toggle(); };
    document.body.appendChild(btn);

    // Chat panel
    var panel = document.createElement('div');
    panel.id = 'vmChatPanel';
    panel.style.cssText = 'position:fixed;bottom:86px;right:20px;z-index:7000;width:340px;max-height:520px;'+
      'display:none;flex-direction:column;background:var(--vm-surface);border-radius:14px;'+
      'box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;border:1px solid var(--vm-border-2)';
    document.body.appendChild(panel);
  }

  function _rebuildPanel(){
    var panel = document.getElementById('vmChatPanel');
    if(!panel) return;
    var modelId = _getSavedModel();
    panel.innerHTML =
      _renderHeader()+
      _renderKeyPrompt(modelId)+
      '<div id="vmChatMsgs" style="flex:1;overflow-y:auto;padding:12px;min-height:200px;max-height:340px"></div>'+
      '<div style="border-top:1px solid var(--vm-border-2);padding:10px 12px;display:flex;gap:8px;background:var(--vm-surface)">'+
        '<input id="vmChatInput" placeholder="Hỏi AI…" autocomplete="off" '+
          'style="flex:1;border:1.5px solid var(--vm-border);border-radius:20px;padding:8px 14px;font-size:.85rem;font-family:inherit;outline:none">'+
        '<button id="vmChatSend" style="background:var(--vm-primary);color:#fff;border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;font-size:1rem;flex:0 0 auto">↑</button>'+
      '</div>';

    _renderMessages();

    // Model selector change (teacher)
    var sel = document.getElementById('vmChatModelSel');
    if(sel) sel.onchange = function(){
      _setSavedModel(sel.value);
      _rebuildPanel();
    };

    // Key save
    var kSave = document.getElementById('vmChatKeySave');
    if(kSave) kSave.onclick = function(){
      var v = (document.getElementById('vmChatKeyIn').value||'').trim();
      if(!v){ VM.toast('Enter API key.','warn'); return; }
      var ki = _keyInputFor(_getSavedModel());
      ki.set(v);
      _rebuildPanel();
      VM.toast('Key saved!','ok');
    };

    // Send
    var inp = document.getElementById('vmChatInput');
    var sendBtn = document.getElementById('vmChatSend');

    async function doSend(){
      if(!inp) return;
      var msg = inp.value.trim();
      if(!msg) return;
      inp.value = '';
      inp.disabled = true;
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<span class="vm-spin" style="width:14px;height:14px;border-width:2px"></span>';

      _history.push({role:'user', content:msg});
      _renderMessages();

      try {
        var reply = await _send(msg);
        _history.push({role:'assistant', content:reply});
      } catch(e) {
        var em = e.message||String(e);
        if(em.startsWith('NO_KEY:')){
          var mid = em.slice(7);
          _history.push({role:'assistant', content:'⚠️ Please enter your '+mid+' API key above to continue.'});
        } else if(em==='NO_GEMINI_KEY'){
          _history.push({role:'assistant', content:'⚠️ No Gemini API key. Please add a key in Settings, or select Groq in the model dropdown.'});
        } else if(em==='NO_GROQ_KEY'){
          _history.push({role:'assistant', content:'⚠️ No Groq key saved. Get a free key at https://console.groq.com/keys and enter it in the ReadWise page.'});
        } else {
          _history.push({role:'assistant', content:'❌ Error: '+em});
        }
      }

      inp.disabled = false;
      sendBtn.disabled = false;
      sendBtn.innerHTML = '↑';
      _renderMessages();
      if(inp) inp.focus();
    }

    if(inp) inp.onkeydown = function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); doSend(); } };
    if(sendBtn) sendBtn.onclick = doSend;
  }

  return {
    init: function(opts){
      mount(opts);
      _rebuildPanel();
    },
    setContext: function(ctx){ _context = ctx||''; },
    toggle: function(){
      _open = !_open;
      var panel = document.getElementById('vmChatPanel');
      var btn   = document.getElementById('vmChatBtn');
      if(panel) panel.style.display = _open ? 'flex' : 'none';
      if(btn)   btn.innerHTML = _open ? '✕' : '💬';
      if(_open){ _rebuildPanel(); var i=document.getElementById('vmChatInput'); if(i) setTimeout(function(){i.focus();},50); }
    },
    destroy: function(){
      _mounted=false; _history=[];
      var p=document.getElementById('vmChatPanel'); if(p) p.remove();
      var b=document.getElementById('vmChatBtn');   if(b) b.remove();
    }
  };
})();
