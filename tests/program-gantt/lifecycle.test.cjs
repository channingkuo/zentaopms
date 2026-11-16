/** Reproduce first SPA entry and exercise in-place refresh as a real admin/PM. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = JSON.parse(fs.readFileSync(process.env.GANTT_FIXTURE || '/tmp/program-gantt-fixture.json'));
const base = process.env.GANTT_BASE_URL || 'http://127.0.0.1:8080';
const artifacts = process.env.GANTT_ARTIFACTS || '/tmp/program-gantt-artifacts';
fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addCookies([fixture.admin.cookie,{name:'lang',value:'zh-cn',domain:'127.0.0.1',path:'/'}]);
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  let navigations=0;page.on('framenavigated',()=>navigations++);
  await page.goto(base+'/index.php?m=program&f=browse',{waitUntil:'networkidle'});
  const frame=page.frameLocator('iframe');
  const app=frame.locator('#programGantt');
  // No browser reload: click exactly the same navigation entry as the reported failure.
  await frame.getByRole('link',{name:'项目集甘特图',exact:true}).click();
  await app.getByRole('searchbox').waitFor();
  assert.equal(await app.locator('.pg-toolbar').count(),2);
  assert.ok(await app.locator('.pg-row').count()>0);
  await page.screenshot({path:path.join(artifacts,'admin-first-spa-entry.png'),fullPage:true});
  // Repeated navigation must reconnect one renderer without duplicate handlers.
  for(let i=0;i<3;i++) {
   await frame.getByRole('link',{name:'项目视角',exact:true}).click();
   await app.waitFor({state:'detached'});
   await frame.getByRole('link',{name:'项目集甘特图',exact:true}).click();
   await app.getByRole('searchbox').waitFor();
   assert.equal(await app.locator('.pg-toolbar').count(),2);
  }
  await app.locator('select').nth(0).selectOption('p'+fixture.program);
  await app.locator('[data-scale=quarter]').click();
  await app.getByRole('searchbox').fill('任务');await page.waitForTimeout(200);
  await app.getByRole('checkbox',{name:'执行',exact:true}).uncheck();
  await app.getByText('显示字段',{exact:true}).click();
  await app.getByRole('checkbox',{name:'负责人',exact:true}).uncheck();
  await app.getByText('显示字段',{exact:true}).click();
  const viewport=app.locator('.pg-viewport');
  await viewport.evaluate(el=>{el.scrollTop=180;el.scrollLeft=100});
  await app.evaluate(el=>{el.__refreshMarker='same-root'});
  const snapshot=await viewport.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));
  const range=await app.locator('.pg-control input[type=date]').evaluateAll(inputs=>inputs.map(input=>input.value));
  const before=navigations;
  // Read from the real permission-checked endpoint, then mimic a newly updated row.
  const dataURL=base+'/index.php?m=program&f=gantt&programID=0&dataOnly=1';
  const data=await (await context.request.get(dataURL,{headers:{'X-Requested-With':'XMLHttpRequest'}})).json();
  assert.equal(data.result,'success');assert.equal(data.options.canEdit,true);
  data.options.nodes.find(node=>node.id==='t'+fixture.task).name='刷新后的任务';
  let mode='success';
  await page.route('**/*dataOnly=1',async route=>{
   await new Promise(resolve=>setTimeout(resolve,300));
   if(mode==='failure') return route.abort('failed');
   if(mode==='empty') return route.fulfill({json:{...data,options:{...data.options,nodes:[]}}});
   return route.fulfill({json:data});
  });
  await app.getByRole('button',{name:'刷新',exact:true}).click();
  await app.getByRole('status').filter({hasText:'正在刷新'}).waitFor();
  assert.ok(await app.locator('.pg-row').count()>0,'old chart stays visible while fetching');
  await app.getByRole('button',{name:'刷新',exact:true}).waitFor();
  await app.getByRole('status').filter({hasText:'当前为只读'}).waitFor();
  assert.equal(await app.evaluate(el=>el.__refreshMarker),'same-root');
  assert.equal(navigations,before,'refresh must not navigate the browser or iframe');
  assert.equal(await app.getByRole('searchbox').inputValue(),'任务');
  assert.equal(await app.locator('select').nth(0).inputValue(),'p'+fixture.program);
  assert.equal(await app.locator('[data-scale=quarter]').getAttribute('aria-pressed'),'true');
  assert.equal(await app.getByRole('checkbox',{name:'执行',exact:true}).isChecked(),false);
  assert.deepEqual(await viewport.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft})),snapshot);
  assert.deepEqual(await app.locator('.pg-control input[type=date]').evaluateAll(inputs=>inputs.map(input=>input.value)),range);
  assert.ok(await app.locator('.pg-name').filter({hasText:'刷新后的任务'}).count());
  mode='failure';
  await app.getByRole('button',{name:'刷新',exact:true}).click();
  await app.getByRole('status').filter({hasText:'刷新失败'}).waitFor();
  assert.ok(await app.locator('.pg-row').count()>0);
  assert.equal(navigations,before);
  await page.screenshot({path:path.join(artifacts,'admin-refresh-retains-chart.png'),fullPage:true});
  mode='empty';
  await app.getByRole('button',{name:'刷新',exact:true}).click();
  await app.getByText('没有符合条件的数据',{exact:true}).waitFor();
  assert.equal(await app.locator('.pg-toolbar').count(),2,'an empty result still renders controls and an explanation');
  assert.deepEqual(errors,[]);
  console.log('Admin lifecycle checks passed: first SPA entry, repeated navigation, permission-checked data, in-place refresh, visible pending/error states, retained filters/scroll and empty state.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
