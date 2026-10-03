/*───────────────────────────────────────────────────────────────
  VocabMaster — Google Apps Script Backend
  Sheet: 1oOSu1HuJgWS70VMzQeSd-GWZr-Z_p_bSQwwjdiQZCWU

  DEPLOY: Extensions ▸ Apps Script ▸ paste ▸ Deploy ▸ New deployment
          ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone (anonymous)
          ▸ copy /exec URL into VM_GAS in vm-common.js

  Router: both doGet (JSONP) and doPost (fetch) dispatch on `action`.
  All responses: { success:Boolean, data|error }
───────────────────────────────────────────────────────────────*/

const SHEET_ID = '1oOSu1HuJgWS70VMzQeSd-GWZr-Z_p_bSQwwjdiQZCWU';

// ── Tab names ──────────────────────────────────────────────────
const T = {
  STUDENTS:    'Students',
  TEACHERS:    'Teachers',
  CLASSES:     'Classes',
  ASSIGN:      'Assignments',
  RESULTS:     'Results',
  VOCAB:       'Vocabulary',
  READWISE:    'ReadWise',
  IC_RECHECK:  'IC_Recheck',
  TR_SETS:     'TranslateSets',
  TR_RESULTS:  'TranslateResults',
};

// ── Column definitions ─────────────────────────────────────────
const HEADERS = {
  [T.STUDENTS]: ['Student ID','Name','Class','Birthdate','Password','Phone','Email','CreatedAt'],
  [T.TEACHERS]: ['Name','Email','Birthdate','Password','Phone','CreatedAt'],
  [T.CLASSES]:  ['Class ID','Class Name','Academic Year','Semester','Teacher Email','CreatedAt'],
  [T.ASSIGN]: [
    'Assignment ID','Mode',         // 'homework' | 'inclass'
    'Class','Title',
    'Reading Passage',              // optional reading text
    'Vocab List',                   // JSON array of {word,ipa,synonyms,vi} objects
    'Deadline',                     // ISO date string, '' = no deadline
    'Required Goals',               // int, default 3 (homework) / 0 (inclass)
    'Session Start',                // inclass: ISO datetime students can begin
    'Session Duration Min',         // inclass: minutes allowed
    'Session End',                  // inclass: ISO datetime session closes
    'CreatedAt','Active'
  ],
  [T.RESULTS]: [
    'Timestamp',
    'Student ID','Name','Class',
    'Assignment ID','Title','Mode',
    'Score',           // 0–100
    'Is Perfect',      // TRUE/FALSE (score===100)
    'Duration Sec',    // seconds taken
    'Correct','Total',
    'Missed Words',    // JSON array — wrong + unfinished words (inclass only)
    'Timed Out',       // TRUE if student ran out of time
    'Absent',          // TRUE if auto-generated absence record
  ],
  [T.VOCAB]: ['Word','IPA','Band','Meaning VI','Synonyms','Example 1','Example 2'],
  [T.READWISE]: [
    'Article ID','Title','Student ID','Student Name','Class',
    'Passage',          // full text
    'Vocab JSON',       // AI-extracted vocab [{word,ipa,vi,synonyms}]
    'Collocations JSON',// [{phrase,meaning}]
    'Saved At'
  ],
  [T.IC_RECHECK]: [
    'Recheck ID','Assignment ID','Assignment Title',
    'Student ID','Student Name','Class',
    'Missed Words',     // comma-separated
    'Penalty Type',     // 'wrong'|'timeout'|'absent'
    'Checked By',       // teacher email
    'Checked At',       // ISO datetime
    'Note'
  ],
  [T.TR_SETS]: [
    'Set ID', 'Source Assignment ID', 'Class', 'Title',
    'Items JSON', 'Pass Score', 'Session Start', 'Deadline',
    'Created At', 'Active', 'Teacher Email'
  ],
  [T.TR_RESULTS]: [
    'Timestamp', 'Student ID', 'Name', 'Class', 'Set ID', 'Title',
    'Run Index', 'Score', 'Passed', 'Duration Sec',
    'Item Scores JSON', 'Cleared Item IDs JSON', 'Chest JSON'
  ],
};

// ── Router ─────────────────────────────────────────────────────
function doGet(e)  { return handle(e, 'GET');  }
function doPost(e) { return handle(e, 'POST'); }

function handle(e, method) {
  var params  = (e && e.parameter) || {};
  var action  = params.action || '';
  var payload = {};
  try {
    if (method === 'POST' && e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      action   = body.action  || action;
      payload  = body.payload || {};
    } else if (params.payload) {
      payload = JSON.parse(params.payload);
    }
  } catch (err) {
    return respond(e, { success:false, error:'Bad payload: ' + err.message });
  }
  var out;
  try   { out = dispatch(action, payload); }
  catch (err) { out = { success:false, error: err.message, action: action }; }
  return respond(e, out);
}

function dispatch(action, p) {
  switch (action) {
    // auth
    case 'auth.studentSignup':   return studentSignup(p);
    case 'auth.studentLogin':    return studentLogin(p);
    case 'auth.teacherLogin':    return teacherLogin(p);
    case 'auth.teacherSignup':   return teacherSignup(p);
    case 'auth.forgotPassword':  return forgotPassword(p);
    case 'auth.changePassword':  return changePassword(p);
    // classes
    case 'class.create':         return classCreate(p);
    case 'class.list':           return classList(p);
    case 'class.roster':         return getRoster(p);
    case 'class.archive':        return archiveClass(p);
    case 'student.archive':      return archiveStudent(p);
    case 'student.update':       return updateStudent(p);
    // assignments (teacher)
    case 'assign.create':        return assignCreate(p);
    case 'assign.update':        return assignUpdate(p);
    case 'assign.delete':        return assignDelete(p);
    case 'assign.appendVocab':   return assignAppendVocab(p);
    case 'assign.list':          return assignList(p);      // teacher: all for class
    case 'assign.get':           return assignGet(p);
    // assignments (student)
    case 'assign.forStudent':    return assignForStudent(p);
    // results
    case 'result.save':          return resultSave(p);
    case 'result.getForTeacher': return resultGetForTeacher(p);
    case 'result.getForStudent': return resultGetForStudent(p);
    case 'result.summary':       return resultSummary(p);  // per-assignment aggregation
    // vocab (shared sheet)
    case 'vocab.list':           return vocabList(p);
    case 'vocab.today':          return vocabToday(p);
    // ReadWise (student self-study)
    case 'readwise.save':        return readwiseSave(p);
    case 'readwise.list':        return readwiseList(p);
    case 'readwise.get':         return readwiseGet(p);
    case 'readwise.delete':      return readwiseDelete(p);
    // Translate
    case 'translate.create':     return translateCreate(p);
    case 'translate.update':     return translateUpdate(p);
    case 'translate.list':       return translateList(p);
    case 'translate.forStudent': return translateForStudent(p);
    case 'translate.get':        return translateGet(p);
    case 'translate.saveResult': return translateSaveResult(p);
    case 'translate.stats':      return translateStats(p);
    case 'translate.myProgress': return translateMyProgress(p);
    // In-class result extensions
    case 'result.saveInclass':   return resultSaveInclass(p);
    case 'result.recheckSave':   return recheckSave(p);
    case 'result.missedWords':   return resultMissedWords(p);
    case 'result.recheckList':   return recheckList(p);
    case 'result.absentPenalty': return absentPenalty(p);
    // util
    case 'ping': return { success:true, data:'pong', time: new Date().toISOString() };
    case 'admin.resetTab': return resetTab(p);
    // Firebase edition (FirebaseVM.gs): account creation + password reset need admin rights
    case 'fb.register': case 'fb.registerTeacher': case 'fb.forgotPassword': return fbRoute(action, p);
    default: return { success:false, error:'Unknown action: ' + action };
  }
}

// ── Response (JSONP-aware) ─────────────────────────────────────
function respond(e, obj) {
  var json = JSON.stringify(obj);
  var cb   = e && e.parameter && e.parameter.callback;
  if (cb) {
    return ContentService
      .createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet helpers ───────────────────────────────────────────────
function ss() { return SpreadsheetApp.openById(SHEET_ID); }

function sheet(name) {
  var book = ss();
  var sh   = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    var head = HEADERS[name];
    if (head) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
      forceTextColumns(sh, head, ['Student ID','Password','Phone']);
    }
  }
  return sh;
}

function forceTextColumns(sh, head, cols) {
  cols.forEach(function(c) {
    var i = head.indexOf(c);
    if (i > -1) sh.getRange(2, i+1, sh.getMaxRows()-1, 1).setNumberFormat('@');
  });
}

function readAll(name) {
  var sh  = sheet(name);
  var rng = sh.getDataRange().getValues();
  if (rng.length < 2) return [];
  var head = rng[0];
  return rng.slice(1).map(function(row, i) {
    var o = { _row: i + 2 };
    head.forEach(function(h, c) { o[h] = row[c]; });
    return o;
  });
}

function headerIndex(name) {
  var sh   = sheet(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var idx  = {};
  head.forEach(function(h, i) { idx[h] = i; });
  return idx;
}

function appendRowByHeader(name, obj) {
  var sh      = sheet(name);
  var lastCol = Math.max(1, sh.getLastColumn());
  var head    = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  while (head.length && head[head.length-1] === '') head.pop();

  var want = HEADERS[name] || Object.keys(obj);
  want.forEach(function(h) {
    if (head.indexOf(h) === -1) { head.push(h); sh.getRange(1, head.length).setValue(h).setFontWeight('bold'); }
  });
  Object.keys(obj).forEach(function(h) {
    if (head.indexOf(h) === -1) { head.push(h); sh.getRange(1, head.length).setValue(h).setFontWeight('bold'); }
  });

  var row = head.map(function(h) { return obj[h] != null ? obj[h] : ''; });
  sh.appendRow(row);
  return sh.getLastRow();
}

function updateRowByHeader(name, rowNum, obj) {
  var sh   = sheet(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  Object.keys(obj).forEach(function(h) {
    var col = head.indexOf(h);
    if (col > -1) sh.getRange(rowNum, col + 1).setValue(obj[h]);
  });
}

function nowIso() { return new Date().toISOString(); }
function uid(prefix) {
  return (prefix||'') + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36);
}

// ── Auth ───────────────────────────────────────────────────────
function studentSignup(p) {
  var missing = [];
  if (!p.studentId || !String(p.studentId).trim()) missing.push('Student ID');
  if (!p.name      || !String(p.name).trim())      missing.push('Họ và tên');
  if (!p.class     || !String(p.class).trim())      missing.push('Mã lớp');
  if (!p.email     || !String(p.email).trim())      missing.push('Email');
  if (!p.birthdate || !String(p.birthdate).trim())  missing.push('Ngày sinh');
  if (!p.phone     || !String(p.phone).trim())      missing.push('Số điện thoại');
  if (!p.password  || !String(p.password).trim())   missing.push('Mật khẩu');
  if (missing.length)
    return { success:false, error:'Vui lòng nhập: ' + missing.join(', ') + '.' };

  var cls = readAll(T.CLASSES).filter(function(r) {
    return String(r['Class ID']) === String(p.class).trim().toUpperCase();
  })[0];
  if (!cls) return { success:false, error:'Mã lớp "' + p.class + '" không tồn tại.' };

  var rows  = readAll(T.STUDENTS);
  var sid   = String(p.studentId).trim();
  var email = String(p.email).trim().toLowerCase();
  var phone = String(p.phone).trim();
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r['Student ID']).trim() === sid)
      return { success:false, error:'Student ID đã được đăng ký.', field:'studentId' };
    if (email && String(r['Email']||'').trim().toLowerCase() === email)
      return { success:false, error:'Email đã được đăng ký.', field:'email' };
    if (phone && String(r['Phone']||'').trim() === phone)
      return { success:false, error:'Số điện thoại đã được đăng ký.', field:'phone' };
  }

  appendRowByHeader(T.STUDENTS, {
    'Student ID': sid, 'Name': String(p.name).trim(),
    'Class': String(p.class).trim().toUpperCase(),
    'Birthdate': String(p.birthdate).trim(),
    'Password': p.password, 'Phone': phone, 'Email': email,
    'CreatedAt': nowIso()
  });
  return { success:true, data:{ studentId:sid, name:p.name, class:p.class } };
}

function studentLogin(p) {
  var idOrEmail = String(p.studentId || '').trim();
  var pass      = String(p.password || '');
  if (!idOrEmail) return { success:false, error:'Nhập Student ID hoặc email.' };
  var lower = idOrEmail.toLowerCase();

  var rows    = readAll(T.STUDENTS);
  var matches = rows.filter(function(r) {
    if (r['Archived'] === true || String(r['Archived']).toLowerCase() === 'true') return false;
    return String(r['Student ID']).trim() === idOrEmail ||
           String(r['Email']||'').trim().toLowerCase() === lower;
  });
  if (!matches.length) return { success:false, error:'Sai Student ID/email hoặc mật khẩu.' };

  var u = matches.filter(function(r) { return samePassword(r['Password'], pass); })[0];
  if (!u) return { success:false, error:'Sai Student ID/email hoặc mật khẩu.' };
  return { success:true, data:{ studentId:u['Student ID'], name:u['Name'], class:u['Class'], email:u['Email'] } };
}

function teacherSignup(p) {
  if (!p.email || !p.password) return { success:false, error:'Thiếu email hoặc mật khẩu.' };
  var rows = readAll(T.TEACHERS);
  if (rows.some(function(r) { return String(r['Email']).toLowerCase() === String(p.email).toLowerCase(); }))
    return { success:false, error:'Email đã tồn tại.' };
  appendRowByHeader(T.TEACHERS, {
    'Name': p.name||'', 'Email': p.email, 'Birthdate': p.birthdate||'',
    'Password': p.password, 'Phone': p.phone||'', 'CreatedAt': nowIso()
  });
  return { success:true, data:{ name:p.name, email:p.email } };
}

function teacherLogin(p) {
  var email = String(p.email||'').trim().toLowerCase();
  var pass  = String(p.password||'');
  var u = readAll(T.TEACHERS).filter(function(r) {
    return String(r['Email']).trim().toLowerCase() === email && samePassword(r['Password'], pass);
  })[0];
  if (!u) return { success:false, error:'Sai email hoặc mật khẩu.' };
  return { success:true, data:{ name:u['Name'], email:u['Email'] } };
}

function forgotPassword(p) {
  var email = String(p.email||'').trim().toLowerCase();
  if (!email) return { success:false, error:'Nhập email đã đăng ký.' };
  var found = readAll(T.STUDENTS).filter(function(r) {
    return String(r['Email']).trim().toLowerCase() === email;
  })[0] || readAll(T.TEACHERS).filter(function(r) {
    return String(r['Email']).trim().toLowerCase() === email;
  })[0];
  if (!found) return { success:false, error:'Không tìm thấy tài khoản với email này.' };
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'VocabMaster — Khôi phục mật khẩu',
      body: 'Xin chào ' + (found['Name']||'') + ',\n\n' +
            'Mật khẩu tài khoản VocabMaster của bạn là: ' + found['Password'] + '\n\n' +
            (found['Student ID'] ? 'Student ID: ' + found['Student ID'] + '\n' : '') +
            '\nVui lòng đăng nhập và đổi mật khẩu nếu cần.\n\n— VocabMaster'
    });
    return { success:true };
  } catch(err) {
    return { success:false, error:'Không gửi được email: ' + err.message };
  }
}

function changePassword(p) {
  if (!p.oldPass || !p.newPass) return { success:false, error:'Thiếu mật khẩu.' };
  if (p.studentId) {
    var sh = sheet(T.STUDENTS), idx = headerIndex(T.STUDENTS);
    var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx['Student ID']]).trim() === String(p.studentId).trim() &&
          samePassword(data[i][idx['Password']], p.oldPass)) {
        sh.getRange(i+1, idx['Password']+1).setValue(p.newPass).setNumberFormat('@');
        return { success:true };
      }
    }
    return { success:false, error:'Sai mật khẩu hiện tại.' };
  } else if (p.email) {
    var sh2 = sheet(T.TEACHERS), idx2 = headerIndex(T.TEACHERS);
    var data2 = sh2.getDataRange().getValues();
    for (var j = 1; j < data2.length; j++) {
      if (String(data2[j][idx2['Email']]).toLowerCase() === String(p.email).toLowerCase() &&
          samePassword(data2[j][idx2['Password']], p.oldPass)) {
        sh2.getRange(j+1, idx2['Password']+1).setValue(p.newPass);
        return { success:true };
      }
    }
    return { success:false, error:'Sai mật khẩu hiện tại.' };
  }
  return { success:false, error:'Thiếu studentId hoặc email.' };
}

function samePassword(stored, given) {
  var s = String(stored).trim();
  var g = String(given).trim();
  if (s === g) return true;
  if (!/^0\d/.test(s) && !/^0\d/.test(g)) {
    var sf = parseFloat(s), gf = parseFloat(g);
    if (!isNaN(sf) && !isNaN(gf) && String(sf) === String(gf)) return true;
  }
  return false;
}

// ── Classes ────────────────────────────────────────────────────
function genClassId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return 'VM-' + s;
}

function classCreate(p) {
  if (!p.className) return { success:false, error:'Thiếu tên lớp.' };
  var existing = readAll(T.CLASSES);
  var id;
  do { id = genClassId(); } while (existing.some(function(r) { return r['Class ID'] === id; }));
  appendRowByHeader(T.CLASSES, {
    'Class ID': id, 'Class Name': p.className,
    'Academic Year': p.year||'', 'Semester': p.semester||'',
    'Teacher Email': p.teacherEmail||'', 'CreatedAt': nowIso()
  });
  return { success:true, data:{ classId:id, className:p.className, year:p.year, semester:p.semester } };
}

function classList(p) {
  var rows = readAll(T.CLASSES).filter(function(r) {
    if (r['Archived'] === true || String(r['Archived']).toLowerCase() === 'true') return false;
    return !p.teacherEmail ||
      String(r['Teacher Email']).toLowerCase() === String(p.teacherEmail).toLowerCase();
  });
  return { success:true, data: rows.map(function(r) {
    return { classId:r['Class ID'], className:r['Class Name'],
             year:r['Academic Year'], semester:r['Semester'], teacherEmail:r['Teacher Email'] };
  })};
}

function getRoster(p) {
  if (!p.classId) return { success:false, error:'Thiếu classId.' };
  var rows = readAll(T.STUDENTS).filter(function(r) {
    if (r['Archived'] === true || String(r['Archived']).toLowerCase() === 'true') return false;
    return String(r['Class']).toUpperCase() === String(p.classId).toUpperCase();
  });
  return { success:true, data: rows.map(function(r) {
    return { studentId:r['Student ID'], name:r['Name'], class:r['Class'], email:r['Email'] };
  })};
}

function archiveClass(p) {
  if (!p.classId) return { success:false, error:'Thiếu classId.' };
  var sh = sheet(T.CLASSES), idx = headerIndex(T.CLASSES);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Class ID']]) === String(p.classId)) {
      // auto-add Archived col if missing
      var arcIdx = idx['Archived'];
      if (arcIdx === undefined) {
        arcIdx = sh.getLastColumn();
        sh.getRange(1, arcIdx+1).setValue('Archived').setFontWeight('bold');
      }
      sh.getRange(i+1, arcIdx+1).setValue(true);
      return { success:true };
    }
  }
  return { success:false, error:'Không tìm thấy lớp.' };
}

function archiveStudent(p) {
  if (!p.studentId) return { success:false, error:'Thiếu studentId.' };
  var sh = sheet(T.STUDENTS), idx = headerIndex(T.STUDENTS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Student ID']]).trim() === String(p.studentId).trim()) {
      var arcIdx = idx['Archived'];
      if (arcIdx === undefined) {
        arcIdx = sh.getLastColumn();
        sh.getRange(1, arcIdx+1).setValue('Archived').setFontWeight('bold');
      }
      sh.getRange(i+1, arcIdx+1).setValue(true);
      return { success:true };
    }
  }
  return { success:false, error:'Không tìm thấy sinh viên.' };
}

function updateStudent(p) {
  if (!p.studentId) return { success:false, error:'Missing studentId.' };
  var sh = sheet(T.STUDENTS), idx = headerIndex(T.STUDENTS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Student ID']]).trim() === String(p.studentId).trim()) {
      if (p.name)  sh.getRange(i+1, idx['Name']+1).setValue(p.name);
      if (p.class) sh.getRange(i+1, idx['Class']+1).setValue(p.class.toUpperCase());
      if (p.email) sh.getRange(i+1, idx['Email']+1).setValue(p.email);
      if (p.phone) sh.getRange(i+1, idx['Phone']+1).setValue(p.phone);
      return { success:true };
    }
  }
  return { success:false, error:'Student not found.' };
}

// ── Assignments ────────────────────────────────────────────────
function assignCreate(p) {
  if (!p.classId || !p.title)
    return { success:false, error:'Missing classId or title.' };

  // Use client-pre-generated ID if provided (prevents double-insert from POST+JSONP)
  var id = p.assignmentId || uid('asgn_');

  // Dedup: if this ID already exists (POST arrived first), return it
  var existing = readAll(T.ASSIGN).filter(function(r){
    return String(r['Assignment ID']) === String(id);
  });
  if (existing.length > 0) {
    // Already saved by POST — update vocab if JSONP call has more data
    if (p.vocab && p.vocab.length > 0) {
      var sh = sheet(T.ASSIGN), idx2 = headerIndex(T.ASSIGN);
      var data = sh.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][idx2['Assignment ID']]) === String(id)) {
          var currentVocab = [];
          try { currentVocab = JSON.parse(data[i][idx2['Vocab List']] || '[]'); } catch(e) {}
          if (currentVocab.length === 0) {
            sh.getRange(i+1, idx2['Vocab List']+1).setValue(JSON.stringify(p.vocab));
          }
          break;
        }
      }
    }
    return { success:true, data:{ assignmentId:id } };
  }

  appendRowByHeader(T.ASSIGN, {
    'Assignment ID': id,
    'Mode':          p.mode || 'homework',
    'Class':         p.classId,
    'Title':         p.title,
    'Reading Passage': p.reading || '',
    'Vocab List':    JSON.stringify(p.vocab || []),
    'Deadline':      p.deadline || '',
    'Required Goals': (p.mode === 'homework') ? (p.requiredGoals || 3) : 0,
    'Session Start':        p.sessionStart        || '',
    'Session Duration Min': p.sessionDurationMin  || '',
    'Session End':          p.sessionEnd          || '',
    'Session Start':        p.sessionStart        || '',
    'Session Duration Min': p.sessionDurationMin  || '',
    'Session End':          p.sessionEnd          || '',
    'CreatedAt':     nowIso(),
    'Active':        'TRUE'
  });
  return { success:true, data:{ assignmentId:id } };
}

function assignUpdate(p) {
  if (!p.assignmentId) return { success:false, error:'Thiếu assignmentId.' };
  var sh = sheet(T.ASSIGN), idx = headerIndex(T.ASSIGN);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Assignment ID']]) === String(p.assignmentId)) {
      var updates = {};
      if (p.title     !== undefined) updates['Title']               = p.title;
      if (p.reading   !== undefined) updates['Reading Passage']     = p.reading;
      if (p.vocab     !== undefined) updates['Vocab List']          = JSON.stringify(p.vocab);
      if (p.mode      !== undefined) updates['Mode']                = p.mode;
      if (p.sessionStart       !== undefined) updates['Session Start']        = p.sessionStart;
      if (p.sessionDurationMin !== undefined) updates['Session Duration Min'] = p.sessionDurationMin;
      if (p.sessionEnd         !== undefined) updates['Session End']          = p.sessionEnd;
      if (p.deadline  !== undefined) updates['Deadline']        = p.deadline;
      if (p.active    !== undefined) updates['Active']          = p.active ? 'TRUE' : 'FALSE';
      if (p.requiredGoals !== undefined) updates['Required Goals'] = p.requiredGoals;
      Object.keys(updates).forEach(function(h) {
        var col = idx[h];
        if (col !== undefined) sh.getRange(i+1, col+1).setValue(updates[h]);
      });
      return { success:true };
    }
  }
  return { success:false, error:'Không tìm thấy assignment.' };
}

function assignDelete(p) {
  if (!p.assignmentId) return { success:false, error:'Thiếu assignmentId.' };
  var sh = sheet(T.ASSIGN), idx = headerIndex(T.ASSIGN);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Assignment ID']]) === String(p.assignmentId)) {
      var col = idx['Active'];
      if (col !== undefined) sh.getRange(i+1, col+1).setValue('FALSE');
      return { success:true };
    }
  }
  return { success:false, error:'Không tìm thấy assignment.' };
}

function assignAppendVocab(p) {
  if (!p.assignmentId) return { success:false, error:'Missing assignmentId.' };
  var sh = sheet(T.ASSIGN), idx = headerIndex(T.ASSIGN);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Assignment ID']]) === String(p.assignmentId)) {
      var vocabCol = idx['Vocab List'];
      var existing = [];
      if (!p.replace) {
        try { existing = JSON.parse(data[i][vocabCol] || '[]'); } catch(e) { existing = []; }
      }
      var merged = existing.concat(p.vocab || []);
      sh.getRange(i+1, vocabCol+1).setValue(JSON.stringify(merged));
      return { success:true };
    }
  }
  return { success:false, error:'Assignment not found.' };
}

function assignList(p) {
  // Teacher: list all assignments for a class (or all classes of teacher)
  var rows = readAll(T.ASSIGN).filter(function(r) {
    if (String(r['Active']).toUpperCase() === 'FALSE') return false;
    if (p.classId) return String(r['Class']) === String(p.classId);
    if (p.classIds && p.classIds.length) return p.classIds.indexOf(String(r['Class'])) > -1;
    return true;
  });
  return { success:true, data: rows.map(function(r) {
    var vocab = [];
    try { vocab = JSON.parse(r['Vocab List'] || '[]'); } catch(e) {}
    return {
      assignmentId: r['Assignment ID'], mode: r['Mode'],
      classId: r['Class'], title: r['Title'],
      reading: r['Reading Passage'],
      vocab: vocab,
      deadline: r['Deadline'], requiredGoals: r['Required Goals'],
      sessionStart: r['Session Start'] || '',
      sessionDurationMin: parseInt(r['Session Duration Min']||'0',10)||0,
      sessionEnd: r['Session End'] || '',
      createdAt: r['CreatedAt'], active: r['Active']
    };
  })};
}

function assignGet(p) {
  if (!p.assignmentId) return { success:false, error:'Thiếu assignmentId.' };
  var r = readAll(T.ASSIGN).filter(function(r) {
    return String(r['Assignment ID']) === String(p.assignmentId);
  })[0];
  if (!r) return { success:false, error:'Không tìm thấy assignment.' };
  var vocab = [];
  try { vocab = JSON.parse(r['Vocab List'] || '[]'); } catch(e) {}
  return { success:true, data:{
    assignmentId:       r['Assignment ID'],
    mode:               r['Mode'],
    classId:            r['Class'],
    title:              r['Title'],
    reading:            r['Reading Passage'],
    vocab:              vocab,
    deadline:           r['Deadline'],
    requiredGoals:      parseInt(r['Required Goals']||'3',10)||3,
    active:             r['Active'],
    createdAt:          r['CreatedAt'],
    sessionStart:       r['Session Start']            || '',
    sessionDurationMin: parseInt(r['Session Duration Min']||'0',10)||0,
    sessionEnd:         r['Session End']              || '',
  }};
}

function getSessionStatus(r) {
  if (String(r['Mode']) !== 'inclass') return null;
  var startStr = r['Session Start'];
  if (!startStr) return 'open'; // no window = always open
  var start = new Date(startStr);
  if (isNaN(start.getTime())) return 'open';
  var end;
  if (r['Session End']) {
    end = new Date(r['Session End']);
  } else {
    var dur = parseInt(r['Session Duration Min']||'0',10)||0;
    end = new Date(start.getTime() + dur * 60000);
  }
  if (isNaN(end.getTime())) return 'open';
  var now = new Date();
  if (now < start) return 'upcoming';
  if (now > end)   return 'closed';
  return 'open';
}

function assignForStudent(p) {
  // Student: list active homework/inclass for their class
  if (!p.classId) return { success:false, error:'Thiếu classId.' };
  var now = new Date();
  var rows = readAll(T.ASSIGN).filter(function(r) {
    if (String(r['Active']).toUpperCase() !== 'TRUE') return false;
    if (String(r['Class']) !== String(p.classId)) return false;
    if (p.mode && r['Mode'] !== p.mode) return false;
    // deadline filter: exclude if deadline passed (empty = always available)
    // For inclass: don't filter by Deadline (session window handled client-side via sessionStatus)
    if (r['Mode'] !== 'inclass') {
      var dl = r['Deadline'];
      if (dl && new Date(dl) < now) return false;
    }
    return true;
  });
  return { success:true, data: rows.map(function(r) {
    var vocab = [];
    try { vocab = JSON.parse(r['Vocab List'] || '[]'); } catch(e) {}
    return {
      assignmentId:       r['Assignment ID'],
      mode:               r['Mode'],
      title:              r['Title'],
      reading:            r['Reading Passage'],
      vocab:              vocab,
      deadline:           r['Deadline'],
      requiredGoals:      parseInt(r['Required Goals']||'3',10)||3,
      sessionStart:       r['Session Start']            || '',
      sessionDurationMin: parseInt(r['Session Duration Min']||'0',10)||0,
      sessionEnd:         r['Session End']              || '',
      sessionStatus:      getSessionStatus(r),
    };
  })};
}

// ── Results ────────────────────────────────────────────────────
function resultSave(p) {
  if (!p.studentId || !p.assignmentId)
    return { success:false, error:'Thiếu studentId hoặc assignmentId.' };
  var isPerfect = (p.score === 100 || p.score === '100') ? 'TRUE' : 'FALSE';
  appendRowByHeader(T.RESULTS, {
    'Timestamp':     nowIso(),
    'Student ID':    p.studentId,
    'Name':          p.name || '',
    'Class':         p.class || '',
    'Assignment ID': p.assignmentId,
    'Title':         p.title || '',
    'Mode':          p.mode || '',
    'Score':         p.score || 0,
    'Is Perfect':    isPerfect,
    'Duration Sec':  p.durationSec || 0,
    'Correct':       p.correct || 0,
    'Total':         p.total || 0,
  });
  return { success:true };
}

/*  resultGetForTeacher
    Supports:
      - p.classIds[]   — filter by one or more class IDs (teacher's classes)
      - p.since        — ISO date string, default = 14 days ago
      - p.full         — if true, ignore `since` and return all
      - p.assignmentId — optional: filter by specific assignment
*/
/*  resultGetForTeacher — server-side grouped + paginated
    p.classId      required: single classId to load (not all classes)
    p.assignmentId optional: filter to one assignment
    p.mode         optional: 'homework'|'inclass'
    p.days         optional: lookback days (default 14, 0 = all time)
    p.page         optional: 1-based page number (default 1)
    p.pageSize     optional: rows per page (default 30)
    p.groupBy      optional: 'student_assignment' (default) groups runs
                             'all' returns flat rows for detail expand

    Grouped mode returns one row per (studentId × assignmentId):
      bestScore, lastScore, attempts, perfectCount, lastTimestamp, runs[]
    Flat mode returns raw rows for a specific student+assignment combo.
*/
function resultGetForTeacher(p) {
  if (!p.classId) return { success:false, error:'classId required' };

  var days     = (p.days === 0 || p.days === '0') ? 0 : (parseInt(p.days,10) || 14);
  var cutoff   = days > 0 ? new Date(Date.now() - days * 86400000) : null;
  var pageSize = Math.min(parseInt(p.pageSize,10) || 30, 100);
  var page     = Math.max(1, parseInt(p.page,10) || 1);

  var allRows = readAll(T.RESULTS).filter(function(r) {
    if (String(r['Class']).trim() !== String(p.classId).trim()) return false;
    if (p.assignmentId && String(r['Assignment ID']) !== String(p.assignmentId)) return false;
    if (p.mode && r['Mode'] !== p.mode) return false;
    if (cutoff) {
      var ts = new Date(r['Timestamp']);
      if (isNaN(ts.getTime()) || ts < cutoff) return false;
    }
    return true;
  });

  // Flat mode: return raw rows for one student+assignment (for accordion expand)
  if (p.groupBy === 'all') {
    var flat = allRows
      .filter(function(r){
        return (!p.studentId || String(r['Student ID']).trim() === String(p.studentId).trim());
      })
      .sort(function(a,b){ return new Date(b['Timestamp'])-new Date(a['Timestamp']); })
      .slice(0, 20)  // max 20 runs per expand
      .map(function(r){
        return {
          timestamp:   r['Timestamp'],
          score:       r['Score'],
          isPerfect:   r['Is Perfect']==='TRUE'||r['Is Perfect']===true,
          durationSec: r['Duration Sec'],
          correct:     r['Correct'],
          total:       r['Total'],
          timedOut:    r['Timed Out']==='TRUE',
          absent:      r['Absent']==='TRUE',
          missedWords: (function(){ try{ return JSON.parse(r['Missed Words']||'[]'); }catch(e){ return []; } })(),
        };
      });
    return { success:true, data: flat };
  }

  // Grouped mode: one row per (studentId × assignmentId)
  var groups = {};
  allRows.forEach(function(r) {
    var key = String(r['Student ID']).trim() + '|' + String(r['Assignment ID']).trim();
    if (!groups[key]) {
      groups[key] = {
        studentId:    String(r['Student ID']).trim(),
        name:         r['Name'],
        class:        r['Class'],
        assignmentId: String(r['Assignment ID']).trim(),
        title:        r['Title'],
        mode:         r['Mode'],
        bestScore:    0,
        lastScore:    0,
        lastTimestamp:'',
        attempts:     0,
        perfectCount: 0,
      };
    }
    var g = groups[key];
    var sc = parseFloat(r['Score']) || 0;
    g.attempts++;
    if (sc > g.bestScore) g.bestScore = sc;
    if (!g.lastTimestamp || r['Timestamp'] > g.lastTimestamp) {
      g.lastTimestamp = r['Timestamp'];
      g.lastScore = sc;
    }
    if (r['Is Perfect']==='TRUE'||r['Is Perfect']===true) g.perfectCount++;
  });

  var grouped = Object.keys(groups).map(function(k){ return groups[k]; });
  grouped.sort(function(a,b){ return b.lastTimestamp.localeCompare(a.lastTimestamp); });

  var total     = grouped.length;
  var totalPages= Math.ceil(total / pageSize) || 1;
  var slice     = grouped.slice((page-1)*pageSize, page*pageSize);

  return {
    success: true,
    data: slice,
    meta: {
      total: total, page: page, pageSize: pageSize, totalPages: totalPages,
      days: days, classId: p.classId
    }
  };
}

/*  resultGetForStudent
    Returns all results for a given student, grouped by assignmentId
    so the student can see their attempt count and goal count per assignment.
*/
function resultGetForStudent(p) {
  if (!p.studentId) return { success:false, error:'Thiếu studentId.' };
  var rows = readAll(T.RESULTS).filter(function(r) {
    return String(r['Student ID']).trim() === String(p.studentId).trim();
  });
  return { success:true, data: rows.map(function(r) {
    return {
      timestamp:    r['Timestamp'],
      assignmentId: r['Assignment ID'],
      title:        r['Title'],
      mode:         r['Mode'],
      score:        r['Score'],
      isPerfect:    r['Is Perfect'] === 'TRUE' || r['Is Perfect'] === true,
      durationSec:  r['Duration Sec'],
      correct:      r['Correct'],
      total:        r['Total'],
      missedWords:  (function(){ try{ return JSON.parse(r['Missed Words']||'[]'); }catch(e){ return []; } })(),
      timedOut:     r['Timed Out']==='TRUE' || r['Timed Out']===true,
      absent:       r['Absent']==='TRUE'    || r['Absent']===true,
    };
  })};
}

/*  resultSummary
    Per-assignment aggregation: for each student, how many attempts total
    and how many perfect (score===100) runs?
    Used by the teacher Results tab to render the Attempts | Goals columns.
*/
function resultSummary(p) {
  if (!p.assignmentId) return { success:false, error:'Thiếu assignmentId.' };
  var rows = readAll(T.RESULTS).filter(function(r) {
    return String(r['Assignment ID']) === String(p.assignmentId);
  });

  var map = {};
  rows.forEach(function(r) {
    var sid = String(r['Student ID']).trim();
    if (!map[sid]) map[sid] = { studentId:sid, name:r['Name'], class:r['Class'], attempts:0, goals:0 };
    map[sid].attempts++;
    if (r['Is Perfect'] === 'TRUE' || r['Is Perfect'] === true) map[sid].goals++;
  });

  return { success:true, data: Object.values(map) };
}

// ── Vocabulary ─────────────────────────────────────────────────
function vocabList(p) {
  var rows = readAll(T.VOCAB).filter(function(r) { return r['Word'] && String(r['Word']).trim(); });
  return { success:true, data: rows.map(function(r) {
    var syns = String(r['Synonyms']||'').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    return {
      word:      String(r['Word']).trim(),
      ipa:       r['IPA'] || '',
      band:      r['Band'] || '',
      meaningVi: r['Meaning VI'] || '',
      synonyms:  syns,
      examples:  [r['Example 1']||'', r['Example 2']||''].filter(Boolean)
    };
  })};
}

function vocabToday(p) {
  var rows = readAll(T.VOCAB).filter(function(r) { return r['Word'] && String(r['Word']).trim(); });
  if (!rows.length) return { success:false, error:'No vocab.' };
  // Rotate daily by day-of-year index (stable within a day, changes at midnight)
  var dayIdx = Math.floor(Date.now() / 86400000);
  var forceIdx = (typeof p.index === 'number') ? p.index : 0;
  var idx = (dayIdx + forceIdx) % rows.length;
  var prevIdx = (idx - 1 + rows.length) % rows.length;

  function toWord(r) {
    var syns = String(r['Synonyms']||'').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    return { word:r['Word'], ipa:r['IPA']||'', band:r['Band']||'',
             meaningVi:r['Meaning VI']||'', synonyms:syns,
             examples:[r['Example 1']||'',r['Example 2']||''].filter(Boolean) };
  }
  return { success:true, data:{ current: toWord(rows[idx]), previous: toWord(rows[prevIdx]) } };
}

// ── ReadWise (student self-study) ──────────────────────────────
function readwiseSave(p) {
  if (!p.studentId || !p.title || !p.passage)
    return { success:false, error:'Missing required fields.' };
  var id = uid('rw_');
  appendRowByHeader(T.READWISE, {
    'Article ID':         id,
    'Title':              p.title,
    'Student ID':         p.studentId,
    'Student Name':       p.studentName || '',
    'Class':              p.class || '',
    'Passage':            p.passage,
    'Vocab JSON':         JSON.stringify(p.vocab || []),
    'Collocations JSON':  JSON.stringify(p.collocations || []),
    'Saved At':           nowIso()
  });
  return { success:true, data:{ articleId:id } };
}

function readwiseList(p) {
  if (!p.studentId) return { success:false, error:'Missing studentId.' };
  var rows = readAll(T.READWISE).filter(function(r) {
    return String(r['Student ID']).trim() === String(p.studentId).trim();
  });
  rows.sort(function(a,b){ return String(b['Saved At']).localeCompare(String(a['Saved At'])); });
  return { success:true, data: rows.map(function(r) {
    var wc = (r['Passage']||'').split(/\s+/).filter(Boolean).length;
    return {
      articleId:    r['Article ID'],
      title:        r['Title'],
      wordCount:    wc,
      readMin:      Math.ceil(wc/200),
      savedAt:      r['Saved At'],
      studentName:  r['Student Name'],
    };
  })};
}

function readwiseGet(p) {
  if (!p.articleId) return { success:false, error:'Missing articleId.' };
  var r = readAll(T.READWISE).filter(function(r) {
    return String(r['Article ID']) === String(p.articleId);
  })[0];
  if (!r) return { success:false, error:'Article not found.' };
  var vocab = [], collocs = [];
  try { vocab   = JSON.parse(r['Vocab JSON']   || '[]'); } catch(e) {}
  try { collocs = JSON.parse(r['Collocations JSON'] || '[]'); } catch(e) {}
  return { success:true, data:{
    articleId:    r['Article ID'],
    title:        r['Title'],
    passage:      r['Passage'],
    vocab:        vocab,
    collocations: collocs,
    savedAt:      r['Saved At'],
  }};
}

function readwiseDelete(p) {
  if (!p.articleId || !p.studentId) return { success:false, error:'Missing fields.' };
  var sh = sheet(T.READWISE), idx = headerIndex(T.READWISE);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Article ID']]) === String(p.articleId) &&
        String(data[i][idx['Student ID']]).trim() === String(p.studentId).trim()) {
      sh.deleteRow(i + 1);
      return { success:true };
    }
  }
  return { success:false, error:'Article not found.' };
}

// ── In-class result with missed words ──────────────────────────
function resultSaveInclass(p) {
  if (!p.studentId || !p.assignmentId)
    return { success:false, error:'Missing studentId or assignmentId.' };
  var isPerfect = (p.score === 100 || p.score === '100') ? 'TRUE' : 'FALSE';
  var missed = JSON.stringify(p.missedWords || []);
  appendRowByHeader(T.RESULTS, {
    'Timestamp':     nowIso(),
    'Student ID':    p.studentId,
    'Name':          p.name || '',
    'Class':         p.class || '',
    'Assignment ID': p.assignmentId,
    'Title':         p.title || '',
    'Mode':          'inclass',
    'Score':         p.score || 0,
    'Is Perfect':    isPerfect,
    'Duration Sec':  p.durationSec || 0,
    'Correct':       p.correct || 0,
    'Total':         p.total || 0,
    'Missed Words':  missed,
    'Timed Out':     p.timedOut ? 'TRUE' : 'FALSE',
    'Absent':        'FALSE',
  });
  return { success:true };
}

// Auto-record absences: teacher calls this after session ends
// marks all enrolled students who have no submission as Absent
// and assigns them all missed words from the class session
function absentPenalty(p) {
  if (!p.assignmentId || !p.classId)
    return { success:false, error:'Missing assignmentId or classId.' };

  // Collect all missed words from students who did submit
  var results = readAll(T.RESULTS).filter(function(r) {
    return String(r['Assignment ID']) === String(p.assignmentId) && r['Absent'] !== 'TRUE';
  });
  var allMissedSet = {};
  results.forEach(function(r) {
    var mw = [];
    try { mw = JSON.parse(r['Missed Words'] || '[]'); } catch(e) {}
    mw.forEach(function(w){ allMissedSet[w] = true; });
  });
  var allMissed = Object.keys(allMissedSet);

  // Find enrolled students
  var enrolled = readAll(T.STUDENTS).filter(function(r) {
    return String(r['Class']).toUpperCase() === String(p.classId).toUpperCase() &&
           r['Archived'] !== true && String(r['Archived']).toLowerCase() !== 'true';
  });
  var submitted = {};
  results.forEach(function(r){ submitted[String(r['Student ID']).trim()] = true; });

  var absent = enrolled.filter(function(r) {
    return !submitted[String(r['Student ID']).trim()];
  });

  absent.forEach(function(s) {
    appendRowByHeader(T.RESULTS, {
      'Timestamp':     nowIso(),
      'Student ID':    s['Student ID'],
      'Name':          s['Name'] || '',
      'Class':         s['Class'] || '',
      'Assignment ID': p.assignmentId,
      'Title':         p.title || '',
      'Mode':          'inclass',
      'Score':         0,
      'Is Perfect':    'FALSE',
      'Duration Sec':  0,
      'Correct':       0,
      'Total':         p.total || 0,
      'Missed Words':  JSON.stringify(allMissed),
      'Timed Out':     'FALSE',
      'Absent':        'TRUE',
    });
  });

  return { success:true, data:{ absentCount: absent.length, allMissedCount: allMissed.length } };
}

// ── resultMissedWords — lazy-load for teacher expand ──────────────
function resultMissedWords(p) {
  if (!p.assignmentId || !p.studentId) return { success:false, error:'Missing fields.' };
  var rows = readAll(T.RESULTS).filter(function(r){
    return String(r['Assignment ID']) === String(p.assignmentId) &&
           String(r['Student ID']).trim() === String(p.studentId).trim() &&
           String(r['Mode']) === 'inclass';
  }).sort(function(a,b){ return String(b['Timestamp']).localeCompare(String(a['Timestamp'])); });
  if (!rows.length) return { success:true, data:{ words:[], timedOut:false, absent:false, score:null } };
  var r = rows[0];
  var words = [];
  try { words = JSON.parse(r['Missed Words']||'[]'); } catch(e){}
  return { success:true, data:{
    words:     words,
    timedOut:  r['Timed Out']==='TRUE'||r['Timed Out']===true,
    absent:    r['Absent']==='TRUE'||r['Absent']===true,
    score:     r['Score'],
    timestamp: r['Timestamp'],
  }};
}

// ── Recheck (teacher manually marks penalty as reviewed) ────────
function recheckSave(p) {
  if (!p.assignmentId || !p.studentId || !p.teacherEmail)
    return { success:false, error:'Missing required fields.' };

  var rid = uid('rc_');
  // Upsert: if exists for same assign+student, update it
  var sh  = sheet(T.IC_RECHECK), idx = headerIndex(T.IC_RECHECK);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Assignment ID']]) === String(p.assignmentId) &&
        String(data[i][idx['Student ID']]).trim() === String(p.studentId).trim()) {
      sh.getRange(i+1, idx['Checked By']+1).setValue(p.teacherEmail);
      sh.getRange(i+1, idx['Checked At']+1).setValue(nowIso());
      sh.getRange(i+1, idx['Note']+1).setValue(p.note || '');
      return { success:true, data:{ recheckId: String(data[i][idx['Recheck ID']]) } };
    }
  }
  // Insert new
  appendRowByHeader(T.IC_RECHECK, {
    'Recheck ID':       rid,
    'Assignment ID':    p.assignmentId,
    'Assignment Title': p.title || '',
    'Student ID':       p.studentId,
    'Student Name':     p.studentName || '',
    'Class':            p.class || '',
    'Missed Words':     p.missedWords || '',
    'Penalty Type':     p.penaltyType || 'wrong',
    'Checked By':       p.teacherEmail,
    'Checked At':       nowIso(),
    'Note':             p.note || '',
  });
  return { success:true, data:{ recheckId: rid } };
}

function recheckList(p) {
  if (!p.assignmentId) return { success:false, error:'Missing assignmentId.' };
  var rows = readAll(T.IC_RECHECK).filter(function(r) {
    return String(r['Assignment ID']) === String(p.assignmentId);
  });
  var map = {};
  rows.forEach(function(r) {
    map[String(r['Student ID']).trim()] = {
      studentId:   r['Student ID'],
      checkedBy:   r['Checked By'],
      checkedAt:   r['Checked At'],
      penaltyType: r['Penalty Type'],
      note:        r['Note'],
    };
  });
  return { success:true, data: map };
}

function changePasswordTeacher(p) {
  if (!p.email || !p.oldPass || !p.newPass)
    return { success:false, error:'Missing fields.' };
  var sh = sheet(T.TEACHERS), idx = headerIndex(T.TEACHERS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Email']]).toLowerCase().trim() === String(p.email).toLowerCase().trim()) {
      if (!samePassword(data[i][idx['Password']], p.oldPass))
        return { success:false, error:'Mật khẩu hiện tại không đúng.' };
      sh.getRange(i+1, idx['Password']+1).setValue(hashPassword(p.newPass));
      return { success:true };
    }
  }
  return { success:false, error:'Teacher not found.' };
}

// ── Translate ──────────────────────────────────────────────────
function translateCreate(p) {
  if (!p.classId || !p.title || !p.sessionStart)
    return { success:false, error:'Missing classId, title, or sessionStart.' };
  if (!p.items || p.items.length < 1)
    return { success:false, error:'items array required.' };

  var id = p.setId || uid('tr_');
  // Dedup: if pre-generated setId already exists, return it
  var existing = readAll(T.TR_SETS).filter(function(r){
    return String(r['Set ID']) === String(id);
  });
  if (existing.length > 0) return { success:true, data:{ setId:id } };

  appendRowByHeader(T.TR_SETS, {
    'Set ID':               id,
    'Source Assignment ID': p.sourceAssignmentId || '',
    'Class':                p.classId,
    'Title':                p.title,
    'Items JSON':           JSON.stringify(p.items || []),
    'Pass Score':           p.passScore || 85,
    'Session Start':        p.sessionStart,
    'Deadline':             p.deadline || '',
    'Created At':           nowIso(),
    'Active':               'TRUE',
    'Teacher Email':        p.teacherEmail || '',
  });
  return { success:true, data:{ setId:id } };
}

function translateUpdate(p) {
  if (!p.setId) return { success:false, error:'Missing setId.' };
  var sh = sheet(T.TR_SETS), idx = headerIndex(T.TR_SETS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx['Set ID']]) === String(p.setId)) {
      var fields = {
        'Title':        p.title,
        'Pass Score':   p.passScore,
        'Session Start':p.sessionStart,
        'Deadline':     p.deadline,
        'Active':       p.active !== undefined ? (p.active ? 'TRUE' : 'FALSE') : undefined,
      };
      Object.keys(fields).forEach(function(k) {
        if (fields[k] !== undefined) sh.getRange(i+1, idx[k]+1).setValue(fields[k]);
      });
      return { success:true };
    }
  }
  return { success:false, error:'Set not found.' };
}

function _trSessionStatus(r) {
  var start = r['Session Start'] ? new Date(r['Session Start']) : null;
  var dl    = r['Deadline']      ? new Date(r['Deadline'])      : null;
  var now   = new Date();
  if (!start || isNaN(start.getTime())) return 'open';
  if (now < start) return 'upcoming';
  if (dl && !isNaN(dl.getTime()) && now > dl) return 'closed';
  return 'open';
}

function translateList(p) {
  // Teacher: list all sets for their classes
  var rows = readAll(T.TR_SETS).filter(function(r) {
    if (p.classId  && String(r['Class'])         !== String(p.classId))  return false;
    if (p.classIds && p.classIds.indexOf(String(r['Class'])) < 0)        return false;
    if (p.teacherEmail && r['Teacher Email'] && r['Teacher Email'] !== p.teacherEmail) return false;
    return true;
  });
  rows.sort(function(a,b){ return String(b['Created At']).localeCompare(String(a['Created At'])); });
  return { success:true, data: rows.map(function(r) {
    return {
      setId:              r['Set ID'],
      sourceAssignmentId: r['Source Assignment ID'],
      classId:            r['Class'],
      title:              r['Title'],
      passScore:          parseInt(r['Pass Score'],10)||85,
      sessionStart:       r['Session Start'],
      deadline:           r['Deadline'],
      createdAt:          r['Created At'],
      active:             r['Active'],
      itemCount:          (function(){ try{ return JSON.parse(r['Items JSON']||'[]').length; } catch(e){ return 0; } })(),
    };
  })};
}

function translateForStudent(p) {
  if (!p.classId) return { success:false, error:'Missing classId.' };
  var rows = readAll(T.TR_SETS).filter(function(r) {
    if (String(r['Active']).toUpperCase() !== 'TRUE') return false;
    if (String(r['Class']).trim() !== String(p.classId).trim()) return false;
    return true;
  });
  return { success:true, data: rows.map(function(r) {
    return {
      setId:              r['Set ID'],
      sourceAssignmentId: r['Source Assignment ID'],
      title:              r['Title'],
      passScore:          parseInt(r['Pass Score'],10)||85,
      sessionStart:       r['Session Start'],
      deadline:           r['Deadline'],
      itemCount:          30,
      sessionStatus:      _trSessionStatus(r),
      // No items in list — too heavy
    };
  })};
}

function translateGet(p) {
  if (!p.setId) return { success:false, error:'Missing setId.' };
  var r = readAll(T.TR_SETS).filter(function(r){
    return String(r['Set ID']) === String(p.setId);
  })[0];
  if (!r) return { success:false, error:'Set not found.' };
  var items = [];
  try { items = JSON.parse(r['Items JSON'] || '[]'); } catch(e) {}
  return { success:true, data:{
    setId:       r['Set ID'],
    title:       r['Title'],
    passScore:   parseInt(r['Pass Score'],10)||85,
    sessionStart:r['Session Start'],
    deadline:    r['Deadline'],
    classId:     r['Class'],
    items:       items,
    sessionStatus: _trSessionStatus(r),
  }};
}

function translateSaveResult(p) {
  if (!p.studentId || !p.setId)
    return { success:false, error:'Missing studentId or setId.' };
  appendRowByHeader(T.TR_RESULTS, {
    'Timestamp':            nowIso(),
    'Student ID':           p.studentId,
    'Name':                 p.name || '',
    'Class':                p.class || '',
    'Set ID':               p.setId,
    'Title':                p.title || '',
    'Run Index':            p.runIndex || 1,
    'Score':                p.score || 0,
    'Passed':               p.passed ? 'TRUE' : 'FALSE',
    'Duration Sec':         p.durationSec || 0,
    'Item Scores JSON':     JSON.stringify(p.itemScores || []),
    'Cleared Item IDs JSON':JSON.stringify(p.clearedItemIds || []),
    'Chest JSON':           JSON.stringify(p.chest || []),
  });
  return { success:true };
}

function translateStats(p) {
  if (!p.setId) return { success:false, error:'Missing setId.' };
  var rows = readAll(T.TR_RESULTS).filter(function(r){
    return String(r['Set ID']) === String(p.setId);
  });

  var students = {};
  rows.forEach(function(r) {
    var sid = String(r['Student ID']).trim();
    if (!students[sid]) students[sid] = {
      studentId: sid, name: r['Name'],
      runs:0, bestScore:0, lastScore:0, clearedCount:0, lastTimestamp:''
    };
    var s = students[sid];
    s.runs++;
    var sc = parseFloat(r['Score'])||0;
    if (sc > s.bestScore) s.bestScore = sc;
    if (!s.lastTimestamp || r['Timestamp'] > s.lastTimestamp) {
      s.lastTimestamp = r['Timestamp'];
      s.lastScore = sc;
    }
    var cleared = [];
    try { cleared = JSON.parse(r['Cleared Item IDs JSON']||'[]'); } catch(e) {}
    if (cleared.length > s.clearedCount) s.clearedCount = cleared.length;
  });

  var stArr = Object.keys(students).map(function(k){ return students[k]; });
  var totalScore = rows.reduce(function(acc,r){ return acc+(parseFloat(r['Score'])||0); },0);

  return { success:true, data:{
    studentCount: stArr.length,
    runsCount:    rows.length,
    avgScore:     rows.length ? Math.round(totalScore/rows.length) : 0,
    avgCleared:   stArr.length ? Math.round(stArr.reduce(function(a,s){return a+s.clearedCount;},0)/stArr.length) : 0,
    students:     stArr.sort(function(a,b){ return b.lastTimestamp.localeCompare(a.lastTimestamp); }),
  }};
}

function translateMyProgress(p) {
  if (!p.studentId || !p.setId) return { success:false, error:'Missing fields.' };
  var rows = readAll(T.TR_RESULTS).filter(function(r){
    return String(r['Set ID']) === String(p.setId) &&
           String(r['Student ID']).trim() === String(p.studentId).trim();
  });
  rows.sort(function(a,b){ return String(a['Timestamp']).localeCompare(String(b['Timestamp'])); });

  var clearedSet = {};
  var bestScore = 0, lastScore = 0;
  rows.forEach(function(r) {
    var sc = parseFloat(r['Score'])||0;
    if (sc > bestScore) bestScore = sc;
    lastScore = sc;
    var cleared = [];
    try { cleared = JSON.parse(r['Cleared Item IDs JSON']||'[]'); } catch(e){}
    cleared.forEach(function(id){ clearedSet[id]=true; });
  });

  return { success:true, data:{
    runs:           rows.length,
    clearedItemIds: Object.keys(clearedSet),
    bestScore:      bestScore,
    lastScore:      lastScore,
    nextRunIndex:   rows.length + 1,
  }};
}

// ── Admin ──────────────────────────────────────────────────────
function resetTab(p) {
  if (!p.tab) return { success:false, error:'Thiếu tab name.' };
  var book = ss();
  var sh   = book.getSheetByName(p.tab);
  if (sh) book.deleteSheet(sh);
  sheet(p.tab);  // re-create with correct headers
  return { success:true, data:'Reset ' + p.tab };
}
