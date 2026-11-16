/** Browser presentation regression, with deterministic data and no database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const source = 'extension/custom/program/ext/';
const lang = Object.fromEntries([...fs.readFileSync(path.join(root, source, 'lang/zh-cn/programgantt.php'), 'utf8').matchAll(/"(\w+)" => "([^"]*)"/g)].map(match => [match[1], match[2]]));
const nodes = [
 {id:'p1',objectID:1,parent:'',type:'program',name:'企业数字化项目集',owner:'李明',status:'doing',begin:'2026-11-08',end:'2026-12-01',progress:36},
 {id:'p2',objectID:2,parent:'p1',type:'project',name:'企业网站第二期',owner:'王芳',status:'doing',begin:'2026-11-10',end:'2026-11-28',progress:50},
 ...Array.from({length:24}, (_,i) => ({id:'t'+i,objectID:i+10,parent:'p2',type:'task',name:i===0?'成果展示的设计：完整的长任务名称应保留在悬停提示中':i===23?'<img src=x onerror=alert(1)>':`成果展示的开发 ${i}`,begin:i===2?'':`2026-11-${String(11+i%10).padStart(2,'0')}`,end:i===2?'':`2026-11-${String(13+i%10).padStart(2,'0')}`,progress:25,editable:true,status:'doing',owner:'张三'}))
];
const options = {lang,nodes,canEdit:true,canExport:true,dataURL:'http://gantt.test/data',saveURL:'http://gantt.test/save',exportURL:'http://gantt.test/export'};
(async()=>{
 const browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-11-16T08:00:00Z')});
  await page.route('http://gantt.test/**', route=>route.fulfill({contentType:'application/json',body:JSON.stringify({result:'success',options,nodes})}));
  await page.goto('http://gantt.test/');
  await page.setContent('<html lang="zh"><style>body{font:14px system-ui;margin:24px;background:#f6f8fb}.btn{border:1px solid #dce3ec;border-radius:4px;padding:6px 10px;background:white;cursor:pointer}*{box-sizing:border-box}</style><div id="programGantt"></div></html>');
  await page.addStyleTag({path:path.join(root,source,'css/gantt/programgantt.ui.css')});
  await page.evaluate(opts=>window.programGanttOptions=opts,options);
  await page.addScriptTag({path:path.join(root,source,'js/gantt/programgantt.ui.js')});
  const app=page.locator('#programGantt');
  await app.locator('.pg-row').first().waitFor();
  assert.equal(await app.locator('[data-scale=week]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await app.locator('.pg-heading .pg-cell').allTextContents(),['名称','工期']);
  assert.equal(await app.locator('.pg-row').first().locator('.pg-cell').last().textContent(),'24 天');
  assert.equal(await app.locator('.pg-major').first().textContent(),'2026年11月');
  assert.equal(await app.locator('.pg-minor').nth(1).textContent(),'11/2–11/8');
  assert.equal(await app.locator('.pg-minor').count(),8,'week mode groups calendar weeks instead of days');
  assert.ok(await app.locator('.pg-current').count());
  assert.equal(await app.locator('img').count(),0,'names stay plain text');
  const row=app.locator('[data-id=t0]');
  assert.equal(await row.locator('.pg-task-meta .pg-detail-owner').textContent(),'负责人: 张三');
  assert.equal(await row.locator('.pg-task-meta .pg-detail-status').textContent(),'状态: 进行中');
  assert.equal(await row.locator('.pg-task-schedule .pg-detail-begin').textContent(),'2026-11-11');
  assert.equal(await row.locator('.pg-task-schedule .pg-detail-end').textContent(),'→ 2026-11-13');
  assert.equal(await row.locator('.pg-task-schedule .pg-detail-progress').textContent(),'进度: 25%');
  assert.deepEqual(await row.locator('.pg-detail-owner').evaluate(el=>({size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color})),{size:'10px',color:'rgb(132, 146, 166)'});
  await app.getByRole('checkbox',{name:'日期',exact:true}).uncheck();
  assert.equal(await row.locator('.pg-detail-begin,.pg-detail-end').count(),0);
  await app.getByRole('checkbox',{name:'日期',exact:true}).check();
  await app.getByText('显示字段',{exact:true}).click();
  for(const [label,key] of [['负责人','owner'],['状态','status'],['进度','progress']]) {
   await app.getByRole('checkbox',{name:label,exact:true}).uncheck();
   assert.equal(await row.locator('.pg-detail-'+key).count(),0);
   await app.getByRole('checkbox',{name:label,exact:true}).check();
  }
  await app.getByText('显示字段',{exact:true}).click();
  assert.deepEqual(await app.locator('.pg-heading .pg-cell').allTextContents(),['名称','工期'],'inline fields never add table columns');

  assert.ok((await row.locator('.pg-cell').first().getAttribute('title')).includes('完整的长任务名称'));
  assert.ok((await row.locator('.pg-bar-label').textContent()).includes('成果展示'));
  assert.equal(await app.locator('[data-id=t2] .pg-unscheduled').textContent(),'未排期');
  assert.equal(await app.locator('[data-id=t2] .pg-cell').last().textContent(),'—');
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).check();
  const weeklyBar=await row.locator('.pg-bar').boundingBox();
  await page.mouse.move(weeklyBar.x+weeklyBar.width/2,weeklyBar.y+weeklyBar.height/2);
  await page.mouse.down();
  await page.mouse.move(weeklyBar.x+weeklyBar.width/2+24,weeklyBar.y+weeklyBar.height/2,{steps:3});
  await page.mouse.up();
  await app.locator('dialog').waitFor({state:'visible'});
  assert.equal(await app.locator('dialog input[type=date]').first().inputValue(),'2026-11-12','weekly grouping keeps drag precision at one day');
  await app.getByRole('button',{name:'取消',exact:true}).click();
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).uncheck();
  await app.locator('[data-scale=day]').click();
  assert.equal(await app.locator('.pg-minor').count(),45,'day mode shows each date separately');
  await app.getByRole('button',{name:'今天',exact:true}).click();
  const vp=app.locator('.pg-viewport');
  assert.ok(await vp.evaluate(el=>el.scrollLeft>0));
  await page.waitForFunction(() => {
   const viewport=document.querySelector('.pg-viewport'), fixed=viewport.querySelector('[data-id=t0] .pg-fixed');
   return fixed && Math.abs(fixed.getBoundingClientRect().x-viewport.getBoundingClientRect().x)<3;
  });
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).check();
  await row.locator('.pg-date-edit').click();
  assert.equal(await app.locator('dialog input[type=date]').first().inputValue(),'2026-11-11');
  await app.getByRole('button',{name:'取消',exact:true}).click();
  await app.getByRole('checkbox',{name:'开启编辑',exact:true}).uncheck();
  await app.locator('[data-scale=month]').click();
  assert.deepEqual(await app.locator('.pg-minor').allTextContents(),['11月','12月']);
  await app.locator('[data-scale=quarter]').click();
  assert.equal(await app.locator('.pg-minor').first().textContent(),'Q4');
  await app.locator('[data-scale=day]').click();
  assert.equal(await app.locator('.pg-minor').first().textContent(),'1周日');
  // Today also moves a past-only range and synchronizes the visible date controls.
  const dates=app.locator('.pg-control input[type=date]');
  await dates.nth(0).fill('2025-01-01'); await dates.nth(1).fill('2025-01-31');
  await app.getByRole('button',{name:'今天',exact:true}).click();
  assert.ok((await dates.nth(0).inputValue()) <= '2026-11-16');
  assert.ok((await dates.nth(1).inputValue()) >= '2026-11-16');
  await dates.nth(0).fill('2026-11-08');await dates.nth(1).fill('2026-12-01');
  await app.locator('[data-scale=week]').click();
  await app.getByRole('button',{name:'今天',exact:true}).click();
  const artifacts=process.env.GANTT_ARTIFACTS || '/tmp/program-gantt-artifacts';fs.mkdirSync(artifacts,{recursive:true});
  let downloaded=page.waitForEvent('download');
  await app.getByRole('button',{name:'导出图片',exact:true}).click();
  const pngPath=path.join(artifacts,'friendly-export.png');await (await downloaded).saveAs(pngPath);
  const png=fs.readFileSync(pngPath);
  assert.equal(png.readUInt32BE(16),420+24*24,'export includes the full time range');
  assert.equal(png.readUInt32BE(20),124+nodes.length*56,'export includes all virtual rows and both header levels');
  downloaded=page.waitForEvent('download');
  await app.getByRole('button',{name:'导出 PDF',exact:true}).click();
  const pdfPath=path.join(artifacts,'friendly-export.pdf');await (await downloaded).saveAs(pdfPath);
  assert.ok(fs.readFileSync(pdfPath,'latin1').includes('/Type /Pages /Count 2'));
  await page.screenshot({path:path.join(artifacts,'friendly-desktop.png'),fullPage:true});
  await page.setViewportSize({width:960,height:800});
  await page.screenshot({path:path.join(artifacts,'friendly-compact.png'),fullPage:true});
  await vp.evaluate(el=>el.scrollTop=600);await page.waitForTimeout(100);
  const tops=await app.locator('.pg-row').evaluateAll(rows=>rows.map(el=>({y:el.getBoundingClientRect().top,alternate:el.classList.contains('pg-alternate'),index:Number(el.style.top.replace('px',''))/56})));
  assert.ok(tops.every(row=>row.alternate===(row.index%2===1)),'virtualization preserves stripe parity');
  assert.deepEqual(errors,[]);
  console.log('Presentation checks passed: compact columns, calendar scales, sticky scrolling, today navigation, safe labels, undated rows, date dialog, virtual rows and PNG/PDF export.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
