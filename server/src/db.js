import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const configuredPath = process.env.EVENTRA_DB_PATH || './data/eventra.sqlite';
const dbPath = configuredPath === ':memory:' ? configuredPath : resolve(configuredPath);
if(dbPath!==':memory:') mkdirSync(dirname(dbPath), { recursive: true });
export const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','ORGANIZER','ATTENDEE')),
  profile_json TEXT NOT NULL DEFAULT '{}', session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS venues (
  id TEXT PRIMARY KEY, organizer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL CHECK(capacity > 0), description TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'AVAILABLE', rate TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL REFERENCES users(id), venue_id TEXT REFERENCES venues(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'General',
  event_date TEXT NOT NULL, start_time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '',
  venue_name TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL CHECK(capacity > 0), image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('Planning','Upcoming','Live','Completed','Cancelled')),
  revenue REAL NOT NULL DEFAULT 0, legacy_registrations INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attendee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_identifier TEXT NOT NULL UNIQUE, ticket_type TEXT NOT NULL DEFAULT 'General Access', registration_status TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK(registration_status IN ('CONFIRMED','CANCELLED')),
  ticket_status TEXT NOT NULL DEFAULT 'VALID' CHECK(ticket_status IN ('VALID','CANCELLED','USED')),
  ticket_token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(event_id, attendee_id)
);
CREATE TABLE IF NOT EXISTS check_ins (
  id TEXT PRIMARY KEY, registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id) ON DELETE CASCADE,
  checked_in_at TEXT NOT NULL, checked_in_by TEXT NOT NULL REFERENCES users(id), legacy_time TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY, organizer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, category TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', budget TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,setting_key)
);
CREATE TABLE IF NOT EXISTS event_snapshots (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL, source TEXT NOT NULL, reason TEXT NOT NULL,
  values_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_event_snapshots_event_time ON event_snapshots(event_id,captured_at);
CREATE TABLE IF NOT EXISTS prediction_snapshots (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  prediction_point TEXT NOT NULL CHECK(prediction_point IN ('30D','14D','7D','1D')),
  cutoff_at TEXT NOT NULL, features_json TEXT, available INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(event_id,prediction_point)
);
CREATE TABLE IF NOT EXISTS event_outcomes (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('VERIFIED','OUTCOME_UNAVAILABLE')),
  total_registrations INTEGER NOT NULL DEFAULT 0, confirmed_registrations INTEGER NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0, actual_check_ins INTEGER NOT NULL DEFAULT 0,
  attendance_rate REAL, no_show_rate REAL, capacity_utilization REAL, conversion_rate REAL,
  source TEXT NOT NULL, source_reference TEXT NOT NULL DEFAULT '', data_quality_status TEXT NOT NULL,
  data_quality_notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS historical_imports (
  id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source_reference TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'IMPORTED_HISTORICAL_DATA', rows_detected INTEGER NOT NULL,
  rows_imported INTEGER NOT NULL, rows_rejected INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS historical_events (
  id TEXT PRIMARY KEY, import_id TEXT NOT NULL REFERENCES historical_imports(id) ON DELETE CASCADE,
  source_row INTEGER NOT NULL, title TEXT NOT NULL, event_date TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL, venue_capacity INTEGER, total_registrations INTEGER NOT NULL,
  confirmed_registrations INTEGER NOT NULL, cancellations INTEGER NOT NULL, actual_check_ins INTEGER NOT NULL,
  source TEXT NOT NULL, source_reference TEXT NOT NULL DEFAULT '', data_quality_status TEXT NOT NULL,
  data_quality_notes TEXT NOT NULL DEFAULT '', verified_by TEXT REFERENCES users(id), verified_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(import_id,source_row)
);
CREATE INDEX IF NOT EXISTS idx_historical_events_date ON historical_events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_organizer_date ON events(organizer_id,event_date);
CREATE INDEX IF NOT EXISTS idx_events_status_date ON events(status,event_date);
CREATE INDEX IF NOT EXISTS idx_registrations_event ON registrations(event_id,registration_status);
CREATE INDEX IF NOT EXISTS idx_registrations_attendee ON registrations(attendee_id,created_at);
CREATE INDEX IF NOT EXISTS idx_vendors_organizer ON vendors(organizer_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
`);

const userColumns=db.prepare('PRAGMA table_info(users)').all().map(column=>column.name);
if(!userColumns.includes('session_version'))db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
const registrationColumns=db.prepare('PRAGMA table_info(registrations)').all().map(column=>column.name);
if(!registrationColumns.includes('ticket_type'))db.exec("ALTER TABLE registrations ADD COLUMN ticket_type TEXT NOT NULL DEFAULT 'General Access'");
const checkInColumns=db.prepare('PRAGMA table_info(check_ins)').all().map(column=>column.name);
if(!checkInColumns.includes('legacy_time'))db.exec("ALTER TABLE check_ins ADD COLUMN legacy_time TEXT NOT NULL DEFAULT ''");
db.pragma('user_version = 1');

const eventColumns=db.prepare('PRAGMA table_info(events)').all().map(column=>column.name);
for(const [name,definition] of [['source',"TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED'"],['source_reference',"TEXT NOT NULL DEFAULT ''"],['data_quality_status',"TEXT NOT NULL DEFAULT 'UNASSESSED'"],['data_quality_notes',"TEXT NOT NULL DEFAULT 'Pre-provenance event record; origin and aggregate accuracy are unknown.'"]])if(!eventColumns.includes(name))db.exec(`ALTER TABLE events ADD COLUMN ${name} ${definition}`);
const provenanceBackfill='phase4b_pre_provenance_events';
if(!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(provenanceBackfill))db.transaction(()=>{db.prepare("UPDATE events SET source='LEGACY_UNVERIFIED',data_quality_notes='Pre-provenance event record; original values retained, but origin and aggregate accuracy are unknown.' WHERE source='PLATFORM' AND source_reference=''").run();db.prepare('INSERT INTO migrations(name,applied_at) VALUES(?,?)').run(provenanceBackfill,new Date().toISOString())})();
const historicalColumns=db.prepare('PRAGMA table_info(historical_events)').all().map(column=>column.name);
if(!historicalColumns.includes('verified_by'))db.exec('ALTER TABLE historical_events ADD COLUMN verified_by TEXT REFERENCES users(id)');
if(!historicalColumns.includes('verified_at'))db.exec('ALTER TABLE historical_events ADD COLUMN verified_at TEXT');

export const now = () => new Date().toISOString();
export const closeDb = () => db.close();
