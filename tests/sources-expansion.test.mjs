import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SOURCES,sourceById} from '../src/sources.mjs';
import {NATIVE_MODES,collect} from '../src/collectors.mjs';

const additions={
  MA:['springfield','lowell','chicopee'],
  CT:['bridgeport','stamford'],
  RI:['pawtucket']
};
test('expansion sources are uniquely registered with correct states and HTTPS evidence',()=>{
  assert.equal(new Set(SOURCES.map(s=>s.id)).size,SOURCES.length);
  for(const [state,ids] of Object.entries(additions)){
    for(const id of ids){
      const s=sourceById(id);
      assert.equal(s.state,state);
      assert.equal(new URL(s.url).protocol,'https:');
      assert.ok(['report','portal'].includes(s.mode));
      assert.deepEqual(s.allowedHosts,[]);
    }
  }
});
test('new sources stay pending until a real collector is proven',async()=>{
  for(const ids of Object.values(additions))for(const id of ids){
    const source=sourceById(id);
    assert.equal(NATIVE_MODES.includes(source.mode),false);
    const result=await collect(source,'2026-10');
    assert.equal(result.status,'pending');
    assert.deepEqual(result.records,[]);
  }
});
