/* The member session owns this view. Leaving the page invalidates outstanding replies. */
const social = (() => {
  let view, timer;
  const initial = () => ({rows:null, tab:'all', filter:'', panel:'', query:'', matches:null, ticket:0, busy:false, error:'', searchError:'', searching:false});
  function close() { clearTimeout(timer); view = null; }
  function current() { return view && state.page === 'friends' && state.data; }
  function page() {
    view ??= initial();
    return `<section id="social"><div class="social-heading"><div><h1>ARKADAŞLAR<span>.</span></h1><p>Arkadaşlarını bul, kimlerin burada olduğunu gör ve bağlantıda kal.</p></div>${control('+ Arkadaş Ekle','add')}</div>
    <div id="social-panel">${panel()}</div><div class="social-toolbar"><label>Arkadaş ara<input id="social-filter" type="text" maxlength="64" placeholder="Kullanıcı adı" value="${e(view.filter)}"></label>${keyboard("social-filter")}<div id="social-tabs">${tabs()}</div></div><div id="social-list">${list()}</div></section>`;
  }
  function keyboard(id) {
    return '<div class="social-keys" hidden data-input="'+id+'"><div class="login-keyboard">'+loginKeyboard()+'</div></div>';
  }
  function showKeys(input) {
    document.querySelectorAll('#social .social-keys').forEach(keys => {
      keys.hidden = keys.dataset.input !== input?.id;
    });
  }
  document.addEventListener('focusin', event => {
    if (!event.target.closest('.social-keys')) showKeys(event.target);
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.social-keys')) showKeys(event.target);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target.closest('#social')) showKeys(null);
  });
  document.addEventListener('click', event=>{
    const key=event.target.closest('.social-keys .touch-key');
    if(!key)return;
    const keys=key.closest('.social-keys'), input=document.getElementById(keys.dataset.input);
    useKeyboardKey(key,input,()=>{keys.hidden=true;if(input.form)input.form.requestSubmit();},()=>{
      keys.hidden=true;(input.form?.querySelector('button')||document.querySelector('#social-tabs button'))?.focus();
    });
  });
  function control(label,action,name='',disabled=false) {
    return `<button type="button" data-social="${action}" data-name="${e(name)}" ${disabled?'disabled':''}>${e(label)}</button>`;
  }
  function avatar(name) {return `<span class="social-avatar" aria-hidden="true">${e(Array.from(name).slice(0,2).join('').toLocaleUpperCase('tr'))}</span>`;}
  function tabs() {
    const rows=view.rows || [], accepted=rows.filter(f=>f.status==='accepted');
    return [['all','Tümü',accepted.length],['online','Çevrimiçi',accepted.filter(f=>f.online).length],['offline','Çevrimdışı',accepted.filter(f=>!f.online).length],['requests','İstekler',rows.length-accepted.length]].map(([key,label,count])=>
      `<button type="button" data-social="tab" data-name="${key}" aria-pressed="${key===view.tab}">${label} <b>${view.rows?count:'–'}</b></button>`).join('');
  }
  function row(f,actions,detail) {
    return `<article class="social-row">${avatar(f.username)}<div class="social-id"><strong>${e(f.username)}</strong><small>${detail}</small></div><div class="social-actions">${actions}</div></article>`;
  }
  function list() {
    if(view.error) return `<p role="alert">${e(view.error)} ${control('Tekrar dene','retry')}</p>`;
    if(!view.rows) return '<p role="status">Arkadaşların yükleniyor…</p>';
    const requests=view.tab==='requests', accepted=view.rows.filter(f=>f.status==='accepted');
    const rows=view.rows.filter(f=>(requests?f.status!=='accepted':f.status==='accepted') && (view.tab!=='online'||f.online) && (view.tab!=='offline'||!f.online) && f.username.toLocaleLowerCase('tr').includes(view.filter.trim().toLocaleLowerCase('tr')));
    if(!rows.length) {
      if(!accepted.length&&!requests&&!view.filter&&view.tab==='all') return `<div class="social-empty">${icon('profile')}<h2>Henüz arkadaşın yok</h2><p>Arkadaşlarını ekleyerek kimlerin çevrimiçi olduğunu ve hangi bilgisayarda oynadıklarını görebilirsin.</p>${control('+ İlk Arkadaşını Ekle','add')}</div>`;
      return '<p class="social-empty">'+(view.filter?'Aradığın kullanıcı bulunamadı.':requests?'Bekleyen arkadaşlık isteğin yok.':view.tab==='online'?'Şu anda çevrimiçi arkadaşın bulunmuyor.':'Çevrimdışı arkadaşın bulunmuyor.')+'</p>';
    }
    return rows.map(f=>{
      if(requests) return row(f,(f.status==='received'?control('Kabul et','accept',f.username,view.busy):'')+control(f.status==='received'?'Reddet':'İsteği iptal et','remove',f.username,view.busy),f.status==='received'?'Gelen istek':'Gönderilen istek · Bekliyor');
      return row(f,control('Para Aktar ⚠','maintenance')+control('Arkadaşlıktan çıkar','confirm',f.username),`<i class="social-dot ${f.online?'on':''}"></i>${f.online?'Çevrimiçi':'Çevrimdışı'}${f.online&&f.computerName?' · '+e(f.computerName):''}`);
    }).join('');
  }
  function results() {
    if(view.searching) return '<p role="status">Aranıyor…</p>';
    if(view.searchError) return '<p role="alert">'+e(view.searchError)+'</p>';
    if(!view.matches) return '';
    return view.matches.map(f=>{
      const status=view.rows?.find(r=>r.username===f.username)?.status || f.status;
      return row(f,status==='none'?control('Arkadaşlık İsteği Gönder','request',f.username,view.busy):'',({none:'Üye',accepted:'Zaten Arkadaşsınız',sent:'İstek Gönderildi',received:'Gelen istek'})[status]);
    }).join('') || '<p>Aradığın kullanıcı bulunamadı.</p>';
  }
  function panel(){
    if(!view.panel) return '';
    if(view.panel==='confirm') return `<section class="social-sheet"><h2>Arkadaşlıktan çıkar?</h2><p>${e(view.target)} arkadaş listenden kaldırılacak.</p>${control('Vazgeç','dismiss')}${control('Arkadaşlıktan çıkar','remove',view.target,view.busy)}</section>`;
    return `<section class="social-sheet"><div class="social-heading"><h2>Arkadaş ekle</h2>${control('Kapat','dismiss')}</div><form id="social-search"><label>Üye kullanıcı adı<input id="social-query" maxlength="32" required autocomplete="off" value="${e(view.query)}"></label><button>Ara</button></form>${keyboard("social-query")}<div id="social-results">${results()}</div></section>`;
  }
  function paint(id,html){const node=document.getElementById(id);if(node)node.innerHTML=html;}
  function update(){if(!current())return; paint('social-list',list());paint('social-tabs',tabs());paint('social-results',results());}
  async function refresh() {
    const owner=view;if(!current())return;
    clearTimeout(timer);
    const sequence=owner.sequence=(owner.sequence||0)+1;
    try {const rows=await call('friends');if(owner!==view||sequence!==owner.sequence)return;owner.rows=rows;owner.error='';}
    catch(err){if(owner!==view||sequence!==owner.sequence)return;owner.error=err.message;}
    if(current()){update();timer=setTimeout(refresh,10000);}
  }
  async function search() {
    const owner=view, ticket=++owner.ticket, query=owner.query.trim();if(!query)return;
    owner.searching=true;owner.searchError='';paint('social-results',results());
    try{const rows=await call('searchFriends',{query});if(view===owner&&ticket===owner.ticket)owner.matches=rows;}
    catch(err){if(view===owner&&ticket===owner.ticket)owner.searchError=err.message;}
    if(view===owner&&ticket===owner.ticket){owner.searching=false;paint('social-results',results());}
  }
  async function action(key,name) {
    const owner=view;if(!current()||owner.busy)return;
    if(key==='retry')return refresh();
    if(key==='tab'){owner.tab=name;update();return;}
    if(key==='maintenance'){toast('Para aktarma özelliği şu anda bakımda. Çok yakında kullanılabilir olacak.');return;}
    if(['add','dismiss','confirm'].includes(key)){
      ++owner.ticket;Object.assign(owner,{panel:key==='dismiss'?'':key,target:name,query:'',matches:null,searchError:'',searching:false});
      paint('social-panel',panel());$('#social-query')?.focus();return;
    }
    if(!['request','accept','remove'].includes(key))return;
    owner.busy=true;update();
    try {
      await call('changeFriend',{username:name,action:key});
      if(owner!==view)return;
      if(owner.panel==='confirm'){owner.panel='';paint('social-panel','');}
      if(key==='request'){const match=owner.matches?.find(f=>f.username===name);if(match)match.status='sent';}
      toast(key==='request'?'Arkadaşlık isteği gönderildi.':key==='accept'?'Arkadaşlık isteği kabul edildi.':'Arkadaş listesi güncellendi.');
      await refresh();
    }catch(err){if(view===owner)toast(err.message);}
    finally{owner.busy=false;if(owner===view)update();}
  }
  document.addEventListener('click',event=>{const b=event.target.closest('#social [data-social]');if(b)void action(b.dataset.social,b.dataset.name);});
  document.addEventListener('submit',event=>{if(event.target.id==='social-search'){event.preventDefault();showKeys(null);void search();}});
  document.addEventListener('input',event=>{
    if(!current())return;
    if(event.target.id==='social-filter'){view.filter=event.target.value;paint('social-list',list());}
    if(event.target.id==='social-query'){Object.assign(view,{query:event.target.value,matches:null,searching:false,searchError:''});++view.ticket;paint('social-results','');}
  });
  return {page,refresh,close};
})();
