const fs=require('node:fs');
const path=require('node:path');
const {fork}=require('node:child_process');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.STECH_TEST_TOOLS?path.join(process.env.STECH_TEST_TOOLS,'node_modules/playwright'):'playwright');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const child=fork(path.join(root,'apps/api/test/profile-ui-server.ts'),[],{cwd:path.join(root,'apps/api'),execArgv:['--import','tsx'],silent:true});
 let browser;
 try{
  const {url,error}=await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',()=>reject(Error('Test API exited early')))});if(error)throw Error(error);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('stech.onboarding.v1','yes'));
  await page.route('**/api/v1/**',async route=>{
   const request=route.request(),requestUrl=new URL(request.url());
   if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'http://localhost:8081','Access-Control-Allow-Headers':'content-type,authorization,idempotency-key','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'}});return;}
   const response=await page.request.fetch(url+requestUrl.pathname+requestUrl.search,{method:request.method(),headers:{'Content-Type':'application/json',...(request.headers().authorization?{Authorization:request.headers().authorization}:{})},data:request.postData()??undefined});
   await route.fulfill({response,headers:{...response.headers(),'Access-Control-Allow-Origin':'http://localhost:8081'}});
  });
  await page.goto('http://localhost:8081/register');
  await page.getByLabel('Ad',{exact:true}).fill('Ali Can');await page.getByLabel('Soyad',{exact:true}).fill('Test');
  await page.getByLabel('Kullanıcı adı',{exact:true}).fill('profile_ui');await page.getByLabel('Telefon',{exact:true}).fill('05321234567');
  await page.getByLabel('Şifre',{exact:true}).fill('ProfileUITest123!');await page.getByLabel('Şifre tekrar',{exact:true}).fill('ProfileUITest123!');
  await page.getByRole('button',{name:/Hesap oluştur/}).click();
  await page.getByRole('tab',{name:/Profil/}).click();
  await page.getByText('Bilgilerimi ve şifremi düzenle',{exact:true}).click();
  await page.getByLabel('Ad',{exact:true}).waitFor();
  await page.getByLabel('Ad',{exact:true}).fill('Ali Can');await page.getByLabel('Soyad',{exact:true}).fill('Yeni Soyad');
  await page.getByLabel('Adres (isteğe bağlı)',{exact:true}).fill('Test Mahallesi, 14');
  await page.getByLabel('Mevcut şifren',{exact:true}).fill('ProfileUITest123!');
  await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();
  await page.getByText('Bilgilerin güncellendi.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Soyad',{exact:true}).inputValue(),'Yeni Soyad');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync(path.join(root,'docs/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'docs/screenshots/profile-edit.png'),fullPage:true});
  assert.equal(await page.getByLabel('Mevcut şifren',{exact:true}).inputValue(),'');
  await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();await page.getByText('Her değişiklikte mevcut şifreni yeniden gir.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Üyelik kartıyla doğrula',exact:true}).click();await page.getByLabel('Kart okuyucu',{exact:true}).fill('00123456');await page.getByLabel('Kart okuyucu',{exact:true}).press('Enter');await page.getByText('Kart okundu. Kaydettiğinde hesabınla eşleşmesi kontrol edilecek.',{exact:true}).waitFor();await page.getByRole('button',{name:'Şifreyle doğrula',exact:true}).click();
  await page.getByLabel('Mevcut şifren',{exact:true}).fill('ProfileUITest123!');await page.getByLabel('Yeni şifre',{exact:true}).fill('ChangedUITest123!');await page.getByLabel('Yeni şifre tekrar',{exact:true}).fill('ChangedUITest123!');
  await page.getByRole('button',{name:'Değişiklikleri kaydet',exact:true}).click();await page.waitForURL('**/login');
  assert.deepEqual(errors,[]);console.log('PASS: separate-name/required-phone registration, profile form persistence, responsive width and password-change logout using isolated API; no live member changed.');
 }finally{if(browser){for(const context of browser.contexts())for(const page of context.pages())await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();}if(child.connected)child.send('close');}
})().catch(e=>{console.error(e.message);process.exitCode=1});
