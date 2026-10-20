// node tests/test_e2e.js — 學生端全流程與老師後台畫面（GAS 以假端點代替）
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
const FAKE = 'https://script.google.com/macros/s/FAKE/exec';

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let posted = null, fail = vp.name === 'phone'; // 手機版先模擬一次送出失敗
    await page.route(FAKE + '**', async route => {
      if (fail) { fail = false; return route.abort(); }
      posted = JSON.parse(route.request().postData());
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, type: 'ENTJ' }) });
    });
    await page.goto('file://' + path.join(root, 'index.html') + '?api=' + encodeURIComponent(FAKE));
    // Step 1 驗證
    await page.click('#to2');
    assert(await page.isVisible('#f-name.err'), '空白姓名需提示');
    await page.fill('#group', '3'); await page.fill('#name', '測試同學'); await page.fill('#sid', 'b14705001');
    await page.click('#to2');
    assert(await page.isVisible('#s2'));
    // 結果在填完前不可見
    assert(!(await page.isVisible('#s4')));
    // 只填一部分 → 擋下
    for (let i = 1; i <= 5; i++) await page.click(`#q${i} button[data-v=a]`);
    await page.click('#to3');
    assert(await page.isVisible('#missMsg')); assert(!(await page.isVisible('#s3')));
    if (vp.name === 'desktop') await page.screenshot({ path: path.join(out, 'step2_missing.png'), fullPage: true });
    // 快速輸入補齊
    await page.click('details.quick summary');
    await page.fill('#quick', 'a'.repeat(32));
    assert.strictEqual(await page.textContent('#cnt'), '已填 32 / 32 題');
    await page.click('#to3');
    assert(await page.isVisible('#s3'));
    assert(await page.isDisabled('#send'), '未勾核對不可送出');
    await page.check('#ok');
    await page.click('#send');
    if (vp.name === 'phone') {
      await page.waitForSelector('#sendErr:not([hidden])');
      assert(await page.isVisible('#showAnyway'));
      await page.click('#send');
    }
    await page.waitForSelector('#s4:not([hidden])');
    assert.strictEqual((await page.textContent('#typeBox')).trim(), 'ENTJ');
    assert.strictEqual(posted.answers, 'a'.repeat(32)); assert.strictEqual(posted.sid, 'B14705001');
    assert.strictEqual(await page.locator('.dim td.hit').count(), 32, '32 個圈選');
    assert.strictEqual(await page.locator('.dim .tie').count(), 2, 'I/E 與 S/N 平手說明');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(sw <= vp.width, vp.name + ' 不可橫向捲動：' + sw);
    await page.screenshot({ path: path.join(out, `result_${vp.name}.png`), fullPage: true });
    // 重新整理後仍顯示結果
    await page.reload(); await page.waitForSelector('#s4:not([hidden])');
    // 修改答案會清掉結果，需要重新送出
    await page.click('#restart'); assert(await page.isVisible('#s2'));
    await page.click('#q1 button[data-v=b]');
    await page.click('#to3'); assert(await page.isDisabled('#send'));
    assert.deepStrictEqual(errors, []);
    await page.close();
  }

  // 老師後台：以 60 位隨機同學的模擬資料
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock_data.json'), 'utf8'));
  const TYPES = Object.keys(base.current.types);
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  const roster = Array.from({ length: 60 }, (_, i) => ({ group: String(1 + (i % 12)), name: '同學' + (i + 1), sid: 'B147050' + String(i + 1).padStart(2, '0'),
    type: TYPES[Math.floor(rnd() * 16)].replace(/^E/, rnd() < .4 ? 'I' : 'E').replace(/S/, rnd() < .65 ? 'N' : 'S'), tie: i % 9 === 0 ? 'IE平手→E' : '' }));
  const cur = { n: 60, types: {}, dims: {}, groups: {}, ties: roster.filter(r => r.tie).length };
  TYPES.forEach(t => cur.types[t] = 0); 'IESNTFJP'.split('').forEach(k => cur.dims[k] = 0);
  roster.forEach(r => { cur.types[r.type]++; r.type.split('').forEach(c => cur.dims[c]++); (cur.groups[r.group] = cur.groups[r.group] || []).push(r.type); });
  cur.representative = [['I','E'],['S','N'],['T','F'],['J','P']].map(([a, b]) => cur.dims[a] === cur.dims[b] ? a + '/' + b : cur.dims[a] > cur.dims[b] ? a : b).join('');
  const mx = Math.max(...Object.values(cur.types)); cur.modal = TYPES.filter(t => cur.types[t] === mx); cur.modalCount = mx;
  const mock = Object.assign({}, base, { current: cur, roster });
  let dash = fs.readFileSync(path.join(root, 'gas/Dashboard.html'), 'utf8').replace('<?= adminKey ?>', 'k');
  dash = dash.replace('<script>', '<script>window.MOCK_DATA=' + JSON.stringify(mock) + ';</script><script>');
  const tmp = path.join(__dirname, 'shots', '_dash.html'); fs.writeFileSync(tmp, dash);
  for (const vp of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: vp });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('file://' + tmp);
    await page.waitForSelector('.tgrid');
    assert.strictEqual(await page.locator('.cell').count(), 16);
    assert.strictEqual(await page.locator('.mini svg').count(), 4);
    assert.strictEqual(await page.locator('tbody tr.live').count(), 1);
    await page.hover('.mini rect.hit >> nth=0'); assert(await page.isVisible('#tip'));
    await page.screenshot({ path: path.join(out, `dashboard_${vp.name}.png`), fullPage: true });
    await page.click('#btnPresent'); assert(!(await page.isVisible('.private')));
    if (vp.name === 'desktop') await page.screenshot({ path: path.join(out, 'dashboard_present.png'), fullPage: true });
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(sw <= vp.width, 'dashboard ' + vp.name + ' 橫向捲動：' + sw);
    assert.deepStrictEqual(errors, []);
    await page.close();
  }
  await browser.close();
  console.log('E2E 通過：欄位驗證、未填完不可看結果、核對才可送出、送出失敗重試、結果與圈選、重新整理、改答案需重送；後台 16 型、趨勢、公佈模式、手機寬度。');
})().catch(e => { console.error(e); process.exit(1); });
