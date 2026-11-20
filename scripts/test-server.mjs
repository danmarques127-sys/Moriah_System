import {randomBytes,scryptSync} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createApplication} from '../src/server.mjs';

export async function createTestApplication(options={}){
 if(process.env.NODE_ENV==='production'||options.production===true)throw new Error('Acesso de teste proibido em produção.');
 const port=Number(options.port||process.env.PORT||3000);
 const codespace=process.env.CODESPACES==='true'&&process.env.CODESPACE_NAME;
 const appUrl=options.appUrl||(codespace?'https://'+process.env.CODESPACE_NAME+'-'+port+'.'+(process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN||'app.github.dev'):'http://localhost:'+port);
 const app=await createApplication({...options,production:false,
  databasePath:options.databasePath||'data/permit-finder-test.sqlite',
  appUrl,adminEmail:'mestre@permit-finder.example',adminPassword:randomBytes(32).toString('hex'),
  testLoginEmail:'mestre@permit-finder.example',
  developmentProxyOrigin:codespace?'http://localhost:'+port:undefined
 });
 // Public fixture credentials for the isolated test database only.
 const salt=randomBytes(16).toString('hex');
 const key=scryptSync('shazam123@',salt,64,{N:32768,r:8,p:1,maxmem:67108864});
 app.db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(salt+':'+key.toString('hex'),app.config.testLoginEmail);
 app.db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email=?)').run(app.config.testLoginEmail);
 return app;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=await createTestApplication();
 app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>{
  console.log('MODO DE TESTE — login: mestre. Use a senha de teste combinada.');
  console.log('Abra: '+app.config.appUrl);
  console.log('Dados de teste separados: data/permit-finder-test.sqlite. Mantenha a porta privada.');
 });
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));
}
