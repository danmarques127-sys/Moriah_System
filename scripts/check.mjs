import {readdirSync} from 'node:fs';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(join(path,d.name)):d.name.endsWith('.mjs')?[join(path,d.name)]:[]);}
for(const path of [...files('src'),...files('public'),...files('scripts'),...files('tests')]){const r=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}console.log('All JavaScript modules passed syntax checks.');
