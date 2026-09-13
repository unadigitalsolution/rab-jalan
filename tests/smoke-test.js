const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const required = ['package.json','src/main.js','src/preload.js','src/renderer/index.html'];
for (const f of required) {
  if (!fs.existsSync(path.join(root, f))) throw new Error('Missing: ' + f);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const key of ['start','test','build']) {
  if (!pkg.scripts[key]) throw new Error('Missing npm script: ' + key);
}

const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');

// Electron security invariants.
for (const marker of ['contextIsolation: true','nodeIntegration: false','sandbox: true','webSecurity: true']) {
  if (!main.includes(marker)) throw new Error('Missing security setting: ' + marker);
}
for (const table of ['users','kv_store','audit_logs','projects','employees','materials','labor','equipment','ahsp','ahsp_components','boq','invoices','receipts','payroll','stock_transactions']) {
  if (!main.includes('CREATE TABLE IF NOT EXISTS ' + table)) throw new Error('Missing DB table: ' + table);
}
for (const ipc of ['auth:status','auth:create-admin','auth:login','db:integrity','db:backup','storage:load','storage:set','storage:remove','project:save','projects:list']) {
  if (!main.includes("ipcMain.handle('" + ipc + "'")) throw new Error('Missing IPC handler: ' + ipc);
}

// Renderer structure and syntax.
for (const marker of ['alfastecLoginOverlay','Una Digital Solution','Assalamualaikum mohon bantu untuk solusi ...','alfastecAPI','roadLength','roadWidth','workflowRabTable','workflowSumTotal']) {
  if (!html.includes(marker)) throw new Error('Missing HTML marker: ' + marker);
}
const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
if (scriptBlocks.length < 3) throw new Error('Expected application and Electron bridge script blocks.');
for (const [i, code] of scriptBlocks.entries()) new vm.Script(code, { filename: `renderer-inline-${i}.js` });
if ((html.match(/<script/gi)||[]).length !== (html.match(/<\/script>/gi)||[]).length) throw new Error('Unbalanced script tags.');

// Functional API surface required by the final gate.
const funcs = ['newEmployee','saveEmployee','deleteEmployee','newMaterial','saveMaterial','deleteMaterial','addStockTransaction','newAHSP','saveAHSP','deleteAHSP','newLabor','saveLabor','deleteLabor','newEquipment','saveEquipment','deleteEquipment','newPrice','savePrice','deletePrice','addBOQ','recalculateBOQ','clearBOQ','deleteBOQ','printRAB','printBOQ','exportCSV','newPayroll','savePayroll','deletePayroll','printPayslip','calculatePercent','savePercentCalc','newInvoice','saveInvoice','deleteInvoice','printInvoice','newReceipt','saveReceipt','deleteReceipt','printReceipt'];
for (const f of funcs) if (!new RegExp('(?:function\\s+' + f + '\\s*\\(|window\\.' + f + '\\s*=)').test(html)) throw new Error('Missing functional surface: ' + f);

// No fake workflow totals should remain.
for (const fake of ['Rp 367.187.500','Rp 31.250.000','Rp 140.625.000','Rp 195.312.500']) {
  if (html.includes(fake)) throw new Error('Hard-coded example total remains: ' + fake);
}
if (html.includes('<title>ALFASTEC Prototype</title>')) throw new Error('Prototype title remains.');

execFileSync(process.execPath, ['--check', path.join(root, 'src/main.js')], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', path.join(root, 'src/preload.js')], { stdio: 'pipe' });
console.log(`ALFASTEC Electron full static audit: PASS (${scriptBlocks.length} renderer scripts, ${funcs.length} functional surfaces)`);
