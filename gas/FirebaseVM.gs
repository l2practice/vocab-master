/*───────────────────────────────────────────────────────────────
  VocabMaster — Firebase edition, Apps Script side (FirebaseVM.gs)
  Thêm làm 1 file script MỚI trong cùng project với Code.gs (không sửa gì khác ngoài 1 dòng ở dispatch).

  Dữ liệu nằm trong Firestore, trình duyệt đọc/ghi thẳng (vm-fbdata.js).
  File này chỉ giữ những việc cần quyền quản trị:
    • tài khoản: SV / GV đăng ký, quên mật khẩu (gửi mật khẩu mới qua email)
    • chuyển dữ liệu 1 lần Google Sheet → Firebase (chạy từ editor, theo bước)

  Làm việc với Firebase bằng tài khoản Google sở hữu script này → tài khoản đó
  phải là Owner của Firebase project (tạo project bằng chính tài khoản này).

  1 DÒNG cần thêm vào dispatch() của Code.gs (trước `default:`):
      case 'fb.register': case 'fb.registerTeacher': case 'fb.forgotPassword': return fbRoute(action, p);

  CÁC BƯỚC CHUYỂN (chạy lần lượt trong editor; bước nào hết giờ thì chạy lại):
    vmfb_0_TestConnection   → kiểm tra kết nối Firestore + Auth + Sheet + Mail
    vmfb_1_IndexExemptions  → tắt chỉ mục cho các cột chữ dài. Đợi vài phút.
    vmfb_2_Teachers         → tài khoản GV (giữ email + mật khẩu cũ)
    vmfb_3_Classes          → lớp
    vmfb_4_Students         → tài khoản SV (giữ mã SV + mật khẩu cũ)
    vmfb_5_Assignments      → bài tập (tên có HW_/IC_, gộp các bài bị nhân đôi/0 từ)
    vmfb_6_Results          → kết quả HW + In-class
    vmfb_7_Rechecks         → dấu re-check của In-class
    vmfb_8_Translate        → bài Luyện Dịch + kết quả
    vmfb_9_ReadWise         → bài đọc tự học của SV
    vmfb_91_VocabBank       → danh sách "Today's word"
  Google Sheet KHÔNG bị sửa: giữ làm bản sao lưu.
───────────────────────────────────────────────────────────────*/

var VMFB = {
  // Firebase console → Project settings → General
  PROJECT_ID: 'vocabmaster-3a0dd',
  API_KEY:    'AIzaSyAhoWEygnchnXPf1BaG2T6ZvpV0VY7oeeY',
  // Phải khớp VM_FIREBASE.studentDomain trong vm-common.js
  STUDENT_DOMAIN: 'students.vocabmaster.app',
  // Lớp trong Sheet không có email GV → gán cho GV này ('' = GV đầu tiên trong tab Teachers)
  DEFAULT_TEACHER_EMAIL: '',
  APP_URL: 'https://l2practice.github.io/vocab-master/login.html'
};

// ── ROUTER (gọi từ dispatch trong Code.gs cho các action 'fb.*') ──
function fbRoute(action, p) {
  try {
    if (!VMFB.PROJECT_ID) return { success: false, error: 'Firebase chưa được cấu hình (VMFB.PROJECT_ID).' };
    if (action === 'fb.register')        return vmfbRegister(p || {});
    if (action === 'fb.registerTeacher') return vmfbRegisterTeacher(p || {});
    if (action === 'fb.forgotPassword')  return vmfbForgotPassword(p || {});
    return { success: false, error: 'Unknown action: ' + action };
  } catch (e) { return { success: false, error: e.message }; }
}

// ════════════════════════════════════════════════════════════
// FIRESTORE (REST, bằng tài khoản chủ script — không bị rules giới hạn)
// ════════════════════════════════════════════════════════════
function fsBase() { return 'https://firestore.googleapis.com/v1/projects/' + VMFB.PROJECT_ID + '/databases/(default)/documents'; }
function fsName(path) { return 'projects/' + VMFB.PROJECT_ID + '/databases/(default)/documents/' + path; }
function gapi(method, url, payload) {
  var opt = { method: method, muteHttpExceptions: true, contentType: 'application/json',
              headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': VMFB.PROJECT_ID } };
  if (payload !== undefined) opt.payload = JSON.stringify(payload);
  var r = UrlFetchApp.fetch(url, opt), code = r.getResponseCode(), text = r.getContentText();
  var json = text ? JSON.parse(text) : {};
  if (code >= 300) {
    var msg = (json.error && (json.error.message || json.error.status)) || ('HTTP ' + code);
    var err = new Error(msg); err.code = code; throw err;
  }
  return json;
}
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v });
  if (v instanceof Date) return { stringValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(o) { var f = {}; Object.keys(o).forEach(function (k) { if (o[k] !== undefined) f[k] = toFs(o[k]); }); return f; }
function fromFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = fromFs(f[k]); }); return o; }
function docOf(d) { var o = fromFields(d.fields); o._id = d.name.split('/').pop(); return o; }
function fsGet(path) {
  try { return docOf(gapi('get', fsBase() + '/' + path)); }
  catch (e) { if (e.code === 404) return null; throw e; }
}
// where: [[field, op, value], ...]  op: EQUAL | LESS_THAN | ...
function fsQuery(col, where, limit) {
  var q = { from: [{ collectionId: col }] };
  if (where && where.length) {
    var filters = where.map(function (w) { return { fieldFilter: { field: { fieldPath: w[0] }, op: w[1], value: toFs(w[2]) } }; });
    q.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters: filters } };
  }
  if (limit) q.limit = limit;
  var r = gapi('post', fsBase() + ':runQuery', { structuredQuery: q });
  return r.filter(function (x) { return x.document; }).map(function (x) { return docOf(x.document); });
}
function wSet(path, data) { return { update: { name: fsName(path), fields: toFields(data) } }; }
// Tên trường trong đường dẫn: bọc `…` khi không phải định danh thường (vd. mã bài bắt đầu bằng số)
function fp(seg) { return /^[A-Za-z_][A-Za-z_0-9]*$/.test(seg) ? seg : '`' + String(seg).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'; }
// Ghi GỘP: chỉ thay các trường liệt kê, giữ nguyên phần còn lại của tài liệu
function wMerge(path, data, maskPaths) {
  return { update: { name: fsName(path), fields: toFields(data) }, updateMask: { fieldPaths: maskPaths || Object.keys(data).map(fp) } };
}
// Những tài liệu (trong 1 collection) đã tồn tại — đọc theo lô 100
function fsExistingIds(col, ids) {
  var found = {};
  for (var i = 0; i < ids.length; i += 100) {
    var r = gapi('post', fsBase() + ':batchGet', { documents: ids.slice(i, i + 100).map(function (id) { return fsName(col + '/' + id); }), mask: { fieldPaths: ['uid'] } });
    r.forEach(function (x) { if (x.found) found[x.found.name.split('/').pop()] = true; });
  }
  return found;
}
// Tối đa 500 lệnh và ~10 MB mỗi lần commit: chia theo dung lượng (1 MB) và số lượng.
function fsCommit(writes) {
  var batch = [], size = 0, LIMIT = 1024 * 1024;
  function send() { if (batch.length) gapi('post', fsBase() + ':commit', { writes: batch }); batch = []; size = 0; }
  writes.forEach(function (w) {
    var s = JSON.stringify(w).length;
    if (batch.length && (size + s > LIMIT || batch.length >= 400)) send();
    batch.push(w); size += s;
  });
  send();
}

// ════════════════════════════════════════════════════════════
// FIREBASE AUTH (quản trị, bằng tài khoản chủ script)
// ════════════════════════════════════════════════════════════
function itk(path) { return 'https://identitytoolkit.googleapis.com/v1/projects/' + VMFB.PROJECT_ID + path; }
// Firebase không nhận mật khẩu dưới 6 ký tự. Đệm y hệt vm-fbdata.js.
function vmfbPw(p) { p = String(p == null ? '' : p).trim(); return p.length >= 6 ? p : (p + '______').slice(0, 6); }
function vmfbLoginEmailFor(studentId) { return String(studentId).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_') + '@' + VMFB.STUDENT_DOMAIN; }
function vmfbSha256(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
// Mã cố định: cùng 1 người luôn ra cùng 1 uid (chạy chuyển dữ liệu lại cũng an toàn).
function vmfbUidForStudent(studentId) { return 's' + vmfbSha256('sid:' + String(studentId).trim()).slice(0, 27); }
function vmfbUidForTeacher(email)     { return 't' + vmfbSha256('teacher:' + vmfbLow(email)).slice(0, 27); }
function vmfbLow(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
function vmfbStr(v) { return String(v == null ? '' : v).trim(); }
function vmfbIso(v) { return v instanceof Date ? v.toISOString() : vmfbStr(v); }
function vmfbHas(v) { return v !== '' && v != null; }

function vmfbAuthCreate(uid, email, password) {
  return gapi('post', itk('/accounts'), { localId: uid, email: email, password: vmfbPw(password), emailVerified: false });
}
// claims nằm trong token đăng nhập: role ('teacher'|'student') cho firestore.rules
function vmfbAuthUpdate(uid, fields) {
  var body = { localId: uid };
  if (fields.email) body.email = fields.email;
  if (fields.password) body.password = vmfbPw(fields.password);
  if (fields.role) body.customAttributes = JSON.stringify({ role: fields.role });
  return gapi('post', itk('/accounts:update'), body);
}
function vmfbAuthLookupEmail(email) {
  try { return (gapi('post', itk('/accounts:lookup'), { email: [email] }).users || [])[0] || null; }
  catch (e) { return null; }
}
function vmfbRandomPassword() {
  var c = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
  for (var i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}


// ════════════════════════════════════════════════════════════
// TÀI KHOẢN
// ════════════════════════════════════════════════════════════
function vmfbRegister(p) {
  var classId = vmfbStr(p.classId).toUpperCase();
  if (!classId) return { success: false, error: 'Cần nhập mã lớp — hỏi giảng viên.' };
  if (!vmfbStr(p.studentId) || !p.password || !vmfbStr(p.fullName)) return { success: false, error: 'Nhập đủ họ tên, mã SV và mật khẩu.' };
  var cls = fsGet('classes/' + classId);
  if (!cls) return { success: false, error: 'Mã lớp "' + classId + '" không tồn tại. Kiểm tra lại với giảng viên.' };
  if (cls.status === 'Archived') return { success: false, error: 'Lớp "' + (cls.className || classId) + '" hiện không mở đăng ký.' };

  var sid = vmfbStr(p.studentId), email = vmfbLow(p.email), uid = vmfbUidForStudent(sid);
  if (fsGet('users/' + uid)) return { success: false, error: 'Student ID đã được đăng ký.' };
  if (email && fsGet('loginIndex/' + vmfbSha256(email))) return { success: false, error: 'Email đã được đăng ký.' };
  try { vmfbAuthCreate(uid, vmfbLoginEmailFor(sid), p.password); }
  catch (e) { if (/EXISTS|DUPLICATE/.test(e.message)) return { success: false, error: 'Student ID đã được đăng ký.' }; throw e; }
  vmfbAuthUpdate(uid, { role: 'student' });
  var writes = [wSet('users/' + uid, { role: 'student', studentId: sid, fullName: vmfbStr(p.fullName), classId: classId,
    teacherUid: cls.teacherUid || '', email: email, phone: vmfbStr(p.phone), birthdate: vmfbStr(p.birthdate),
    archived: false, createdAt: new Date().toISOString() })];
  if (email) writes.push(wSet('loginIndex/' + vmfbSha256(email), { sid: sid }));
  fsCommit(writes);
  return { success: true, message: 'Chào mừng vào lớp ' + (cls.className || classId) + '! Đăng nhập ngay.' };
}

// Đăng ký GV tự do (như bản Sheet); khoá tài khoản lạ bằng cách đặt archived = true trong users.
function vmfbRegisterTeacher(p) {
  var email = vmfbLow(p.email);
  if (!email || !p.password || !vmfbStr(p.fullName)) return { success: false, error: 'Nhập đủ họ tên, email, mật khẩu.' };
  if (vmfbAuthLookupEmail(email)) return { success: false, error: 'Email đã tồn tại.' };
  var uid = vmfbUidForTeacher(email);
  vmfbAuthCreate(uid, email, p.password);
  vmfbAuthUpdate(uid, { role: 'teacher' });
  fsCommit([wSet('users/' + uid, { role: 'teacher', fullName: vmfbStr(p.fullName), email: email, phone: vmfbStr(p.phone),
    birthdate: vmfbStr(p.birthdate), archived: false, createdAt: new Date().toISOString() })]);
  return { success: true, message: 'Tạo tài khoản GV thành công.' };
}

// Mật khẩu Firebase được mã hoá, không đọc lại được → đặt mật khẩu MỚI và gửi qua email.
function vmfbForgotPassword(p) {
  var email = vmfbLow(p.email);
  if (!email) return { success: false, error: 'Nhập email đã đăng ký.' };
  var uid = '', name = '', sid = '';
  var idx = fsGet('loginIndex/' + vmfbSha256(email));
  if (idx && idx.multi) return { success: false, error: 'Email này gắn với nhiều tài khoản. Liên hệ giảng viên để đặt lại mật khẩu.' };
  if (idx) {
    sid = idx.sid; uid = vmfbUidForStudent(sid);
    var u = fsGet('users/' + uid); name = u ? u.fullName : '';
  } else {
    var t = vmfbAuthLookupEmail(email);
    if (t) { uid = t.localId; var tu = fsGet('users/' + uid); name = tu ? tu.fullName : ''; }
  }
  if (!uid) return { success: false, error: 'Không tìm thấy tài khoản với email này.' };
  var pw = vmfbRandomPassword();
  vmfbAuthUpdate(uid, { password: pw });
  try {
    MailApp.sendEmail({
      to: email, name: 'VocabMaster', subject: '[VocabMaster] Mật khẩu mới',
      body: 'Xin chào ' + (name || '') + ',\n\nMật khẩu mới của bạn: ' + pw + '\n' +
            (sid ? 'Student ID: ' + sid + '\n' : '') + '\nĐăng nhập tại: ' + VMFB.APP_URL + '\nVui lòng đổi mật khẩu sau khi đăng nhập.\n\n— VocabMaster'
    });
  } catch (err) { return { success: false, error: 'Không gửi được email: ' + err.message }; }
  return { success: true, newPasswordSent: true };
}

// ════════════════════════════════════════════════════════════
// CHUYỂN DỮ LIỆU 1 LẦN  Google Sheet → Firebase
// Chạy từ editor, theo thứ tự. Bước nào cũng chạy lại được (không ghi đè dữ liệu đã có trên Firebase);
// bước nào hết giờ thì tự dừng gọn — chạy lại để làm tiếp. Google Sheet không bị sửa.
// Dùng lại readAll() và T.* của Code.gs.
// ════════════════════════════════════════════════════════════
function vmfbLog(s) { Logger.log(s); return s; }
function vmfbCursor(key, v) {
  var P = PropertiesService.getScriptProperties();
  if (v === undefined) return parseInt(P.getProperty('vmfb_' + key) || '0', 10);
  P.setProperty('vmfb_' + key, String(v));
}
function vmfbTrue(v) { return v === true || String(v).toLowerCase() === 'true'; }
function vmfbJson(v, fb) { try { return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
function vmfbNum(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// Tên bài luôn có tiền tố HW_ / IC_ (giống VM.prefixTitle ở vm-common.js)
function vmfbPrefix(title, mode) {
  var t = vmfbStr(title).replace(/^(?:HW|IC)(?:\s*[_\-:.]\s*|\s+)/i, '');
  return (mode === 'inclass' ? 'IC_' : 'HW_') + t;
}

function vmfb_0_TestConnection() {
  var r = [];
  if (!VMFB.PROJECT_ID) return vmfbLog('Điền VMFB.PROJECT_ID và VMFB.API_KEY ở đầu file trước.');
  try { fsQuery('classes', [], 1); r.push('Firestore (admin)   OK'); } catch (e) { r.push('Firestore (admin)   LỖI: ' + e.message); }
  try { gapi('post', itk('/accounts:lookup'), { email: ['nobody@' + VMFB.STUDENT_DOMAIN] }); r.push('Firebase Auth admin OK'); }
  catch (e) { r.push('Firebase Auth admin LỖI: ' + e.message); }
  try { ss().getName(); r.push('Google Sheet        OK'); } catch (e) { r.push('Google Sheet        LỖI: ' + e.message); }
  try { MailApp.getRemainingDailyQuota(); r.push('Mail                OK'); } catch (e) { r.push('Mail                LỖI: ' + e.message); }
  return vmfbLog(r.join('\n'));
}

// Bước 1 — các cột chữ dài không bao giờ được tìm kiếm: tắt chỉ mục (lưu nhanh hơn, không chạm giới hạn chỉ mục).
function vmfb_1_IndexExemptions() {
  var fields = [['assignments', 'vocabJson'], ['assignments', 'reading'], ['assignments', 'ext'],
                ['results', 'runs'], ['trSets', 'itemsJson'], ['trProgress', 'runs'], ['trProgress', 'clearedIds'],
                ['trProgress', 'lastItemScores'], ['trProgress', 'lastChest'],
                ['readwise', 'passage'], ['readwise', 'vocabJson'], ['readwise', 'collocJson'], ['vocabBank', 'words']];
  var out = [];
  fields.forEach(function (f) {
    var url = 'https://firestore.googleapis.com/v1/projects/' + VMFB.PROJECT_ID +
      '/databases/(default)/collectionGroups/' + f[0] + '/fields/' + f[1] + '?updateMask=indexConfig';
    try { gapi('patch', url, { indexConfig: { indexes: [] } }); out.push(f.join('.') + '  đã yêu cầu'); }
    catch (e) { out.push(f.join('.') + '  LỖI: ' + e.message); }
  });
  return vmfbLog(out.join('\n'));
}

function vmfbTeachers_() { return readAll(T.TEACHERS).filter(function (u) { return vmfbLow(u['Email']); }); }
function vmfbDefaultTeacher_() {
  var t = vmfbTeachers_();
  return vmfbLow(VMFB.DEFAULT_TEACHER_EMAIL) || (t[0] ? vmfbLow(t[0]['Email']) : '');
}
// classId → { uid, name, email }
function vmfbClassOwners_() {
  var def = vmfbDefaultTeacher_(), owner = {};
  readAll(T.CLASSES).forEach(function (c) {
    var id = vmfbStr(c['Class ID']).toUpperCase(); if (!id) return;
    var em = vmfbLow(c['Teacher Email']) || def;
    owner[id] = { uid: vmfbUidForTeacher(em), name: vmfbStr(c['Class Name']) || id, email: em };
  });
  return owner;
}
// studentId → { uid, classId, name, teacherUid }
function vmfbStudentMap_(owner) {
  var m = {};
  readAll(T.STUDENTS).forEach(function (s) {
    var sid = vmfbStr(s['Student ID']); if (!sid) return;
    var classId = vmfbStr(s['Class']).toUpperCase();
    m[sid] = { uid: vmfbUidForStudent(sid), classId: classId, name: vmfbStr(s['Name']), teacherUid: owner[classId] ? owner[classId].uid : '' };
  });
  return m;
}

// Bước 2 — GV: giữ nguyên email + mật khẩu cũ.
function vmfb_2_Teachers() {
  var made = 0, writes = [];
  vmfbTeachers_().forEach(function (t) {
    var email = vmfbLow(t['Email']), uid = vmfbUidForTeacher(email);
    try { vmfbAuthCreate(uid, email, String(t['Password'] == null ? '' : t['Password'])); made++; }
    catch (e) { if (!/EXISTS|DUPLICATE/.test(e.message)) throw e; }
    vmfbAuthUpdate(uid, { role: 'teacher' });
    writes.push(wSet('users/' + uid, { role: 'teacher', fullName: vmfbStr(t['Name']), email: email, phone: vmfbStr(t['Phone']),
      birthdate: vmfbStr(t['Birthdate']), archived: false, createdAt: vmfbIso(t['CreatedAt']) }));
  });
  fsCommit(writes);
  return vmfbLog('Tài khoản GV mới tạo: ' + made + ', hồ sơ đã ghi: ' + writes.length);
}

// Bước 3 — lớp. Lớp không có email GV → GV mặc định.
function vmfb_3_Classes() {
  var def = vmfbDefaultTeacher_(), writes = [], orphan = 0, names = {};
  vmfbTeachers_().forEach(function (t) { names[vmfbLow(t['Email'])] = vmfbStr(t['Name']); });
  readAll(T.CLASSES).forEach(function (c) {
    var id = vmfbStr(c['Class ID']).toUpperCase(); if (!id) return;
    var email = vmfbLow(c['Teacher Email']) || def;
    if (!vmfbLow(c['Teacher Email'])) orphan++;
    writes.push(wSet('classes/' + id, { classId: id, className: vmfbStr(c['Class Name']) || id, academicYear: vmfbStr(c['Academic Year']),
      semester: vmfbStr(c['Semester']), teacherUid: vmfbUidForTeacher(email), teacherName: names[email] || '', teacherEmail: email,
      status: vmfbTrue(c['Archived']) ? 'Archived' : 'Active', createdAt: vmfbIso(c['CreatedAt']) }));
  });
  fsCommit(writes);
  return vmfbLog('Lớp: ' + writes.length + (orphan ? ' (' + orphan + ' lớp không có email GV → ' + def + ')' : ''));
}

// Bước 4 — SV: giữ nguyên Student ID / email và CÙNG mật khẩu cũ.
function vmfb_4_Students() {
  var t0 = Date.now(), owner = vmfbClassOwners_();
  var rows = readAll(T.STUDENTS).filter(function (u) { return vmfbStr(u['Student ID']); });
  var start = vmfbCursor('stu'), made = 0, skipped = 0;
  for (var i = start; i < rows.length; i++) {
    if (Date.now() - t0 > 4.5 * 60000) { vmfbCursor('stu', i); return vmfbLog('Tạm dừng ở SV ' + i + '/' + rows.length + ' — chạy lại vmfb_4_Students để làm tiếp.'); }
    var sid = vmfbStr(rows[i]['Student ID']), uid = vmfbUidForStudent(sid);
    var pw = rows[i]['Password'] == null || rows[i]['Password'] === '' ? sid : String(rows[i]['Password']);
    try { vmfbAuthCreate(uid, vmfbLoginEmailFor(sid), pw); made++; }
    catch (e) { if (/EXISTS|DUPLICATE/.test(e.message)) skipped++; else { Logger.log('Tài khoản ' + sid + ': ' + e.message); continue; } }
    vmfbAuthUpdate(uid, { role: 'student' });
  }
  vmfbCursor('stu', 0);
  var writes = [], emails = {};
  rows.forEach(function (s) {
    var sid = vmfbStr(s['Student ID']), classId = vmfbStr(s['Class']).toUpperCase(), email = vmfbLow(s['Email']);
    writes.push(wSet('users/' + vmfbUidForStudent(sid), { role: 'student', studentId: sid, fullName: vmfbStr(s['Name']),
      classId: classId, teacherUid: owner[classId] ? owner[classId].uid : '', email: email, phone: vmfbStr(s['Phone']),
      birthdate: vmfbStr(s['Birthdate']), archived: vmfbTrue(s['Archived']), createdAt: vmfbIso(s['CreatedAt']) }));
    if (email) (emails[email] = emails[email] || []).push(sid);
  });
  Object.keys(emails).forEach(function (e) {
    writes.push(wSet('loginIndex/' + vmfbSha256(e), emails[e].length > 1 ? { sid: emails[e][0], multi: true } : { sid: emails[e][0] }));
  });
  fsCommit(writes);
  return vmfbLog('Tài khoản SV mới tạo: ' + made + ', đã có/bỏ qua: ' + skipped + ', hồ sơ đã ghi: ' + rows.length);
}

/* Bước 5 — bài tập.
   • Tên đổi sang HW_… / IC_… theo mode.
   • Bài bị NHÂN ĐÔI (cùng lớp + mode + tên, một bản có từ, bản kia 0 từ) → chỉ giữ bản có từ;
     kết quả đã gắn vào bản 0 từ được gộp sang bản giữ lại ở bước 6.
   • Bài đã "xoá" trong Sheet (Active = FALSE) vốn đã ẩn với GV → chuyển thành deleted. */
function vmfb_5_Assignments() {
  var owner = vmfbClassOwners_();
  var rows = readAll(T.ASSIGN).filter(function (r) { return vmfbStr(r['Assignment ID']); });
  var items = rows.map(function (r) {
    var vocab = vmfbJson(r['Vocab List'], []);
    var mode = r['Mode'] === 'inclass' ? 'inclass' : 'homework';
    return { r: r, id: vmfbStr(r['Assignment ID']), classId: vmfbStr(r['Class']).toUpperCase(), mode: mode,
             title: vmfbPrefix(r['Title'], mode), vocab: vocab, n: vocab.length, created: vmfbIso(r['CreatedAt']) };
  });
  var groups = {};
  items.forEach(function (it) { (groups[it.classId + '|' + it.mode + '|' + it.title.toLowerCase()] = groups[it.classId + '|' + it.mode + '|' + it.title.toLowerCase()] || []).push(it); });
  var alias = {}, drop = {}, dupes = 0;
  Object.keys(groups).forEach(function (k) {
    var g = groups[k]; if (g.length < 2) return;
    g.sort(function (a, b) { return (b.n - a.n) || a.created.localeCompare(b.created); });
    for (var i = 1; i < g.length; i++) if (g[i].n === 0) { alias[g[i].id] = g[0].id; drop[g[i].id] = true; dupes++; }
  });
  PropertiesService.getScriptProperties().setProperty('vmfb_alias', JSON.stringify(alias));

  var keep = items.filter(function (it) { return !drop[it.id]; });
  var exists = fsExistingIds('assignments', keep.map(function (it) { return it.id; }));
  var writes = [], skipped = 0;
  keep.forEach(function (it) {
    if (exists[it.id]) { skipped++; return; }
    var r = it.r, isHw = it.mode === 'homework';
    writes.push(wSet('assignments/' + it.id, {
      assignmentId: it.id, teacherUid: owner[it.classId] ? owner[it.classId].uid : '', classId: it.classId, mode: it.mode, title: it.title,
      reading: vmfbStr(r['Reading Passage']), vocabJson: JSON.stringify(it.vocab), vocabCount: it.n,
      deadline: vmfbIso(r['Deadline']), requiredGoals: isHw ? (parseInt(r['Required Goals'], 10) || 3) : 0,
      sessionStart: vmfbIso(r['Session Start']), sessionDurationMin: parseInt(r['Session Duration Min'], 10) || 0, sessionEnd: vmfbIso(r['Session End']),
      extAll: '', ext: {}, active: String(r['Active']).toUpperCase() !== 'FALSE', deleted: String(r['Active']).toUpperCase() === 'FALSE',
      createdAt: it.created
    }));
  });
  fsCommit(writes);
  return vmfbLog('Bài tập: ' + writes.length + ' đã chuyển, ' + skipped + ' đã có sẵn, ' + dupes + ' bản nhân đôi 0 từ được gộp.');
}

// Bước 6 — kết quả: mỗi (SV × bài) thành 1 tài liệu chứa mọi lần làm (runs). Không ghi đè tài liệu đã có.
function vmfb_6_Results() {
  var t0 = Date.now(), owner = vmfbClassOwners_(), users = vmfbStudentMap_(owner);
  var alias = vmfbJson(PropertiesService.getScriptProperties().getProperty('vmfb_alias'), {});
  var titles = {};
  readAll(T.ASSIGN).forEach(function (r) { titles[vmfbStr(r['Assignment ID'])] = vmfbPrefix(r['Title'], r['Mode'] === 'inclass' ? 'inclass' : 'homework'); });

  var by = {}, order = [], orphan = 0;
  readAll(T.RESULTS).forEach(function (r) {
    var sid = vmfbStr(r['Student ID']), aid0 = vmfbStr(r['Assignment ID']);
    if (!sid || !aid0) return;
    if (!users[sid]) { orphan++; return; }
    var aid = alias[aid0] || aid0, key = aid + '__' + sid;
    if (!by[key]) { by[key] = { aid: aid, sid: sid, mode: vmfbStr(r['Mode']), title: titles[aid] || vmfbStr(r['Title']), cls: vmfbStr(r['Class']).toUpperCase(), runs: [] }; order.push(key); }
    var score = vmfbNum(r['Score']);
    by[key].runs.push({
      t: vmfbIso(r['Timestamp']), score: score, perfect: score === 100 || vmfbTrue(r['Is Perfect']), dur: vmfbNum(r['Duration Sec']),
      correct: vmfbNum(r['Correct']), total: vmfbNum(r['Total']), missed: vmfbJson(r['Missed Words'], []),
      timedOut: vmfbTrue(r['Timed Out']), absent: vmfbTrue(r['Absent'])
    });
  });
  var start = vmfbCursor('res'), writes = [];
  var exists = fsExistingIds('results', order.slice(start).map(function (k) { return by[k].aid + '_' + users[by[k].sid].uid; }));
  for (var i = start; i < order.length; i++) {
    if (Date.now() - t0 > 4 * 60000) { fsCommit(writes); vmfbCursor('res', i); return vmfbLog('Tạm dừng ở nhóm ' + i + '/' + order.length + ' — chạy lại vmfb_6_Results để làm tiếp.'); }
    var g = by[order[i]], u = users[g.sid], id = g.aid + '_' + u.uid;
    if (exists[id]) continue;
    g.runs.sort(function (a, b) { return a.t.localeCompare(b.t); });
    var classId = g.cls || u.classId;
    writes.push(wSet('results/' + id, {
      uid: u.uid, studentId: g.sid, name: u.name, classId: classId, teacherUid: owner[classId] ? owner[classId].uid : u.teacherUid,
      assignmentId: g.aid, title: g.title, mode: g.mode, attempts: g.runs.length,
      perfectCount: g.runs.filter(function (r) { return r.perfect; }).length, lastAt: g.runs[g.runs.length - 1].t, runs: g.runs
    }));
    if (writes.length >= 200) { fsCommit(writes); writes = []; vmfbCursor('res', i + 1); }
  }
  fsCommit(writes);
  vmfbCursor('res', 0);
  return vmfbLog('Kết quả: ' + order.length + ' nhóm (SV × bài) đã xử lý' + (orphan ? ', bỏ ' + orphan + ' dòng của SV không còn trong tab Students' : '') + '.');
}

// Bước 7 — dấu re-check của In-class
function vmfb_7_Rechecks() {
  var owner = vmfbClassOwners_(), alias = vmfbJson(PropertiesService.getScriptProperties().getProperty('vmfb_alias'), {}), writes = [];
  readAll(T.IC_RECHECK).forEach(function (r) {
    var sid = vmfbStr(r['Student ID']), aid0 = vmfbStr(r['Assignment ID']); if (!sid || !aid0) return;
    var aid = alias[aid0] || aid0, classId = vmfbStr(r['Class']).toUpperCase();
    writes.push(wSet('rechecks/' + aid + '_' + vmfbUidForStudent(sid), {
      teacherUid: owner[classId] ? owner[classId].uid : vmfbUidForTeacher(vmfbDefaultTeacher_()), assignmentId: aid, studentId: sid,
      studentName: vmfbStr(r['Student Name']), classId: classId, missedWords: vmfbStr(r['Missed Words']), penaltyType: vmfbStr(r['Penalty Type']),
      checkedBy: vmfbStr(r['Checked By']), checkedAt: vmfbIso(r['Checked At']), note: vmfbStr(r['Note'])
    }));
  });
  fsCommit(writes);
  return vmfbLog('Re-check: ' + writes.length);
}

// Bước 8 — bài Luyện Dịch (TranslateSets) + kết quả (TranslateResults → 1 tài liệu / SV × bài)
function vmfb_8_Translate() {
  var owner = vmfbClassOwners_(), users = vmfbStudentMap_(owner), sets = {}, writes = [];
  readAll(T.TR_SETS).forEach(function (r) {
    var id = vmfbStr(r['Set ID']); if (!id) return;
    var classId = vmfbStr(r['Class']).toUpperCase(), em = vmfbLow(r['Teacher Email']);
    var items = vmfbJson(r['Items JSON'], []);
    sets[id] = { teacherUid: em ? vmfbUidForTeacher(em) : (owner[classId] ? owner[classId].uid : '') };
    writes.push(wSet('trSets/' + id, { setId: id, sourceAssignmentId: vmfbStr(r['Source Assignment ID']), classId: classId,
      teacherUid: sets[id].teacherUid, title: vmfbStr(r['Title']), itemsJson: JSON.stringify(items), itemCount: items.length,
      passScore: parseInt(r['Pass Score'], 10) || 85, sessionStart: vmfbIso(r['Session Start']), deadline: vmfbIso(r['Deadline']),
      active: String(r['Active']).toUpperCase() !== 'FALSE', createdAt: vmfbIso(r['Created At']) }));
  });
  var by = {};
  readAll(T.TR_RESULTS).forEach(function (r) {
    var sid = vmfbStr(r['Student ID']), setId = vmfbStr(r['Set ID']);
    if (!users[sid] || !sets[setId]) return;
    var g = by[setId + '_' + sid] = by[setId + '_' + sid] || { sid: sid, setId: setId, title: vmfbStr(r['Title']), runs: [], cleared: {}, last: null };
    var run = { i: vmfbNum(r['Run Index']) || 1, t: vmfbIso(r['Timestamp']), score: vmfbNum(r['Score']), passed: vmfbTrue(r['Passed']), dur: vmfbNum(r['Duration Sec']) };
    g.runs.push(run);
    vmfbJson(r['Cleared Item IDs JSON'], []).forEach(function (x) { g.cleared[x] = true; });
    if (!g.last || run.t > g.last.t) g.last = { t: run.t, scores: vmfbStr(r['Item Scores JSON']), chest: vmfbStr(r['Chest JSON']) };
  });
  Object.keys(by).forEach(function (k) {
    var g = by[k], u = users[g.sid];
    writes.push(wSet('trProgress/' + g.setId + '_' + u.uid, { uid: u.uid, studentId: g.sid, name: u.name, classId: u.classId,
      teacherUid: sets[g.setId].teacherUid, setId: g.setId, title: g.title, lastAt: g.last.t, runs: g.runs,
      clearedIds: Object.keys(g.cleared), lastItemScores: g.last.scores || '[]', lastChest: g.last.chest || '[]' }));
  });
  fsCommit(writes);
  return vmfbLog('Luyện Dịch: ' + Object.keys(sets).length + ' bài, ' + Object.keys(by).length + ' tiến độ SV.');
}

// Bước 9 — bài đọc ReadWise của SV
function vmfb_9_ReadWise() {
  var owner = vmfbClassOwners_(), users = vmfbStudentMap_(owner), writes = [], skipped = 0;
  readAll(T.READWISE).forEach(function (r) {
    var id = vmfbStr(r['Article ID']), sid = vmfbStr(r['Student ID']);
    if (!id || !users[sid]) { skipped++; return; }
    var passage = String(r['Passage'] == null ? '' : r['Passage']);
    writes.push(wSet('readwise/' + id, { articleId: id, uid: users[sid].uid, studentId: sid, studentName: vmfbStr(r['Student Name']),
      classId: vmfbStr(r['Class']).toUpperCase(), title: vmfbStr(r['Title']), passage: passage,
      wordCount: passage.split(/\s+/).filter(Boolean).length, vocabJson: vmfbStr(r['Vocab JSON']) || '[]',
      collocJson: vmfbStr(r['Collocations JSON']) || '[]', savedAt: vmfbIso(r['Saved At']) }));
  });
  fsCommit(writes);
  return vmfbLog('ReadWise: ' + writes.length + ' bài' + (skipped ? ', bỏ ' + skipped + ' bài của SV không còn trong Students' : ''));
}

// Bước 10 — "Today's word": tab Vocabulary → vocabBank/c0..cN (100 từ/tài liệu) + vocabBank/meta
function vmfb_91_VocabBank() {
  var words = readAll(T.VOCAB).filter(function (r) { return vmfbStr(r['Word']); }).map(function (r) {
    return { word: vmfbStr(r['Word']), ipa: vmfbStr(r['IPA']), band: vmfbStr(r['Band']), meaningVi: vmfbStr(r['Meaning VI']),
             synonyms: vmfbStr(r['Synonyms']).split(',').map(function (s) { return s.trim(); }).filter(Boolean),
             examples: [vmfbStr(r['Example 1']), vmfbStr(r['Example 2'])].filter(Boolean) };
  });
  var writes = [wSet('vocabBank/meta', { count: words.length })];
  for (var i = 0; i * 100 < words.length; i++) writes.push(wSet('vocabBank/c' + i, { words: words.slice(i * 100, i * 100 + 100) }));
  fsCommit(writes);
  return vmfbLog('Từ vựng: ' + words.length + ' từ trong ' + (writes.length - 1) + ' tài liệu.');
}

// ════════════════════════════════════════════════════════════
// SOI MỘT BÀI: đổi VMFB_FIND ở dưới thành một phần tên bài (VD 'Thylacines'), chạy
// vmfb_find_Assignment rồi gửi Execution log. Cho biết bài đó trong Sheet / Firebase,
// và các tài liệu kết quả gắn với nó (lớp, GV, SV, mode).
// ════════════════════════════════════════════════════════════
var VMFB_FIND = 'Thylacines';
function vmfb_find_Assignment() {
  var q = VMFB_FIND.toLowerCase(), out = [], ids = {};
  out.push('— Lớp trên Firebase —');
  fsQuery('classes', []).forEach(function (c) { out.push(c._id + ' | ' + c.className + ' | teacherUid=' + c.teacherUid + ' | ' + c.status); });
  out.push('— Bài trong Sheet —');
  readAll(T.ASSIGN).forEach(function (r) {
    if (String(r['Title']).toLowerCase().indexOf(q) < 0) return;
    var n = 0; try { n = JSON.parse(r['Vocab List'] || '[]').length; } catch (e) {}
    ids[vmfbStr(r['Assignment ID'])] = 1;
    out.push(vmfbStr(r['Assignment ID']) + ' | ' + r['Mode'] + ' | lớp=' + r['Class'] + ' | ' + n + ' từ | Active=' + r['Active'] + ' | ' + r['Title']);
  });
  out.push('— Bài trên Firebase —');
  fsQuery('assignments', []).forEach(function (a) {
    if (String(a.title).toLowerCase().indexOf(q) < 0) return;
    ids[a._id] = 1;
    out.push(a._id + ' | ' + a.mode + ' | classId=' + a.classId + ' | teacherUid=' + a.teacherUid + ' | active=' + a.active + ' deleted=' + a.deleted + ' | ' + a.title);
  });
  out.push('— Kết quả trên Firebase gắn với các bài trên —');
  var n = 0;
  fsQuery('results', []).forEach(function (d) {
    if (!ids[d.assignmentId]) return;
    n++; if (n <= 40) out.push(d._id + ' | mode=' + d.mode + ' | classId=' + d.classId + ' | teacherUid=' + d.teacherUid + ' | SV=' + d.studentId + ' | ' + (d.runs || []).length + ' lượt');
  });
  out.push('Tổng ' + n + ' tài liệu kết quả (hiện tối đa 40).');
  return vmfbLog(out.join('\n'));
}
