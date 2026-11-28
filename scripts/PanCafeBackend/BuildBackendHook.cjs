// PanCafe 3.3.2.312 only. Fixed operations; identities are resolved on the target thread.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const outputIndex=process.argv.indexOf('--output');
const root=outputIndex<0?__dirname:path.resolve(process.argv[outputIndex+1]),TEXT=0x1000,DATA=0x2000;
fs.mkdirSync(root,{recursive:true});
const fixture=process.argv.includes('--fixture');
const methodAddress=value=>{
 if(!fixture)return value;
 const pages={0x00FE0000:0x30000000,0x01090000:0x30010000,0x00990000:0x30020000,0x009A0000:0x30030000,0x00C70000:0x30040000,0x006D0000:0x30050000,0x01120000:0x30060000};
 const page=value&0xffff0000;return page in pages?pages[page]+(value&0xffff):value;
};
const nonce=crypto.randomBytes(12).toString('hex'),tag=crypto.randomBytes(4).readUInt32LE();
const mapping='Local\\STech.PanCafe.Native.'+nonce,continuation=mapping+'.Continue';
const chunks=[];let length=0;const u32=v=>{let b=Buffer.alloc(4);b.writeUInt32LE(v>>>0);return b;};
function add(b){b=Buffer.from(b);let r=DATA+length;chunks.push(b);length+=b.length;return r;}
const ascii=s=>Buffer.from(s+'\0','ascii'),zero=n=>Buffer.alloc(n);
const exp=add(zero(40)),funcs=add(zero(4)),names=add(zero(4)),ord=add(zero(2));
const moduleName=add(ascii('ControllerBackend.x86.dll')),exportName=add(ascii('BackendHook'));
while(length%4)add([0]);const importsRva=add(zero(60)),imports={},records=[];
for(const [dll,symbols] of [['KERNEL32.dll',['OpenFileMappingW','MapViewOfFile','UnmapViewOfFile','CloseHandle','GetCurrentProcessId','CompareStringOrdinal','OpenEventW','OpenProcess','WaitForMultipleObjects']],['USER32.dll',['CallNextHookEx']]]){
 const lookup=add(zero((symbols.length+1)*4)),iat=add(zero((symbols.length+1)*4)),dllName=add(ascii(dll)),hints=[];
 for(let j=0;j<symbols.length;j++){while(length%2)add([0]);hints.push(add(Buffer.concat([zero(2),ascii(symbols[j])])));imports[symbols[j]]=iat+j*4;}records.push({lookup,iat,dllName,hints});
}
while(length%2)add([0]);const mapName=add(Buffer.from(mapping+'\0','utf16le')),eventName=add(Buffer.from(continuation+'\0','utf16le'));
while(length%4)add([0]);const methods={};for(const [k,v] of Object.entries({getMember:0x993DF8,getMemberTerminal:0x9A3B1C,getTerminal:0x9A3C4C,refreshMember:0x993164,refreshDataset:0x6D9208,updateTerminal:0x9A2AC0,permission:0xC7B188,prices:0xFE2DAC,capacity:0xFEB8EC,start:0x9A2788,getBool:0x994E7C,getTicket:0x9AE324,refreshTicket:0x9AC72C}))methods[k]=add(u32(methodAddress(v)));
const epsilon=add(Buffer.from('8dedb5a0f7c6b03e','hex')); // double 0.000001
const reloc=add(Buffer.concat([u32(TEXT),u32(12),zero(4)]));let data=Buffer.concat(chunks);
const put=(r,v)=>data.writeUInt32LE(v>>>0,r-DATA);put(funcs,TEXT);put(names,exportName);put(exp+12,moduleName);put(exp+16,1);put(exp+20,1);put(exp+24,1);put(exp+28,funcs);put(exp+32,names);put(exp+36,ord);
records.forEach((r,i)=>{put(importsRva+i*20,r.lookup);put(importsRva+i*20+12,r.dllName);put(importsRva+i*20+16,r.iat);r.hints.forEach((h,j)=>{put(r.lookup+j*4,h);put(r.iat+j*4,h);});});
const code=[],labels={},fixups=[];const emit=(...x)=>code.push(...x.flat()),imm=v=>[...u32(v)],hex=s=>emit([...Buffer.from(s.replace(/\s/g,''),'hex')]);
const label=s=>{labels[s]=code.length;},jump=(op,s)=>{emit(...op);fixups.push([code.length,s]);emit(0,0,0,0);};
const jz=s=>jump([15,132],s),jnz=s=>jump([15,133],s),jmp=s=>jump([233],s);
hex('55 89e5 53 56 57 83ec20 e800000000');const origin=TEXT+code.length;hex('5b');
const callRva=r=>{hex('ff93');emit(imm(r-origin));},call=n=>callRva(imports[n]),method=n=>callRva(methods[n]);
const pushRva=r=>{hex('8d83');emit(imm(r-origin));hex('50');},set=(offset,value)=>{hex('c786');emit(imm(offset),imm(value));};
function fail(codeValue){set(36,codeValue);jmp('error');}
function objectGlobal(address,vmt){hex('a1');emit(imm(methodAddress(address)));hex('85c0');jz('identity-error');hex('8b00 85c0');jz('identity-error');if(vmt){hex('8138');emit(imm(vmt));jnz('identity-error');}}
hex('837d0800');jump([15,140],'forward');hex('837d0c01');jnz('forward');hex('8b7d10 85ff');jz('forward');
hex('817f04afbc0000');jnz('forward');hex('817f08324d4350');jnz('forward');hex('817f0c');emit(imm(tag));jnz('forward');
hex('c7470400000000 c7470800000000 c7470c00000000 c745ec00000000 c745e800000000');
pushRva(mapName);hex('6a00 6a06');call('OpenFileMappingW');hex('85c0');jz('forward');hex('8945f0');
hex('6800080000 6a00 6a00 6a06 50');call('MapViewOfFile');hex('89c6 85f6');jz('close-map');
hex('813e324d4350');jnz('unmap');call('GetCurrentProcessId');hex('3b4604');jnz('unmap');hex('837e0c00');jnz('unmap');set(12,1);
// Local self-test only. No application addresses are touched on this path.
hex('837e0863');jnz('dispatch');hex('3b4614');jnz('bad-operation');set(12,2);jmp('unmap');
label('dispatch');hex('837e0804');jump([15,135],'bad-operation');
// Resolve member by ID on PanCafe's own thread; do not accept caller heap pointers.
objectGlobal(0x01092e48,9989140);hex('8b5610');method('getMember');hex('85c0');jz('member-missing');hex('894618 8138');emit(imm(9986224));jnz('identity-error');hex('8b5008 3b5610');jnz('identity-error');
hex('8b4060 85c0');jz('identity-error');hex('6a00 ffb6fc000000 8d9600010000 52 ff70fc 50');call('CompareStringOrdinal');hex('83f802');jnz('identity-error');
hex('8b4618 80783101');jnz('inactive');hex('0fb65050 895634 dd4038 dd5e50');
objectGlobal(0x01092338,16282616);hex('894630');
hex('837e0804');jz('session-status');
objectGlobal(0x01092cd8);hex('8b80b8030000 85c0');jz('identity-error');hex('894670 0fb690a5000000 89564c 83fa01');jump([15,135],'editing');
hex('837e0802');jz('session');hex('837e0803');jz('session');
// Credit/credit probe. No monetary SQL is performed by this DLL.
hex('b02b 33d2');method('permission');hex('84c0');jz('permission-error');
objectGlobal(0x01092e48,9989140);hex('80784000');jnz('bonus-error');
objectGlobal(0x010929d0,10010300);hex('8b5610');method('getMemberTerminal');hex('89c7 89461c');
hex('837e3400');jz('logged-out');hex('837e3401');jnz('association-error');hex('85ff');jz('association-error');
hex('813f');emit(imm(9999948));jnz('identity-error');hex('807f2405');jnz('association-error');hex('8b87c8000000 3b4618');jnz('association-error');
hex('8b4710 894674 0fb64724 89463c');jmp('credit-resolved');
label('logged-out');hex('85ff');jnz('association-error');
label('credit-resolved');hex('a1');emit(imm(methodAddress(0x0112198C)));hex('894648 837e0800');jz('done');
// Optional ticket credit: resolve the cached ticket and its dataset on the same
// thread. Reload before the SQL guard and again after commit, without a sale UI.
hex('83beac00000000');jz('ticket-ready');
objectGlobal(0x0109247C,0x0099150C);hex('8b96ac000000');method('getTicket');hex('85c0');jz('ticket-error');
hex('8138');emit(imm(0x00990E94));jnz('identity-error');hex('8b5024 3b96ac000000');jnz('identity-error');hex('8986b8000000');
method('refreshTicket');hex('8b86b8000000 80783200');jnz('ticket-error');hex('80784901');jnz('ticket-error');
objectGlobal(0x01092cd8);hex('8b80f0050000 85c0');jz('identity-error');hex('8986b4000000 80b8a500000001');jump([15,135],'editing');
label('ticket-ready');
// Prepare process+event handles before advertising that the GUI thread is held.
pushRva(eventName);hex('6a00 6800001000');call('OpenEventW');hex('85c0');jz('handshake-error');hex('8945ec 8945dc');
hex('ff7614 6a00 6800001000');call('OpenProcess');hex('85c0');jz('handshake-error');hex('8945e8 8945e0');
set(40,10);set(12,10);
hex('6810270000 6a00 8d45dc 50 6a02');call('WaitForMultipleObjects');hex('3d02010000');jnz('credit-wake');
// A deadline can cancel an unclaimed request. Once DB work is claimed, keep
// the model stable until the transaction's finally block or process exit.
hex('b80a000000 baffffffff f00fb1560c');jz('handshake-error');hex('83f80b');jnz('handshake-error');
hex('6aff 6a00 8d45dc 50 6a02');call('WaitForMultipleObjects');
label('credit-wake');hex('83f801');jz('actor-exited');hex('85c0');jnz('handshake-error');hex('837e2c01');jnz('transaction-aborted');jmp('credit-sync');
label('actor-exited');set(44,2); // outcome is unknown; reload persisted data anyway
label('credit-sync');set(40,210);
hex('83beac00000000');jz('member-sync');hex('8b86b8000000');method('refreshTicket');
hex('8b86b8000000 80784801');jnz('outcome-error');hex('80784a01');jnz('outcome-error');
hex('8b86b4000000 80b8a500000001');jnz('member-sync');method('refreshDataset');
label('member-sync');hex('8b4618');method('refreshMember');
hex('8b4670 80b8a500000001');jnz('skip-dataset');method('refreshDataset');
label('skip-dataset');set(40,220);hex('85ff');jz('credit-validate');hex('89f8');method('updateTerminal');
label('credit-validate');hex('837e2c02');jz('outcome-error');hex('8b4618 dd4038 dc6660 d9e1 dc9b');emit(imm(epsilon-origin));hex('dfe0 9e');jump([15,135],'outcome-error');set(40,240);jmp('done');
label('session');hex('b021 33d2');method('permission');hex('84c0');jz('permission-error');
objectGlobal(0x010929d0,10010300);hex('8d9640020000');method('getTerminal');hex('89c7 85ff');jz('terminal-missing');hex('813f');emit(imm(9999948));jnz('identity-error');
hex('8b4710 3b4620');jnz('identity-error');hex('894674 0fb64724 89463c 0fb64716 894644');
hex('807f1500');jnz('identity-error');hex('807f2401');jz('idle-terminal');hex('807f2400');jnz('busy');hex('807f1600');jnz('busy');label('idle-terminal');hex('837e3400');jnz('busy');
hex('0fb64725 8986a0000000 807f1601');jz('wake-ready');hex('807f2500');jnz('wake-ready');
// StartSession's own doSessionStarted callback sends WOL to the saved MAC.
// Offline PCs must reach that callback, with usable cached MAC/settings.
hex('8b4718 85c0');jz('mac-error');
hex('6a01 ffb65c040000 8d9660040000 52 ff70fc 50');call('CompareStringOrdinal');hex('83f802');jnz('mac-error');
hex('83be5c04000000');jz('mac-error');
objectGlobal(0x010939d8);hex('b101 bac4f0fb00');method('getBool');hex('84c0');jz('wake-disabled');set(168,1);
label('wake-ready');
hex('8b4618');method('refreshMember');hex('8b4618 80785000');jnz('busy');
hex('8d8680000000 50 8d8688000000 50 8d8690000000 50 8d8698000000 50 0fb64f14 8b5618 8b4630');method('prices');hex('84c0');jz('price-error');
hex('ba01000000 8b4630');method('capacity');hex('84c0');jz('capacity-error');hex('837e0803');jz('done');
set(40,100);hex('6a00 6a00 6a00 6a01 8b4e18 ba05000000 89f8');method('start');set(40,110);
hex('807f2405');jnz('outcome-error');hex('8b87cc000000 3b4610');jnz('outcome-error');hex('8b4618 80785001');jnz('outcome-error');jmp('done');
label('session-status');
objectGlobal(0x010929d0,10010300);hex('8d9640020000');method('getTerminal');hex('89c7 85ff');jz('terminal-missing');hex('813f');emit(imm(9999948));jnz('identity-error');
hex('8b4710 3b4620');jnz('identity-error');hex('894674 0fb64716 894644 0fb64725 8986a0000000');
hex('807f2405');jnz('session-changed');hex('8b87cc000000 3b4610');jnz('session-changed');hex('8b4618 80785001');jnz('session-changed');jmp('done');
label('done');hex('8b4618 0fb65050 895638 dd4038 dd5e58 85ff');jz('done-state');hex('0fb64724 894640 0fb64725 8986a4000000');label('done-state');set(12,2);jmp('cleanup');
for(const [name,n] of Object.entries({'bad-operation':1,'member-missing':2,'identity-error':3,'permission-error':4,'inactive':5,'busy':6,'bonus-error':8,'editing':9,'association-error':10,'terminal-missing':11,'price-error':12,'capacity-error':13,'handshake-error':14,'transaction-aborted':15,'outcome-error':16,'mac-error':17,'wake-disabled':18,'session-changed':19,'ticket-error':20})){label(name);fail(n);}
label('error');set(12,-1);
label('cleanup');hex('837dec00');jz('close-actor');hex('ff75ec');call('CloseHandle');label('close-actor');hex('837de800');jz('unmap');hex('ff75e8');call('CloseHandle');
label('unmap');hex('56');call('UnmapViewOfFile');label('close-map');hex('ff75f0');call('CloseHandle');
label('forward');hex('ff7510 ff750c ff7508 6a00');call('CallNextHookEx');hex('83c420 5f 5e 5b 5d c20c00');
const text=Buffer.from(code);for(const [at,target] of fixups){if(!(target in labels))throw Error(target);text.writeInt32LE(labels[target]-at-4,at);}if(text.length>4096||data.length>4096)throw Error('PE section size exceeded');
const header=Buffer.alloc(512);header.write('MZ');header.writeUInt32LE(128,60);header.write('PE\0\0',128,'binary');header.writeUInt16LE(0x14c,132);header.writeUInt16LE(2,134);header.writeUInt16LE(224,148);header.writeUInt16LE(0x2102,150);
const opt=152;header.writeUInt16LE(0x10b,opt);for(const [o,v] of [[4,4096],[8,4096],[20,TEXT],[24,DATA],[28,0x6d900000],[32,4096],[36,512],[56,0x3000],[60,512],[72,1<<20],[76,4096],[80,1<<20],[84,4096],[92,16]])header.writeUInt32LE(v,opt+o);
header.writeUInt16LE(6,opt+40);header.writeUInt16LE(6,opt+48);header.writeUInt16LE(2,opt+68);header.writeUInt16LE(0x140,opt+70);
for(const [i,rva,size] of [[0,exp,exportName+12-exp],[1,importsRva,60],[5,reloc,12]]){header.writeUInt32LE(rva,opt+96+i*8);header.writeUInt32LE(size,opt+100+i*8);}
for(const [i,name,payload,rva,raw,flags] of [[0,'.text',text,TEXT,512,0x60000020],[1,'.rdata',data,DATA,4608,0x40000040]]){let p=opt+224+i*40;header.write(name,p,'ascii');for(const [o,v] of [[8,payload.length],[12,rva],[16,4096],[20,raw],[36,flags]])header.writeUInt32LE(v,p+o);}
const dll=Buffer.concat([header,text,zero(4096-text.length),data,zero(4096-data.length)]);fs.writeFileSync(path.join(root,fixture?'ControllerBackend.fixture.x86.dll':'ControllerBackend.x86.dll'),dll);
fs.writeFileSync(path.join(root,fixture?'backend-fixture-profile.json':'backend-profile.json'),JSON.stringify({schema:5,fixture,mapping,continuation,tag,message:0xBCAF,dll_sha256:crypto.createHash('sha256').update(dll).digest('hex').toUpperCase(),exe_sha256:'017A4B0243778C119493C9FD80C5B5B4AF5EBF3E9199601B7583E90F6C0FA352'}));
console.log(JSON.stringify({text_bytes:text.length,data_bytes:data.length,dll_bytes:dll.length}));
