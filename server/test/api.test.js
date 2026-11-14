import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.NODE_ENV='test';
process.env.EVENTRA_DB_PATH=':memory:';
process.env.EVENTRA_JWT_SECRET='test-secret-that-is-long-enough-to-be-safe-123456';
process.env.EVENTRA_CORS_ORIGIN='http://localhost:5173';

let app,createApp,db,org,admin,attendee,secondOrganizer,secondAttendee,thirdAttendee;
before(async()=>{
 ({db}=await import('../src/db.js'));
 const {seedDemoData}=await import('../src/demo.js');await seedDemoData();
 ({createApp}=await import('../src/app.js'));
 app=createApp();
 const login=async(email,password)=>{const agent=request.agent(app),r=await agent.post('/api/auth/login').send({email,password});assert.equal(r.status,200);assert.equal(r.body.data.token,undefined);return agent};
 admin=await login('admin@eventra.local','Eventra@2026');org=await login('organizer@eventra.local','Organizer@2026');attendee=await login('attendee@eventra.local','Attendee@2026');
 const orgCreated=await admin.post('/api/users').send({name:'Second Organizer',email:'second-org@eventra.local',password:'SecondOrganizer@2026',role:'ORGANIZER'});
 assert.equal(orgCreated.status,201);secondOrganizer=await login('second-org@eventra.local','SecondOrganizer@2026');
 const attendeeCreated=await admin.post('/api/users').send({name:'Second Attendee',email:'second-attendee@eventra.local',password:'SecondAttendee@2026',role:'ATTENDEE'});
 assert.equal(attendeeCreated.status,201);secondAttendee=await login('second-attendee@eventra.local','SecondAttendee@2026');
 const third=await admin.post('/api/users').send({name:'Third Attendee',email:'third-attendee@eventra.local',password:'ThirdAttendee@2026',role:'ATTENDEE'});
 assert.equal(third.status,201);thirdAttendee=await login('third-attendee@eventra.local','ThirdAttendee@2026');
});

test('health endpoint reports a ready database',async()=>{const r=await request(app).get('/api/health');assert.equal(r.status,200);assert.equal(r.body.data.database,true)});
test('authentication rejects bad credentials and protected anonymous access',async()=>{
 assert.equal((await request(app).post('/api/auth/login').send({email:'admin@eventra.local',password:'bad'})).status,401);
 const r=await request(app).post('/api/events').send({name:'No auth',date:'2026-12-01',capacity:10});assert.equal(r.status,401);
});
test('attendee self-signup creates an attendee-only HTTP-only session',async()=>{
 const agent=request.agent(app),created=await agent.post('/api/auth/register').send({name:'New Guest',email:'new-guest@eventra.local',password:'A-strong-demo-password'});
 assert.equal(created.status,201);assert.equal(created.body.data.user.role,'ATTENDEE');assert.equal(created.body.data.token,undefined);
 assert.match(created.headers['set-cookie'][0],/HttpOnly/i);assert.match(created.headers['set-cookie'][0],/SameSite=Lax/i);
 const me=await agent.get('/api/auth/me');assert.equal(me.status,200);assert.equal(me.body.data.user.email,'new-guest@eventra.local');
 assert.equal((await agent.post('/api/auth/logout').send({})).status,200);assert.equal((await agent.get('/api/auth/me')).status,401);
});
test('attendees cannot call organizer analytics or create events',async()=>{
 assert.equal((await attendee.get('/api/analytics')).status,403);
 assert.equal((await attendee.post('/api/events').send({name:'No',date:'2026-12-01'})).status,403);
});
test('settings persist for authorized workspace users and remain private to attendees',async()=>{
 const saved=await org.put('/api/settings').send({organizationName:'Engineering Events',currency:'INR',notificationEmail:'events@example.org'});assert.equal(saved.status,200);
 const loaded=await org.get('/api/settings');assert.equal(loaded.body.data.organizationName,'Engineering Events');
 assert.equal((await attendee.get('/api/settings')).status,403);
});
test('organizers can create events but cannot read or edit another organizer event',async()=>{
 const created=await org.post('/api/events').send({name:'Owner Event',date:'2026-12-10',venue:'Grand Convention Hall',capacity:30,status:'Live'});
 assert.equal(created.status,201);const id=created.body.data.id;
 assert.equal((await secondOrganizer.get(`/api/events/${id}`)).status,404);
 assert.equal((await secondOrganizer.patch(`/api/events/${id}`).send({name:'Hijack'})).status,404);
});
test('registration is server counted, duplicate guarded, capacity enforced, and check-in is single use',async()=>{
 const created=await org.post('/api/events').send({name:'Ticket Event',date:'2026-12-11',venue:'Grand Convention Hall',capacity:2,status:'Live'});
 const id=created.body.data.id;assert.equal(created.status,201);
 const first=await attendee.post(`/api/events/${id}/register`).send({});assert.equal(first.status,201);
 const dupe=await attendee.post(`/api/events/${id}/register`).send({});assert.equal(dupe.status,409);assert.equal(dupe.body.error.code,'DUPLICATE_REGISTRATION');
 const second=await secondAttendee.post(`/api/events/${id}/register`).send({});assert.equal(second.status,201);
 const full=await thirdAttendee.post(`/api/events/${id}/register`).send({});assert.equal(full.status,409);assert.equal(full.body.error.code,'EVENT_FULL');
 const invalid=await org.post('/api/check-in').send({token:'not-a-valid-ticket'});assert.equal(invalid.status,404);assert.equal(invalid.body.error.code,'INVALID_TICKET');
 assert.equal((await attendee.post('/api/check-in').send({ticketIdentifier:first.body.data.ticketIdentifier})).status,403);
 const checked=await org.post('/api/check-in').send({token:first.body.data.ticketToken});assert.equal(checked.status,200);assert.equal(checked.body.data.state,'VALID');
 const repeat=await org.post('/api/check-in').send({token:first.body.data.ticketToken});assert.equal(repeat.status,409);assert.equal(repeat.body.error.code,'ALREADY_CHECKED_IN');
});
test('capacity is enforced for a different attendee',async()=>{
 const event=await org.post('/api/events').send({name:'One Seat',date:'2026-12-12',venue:'Grand Convention Hall',capacity:1,status:'Upcoming'});
 const id=event.body.data.id;
 const registration=await attendee.post(`/api/events/${id}/register`).send({});assert.equal(registration.status,201);
 const full=await secondAttendee.post(`/api/events/${id}/register`).send({});assert.equal(full.status,409);assert.equal(full.body.error.code,'EVENT_FULL');
 assert.equal((await attendee.post(`/api/tickets/${registration.body.data.id}/cancel`).send({})).status,200);
 const cancelled=await org.post('/api/check-in').send({token:registration.body.data.ticketToken});assert.equal(cancelled.status,410);assert.equal(cancelled.body.error.code,'TICKET_CANCELLED');
 assert.equal((await secondAttendee.post(`/api/events/${id}/register`).send({})).status,201);
});
test('venue CRUD persists validated records and protects assigned venues',async()=>{
 const create=await org.post('/api/venues').send({name:'Test Hall',capacity:100,city:'Pune'});assert.equal(create.status,201);const id=create.body.data.id;
 const update=await org.patch(`/api/venues/${id}`).send({capacity:150});assert.equal(update.status,200);assert.equal(update.body.data.capacity,150);
 const event=await org.post('/api/events').send({name:'Venue Bound Event',date:'2026-12-13',venueId:id,capacity:100,status:'Planning'});assert.equal(event.status,201);
 assert.equal((await org.patch(`/api/events/${event.body.data.id}`).send({name:'Venue Bound Event',capacity:160})).body.error.code,'VENUE_CAPACITY');
 assert.equal((await org.patch(`/api/venues/${id}`).send({capacity:90})).status,409);
 const blocked=await org.delete(`/api/venues/${id}`);assert.equal(blocked.status,409);
 db.prepare('DELETE FROM events WHERE id=?').run(event.body.data.id);
 assert.equal((await org.delete(`/api/venues/${id}`)).status,200);
});
test('legacy attendee route is organizer scoped and disallows client-supplied statuses',async()=>{
 assert.equal((await attendee.get('/api/attendees')).status,403);
 const row=await org.get('/api/attendees');assert.equal(row.status,200);assert.ok(Array.isArray(row.body.data));
});
test('event intelligence is private, owner-scoped, validated, and supports read-only what-if analysis',async()=>{
 const created=await org.post('/api/events').send({name:'Intelligence Event',date:'2027-04-12',startTime:'10:00',endTime:'17:00',venue:'Grand Convention Hall',capacity:900,status:'Upcoming'});
 assert.equal(created.status,201);const id=created.body.data.id;
 const intelligence=await org.get(`/api/events/${id}/intelligence`);assert.equal(intelligence.status,200);
 assert.equal(intelligence.body.data.event.id,id);assert.equal(intelligence.body.data.prediction.method,'Rule-based estimate');
 assert.ok(Number.isInteger(intelligence.body.data.readiness.score));assert.ok(Array.isArray(intelligence.body.data.recommendations));
 assert.equal((await attendee.get(`/api/events/${id}/intelligence`)).status,403);
 assert.equal((await secondOrganizer.get(`/api/events/${id}/intelligence`)).status,404);
 assert.equal((await admin.get(`/api/events/${id}/intelligence`)).status,200);
 assert.equal((await org.get('/api/events/not-a-real-id/intelligence')).status,404);
 assert.equal((await org.get(`/api/events/${'x'.repeat(101)}/intelligence`)).status,400);
 const simulation=await org.post(`/api/events/${id}/what-if`).send({expectedRegistrations:1100});assert.equal(simulation.status,200);
 assert.equal(simulation.body.data.scenario.registrations,1100);assert.equal(simulation.body.data.scenario.estimatedAttendance,792);
 assert.equal((await org.post(`/api/events/${id}/what-if`).send({expectedRegistrations:-1})).status,400);
 assert.equal((await org.post(`/api/events/${id}/what-if`).send({expectedRegistrations:'1100'})).status,400);
 assert.equal((await attendee.post(`/api/events/${id}/what-if`).send({expectedRegistrations:1100})).status,403);
 assert.equal((await secondOrganizer.post(`/api/events/${id}/what-if`).send({expectedRegistrations:1100})).status,404);
 const unchanged=await org.get(`/api/events/${id}`);assert.equal(unchanged.body.data.capacity,900);
});

test('data intelligence preserves owner scope and reports quality without treating legacy totals as attendance',async()=>{
 const created=await org.post('/api/events').send({name:'Quality Event',date:'2027-05-01',capacity:100,status:'Planning'});assert.equal(created.status,201);const id=created.body.data.id;
 const timeline=await org.get(`/api/data-intelligence/events/${id}/timeline`);assert.equal(timeline.status,200);assert.equal(timeline.body.data.snapshots.length,1);assert.equal(timeline.body.data.snapshots[0].values.confirmedRegistrations,0);
 assert.equal((await secondOrganizer.get(`/api/data-intelligence/events/${id}/timeline`)).status,404);
 const overview=await org.get('/api/data-intelligence');assert.equal(overview.status,200);const item=overview.body.data.events.find(event=>event.id===id);assert.equal(item.outcome.status,'OUTCOME_UNAVAILABLE');assert.equal(item.legacyRegistrations,0);assert.equal(overview.body.data.mlReadiness.status,'INSUFFICIENT DATA');
 assert.equal((await attendee.get('/api/data-intelligence')).status,403);
});

test('prediction snapshots choose only the newest captured feature state at or before each cutoff',async()=>{
 const created=await org.post('/api/events').send({name:'Cutoff Event',date:'2030-01-31',capacity:600,status:'Planning'});const id=created.body.data.id;
 const before='{"capacity":500,"confirmedRegistrations":80}',after='{"capacity":900,"confirmedRegistrations":700}';
 db.prepare('INSERT INTO event_snapshots(id,event_id,captured_at,source,reason,values_json,created_at) VALUES(?,?,?,?,?,?,?)').run('cutoff-before',id,'2029-12-31T23:00:00.000Z','PLATFORM','before cutoff',before,'2029-12-31T23:00:00.000Z');
 db.prepare('INSERT INTO event_snapshots(id,event_id,captured_at,source,reason,values_json,created_at) VALUES(?,?,?,?,?,?,?)').run('cutoff-after',id,'2030-01-02T00:00:00.000Z','PLATFORM','after cutoff',after,'2030-01-02T00:00:00.000Z');
 const timeline=await org.get(`/api/data-intelligence/events/${id}/timeline`);const point=timeline.body.data.predictionPoints.find(item=>item.point==='30D');assert.equal(point.cutoffAt,'2030-01-01T00:00:00.000Z');assert.equal(point.available,true);assert.equal(point.features.capacity,500);assert.equal(point.features.confirmedRegistrations,80);
});

test('completed platform outcomes calculate identified attendance without legacy aggregates',async()=>{
 const eventDate=new Date(Date.now()-86400000).toISOString().slice(0,10),created=await org.post('/api/events').send({name:'Verified Outcome Fixture',date:eventDate,startTime:'10:00',capacity:100,status:'Completed'});assert.equal(created.status,201);const eventId=created.body.data.id,registrationId=randomUUID(),tokenHash=`test-${randomUUID()}`,registeredAt=`${eventDate}T08:00:00.000Z`,checkedInAt=`${eventDate}T10:15:00.000Z`;
 db.prepare(`INSERT INTO registrations(id,event_id,attendee_id,ticket_identifier,ticket_type,registration_status,ticket_status,ticket_token_hash,created_at,updated_at) VALUES(?,?,?,?,?,'CONFIRMED','USED',?,?,?)`).run(registrationId,eventId,'u-attendee',`OUTCOME-${randomUUID()}`,'General Access',tokenHash,registeredAt,checkedInAt);
 db.prepare('INSERT INTO check_ins(id,registration_id,checked_in_at,checked_in_by) VALUES(?,?,?,?)').run(randomUUID(),registrationId,checkedInAt,'u-org');
 const saved=await org.patch(`/api/events/${eventId}`).send({name:'Verified Outcome Fixture',description:'Finalize metadata'});assert.equal(saved.status,200);
 const overview=await org.get('/api/data-intelligence'),item=overview.body.data.events.find(row=>row.id===eventId);assert.equal(item.outcome.status,'VERIFIED');assert.equal(item.outcome.totalRegistrations,1);assert.equal(item.outcome.confirmedRegistrations,1);assert.equal(item.outcome.actualCheckIns,1);assert.equal(item.outcome.attendanceRate,1);assert.equal(item.legacyRegistrations,0);
});

test('historical CSV import previews rejected rows and keeps imported data unverified',async()=>{
 const csv='title,date,category,capacity,venue_capacity,registrations,confirmed_registrations,cancellations,actual_check_ins,source_reference\nArchive Summit,2024-09-12,Technology,500,600,420,400,20,312,Attendance report';
 const preview=await admin.post('/api/data-intelligence/import/preview').send({csv});assert.equal(preview.status,200);assert.equal(preview.body.data.summary.valid,1);
 const denied=await org.post('/api/data-intelligence/import/confirm').send({csv,fileName:'archive.csv'});assert.equal(denied.status,403);
 const imported=await admin.post('/api/data-intelligence/import/confirm').send({csv,fileName:'archive.csv',sourceReference:'College attendance report'});assert.equal(imported.status,201);assert.equal(imported.body.data.rowsImported,1);assert.equal(imported.body.data.rowsRejected,0);
 const duplicate=await admin.post('/api/data-intelligence/import/confirm').send({csv,fileName:'archive.csv'});assert.equal(duplicate.body.data.rowsImported,0);assert.equal(duplicate.body.data.rowsRejected,1);
 const overview=await admin.get('/api/data-intelligence');assert.equal(overview.body.data.summary.importedHistoricalEvents,1);assert.equal(overview.body.data.summary.importedOutcomesPendingReview,1);const row=overview.body.data.historicalDataset[0];assert.equal(row.dataQualityStatus,'IMPORTED_UNVERIFIED');
 assert.equal((await org.patch(`/api/data-intelligence/imports/${row.id}/verify`).send({sourceReference:'College report archive',reviewNotes:'Checked against the signed attendance report.'})).status,403);
 const reviewed=await admin.patch(`/api/data-intelligence/imports/${row.id}/verify`).send({sourceReference:'College report archive',reviewNotes:'Checked against the signed attendance report.'});assert.equal(reviewed.status,200);assert.equal(reviewed.body.data.dataQualityStatus,'VERIFIED');
 const afterReview=await admin.get('/api/data-intelligence');assert.equal(afterReview.body.data.summary.importedOutcomesPendingReview,0);assert.equal(afterReview.body.data.summary.verifiedOutcomes,2);
 const invalid='title,date,category,capacity,venue_capacity,registrations,confirmed_registrations,cancellations,actual_check_ins\nBad Event,2024-99-99,Technology,-1,,20,20,0,';const bad=await admin.post('/api/data-intelligence/import/preview').send({csv:invalid});assert.equal(bad.body.data.summary.rejected,1);
});
