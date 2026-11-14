import { z } from 'zod';
import { db, now } from './db.js';
import { deriveTemporalState } from './lifecycle.js';

export class HttpError extends Error {
  constructor(status, code, message, details) { super(message); this.status=status; this.code=code; this.details=details; }
}
export const ok = (res, data, status=200) => res.status(status).json({ data });
export const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
export const parse = (schema, value) => {
  const result=schema.safeParse(value);
  if(!result.success) throw new HttpError(400,'VALIDATION_ERROR','Request validation failed',result.error.issues.map(i=>({field:i.path.join('.'),message:i.message})));
  return result.data;
};
export const string = z.string().trim().min(1).max(500);
export const idParam = z.object({id:z.string().min(1).max(100)});
export const eventById = id => db.prepare('SELECT * FROM events WHERE id=?').get(id);
export const eventForUser = (req,id) => {
  const event=eventById(id);
  if(!event) throw new HttpError(404,'NOT_FOUND','Event not found');
  if(req.user.role==='ORGANIZER'&&event.organizer_id!==req.user.id) throw new HttpError(404,'NOT_FOUND','Event not found');
  return event;
};
export const eventDto = row => ({
  id:row.id,name:row.title,title:row.title,description:row.description,category:row.category,
  date:row.event_date,startTime:row.start_time,endTime:row.end_time,venue:row.venue_name,venueId:row.venue_id,
  status:row.status,temporalState:deriveTemporalState(row),capacity:row.capacity,registrations:Number(row.legacy_registrations||0)+Number(row.registration_count||0),
  revenue:Number(row.revenue||0),image:row.image,organizerId:row.organizer_id,createdAt:row.created_at,updatedAt:row.updated_at,
});
export const attendeeRows = (scopeSql, params=[]) => db.prepare(`
 SELECT r.id AS registration_id,r.ticket_identifier,r.ticket_type,r.registration_status,r.ticket_status,r.created_at,c.legacy_time,
 u.id,u.name,u.email,e.title AS event,e.event_date,e.venue_name,
 c.checked_in_at,CASE WHEN c.id IS NULL THEN 'Pending' ELSE 'Checked In' END AS status
 FROM registrations r JOIN users u ON u.id=r.attendee_id JOIN events e ON e.id=r.event_id
 LEFT JOIN check_ins c ON c.registration_id=r.id WHERE ${scopeSql} ORDER BY r.created_at DESC
`).all(...params).map(r=>({id:r.ticket_identifier,registrationId:r.registration_id,name:r.name,email:r.email,event:r.event,ticket:r.ticket_type,status:r.status,time:r.checked_in_at?(r.legacy_time||new Date(r.checked_in_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})):'—',date:r.event_date,venue:r.venue_name,registrationStatus:r.registration_status,ticketStatus:r.ticket_status,attendeeId:r.id}));
export const recordActivity = (user,action,detail='',type='system') => {
  const id=crypto.randomUUID();db.prepare('INSERT INTO activity(id,user_id,action,detail,type,created_at) VALUES(?,?,?,?,?,?)').run(id,user?.id||null,action,detail,type,now());return id;
};
