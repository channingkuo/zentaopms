/** Verify real logged-in startup while Programs are disabled, then re-enabled. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixturePath=process.env.GANTT_FIXTURE || '/tmp/program-gantt-fixture.json';
const fixture=JSON.parse(fs.readFileSync(fixturePath));
const base=process.env.GANTT_BASE_URL || 'http://127.0.0.1:8080';
const mode=value=>execFileSync(process.env.PHP_BINARY || 'php',[path.join(__dirname,'browser-fixture.php'),'mode',fixturePath,value],{env:{...process.env,GANTT_BROWSER_FIXTURE:'1'},stdio:'pipe'});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1400,height:900}});
  await context.addCookies([fixture.admin.cookie,{name:'lang',value:'zh-cn',domain:'127.0.0.1',path:'/'}]);
  const page=await context.newPage();
  for(const value of ['light','disabled']) {
   mode(value);
   // The reported crash happens before any controller runs, during user-view setup.
   const response=await context.request.get(base+'/index.php?m=project&f=browse&zin=1',{headers:{'X-Requested-With':'XMLHttpRequest'}});
   assert.equal(response.status(),200);
   assert.doesNotMatch(await response.text(),/Fatal error|Attempt to assign property/);
   await page.goto(base+'/index.php?m=project&f=browse',{waitUntil:'networkidle'});
   const frame=page.frameLocator('iframe');
   await frame.locator('#main').waitFor();
   assert.equal(await frame.getByRole('link',{name:'项目集甘特图',exact:true}).count(),0);
   const denied=await (await context.request.get(base+'/index.php?m=program&f=gantt&dataOnly=1',{headers:{'X-Requested-With':'XMLHttpRequest'}})).json();
   assert.equal(denied.result,'fail');
   assert.match(denied.message,/启用项目集/);
  }
  mode('enabled');
  await page.goto(base+'/index.php?m=program&f=browse',{waitUntil:'networkidle'});
  const frame=page.frameLocator('iframe');
  await frame.getByRole('link',{name:'项目集甘特图',exact:true}).click();
  await frame.locator('#programGantt .pg-row').first().waitFor();
  console.log('Logged-in feature checks passed: light/disabled project startup, hidden Gantt entry, graceful denial and re-enabled chart.');
 } finally {mode('enabled');await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
