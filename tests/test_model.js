// node tests/test_model.js — 驗證計分規則、前後端一致、GAS 收件與彙整
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..');

// 1) 載入 GAS Code.gs（以假的 Google 服務）
const sheets = {};
function fakeSheet(name) {
  const rows = [];
  return { name, rows,
    getLastRow: () => rows.length,
    appendRow: r => rows.push(r.slice()),
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => { const o = []; for (let j = 0; j < nc; j++) o.push(x[c - 1 + j] === undefined ? '' : x[c - 1 + j]); return o; }),
      setValues: v => v.forEach((row, i) => { const t = rows[r - 1 + i] || (rows[r - 1 + i] = []); row.forEach((val, j) => t[c - 1 + j] = val); }),
      setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; }, setFontSize() { return this; }
    }),
    setFrozenRows() {}, clear() { rows.length = 0; } };
}
const ctx = {
  console,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet(n)) }),
                    getUi: () => ({ alert() {}, createMenu() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({ _p: ctx._props, getProperty: k => ctx._props[k] || null, setProperty: (k, v) => { ctx._props[k] = v; } }) },
  Utilities: { getUuid: () => 'aaaa-bbbb-cccc', formatDate: () => '2026/10/20 10:00' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return { body: s }; } }) },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/X/exec' }) },
  _props: {}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'gas/Code.gs'), 'utf8') + '\nthis.__x={scoreSD5,aggregate,doPost,doGet,setup,getDashboardData,refreshSummary,adminKey_};', ctx);
const G = ctx.__x;

// 2) 抽出 index.html 的計分函式
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = html.match(/const DIMENSIONS = \[[\s\S]*?\n\];/)[0] + '\n' + html.match(/function scoreSD5[\s\S]*?\n}\n/)[0];
const W = {}; vm.createContext(W); vm.runInContext(js + '\nthis.score=scoreSD5;this.D=DIMENSIONS;', W);

// 3) 轉換表結構：32 題各出現一次，同一題左右選項相反
const seen = {};
W.D.forEach(d => { assert.strictEqual(d.L_items.length, 8); d.L_items.forEach(([q, o], i) => {
  const [q2, o2] = d.R_items[i]; assert.strictEqual(q, q2); assert.notStrictEqual(o, o2); assert(!seen[q]); seen[q] = d.key; });
  assert(d.L_items.some(([q]) => q === d.tieQ), d.key + ' 平手題需屬於該構面'); });
assert.strictEqual(Object.keys(seen).length, 32);

// 4) 已知案例（手算）
const all = (v) => Array(32).fill(v);
// 全 a：I/E 4:4 平手不計第 11 題→E；S/N 4:4 不計第 16 題→N；T 5:3；J 5:3
let r = W.score(all('a'));
assert.strictEqual(JSON.stringify(r.dims.map(d => [d.l, d.r, d.tie, d.pick])), JSON.stringify([[4,4,true,'E'],[4,4,true,'N'],[5,3,false,'T'],[5,3,false,'J']]));
assert.strictEqual(r.type, 'ENTJ');
r = W.score(all('b')); assert.strictEqual(r.type, 'ISFP');
// 依講義圈選 I 欄全部 → I 8
const ans = all('a'); [15,19,27,32].forEach(q => ans[q-1]='b');
assert.strictEqual(W.score(ans).dims[0].l, 8);

// 5) 前後端隨機比對 2000 次
for (let k = 0; k < 2000; k++) {
  const a = Array.from({ length: 32 }, () => Math.random() < .5 ? 'a' : 'b');
  const x = W.score(a), y = G.scoreSD5(a);
  assert.strictEqual(x.type, y.type);
  x.dims.forEach((d, i) => { assert.strictEqual(d.l + d.r, 8); assert.strictEqual(d.l, y.dims[i].l); });
}
assert.throws(() => G.scoreSD5(all('a').slice(1)));
assert.throws(() => G.scoreSD5(all('c')));

// 6) GAS：初始化、收件、去重、錯誤處理、彙整
G.setup();
assert.strictEqual(sheets.History.rows.length, 10);
const post = o => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(o) } }).body);
const s1 = post({ action: 'submit', group: '3', name: '王小明', sid: 'b14705001', answers: 'a'.repeat(32) });
assert.deepStrictEqual(s1, { ok: true, type: 'ENTJ' });
post({ action: 'submit', group: '3', name: '王小明', sid: 'B14705001', answers: 'b'.repeat(32) }); // 重送覆寫
post({ action: 'submit', group: '5', name: '=HYPERLINK("x")', sid: 'B14705002', answers: 'b'.repeat(32) });
assert.strictEqual(sheets.Responses.rows.length, 3, '重送應覆寫而不是新增');
assert.strictEqual(sheets.Responses.rows[2][3].startsWith('='), false, '公式注入需被移除');
assert.strictEqual(post({ action: 'submit', group: '1', name: 'x', sid: 'B1', answers: 'a'.repeat(32) }).ok, false);
assert.strictEqual(post({ action: 'submit', group: '1', name: 'x', sid: 'B14705003', answers: 'a'.repeat(31) }).ok, false);
assert.strictEqual(post({ action: 'submit', group: '', name: 'x', sid: 'B14705003', answers: 'a'.repeat(32) }).ok, false);
assert.strictEqual(post({}).ok, false);

const key = G.adminKey_();
assert.throws(() => G.getDashboardData('wrong'));
const d = G.getDashboardData(key);
assert.strictEqual(d.current.n, 2);
assert.strictEqual(d.current.types.ISFP, 2);
assert.strictEqual(d.current.representative, 'ISFP');
assert.strictEqual(d.history.length, 9);
const h17 = d.history.find(h => h.year === 2017);
['I','S','T','J'].forEach((k,i)=>assert.strictEqual(h17[k]+h17['ENFP'[i]], 67, '2017 '+k));
const h25 = d.history.find(h => h.year === 2025);
assert.strictEqual(JSON.stringify([h25.I, h25.E, h25.S, h25.N, h25.T, h25.F, h25.J, h25.P]), JSON.stringify([32, 18, 21, 29, 29, 21, 31, 19]));
assert.strictEqual(Object.values(h25.types).reduce((a, b) => a + b, 0), 50);
// 2025 四構面須與 16 型加總一致
const fromTypes = { I:0,E:0,S:0,N:0,T:0,F:0,J:0,P:0 };
Object.entries(h25.types).forEach(([t, c]) => t.split('').forEach(ch => fromTypes[ch] += c));
['I','E','S','N','T','F','J','P'].forEach(k => assert.strictEqual(fromTypes[k], h25[k], '2025 ' + k));
// 平手代表型
const ag = G.aggregate([{ type: 'ISTJ', group: '1' }, { type: 'ENFP', group: '1' }]);
assert.strictEqual(ag.representative, 'I/ES/NT/FJ/P');
// 未帶 key 的 GET 不回後台
fs.writeFileSync(path.join(__dirname, 'mock_data.json'), JSON.stringify(d));
G.refreshSummary();
console.log('全部通過：轉換表結構、手算案例、前後端 2000 組比對、GAS 收件／去重／驗證、彙整與歷年資料。');
