const {chromium}=require(process.env.STECH_TEST_TOOLS ? require('node:path').join(process.env.STECH_TEST_TOOLS,'node_modules/playwright') : 'playwright');
const {mkdtemp,mkdir}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {DemoStore}=require('../electron/core.cjs');
const {KioskSession}=require('../electron/session.cjs');
(async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'stech-portrait-'));
 const out=path.join(__dirname,'../docs/screenshots/portrait');await mkdir(out,{recursive:true});
 const store=new DemoStore(path.join(dir,'wallets.json'));await store.initialize();
 const session=new KioskSession({demo:store,mode:'demo',idleSeconds:120});
 const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1080,height:1920}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('testKioskCall',async(action,payload)=>{try{return {ok:true,data:action==='info'?{mode:'demo',station:'S TECH · Merkez'}:await session.run(action,payload)}}catch(e){return {ok:false,error:e.message}}});
 await page.addInitScript(()=>{window.stech={call:(...args)=>window.testKioskCall(...args),on:()=>{}}});
 try{
  await page.goto(pathToFileURL(path.join(__dirname,'../ui/index.html')).href);
  async function capture(name){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' horizontal overflow');await page.screenshot({path:path.join(out,name+'.png')});}
  await page.getByRole('heading',{name:'Üye kartını okut'}).waitFor();await capture('01-welcome-1080x1920');
  await page.getByRole('button',{name:'Kaan olarak dene'}).click();await page.getByRole('heading',{name:'Merhaba, Kaan.'}).waitFor();
  const nav=await page.locator('nav').boundingBox();assert.equal(nav.x,0);assert.equal(nav.width,1080);assert.ok(nav.y>1700);
  await capture('02-home-1080x1920');
  await page.getByRole('button',{name:'Bakiye yükle',exact:true}).first().click();await page.waitForFunction(()=>!document.querySelector('[data-action="pay"]').disabled);
  const pay=await page.getByRole('button',{name:'POS ile ödemeye geç'}).boundingBox();assert.ok(pay.y+pay.height<nav.y, 'Payment button must be visible without scrolling');await capture('03-topup-1080x1920');
  await page.getByRole('button',{name:'POS ile ödemeye geç'}).click();await page.getByRole('heading',{name:'Kartını POS cihazına okut.'}).waitFor();await capture('04-pos-1080x1920');
  await page.getByRole('button',{name:'Ödemeyi onayla'}).click();await page.getByRole('heading',{name:'Hazırsın. İyi oyunlar!'}).waitFor();
  const finish=await page.getByRole('button',{name:'İşlemleri bitir',exact:true}).boundingBox();assert.ok(finish.y+finish.height<nav.y,'Completion actions must stay above navigation');
  await capture('05-success-1080x1920');
  await page.getByRole('button',{name:'Başka bir işlem yap'}).click();
  await page.getByRole('button',{name:'İşlem geçmişi',exact:true}).click();await page.locator('.history-panel .transaction').first().waitFor();await capture('06-history-1080x1920');
  await page.getByRole('button',{name:'Profilim',exact:true}).click();await capture('07-profile-1080x1920');
  await page.getByRole('button',{name:'Kampanyalar',exact:true}).click();await page.getByRole('button',{name:'Kampanyayı incele'}).click();await page.getByRole('dialog').waitFor();await capture('08-campaign-dialog-1080x1920');
  await page.getByRole('button',{name:'Geri dön',exact:true}).click();
  for(const size of [{width:720,height:1280},{width:1440,height:900},{width:1024,height:768}]){await page.setViewportSize(size);await page.getByRole('button',{name:'Profilim',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(size));}
  assert.deepEqual(errors,[]);
  console.log('PASS: portrait 1080x1920 welcome/home/topup/POS/success/history/profile/modal; bottom navigation, reachable completion, no horizontal overflow; 720x1280 and landscape fallback.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
