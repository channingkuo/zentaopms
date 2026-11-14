const assert = require('node:assert/strict');
const {date, iso, validRange, visibleRows, ticks, makePDF} = require('../../extension/custom/program/ext/js/gantt/programgantt.ui.js');
const state = {scope:'',status:'all',search:'',executions:true,tasks:true,collapsed:new Set()};
const nodes = [
 {id:'p1',parent:'',type:'program',name:'Visible program',status:'doing'},
 {id:'p2',parent:'p1',type:'program',name:'Nested program',status:'wait'},
 {id:'p3',parent:'p2',type:'project',name:'Release',status:'doing'},
 {id:'p4',parent:'p3',type:'execution',name:'Sprint',status:'doing'},
 {id:'t1',parent:'p4',type:'task',name:'中国任务 <script>',status:'closed'},
 {id:'p5',parent:'',type:'program',name:'Closed program',status:'closed'},
 {id:'p6',parent:'p5',type:'project',name:'Other release',status:'doing'}
];
assert.equal(date('2026-02-30'), null);
assert.equal(date('0000-00-00'), null);
assert.equal(date('1899-12-31'), null);
assert.equal(iso(date('2024-02-29')), '2024-02-29');
assert.equal(validRange('2026-01-02','2026-01-01'),false);
assert.equal(validRange('2020-01-01','2040-01-01'),false);
assert.equal(validRange('2026-01-01','2026-01-01'),true);
assert.equal(visibleRows(nodes,state).length,7);
assert.deepEqual(visibleRows(nodes,{...state,scope:'p2'}).map(n=>n.id),['p2','p3','p4','t1']);
assert.deepEqual(visibleRows(nodes,{...state,executions:false}).map(n=>n.id),['p1','p2','p3','t1','p5','p6']);
assert.equal(visibleRows(nodes,{...state,executions:false}).find(n=>n.id==='t1').depth,3);
assert.deepEqual(visibleRows(nodes,{...state,search:'中国'}).map(n=>n.id),['p1','p2','p3','p4','t1']);
assert.deepEqual(visibleRows(nodes,{...state,collapsed:new Set(['p2'])}).map(n=>n.id),['p1','p2','p5','p6']);
assert.deepEqual(visibleRows(nodes,{...state,status:'closed'}).map(n=>n.id),['p5','p6']);
assert.ok(visibleRows(nodes,{...state,status:'unclosed'}).some(n=>n.id==='t1'), 'program filter must not remove closed tasks');
assert.equal(ticks(date('2024-02-01'),date('2024-03-31'),'month')[0].end,date('2024-03-01'));
assert.equal(ticks(date('2026-01-01'),date('2026-12-31'),'quarter').length,4);
(async()=>{
 const pdf = makePDF([{width:2,height:2,bytes:new Uint8Array([0xff,0xd8,0xff,0xd9])},{width:2,height:2,bytes:new Uint8Array([0xff,0xd8,0xff,0xd9])}]);
 const bytes=Buffer.from(await pdf.arrayBuffer()), text=bytes.toString('latin1');
 assert.ok(text.startsWith('%PDF-1.4'));
 assert.ok(text.includes('/Count 2'));
 const xref=Number(text.match(/startxref\n(\d+)/)[1]);
 assert.equal(text.slice(xref,xref+4),'xref');
 const offsets=text.slice(xref).match(/\d{10} 00000 n/g).map(s=>Number(s.slice(0,10)));
 offsets.forEach((offset,i)=>assert.ok(text.slice(offset).startsWith(`${i+1} 0 obj`)));
 console.log('Frontend regression checks passed (dates, hierarchy, filters, calendar ticks, PDF byte offsets).');
})().catch(error=>{console.error(error);process.exitCode=1;});
