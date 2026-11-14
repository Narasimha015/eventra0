import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV='test';
process.env.EVENTRA_DB_PATH=':memory:';
process.env.EVENTRA_JWT_SECRET='smoke-test-secret-with-more-than-thirty-two-characters';
let app;
before(async()=>{const {createApp}=await import('../src/app.js');app=createApp()});
test('API smoke: health and public event discovery respond with stable envelopes',async()=>{
 const health=await request(app).get('/api/health');assert.equal(health.status,200);assert.equal(health.body.data.status,'ok');assert.equal(health.body.data.database,true);
 const events=await request(app).get('/api/events');assert.equal(events.status,200);assert.ok(Array.isArray(events.body.data));
});
