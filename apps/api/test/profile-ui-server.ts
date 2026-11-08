import 'reflect-metadata';
import {createApp} from '../src/app';
async function main(){
 const app=await createApp({ENVIRONMENT:'test',PROFILE_ENCRYPTION_KEY:'ef'.repeat(32)});
 await app.listen(0,'127.0.0.1');
 process.on('message',async(message)=>{if(message==='close'){await app.close();process.exit(0);}});
 process.send?.({url:await app.getUrl()});
}
void main().catch(()=>{process.send?.({error:'Profile UI test server failed'});process.exit(1)});
