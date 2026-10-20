// node tests/test_integration.js
// 模擬正式環境：本機 HTTP 伺服器扮演 GitHub Pages；另一個伺服器執行 Code.gs 的 doPost，
// 並像 GAS 一樣先回 302 重新導向到另一個網域再回 JSON。多位學生用真實瀏覽器走完整流程，
// 最後用後台的 getDashboardData 結果渲染 Dashboard.html。
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });

// ---- 假的 Google 服務 + Code.gs ----
const sheets = {};
function fakeSheet() {
  const rows = [];
  return { rows, getLastRow: () => rows.length, appendRow: r => rows.push(r.slice()),
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => Array.from({ length: nc }, (_, j) => x[c - 1 + j] === undefined ? '' : x[c - 1 + j])),
      setValues: v => v.forEach((row, i) => { const t = rows[r - 1 + i] || (rows[r - 1 + i] = []); row.forEach((val, j) => t[c - 1 + j] = val); }),
      setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; }, setFontSize() { return this; } }),
    setFrozenRows() {}, clear() { rows.length = 0; } };
}
const props = {};
const ctx = { console,
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet()) }), getUi: () => ({ alert() {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  Utilities: { getUuid: () => 'test-key-1234', formatDate: () => '2026/10/20 10:00' },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return { body: s }; } }) },
  ScriptApp: { getService: () => ({ getUrl: () => '' }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'gas/Code.gs'), 'utf8') + '\nthis.G={doPost,setup,getDashboardData,adminKey_,scoreSD5};', ctx);
const G = ctx.G; G.setup();

// ---- 伺服器 ----
const PAGES = 8780, GAS = 8790, GUC = 8791; // Pages、script.google.com、script.googleusercontent.com
const pending = {}; let seq = 0, posts = 0, breakBackend = false;
const gasUrl = `http://127.0.0.1:${GAS}/macros/s/TEST/exec`;
const page = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/const GAS_URL = "[^"]*";/, `const GAS_URL = "${gasUrl}";`);
const servers = [
  http.createServer((req, res) => { // GitHub Pages：/mgmt-2026-sd5/
    if (req.url === '/mgmt-2026-sd5/' || req.url.startsWith('/mgmt-2026-sd5/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
    res.writeHead(404); res.end();
  }).listen(PAGES),
  http.createServer((req, res) => { // GAS /exec：執行 doPost 後 302
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(405, cors); return res.end(); } // GAS 不支援預檢；前端必須是 simple request
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      posts++;
      assert(/^text\/plain/.test(req.headers['content-type'] || ''), '必須用 text/plain 避免 CORS 預檢');
      const out = breakBackend ? JSON.stringify({ ok: false, error: '後台尚未初始化' }) : G.doPost({ postData: { contents: body } }).body;
      const id = ++seq; pending[id] = out;
      res.writeHead(302, Object.assign({ Location: `http://127.0.0.1:${GUC}/macros/echo?id=${id}` }, cors)); res.end();
    });
  }).listen(GAS),
  http.createServer((req, res) => { // googleusercontent：回 JSON
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(pending[id] || '{}');
  }).listen(GUC)
];

// ---- 測試學生 ----
const rnd = (s => () => (s = (s * 48271) % 2147483647) / 2147483647)(2026);
const students = Array.from({ length: 12 }, (_, i) => ({
  group: String(1 + (i % 4)), name: '學生' + (i + 1), sid: 'B147050' + String(i + 1).padStart(2, '0'),
  answers: Array.from({ length: 32 }, () => rnd() < .5 ? 'a' : 'b')
}));

(async () => {
  const browser = await chromium.launch();
  const url = `http://127.0.0.1:${PAGES}/mgmt-2026-sd5/`;
  const checkOne = async (s, opts = {}) => {
    const ctxb = await browser.newContext({ viewport: opts.phone ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    const p = await ctxb.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(url);
    await p.fill('#group', s.group); await p.fill('#name', s.name); await p.fill('#sid', s.sid.toLowerCase());
    await p.click('#to2');
    if (opts.quick) { await p.click('details.quick summary'); await p.fill('#quick', s.answers.join(' ')); }
    else for (let q = 1; q <= 32; q++) await p.click(`#q${q} button[data-v=${s.answers[q - 1]}]`);
    await p.click('#to3');
    // 核對頁的答案與輸入一致
    const rev = await p.$$eval('#review b', bs => bs.map(b => b.textContent));
    assert.strictEqual(rev.join(''), s.answers.join(''));
    assert(!(await p.isVisible('#s4')), '送出前不能看到結果');
    await p.check('#ok'); await p.click('#send');
    await p.waitForSelector('#s4:not([hidden])', { timeout: 15000 });
    assert.strictEqual(await p.getAttribute('#pending', 'class'), 'note ok', s.sid + ' 應顯示已送出');
    const shown = (await p.textContent('#typeBox')).trim();
    assert.strictEqual(shown, G.scoreSD5(s.answers).type, s.sid + ' 類型');
    assert.strictEqual(await p.locator('.dim td.hit').count(), 32);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth); assert(sw <= (opts.phone ? 390 : 1280));
    if (opts.shot) await p.screenshot({ path: path.join(shots, opts.shot), fullPage: true });
    assert.deepStrictEqual(errs, [], s.sid + ' 主控台錯誤');
    await ctxb.close();
    return shown;
  };

  // 1) 12 位學生：一半逐題點選、一半快速輸入；其中 3 位用手機寬度；同時 4 位並行
  for (let i = 0; i < students.length; i += 4) {
    await Promise.all(students.slice(i, i + 4).map((s, k) => checkOne(s, { quick: (i + k) % 2 === 1, phone: (i + k) % 4 === 3, shot: i + k === 0 ? 'int_student_desktop.png' : (i + k === 3 ? 'int_student_phone.png' : null) })));
  }
  // 2) 第 1 位改答案重送 → 覆寫
  students[0].answers = students[0].answers.map(x => x === 'a' ? 'b' : 'a');
  await checkOne(students[0]);
  // 3a) 前端擋下格式錯誤的學號
  {
    const c = await browser.newContext(); const p = await c.newPage();
    await p.goto(url); await p.fill('#group', '9'); await p.fill('#name', '格式錯'); await p.fill('#sid', 'B12');
    await p.click('#to2');
    assert(await p.isVisible('#f-sid.err')); assert(!(await p.isVisible('#s2')));
    await c.close();
  }
  // 3b) 後端回傳失敗 → 顯示錯誤、可先看結果但標示未送出，恢復後可重送
  {
    breakBackend = true;
    const c = await browser.newContext(); const p = await c.newPage();
    await p.goto(url); await p.fill('#group', '9'); await p.fill('#name', '重送測試'); await p.fill('#sid', 'B14705099');
    await p.click('#to2'); await p.click('details.quick summary'); await p.fill('#quick', 'a'.repeat(32));
    await p.click('#to3'); await p.check('#ok'); await p.click('#send');
    await p.waitForSelector('#sendErr:not([hidden])');
    assert(/後台尚未初始化/.test(await p.textContent('#sendErr')));
    await p.click('#showAnyway'); await p.waitForSelector('#s4:not([hidden])');
    assert.strictEqual(await p.getAttribute('#pending', 'class'), 'note bad');
    breakBackend = false;
    await p.click('#retry');
    await p.waitForFunction(() => document.querySelector('#pending').className === 'note ok');
    await c.close();
    students.push({ group: '9', name: '重送測試', sid: 'B14705099', answers: Array(32).fill('a') });
  }
  // 4) 試算表內容
  const rows = sheets.Responses.rows.slice(1);
  assert.strictEqual(rows.length, 13, '13 位學生、重送不新增');
  rows.forEach(r => { const s = students.find(x => x.sid === r[4]); assert(s, '學號大寫'); assert.strictEqual(r[15], s.answers.join('')); assert.strictEqual(r[5], G.scoreSD5(s.answers).type); });
  const d = G.getDashboardData(G.adminKey_());
  assert.strictEqual(d.current.n, 13);
  const h17 = d.history.find(h => h.year === 2017);
  assert.strictEqual(JSON.stringify([h17.I, h17.E, h17.S, h17.N, h17.T, h17.F, h17.J, h17.P]), JSON.stringify([54, 13, 25, 42, 29, 38, 40, 27]));

  // 5) 用真實彙整結果渲染後台
  let dash = fs.readFileSync(path.join(root, 'gas/Dashboard.html'), 'utf8').replace('<?= adminKey ?>', 'k')
    .replace('<script>', '<script>window.MOCK_DATA=' + JSON.stringify(d) + ';</script><script>');
  const tmp = path.join(shots, '_dash_int.html'); fs.writeFileSync(tmp, dash);
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + tmp); await p.waitForSelector('.tgrid');
  const row17 = await p.$$eval('tbody tr', trs => trs.map(t => t.textContent).find(x => x.startsWith('2017')));
  assert(/40：27/.test(row17) && /59\.7%/.test(row17), '2017 J:P 與 J% ' + row17);
  assert(/13 人已送出/.test(await p.textContent('#meta')));
  await p.click('#btnPresent');
  await p.screenshot({ path: path.join(shots, 'int_dashboard.png'), fullPage: true });
  assert.deepStrictEqual(errs, []);
  await browser.close(); servers.forEach(s => s.close());
  console.log(`整合測試通過：12 位學生（逐題／快速輸入、桌機／手機、4 人並行）經 302 重新導向送出 ${posts} 次，前端結果與後端一致；重送覆寫；前端擋格式錯學號；後端失敗時標示未送出、恢復後重送成功；2017 年 J:P=40:27（J 59.7%）出現在後台。`);
})().catch(e => { console.error(e); servers.forEach(s => s.close()); process.exit(1); });
