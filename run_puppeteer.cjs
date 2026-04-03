const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  try {
    await page.goto('http://127.0.0.1:1420', { waitUntil: 'networkidle0', timeout: 5000 });
  } catch (e) {
    console.log("Goto error:", e.message);
  }
  
  await browser.close();
})();
