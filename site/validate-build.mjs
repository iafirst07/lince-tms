import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const handler=(await import(pathToFileURL(path.join(root,'dist/server/index.js')).href+'?validate='+Date.now())).default;
assert.equal(typeof handler.fetch,'function');
const routes=['/navigation.js','/navigation.css','/','/app.js','/style.css','/sw.js','/driver/','/driver/driver.js','/driver/driver.css','/driver/driver-sw.js','/driver/manifest.webmanifest','/driver/icon.svg','/driver/icon-192.png','/driver/icon-512.png','/docs/','/docs/openapi.json','/demo-context.js','/simulation-console.js'];
for(const route of routes){const response=await handler.fetch(new Request('https://lince.example'+route),{});assert.equal(response.status,200,route);const bytes=await response.arrayBuffer();assert.ok(bytes.byteLength>0,route);}
const spec=await(await handler.fetch(new Request('https://lince.example/docs/openapi.json'),{})).json();
assert.ok(spec.openapi.startsWith('3.1.'));assert.equal(spec['x-runtime'],'PUBLIC_SIMULATION_ONLY');
assert.equal(spec.components.schemas.CommandEnvelope.oneOf.some(x=>x.properties?.command?.const==='migration_rollback'),false);
assert.equal(spec.components.schemas.CommandEnvelope.oneOf.length,71);
const manifest=await(await handler.fetch(new Request('https://lince.example/driver/manifest.webmanifest'),{})).json();assert.equal(manifest.scope,'/driver/');assert.ok(manifest.icons.length>=2);
const desktop=await(await handler.fetch(new Request('https://lince.example/'),{})).text();assert.ok(desktop.includes('/demo-context.js'));assert.ok(desktop.includes('/simulation-console.js'));assert.ok(desktop.includes('Lince'));
const sw=await(await handler.fetch(new Request('https://lince.example/driver/driver-sw.js'),{})).text();assert.ok(sw.includes("'/demo-context.js'"));
const hosting=JSON.parse(fs.readFileSync(path.join(root,'.openai/hosting.json'),'utf8'));assert.ok(hosting.project_id);assert.ok(hosting.d1);assert.equal(hosting.static,undefined);
assert.ok(fs.readFileSync(path.join(root,'drizzle/0000_lince_simulation.sql'),'utf8').includes('simulation_file_chunks'));
console.log(JSON.stringify({compiledStaticRoutes:routes.length,publicCommandSchemas:71,manifest:'PASS',databaseMigration:'PRESENT',scope:'Compiled artifact static/document contracts, not browser or hosted D1'}));
