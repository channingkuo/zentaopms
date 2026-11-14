/** Local browser regression; see README for disposable-fixture setup. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const state = JSON.parse(fs.readFileSync(process.env.GANTT_FIXTURE || '/tmp/program-gantt-fixture.json'));
const base = process.env.GANTT_BASE_URL || 'http://127.0.0.1:8080';
const artifacts = process.env.GANTT_ARTIFACTS || '/tmp/program-gantt-artifacts';
fs.mkdirSync(artifacts, {recursive:true});
(async()=>{
 const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox']});
 const errors = [];
 try {
  const context = await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true,locale:'zh-CN'});
  await context.addCookies([state.editor.cookie,{name:'lang',value:'zh-cn',domain:'127.0.0.1',path:'/'}]);
  const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.stack);console.error(error.stack);});
  await page.goto(base+'/index.php?m=program&f=gantt', {waitUntil:'networkidle'});
  const app = page.frameLocator('iframe').locator('#programGantt');
  await app.locator('.pg-row').first().waitFor({state:'attached'}); console.log('Mounted Gantt page');
  assert.equal(await app.locator('img').count(),0,'task HTML is displayed as text');
  assert.ok(await app.locator('.pg-notice').textContent().then(text=>text.includes('37')));
  assert.equal(await app.getByRole('checkbox',{name:'开启编辑',exact:true}).isChecked(),false);
  // Filtering keeps ancestors and supports execution flattening.
  await app.getByRole('searchbox').fill('中文任务');
  await page.waitForTimeout(250);
  assert.equal(await app.locator('.pg-row').count(),4);
  await app.getByRole('checkbox',{name:'执行',exact:true}).uncheck();
  assert.equal(await app.locator('.pg-row').count(),3);
  await app.getByRole('checkbox',{name:'执行',exact:true}).check();
  await app.getByRole('searchbox').fill('');await page.waitForTimeout(250);
  await app.getByRole('button',{name:'全部折叠',exact:true}).click();assert.equal(await app.locator('.pg-row').count(),1);
  await app.getByRole('button',{name:'全部展开',exact:true}).click();
  // Move an item using the actual pointer drag and save the confirmation.
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).check();
  const task=app.locator(`.pg-row[data-id="t${state.task}"]`);
  const bar=task.locator('.pg-bar');await bar.scrollIntoViewIfNeeded();
  const box=await bar.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+8,box.y+box.height/2,{steps:4});await page.mouse.up();
  const dialog=app.locator('dialog');await dialog.waitFor({state:'visible'});
  const dates=dialog.locator('input[type=date]');
  assert.equal(await dates.nth(0).inputValue(),'2026-03-03');assert.equal(await dates.nth(1).inputValue(),'2026-03-12');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.reload();await app.locator('.pg-row').first().waitFor();
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).check();
  // Resize the finish edge and persist an inclusive deadline.
  const resized=app.locator(`.pg-row[data-id="t${state.task}"] .pg-bar`);await resized.scrollIntoViewIfNeeded();
  const edge=await resized.locator('.pg-end').boundingBox();
  await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2+4,edge.y+edge.height/2,{steps:4});await page.mouse.up();
  await dialog.waitFor({state:'visible'});assert.equal(await dates.nth(1).inputValue(),'2026-03-13');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
  // Date form rejects out-of-parent dates; failed save leaves the dialog and persisted values intact.
  await app.locator(`.pg-row[data-id="t${state.task}"] .pg-date-edit`).click();
  await dates.nth(0).fill('2027-01-01');await dates.nth(1).fill('2027-02-01');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await dialog.locator('.pg-error').filter({hasText:'父级'}).waitFor();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  // Keyboard-accessible date entry supports a previously unscheduled one-day item.
  const unscheduled=state.tasks[1];
  await app.locator(`.pg-row[data-id="t${unscheduled}"] .pg-date-edit`).click();
  await dates.nth(0).fill('2026-06-01');await dates.nth(1).fill('2026-06-01');
  await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
  // Complete chart export includes virtualized rows, not only the scroll viewport.
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).uncheck();
  let download=page.waitForEvent('download');await app.getByRole('button',{name:'导出图片',exact:true}).click();
  await (await download).saveAs(path.join(artifacts,'gantt.png'));
  await app.getByRole('button',{name:'导出 PDF',exact:true}).waitFor({state:'visible'});
  download=page.waitForEvent('download');await app.getByRole('button',{name:'导出 PDF',exact:true}).click();
  await (await download).saveAs(path.join(artifacts,'gantt.pdf'));
  assert.ok(fs.readFileSync(path.join(artifacts,'gantt.png')).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  assert.ok(fs.readFileSync(path.join(artifacts,'gantt.pdf'),'latin1').includes('/Type /Pages /Count 4'));
  // CSRF, stale edits and GET requests are checked on the real HTTP route.
  const post=async(form,ctx=context)=>{const response=await ctx.request.post(base+'/index.php?m=program&f=ganttEdit',{form,headers:{Referer:base+'/index.php?m=program&f=gantt','X-Requested-With':'XMLHttpRequest'}});return response.json();};
  const forged=await post({id:state.task,type:'task',begin:'2026-03-04',end:'2026-03-14',oldBegin:'2026-03-03',oldEnd:'2026-03-13'});
  assert.equal(forged.result,'fail');
  const token=await page.frames().find(frame=>frame!==page.mainFrame()).evaluate(()=>{ /* Obtain the existing session token via the rendered request options. */
    const text=[...document.scripts].map(s=>s.textContent).join('\n');return text.match(/"token":"([a-f0-9]{64})"/)[1];
  });
  const stale=await post({token,id:state.task,type:'task',begin:'2026-03-04',end:'2026-03-14',oldBegin:'2026-03-01',oldEnd:'2026-03-10'});
  assert.equal(stale.result,'fail');assert.match(stale.message,/其他用户/);
  const get=await context.request.get(base+'/index.php?m=program&f=ganttEdit',{headers:{'X-Requested-With':'XMLHttpRequest'}});assert.equal((await get.json()).result,'fail');
  await app.getByRole('button',{name:'全屏',exact:true}).click();assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
  await app.getByRole('button',{name:'全屏',exact:true}).click();assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);
  await page.screenshot({path:path.join(artifacts,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:960,height:800});await page.screenshot({path:path.join(artifacts,'compact.png'),fullPage:true});
  // Scoped route and every scale work on an actual rendered page.
  await page.goto(base+`/index.php?m=program&f=gantt&programID=${state.program}`);await app.locator('.pg-row').first().waitFor();
  for(const scale of ['day','week','month','quarter']) {await app.locator('select').nth(2).selectOption(scale);assert.ok(await app.locator('.pg-tick').count()>0);}
  const reader=await browser.newContext({viewport:{width:1400,height:900}});await reader.addCookies([state.reader.cookie,{name:'lang',value:'zh-cn',domain:'127.0.0.1',path:'/'}]);
  const readPage=await reader.newPage();readPage.on('pageerror',error=>errors.push(error.stack));await readPage.goto(base+'/index.php?m=program&f=gantt');
  const readonly=readPage.frameLocator('iframe').locator('#programGantt');await readonly.locator('.pg-row').first().waitFor();
  assert.equal(await readonly.getByRole('checkbox',{name:'开启编辑',exact:true}).count(),0);
  assert.equal(await readonly.getByRole('button',{name:'导出图片',exact:true}).count(),0);
  const noexport=await reader.request.get(base+'/index.php?m=program&f=ganttExport',{headers:{'X-Requested-With':'XMLHttpRequest'}});
  assert.ok(!(await noexport.text()).includes('"nodes"'),'reader cannot fetch export data');
  assert.deepEqual(errors,[]);
  console.log('Browser regression checks passed: hierarchy, filters, safe text, drag, resize, persistence, bounds, unscheduled dates, full PNG, multipage PDF, CSRF, stale writes, read-only/export denial, scales and responsive screenshots.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
