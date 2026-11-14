import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { db, now } from './db.js';

const localPasswords = {
  ADMIN: process.env.EVENTRA_DEMO_ADMIN_PASSWORD || 'Eventra@2026',
  ORGANIZER: process.env.EVENTRA_DEMO_ORGANIZER_PASSWORD || 'Organizer@2026',
  ATTENDEE: process.env.EVENTRA_DEMO_ATTENDEE_PASSWORD || 'Attendee@2026',
};

export async function seedDemoData() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  const time = now();
  const users = [
    ['u-admin','Admin User','admin@eventra.local','ADMIN'],
    ['u-org','Event Organizer','organizer@eventra.local','ORGANIZER'],
    ['u-attendee','Demo Attendee','attendee@eventra.local','ATTENDEE'],
  ];
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users(id,name,email,password_hash,role,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)`);
  for (const [id,name,email,role] of users) {
    insertUser.run(id,name,email,await bcrypt.hash(localPasswords[role],12),role,time,time);
  }

  const insertVenue = db.prepare(`INSERT OR IGNORE INTO venues(id,organizer_id,name,address,city,capacity,description,status,rate,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  insertVenue.run('v1','u-org','Grand Convention Hall','','',1200,'Imported demo venue','AVAILABLE','₹1.8L / day',time,time);
  insertVenue.run('v2','u-org','Innovation Park','','',750,'Imported demo venue','RESERVED','₹95K / day',time,time);
  insertVenue.run('v3','u-org','Creative Arts Center','','',500,'Imported demo venue','AVAILABLE','₹65K / day',time,time);

 const insertEvent = db.prepare(`INSERT OR IGNORE INTO events(id,organizer_id,venue_id,title,event_date,venue_name,capacity,status,revenue,legacy_registrations,created_at,updated_at,source,source_reference,data_quality_status,data_quality_notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const evs = [
    ['e1','Tech Summit 2026','2026-09-18','Grand Convention Hall','Live',1000,412500,842,'v1'],
    ['e2','Startup Expo','2026-10-04','Innovation Park','Upcoming',750,286000,524,'v2'],
    ['e3','Design Week','2026-10-22','Creative Arts Center','Planning',500,108000,216,'v3'],
  ];
  for (const [id,title,date,venue,status,capacity,revenue,legacy,venueId] of evs) {
    insertEvent.run(id,'u-org',venueId,title,date,venue,capacity,status,revenue,legacy,time,time,'DEMO_SEED','server/src/demo.js','DEMO_UNVERIFIED','Seeded demonstration event; legacy aggregate is not actual attendance.');
  }
  const insertVendor = db.prepare(`INSERT OR IGNORE INTO vendors(id,organizer_id,name,category,budget,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
  insertVendor.run('vendor1','u-org','StageCraft Productions','Production','₹2.4L','Confirmed',time,time);
  insertVendor.run('vendor2','u-org','FreshBite Catering','Catering','₹1.1L','Confirmed',time,time);
  return { accounts: users.map(([,name,email,role])=>({name,email,role})) };
}

export function issueTicket({ eventId, attendeeId, identifier, ticketType='General Access', registrationStatus='CONFIRMED', ticketStatus='VALID' }) {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const time = now();
  db.prepare(`INSERT INTO registrations(id,event_id,attendee_id,ticket_identifier,ticket_type,registration_status,ticket_status,ticket_token_hash,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,eventId,attendeeId,identifier,ticketType,registrationStatus,ticketStatus,tokenHash,time,time);
  return { id, token, identifier };
}
