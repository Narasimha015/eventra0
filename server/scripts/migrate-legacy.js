import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { db, now } from '../src/db.js';
import { seedDemoData } from '../src/demo.js';

const legacyPath = resolve(process.env.EVENTRA_LEGACY_JSON || './data.json');
const migration = 'legacy-json-v1';
const raw = JSON.parse(await readFile(legacyPath, 'utf8'));
const detailMigration = 'legacy-ticket-details-v1';
if (!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(detailMigration)) {
  const updateTicket = db.prepare('UPDATE registrations SET ticket_type=? WHERE ticket_identifier=?');
  const updateCheckIn = db.prepare(`UPDATE check_ins SET legacy_time=? WHERE registration_id=(SELECT id FROM registrations WHERE ticket_identifier=?)`);
  for (const attendee of raw.attendees || []) {
    const identifier = String(attendee.id || '');
    if (!identifier) continue;
    updateTicket.run(String(attendee.ticket || 'General Access'), identifier);
    if (attendee.status === 'Checked In') updateCheckIn.run(String(attendee.time || ''), identifier);
  }
  db.prepare('INSERT INTO migrations(name,applied_at) VALUES(?,?)').run(detailMigration, now());
}
if (db.prepare('SELECT 1 FROM migrations WHERE name=?').get(migration)) {
  console.log('Legacy JSON import already completed.');
  process.exit(0);
}
if(process.env.NODE_ENV!=='production')await seedDemoData();
const time = now();
const roleMap=new Map([['ADMIN','ADMIN'],['ADMINISTRATOR','ADMIN'],['ORGANIZER','ORGANIZER'],['ATTENDEE','ATTENDEE']]);
const insertUser = db.prepare(`INSERT OR IGNORE INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`);
for(const [i,user] of (raw.users||[]).entries()){
 const role=roleMap.get(String(user.role||'ATTENDEE').toUpperCase());if(!role)continue;
 insertUser.run(String(user.id||`legacy-user-${i}`),String(user.name||'Imported user'),String(user.email||`legacy-${i}@eventra.local`).toLowerCase(),`!password-reset-required-${randomBytes(24).toString('hex')}`,role,time,time);
}
const organizerId=db.prepare("SELECT id FROM users WHERE role='ORGANIZER' ORDER BY created_at LIMIT 1").get()?.id;
if(!organizerId)throw new Error('Legacy data needs at least one organizer account before importing event ownership.');
const insertVenue = db.prepare(`INSERT OR IGNORE INTO venues(id,organizer_id,name,address,city,capacity,description,status,rate,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
const venueByName = new Map();
for (const venue of raw.venues || []) {
  const id = String(venue.id || randomUUID());
  venueByName.set(venue.name, id);
  insertVenue.run(id,organizerId,venue.name,'','',Math.max(1,Number(venue.capacity)||1),'',String(venue.status||'AVAILABLE').toUpperCase(),String(venue.rate||''),time,time);
}

const insertEvent = db.prepare(`INSERT OR IGNORE INTO events(id,organizer_id,venue_id,title,description,category,event_date,start_time,end_time,venue_name,capacity,status,revenue,legacy_registrations,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const event of raw.events || []) {
  const id = String(event.id || randomUUID());
  const registrationRows = (raw.attendees || []).filter(a=>a.event===event.name).length;
  const legacyTotal = Math.max(registrationRows,Number(event.registrations)||0);
  insertEvent.run(id,organizerId,venueByName.get(event.venue)||null,event.name,'','General',String(event.date||''),'','',event.venue||'',Math.max(1,Number(event.capacity)||1),['Planning','Upcoming','Live','Completed','Cancelled'].includes(event.status)?event.status:'Planning',Number(event.revenue)||0,Math.max(0,legacyTotal-registrationRows),time,time);
}

const insertRegistration = db.prepare(`INSERT OR IGNORE INTO registrations(id,event_id,attendee_id,ticket_identifier,ticket_type,registration_status,ticket_status,ticket_token_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`);
const insertCheckIn = db.prepare('INSERT OR IGNORE INTO check_ins(id,registration_id,checked_in_at,checked_in_by,legacy_time) VALUES(?,?,?,?,?)');
const getEvent = db.prepare('SELECT id FROM events WHERE title=?');
const getUser = db.prepare('SELECT id FROM users WHERE email=?');
const registeredCounts = new Map();
for (const [i, attendee] of (raw.attendees || []).entries()) {
  const email = String(attendee.email || `legacy-${i}@eventra.local`).trim().toLowerCase();
  const attendeeId = String(attendee.id || randomUUID());
  insertUser.run(attendeeId,String(attendee.name||'Imported attendee'),email,`!disabled-${randomBytes(24).toString('hex')}`,'ATTENDEE',time,time);
  const user = getUser.get(email);
  const event = getEvent.get(attendee.event);
  if (!user || !event) continue;
  const ticketToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(ticketToken).digest('hex');
  const status = attendee.status==='Checked In'?'USED':'VALID';
  const registrationId = randomUUID();
  const result = insertRegistration.run(registrationId,event.id,user.id,String(attendee.id||`LEGACY-${i+1}`),String(attendee.ticket||'General Access'),'CONFIRMED',status,tokenHash,time,time);
  if (result.changes) {
    registeredCounts.set(event.id,(registeredCounts.get(event.id)||0)+1);
  if (status==='USED') insertCheckIn.run(randomUUID(),registrationId,time,organizerId,String(attendee.time||''));
  }
}
const adjustLegacy = db.prepare('UPDATE events SET legacy_registrations=MAX(0,legacy_registrations-?) WHERE id=?');
for (const [eventId,count] of registeredCounts) adjustLegacy.run(count,eventId);

const insertVendor = db.prepare(`INSERT OR IGNORE INTO vendors(id,organizer_id,name,category,budget,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
for (const vendor of raw.vendors || []) insertVendor.run(String(vendor.id||randomUUID()),organizerId,vendor.name||'Imported vendor',vendor.category||'Other',String(vendor.budget||''),vendor.status||'Pending',time,time);
const insertActivity = db.prepare('INSERT OR IGNORE INTO activity(id,user_id,action,detail,type,created_at,read) VALUES(?,?,?,?,?,?,?)');
for (const item of raw.audit || []) insertActivity.run(String(item.id||randomUUID()),organizerId,item.action||'Imported activity',item.detail||'','system',item.at||time,item.read?1:0);
db.prepare('INSERT INTO migrations(name,applied_at) VALUES(?,?)').run(migration,time);
console.log(`Imported legacy records from ${legacyPath}; source JSON was left intact.`);
