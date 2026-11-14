import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTemporalState } from '../src/lifecycle.js';

const at=new Date('2026-10-08T12:00:00.000Z');
test('lifecycle derives time state while preserving explicit cancelled/completed status',()=>{
 assert.equal(deriveTemporalState({status:'Planning',event_date:'2026-10-22',start_time:'10:00',end_time:'17:00'},at),'PLANNING');
 assert.equal(deriveTemporalState({status:'Upcoming',event_date:'2026-10-08',start_time:'15:00',end_time:'17:00'},at),'UPCOMING');
 assert.equal(deriveTemporalState({status:'Upcoming',event_date:'2026-10-08',start_time:'09:00',end_time:'17:00'},at),'LIVE_STATUS_REVIEW');
 assert.equal(deriveTemporalState({status:'Live',event_date:'2026-10-08',start_time:'09:00',end_time:'17:00'},at),'LIVE');
 assert.equal(deriveTemporalState({status:'Upcoming',event_date:'2026-10-07'},at),'PAST_STATUS_REVIEW');
 assert.equal(deriveTemporalState({status:'Cancelled',event_date:'2027-01-01'},at),'CANCELLED');
});
