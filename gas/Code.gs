/**
 * SD5 人格特質自我診斷｜管理學 2026 後台（Google Apps Script）
 *
 * 綁定在一份 Google 試算表上（擴充功能 → Apps Script）。
 * - doPost：接收學生端網頁送出的 32 題答案，伺服器端重新計分後寫入「Responses」。
 * - doGet ：帶正確 key 才回傳老師專用的班級彙整與 2017 年起趨勢；其他人只看到一行說明。
 * - 試算表選單「SD5 後台」：初始化、開啟班級彙整、更新彙整表、寫入歷史資料、顯示後台網址。
 */

const CFG = {
  YEAR: 2026,                    // 本學期年度
  SHEET_RESP: 'Responses',
  SHEET_HIST: 'History',
  SHEET_SUM: 'Summary',
  TZ: 'Asia/Taipei',
  // 正式部署網址（部署 → 管理部署作業 → 網頁應用程式 URL）。在試算表選單中 ScriptApp.getService().getUrl() 會回傳無法使用的網址，因此直接記錄。
  WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbzlgdoCLRZFnyo_o8veJ15KXz2_kJaX6NmCVdaUC-FrrHRXb3D3DizGW2e26o-agmzrig/exec'
};

const TYPE_ORDER = [
  'ISTJ','ISFJ','INFJ','INTJ',
  'ISTP','ISFP','INFP','INTP',
  'ESTP','ESFP','ENFP','ENTP',
  'ESTJ','ESFJ','ENFJ','ENTJ'
];
const LETTERS = ['I','E','S','N','T','F','J','P'];

/* ===== SD5 轉換表（與 index.html 相同） ===== */
const DIMENSIONS = [
  {key:'IE', L:'I', R:'E', tieQ:11,
   L_items:[[2,'a'],[6,'a'],[11,'a'],[15,'b'],[19,'b'],[22,'a'],[27,'b'],[32,'b']],
   R_items:[[2,'b'],[6,'b'],[11,'b'],[15,'a'],[19,'a'],[22,'b'],[27,'a'],[32,'a']]},
  {key:'SN', L:'S', R:'N', tieQ:16,
   L_items:[[1,'b'],[10,'b'],[13,'a'],[16,'a'],[17,'a'],[21,'a'],[28,'b'],[30,'b']],
   R_items:[[1,'a'],[10,'a'],[13,'b'],[16,'b'],[17,'b'],[21,'b'],[28,'a'],[30,'a']]},
  {key:'TF', L:'T', R:'F', tieQ:24,
   L_items:[[3,'a'],[5,'a'],[12,'a'],[14,'b'],[20,'a'],[24,'b'],[25,'a'],[29,'b']],
   R_items:[[3,'b'],[5,'b'],[12,'b'],[14,'a'],[20,'b'],[24,'a'],[25,'b'],[29,'a']]},
  {key:'JP', L:'J', R:'P', tieQ:23,
   L_items:[[4,'a'],[7,'a'],[8,'b'],[9,'a'],[18,'b'],[23,'b'],[26,'a'],[31,'a']],
   R_items:[[4,'b'],[7,'b'],[8,'a'],[9,'b'],[18,'a'],[23,'a'],[26,'b'],[31,'b']]}
];

function scoreSD5(answers) {
  if (!Array.isArray(answers) || answers.length !== 32 || answers.some(function (x) { return x !== 'a' && x !== 'b'; })) {
    throw new Error('需要 32 題 a/b 答案');
  }
  const dims = DIMENSIONS.map(function (d) {
    const count = function (items, skip) {
      return items.filter(function (it) { return it[0] !== skip && answers[it[0] - 1] === it[1]; }).length;
    };
    const l = count(d.L_items), r = count(d.R_items);
    let pick, tie = false, lAdj = l, rAdj = r;
    if (l !== r) { pick = l > r ? d.L : d.R; }
    else { tie = true; lAdj = count(d.L_items, d.tieQ); rAdj = count(d.R_items, d.tieQ); pick = lAdj > rAdj ? d.L : d.R; }
    return {key: d.key, L: d.L, R: d.R, l: l, r: r, tie: tie, lAdj: lAdj, rAdj: rAdj, pick: pick};
  });
  return {type: dims.map(function (x) { return x.pick; }).join(''), dims: dims};
}

/* ===== 歷年資料（MBTI_Class_Results.xlsx） =====
 * 2017–2024 只有四構面人數；2025 另有 16 型人數。
 * 2017 年 P 原檔為 23，依授課教師更正為 27（2026-10-20）。 */
const HISTORY_SEED = [
  // 年度, I, E, S, N, T, F, J, P, 備註
  [2017, 54, 13, 25, 42, 29, 38, 40, 27, 'P 依老師更正為 27（原檔 23）'],
  [2018, 29, 15, 17, 27, 15, 29, 28, 16, ''],
  [2019, 36, 18, 19, 35, 25, 29, 34, 20, ''],
  [2020, 32, 21, 16, 37, 22, 31, 35, 18, ''],
  [2021, 24,  8, 14, 18, 14, 18, 20, 12, ''],
  [2022, 33, 20, 16, 37, 32, 21, 32, 21, ''],
  [2023, 28, 24, 14, 38, 19, 33, 25, 27, ''],
  [2024, 29, 22, 15, 36, 28, 23, 27, 24, ''],
  [2025, 32, 18, 21, 29, 29, 21, 31, 19, '另有 16 型人數']
];
const TYPES_2025 = {ISTJ:6,ISFJ:5,INFJ:4,INTJ:8,ISTP:4,ISFP:1,INFP:1,INTP:3,ESTP:2,ESFP:1,ENFP:5,ENTP:2,ESTJ:1,ESFJ:1,ENFJ:3,ENTJ:3};

const RESP_HEADER = ['時間','年度','組別','姓名','學號','類型','I','E','S','N','T','F','J','P','平手處理','答案']
  .concat(Array.from({length: 32}, function (_, i) { return 'Q' + (i + 1); }));
const HIST_HEADER = ['年度','I','E','S','N','T','F','J','P','備註'].concat(TYPE_ORDER);

/* ===== 選單與初始化 ===== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('SD5 後台')
    .addItem('① 初始化（第一次使用）', 'setup')
    .addItem('開啟班級彙整與趨勢', 'openDashboard')
    .addItem('更新 Summary 工作表', 'refreshSummary')
    .addSeparator()
    .addItem('把本年度結果寫入 History', 'archiveCurrentYear')
    .addItem('顯示後台網址與金鑰', 'showAdminInfo')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  let resp = ss.getSheetByName(CFG.SHEET_RESP);
  if (!resp) resp = ss.insertSheet(CFG.SHEET_RESP);
  if (resp.getLastRow() === 0) {
    resp.appendRow(RESP_HEADER);
    resp.setFrozenRows(1);
    resp.getRange(1, 1, 1, RESP_HEADER.length).setFontWeight('bold').setBackground('#E1E8F2');
  }
  let hist = ss.getSheetByName(CFG.SHEET_HIST);
  if (!hist) hist = ss.insertSheet(CFG.SHEET_HIST);
  if (hist.getLastRow() === 0) {
    hist.appendRow(HIST_HEADER);
    HISTORY_SEED.forEach(function (r) {
      const types = TYPE_ORDER.map(function (t) { return r[0] === 2025 ? TYPES_2025[t] : ''; });
      hist.appendRow(r.concat(types));
    });
    hist.setFrozenRows(1);
    hist.getRange(1, 1, 1, HIST_HEADER.length).setFontWeight('bold').setBackground('#E1E8F2');
  }
  if (!ss.getSheetByName(CFG.SHEET_SUM)) ss.insertSheet(CFG.SHEET_SUM);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  refreshSummary();
  SpreadsheetApp.getUi().alert('初始化完成。\n\n下一步：部署 → 新增部署作業 → 網頁應用程式；執行身分選「我」，存取權選「所有人」。\n部署後用「顯示後台網址與金鑰」取得老師專用連結。');
}

function adminKey_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
}

function showAdminInfo() {
  const url = CFG.WEBAPP_URL || ScriptApp.getService().getUrl();
  const key = adminKey_();
  const msg = url
    ? '學生端收件網址（貼到 index.html 的 GAS_URL）：\n' + url + '\n\n老師後台（請勿外流）：\n' + url + '?key=' + key
    : '尚未部署為網頁應用程式。金鑰：' + key;
  SpreadsheetApp.getUi().alert(msg);
}

/* ===== 網頁端點 ===== */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action !== 'submit') return json_({ok: false, error: '未知的動作'});
    const group = clean_(body.group, 10), name = clean_(body.name, 40);
    const sid = clean_(body.sid, 12).toUpperCase();
    const ans = String(body.answers || '').toLowerCase().split('');
    if (!group || !name || !sid) return json_({ok: false, error: '組別、姓名、學號都要填'});
    if (!/^[A-Z0-9]{6,12}$/.test(sid)) return json_({ok: false, error: '學號格式不符'});
    const r = scoreSD5(ans); // 格式錯誤會丟出例外
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      upsert_(r, group, name, sid, ans);
    } finally { lock.releaseLock(); }
    return json_({ok: true, type: r.type});
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ok: true, year: CFG.YEAR});
  if (p.key && p.key === adminKey_()) {
    const t = HtmlService.createTemplateFromFile('Dashboard');
    t.adminKey = p.key;
    return t.evaluate().setTitle('SD5 班級彙整｜管理學 ' + CFG.YEAR)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">這是 SD5 的收件端點，請回到課程網頁填寫。</p>');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function clean_(s, n) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').replace(/^[=+\-@]+/, '').trim().slice(0, n);
}

function upsert_(r, group, name, sid, ans) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_RESP);
  if (!sh) throw new Error('後台尚未初始化');
  const counts = {};
  r.dims.forEach(function (d) { counts[d.L] = d.l; counts[d.R] = d.r; });
  const ties = r.dims.filter(function (d) { return d.tie; })
    .map(function (d) { return d.key + '平手→' + d.pick; }).join('；');
  const row = [new Date(), CFG.YEAR, group, name, sid, r.type]
    .concat(LETTERS.map(function (k) { return counts[k]; }))
    .concat([ties, ans.join('')]).concat(ans);
  const last = sh.getLastRow();
  if (last >= 2) {
    const keys = sh.getRange(2, 2, last - 1, 4).getValues(); // 年度、組別、姓名、學號
    for (let i = 0; i < keys.length; i++) {
      if (Number(keys[i][0]) === CFG.YEAR && String(keys[i][3]).toUpperCase() === sid) {
        sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sh.appendRow(row);
}

/* ===== 彙整 ===== */
function readResponses_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_RESP);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues()
    .filter(function (r) { return Number(r[1]) === CFG.YEAR && TYPE_ORDER.indexOf(String(r[5])) >= 0; })
    .map(function (r) {
      return {time: r[0] instanceof Date ? r[0].getTime() : null, group: String(r[2]), name: String(r[3]), sid: String(r[4]), type: String(r[5]), tie: String(r[14] || '')};
    });
}

function readHistory_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_HIST);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, HIST_HEADER.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      const o = {year: Number(r[0]), note: String(r[9] || ''), types: null};
      LETTERS.forEach(function (k, i) { o[k] = Number(r[i + 1]) || 0; });
      const t = r.slice(10, 26);
      if (t.some(function (v) { return v !== '' && v !== null; })) {
        o.types = {};
        TYPE_ORDER.forEach(function (k, i) { o.types[k] = Number(t[i]) || 0; });
      }
      return o;
    });
}

/** 純函式：由學生列表算出班級彙整（便於本機測試） */
function aggregate(rows) {
  const types = {};
  TYPE_ORDER.forEach(function (t) { types[t] = 0; });
  const dims = {};
  LETTERS.forEach(function (k) { dims[k] = 0; });
  const groups = {};
  rows.forEach(function (r) {
    types[r.type]++;
    r.type.split('').forEach(function (c) { dims[c]++; });
    (groups[r.group] = groups[r.group] || []).push(r.type);
  });
  const n = rows.length;
  const rep = [['I','E'],['S','N'],['T','F'],['J','P']].map(function (p) {
    if (dims[p[0]] === dims[p[1]]) return p[0] + '/' + p[1];
    return dims[p[0]] > dims[p[1]] ? p[0] : p[1];
  });
  let max = 0;
  TYPE_ORDER.forEach(function (t) { if (types[t] > max) max = types[t]; });
  const modal = max > 0 ? TYPE_ORDER.filter(function (t) { return types[t] === max; }) : [];
  return {n: n, types: types, dims: dims, representative: rep.join(''), modal: modal, modalCount: max, groups: groups,
          ties: rows.filter(function (r) { return r.tie; }).length};
}

/** 給 Dashboard.html 呼叫 */
function getDashboardData(key) {
  if (key !== adminKey_()) throw new Error('沒有權限');
  const rows = readResponses_();
  const cur = aggregate(rows);
  const hist = readHistory_().filter(function (h) { return h.year !== CFG.YEAR; });
  return {
    year: CFG.YEAR,
    updated: Utilities.formatDate(new Date(), CFG.TZ, 'yyyy/MM/dd HH:mm'),
    current: cur,
    roster: rows.map(function (r) { return {group: r.group, name: r.name, sid: r.sid, type: r.type, tie: r.tie}; }),
    history: hist
  };
}

function openDashboard() {
  const t = HtmlService.createTemplateFromFile('Dashboard');
  t.adminKey = adminKey_();
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(1200).setHeight(820), 'SD5 班級彙整與趨勢');
}

/** 在 Summary 工作表寫出本年度 16 型與四構面，方便直接在試算表看 */
function refreshSummary() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CFG.SHEET_SUM) || ss.insertSheet(CFG.SHEET_SUM);
  const a = aggregate(readResponses_());
  sh.clear();
  const pct = function (x) { return a.n ? x / a.n : 0; };
  const out = [[CFG.YEAR + ' 年班級結果', '', '', '', '填答人數', a.n]];
  out.push(['', '', '', '', '', '']);
  for (let r = 0; r < 4; r++) {
    const ts = TYPE_ORDER.slice(r * 4, r * 4 + 4);
    out.push([''].concat(ts).concat(['']));
    out.push(['人數'].concat(ts.map(function (t) { return a.types[t]; })).concat(['']));
    out.push(['比例'].concat(ts.map(function (t) { return pct(a.types[t]); })).concat(['']));
  }
  out.push(['', '', '', '', '', '']);
  [['I','E'],['S','N'],['T','F'],['J','P']].forEach(function (p) {
    out.push([p[0] + ' / ' + p[1], a.dims[p[0]], a.dims[p[1]], pct(a.dims[p[0]]), pct(a.dims[p[1]]), '']);
  });
  out.push(['班級代表型', a.representative, '最多人的類型', a.modal.join('、'), a.modalCount + ' 人', '']);
  sh.getRange(1, 1, out.length, 6).setValues(out);
  for (let r = 0; r < 4; r++) sh.getRange(5 + r * 3, 2, 1, 4).setNumberFormat('0.0%');
  sh.getRange(16, 4, 4, 2).setNumberFormat('0.0%');
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(13);
}

/** 學期結束後，把本年度四構面與 16 型寫進 History（同年度會覆寫） */
function archiveCurrentYear() {
  const ui = SpreadsheetApp.getUi();
  const a = aggregate(readResponses_());
  if (!a.n) { ui.alert('本年度還沒有資料。'); return; }
  if (ui.alert('寫入 History', '把 ' + CFG.YEAR + ' 年 ' + a.n + ' 人的結果寫入 History？同年度既有資料會被覆寫。', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.SHEET_HIST);
  const row = [CFG.YEAR].concat(LETTERS.map(function (k) { return a.dims[k]; }))
    .concat(['由 SD5 網頁彙整']).concat(TYPE_ORDER.map(function (t) { return a.types[t]; }));
  const years = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map(function (r) { return Number(r[0]); });
  const idx = years.indexOf(CFG.YEAR);
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
  ui.alert('已寫入。');
}
