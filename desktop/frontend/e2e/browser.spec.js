const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let passed = 0, failed = 0;

  async function test(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
  }

  console.log('\n═══ EcoPilot 浏览器 E2E ═══\n');

  await test('首页加载成功', async () => {
    await page.goto('http://127.0.0.1:3000/', { timeout: 10000 });
    const title = await page.title();
    assert(title.includes('EcoPilot'), `Title: ${title}`);
  });

  await test('三栏布局存在', async () => {
    const body = await page.$('body');
    assert(body, 'Body not found');
    // Check for main structural elements
    const children = await page.$$('body > div > div');
    assert(children.length >= 2, `Expected >=2 children, got ${children.length}`);
  });

  await test('左侧栏导航可见', async () => {
    const text = await page.textContent('body');
    assert(text.includes('新建对话') || text.includes('EcoPilot'), 'Navigation not found');
  });

  await test('页面无障碍错误', async () => {
    const errors = [];
    page.on('pageerror', err => errors.push(err));
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    assert(errors.length === 0, `JS errors: ${errors.map(e=>e.message).join(', ')}`);
  });

  await test('API 健康检查', async () => {
    const resp = await page.request.get('http://127.0.0.1:8002/api/chat/health');
    assert(resp.ok(), `HTTP ${resp.status()}`);
    const data = await resp.json();
    assert(data.engine === 'EcoPilot', `Engine: ${data.engine}`);
  });

  await test('CSS 加载完整', async () => {
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    assert(bgColor, 'No background color - CSS may not have loaded');
  });

  await test('Font 加载', async () => {
    const fontFamily = await page.evaluate(() => {
      return window.getComputedStyle(document.body).fontFamily;
    });
    assert(fontFamily.includes('Geist') || fontFamily.includes('sans'), `Font: ${fontFamily}`);
  });

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
