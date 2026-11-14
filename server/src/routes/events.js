import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, now } from '../db.js';
import { asyncRoute, eventById, eventDto, eventForUser, HttpError, ok, parse, recordActivity } from '../http.js';
import { authenticate, allowRoles } from '../middleware.js';
import { issueTicket } from '../demo.js';
import { captureEventSnapshot, persistOutcome } from '../data-intelligence.js';

export const eventsRouter=Router();
const eventInput=z.object({
  name:z.string().trim().min(2).max(160).optional(),title:z.string().trim().min(2).max(160).optional(),
  description:z.string().max(10000).optional(),category:z.string().max(80).optional(),date:z.string().min(10).max(30).optional(),
  startTime:z.string().max(20).optional(),endTime:z.string().max(20).optional(),venue:z.string().max(200).optional(),venueId:z.string().max(100).nullable().optional(),
  capacity:z.coerce.number().int().min(1).max(1000000).optional(),status:z.enum(['Planning','Upcoming','Live','Completed','Cancelled']).optional(),
  revenue:z.coerce.number().min(0).optional(),image:z.string().max(2000).optional(),
}).refine(v=>v.name||v.title,{message:'Event title is required',path:['title']});

function chooseVenue(input,organizerId,capacity){
  if(input.venueId){
    const venue=db.prepare('SELECT * FROM venues WHERE id=?').get(input.venueId);
    if(!venue) throw new HttpError(400,'INVALID_VENUE','Selected venue does not exist');
    if(venue.organizer_id&&venue.organizer_id!==organizerId) throw new HttpError(403,'FORBIDDEN','Venue belongs to another organizer');
    if(venue.status!=='AVAILABLE') throw new HttpError(409,'VENUE_UNAVAILABLE','Selected venue is not available');
    if(venue.capacity<capacity) throw new HttpError(400,'VENUE_CAPACITY','Venue capacity is below the event capacity');
    return venue;
  }
  if(input.venue){const venue=db.prepare('SELECT * FROM venues WHERE name=? AND (organizer_id=? OR organizer_id IS NULL) LIMIT 1').get(input.venue,organizerId)||null;if(venue&&venue.status!=='AVAILABLE')throw new HttpError(409,'VENUE_UNAVAILABLE','Selected venue is not available');if(venue&&venue.capacity<capacity)throw new HttpError(400,'VENUE_CAPACITY','Venue capacity is below the event capacity');return venue;}
  return null;
}
function listEvents(req){
 const where=req.user?.role==='ADMIN'?'':req.user?.role==='ORGANIZER'?'WHERE e.organizer_id=?':'WHERE e.status IN (\'Upcoming\',\'Live\')';
 const rows=db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.registration_status='CONFIRMED') registration_count FROM events e ${where} ORDER BY e.event_date`).all(...(req.user?.role==='ORGANIZER'?[req.user.id]:[]));
 return rows.map(eventDto);
}
eventsRouter.get('/',(req,res)=>ok(res,listEvents(req)));
eventsRouter.post('/',authenticate,allowRoles('ADMIN','ORGANIZER'),asyncRoute(async(req,res)=>{
 const input=parse(eventInput,req.body);if(!input.date) throw new HttpError(400,'VALIDATION_ERROR','Event date is required');
 const title=input.title||input.name,capacity=input.capacity||100,owner=req.user.role==='ORGANIZER'?req.user.id:(req.body.organizerId||req.user.id);
 if(req.user.role==='ADMIN'&&!db.prepare("SELECT id FROM users WHERE id=? AND role='ORGANIZER'").get(owner)) throw new HttpError(400,'INVALID_ORGANIZER','Organizer does not exist');
 const venue=chooseVenue(input,owner,capacity),id=randomUUID(),time=now();
 db.prepare(`INSERT INTO events(id,organizer_id,venue_id,title,description,category,event_date,start_time,end_time,venue_name,capacity,status,revenue,image,created_at,updated_at,source,data_quality_status)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,owner,venue?.id||null,title,input.description||'',input.category||'General',input.date,input.startTime||'',input.endTime||'',input.venue||venue?.name||'',capacity,input.status||'Planning',input.revenue||0,input.image||'',time,time,'PLATFORM','UNASSESSED');
 captureEventSnapshot(id,'Event created');
 persistOutcome(id);
 recordActivity(req.user,'Created event',title,'success');
 ok(res,eventDto({...eventById(id),registration_count:0}),201);
}));
eventsRouter.get('/:id',authenticate,asyncRoute(async(req,res)=>{
 const row=eventForUser(req,req.params.id);if(req.user.role==='ATTENDEE'&&!['Upcoming','Live'].includes(row.status))throw new HttpError(404,'NOT_FOUND','Event not found');const count=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND registration_status='CONFIRMED'").get(row.id).n;
 ok(res,eventDto({...row,registration_count:count}));
}));
eventsRouter.patch('/:id',authenticate,allowRoles('ADMIN','ORGANIZER'),asyncRoute(async(req,res)=>{
 const current=eventForUser(req,req.params.id),input=parse(eventInput,req.body);
 const capacity=input.capacity??current.capacity;
 const count=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND registration_status='CONFIRMED'").get(current.id).n;
 if(capacity<Number(current.legacy_registrations||0)+count) throw new HttpError(409,'CAPACITY_BELOW_REGISTRATIONS','Capacity cannot be lower than the current registration count');
 if(current.venue_id){const linkedVenue=db.prepare('SELECT capacity FROM venues WHERE id=?').get(current.venue_id);if(linkedVenue&&capacity>linkedVenue.capacity)throw new HttpError(400,'VENUE_CAPACITY','Event capacity cannot exceed the linked venue capacity');}
 const venueChanged=(input.venueId!==undefined&&input.venueId!==current.venue_id)||(input.venue!==undefined&&input.venue!==current.venue_name);
 const venue=venueChanged?chooseVenue(input,current.organizer_id,capacity):(current.venue_id?db.prepare('SELECT * FROM venues WHERE id=?').get(current.venue_id):null);
 const next={title:input.title||input.name||current.title,description:input.description??current.description,category:input.category??current.category,event_date:input.date??current.event_date,start_time:input.startTime??current.start_time,end_time:input.endTime??current.end_time,venue_name:input.venue??venue?.name??current.venue_name,venue_id:input.venueId===null?null:venue?.id??input.venueId??current.venue_id,capacity,status:input.status??current.status,revenue:input.revenue??current.revenue,image:input.image??current.image,updated_at:now()};
 db.prepare(`UPDATE events SET title=@title,description=@description,category=@category,event_date=@event_date,start_time=@start_time,end_time=@end_time,venue_name=@venue_name,venue_id=@venue_id,capacity=@capacity,status=@status,revenue=@revenue,image=@image,updated_at=@updated_at WHERE id=@id`).run({...next,id:current.id});
 captureEventSnapshot(current.id,'Event details updated');
 persistOutcome(current.id);
 recordActivity(req.user,'Updated event',next.title,'system');const row=eventById(current.id);ok(res,eventDto({...row,registration_count:count}));
}));
eventsRouter.delete('/:id',authenticate,allowRoles('ADMIN','ORGANIZER'),asyncRoute(async(req,res)=>{
 const current=eventForUser(req,req.params.id);
 const active=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND registration_status='CONFIRMED'").get(current.id).n;
 if(active) throw new HttpError(409,'EVENT_HAS_REGISTRATIONS','Cancel registrations before deleting this event');
 db.prepare('DELETE FROM events WHERE id=?').run(current.id);recordActivity(req.user,'Deleted event',current.title,'danger');ok(res,{id:current.id});
}));

eventsRouter.post('/:id/register',authenticate,allowRoles('ATTENDEE'),asyncRoute(async(req,res)=>{
 const event=eventById(req.params.id);if(!event) throw new HttpError(404,'NOT_FOUND','Event not found');
 const register=db.transaction(()=>{
  const latest=eventById(event.id);if(!['Upcoming','Live'].includes(latest.status)) throw new HttpError(409,'EVENT_NOT_ACTIVE','Registration is not open for this event');
  if(db.prepare("SELECT 1 FROM registrations WHERE event_id=? AND attendee_id=? AND registration_status='CONFIRMED'").get(event.id,req.user.id))throw new HttpError(409,'DUPLICATE_REGISTRATION','You are already registered for this event');
  const count=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND registration_status='CONFIRMED'").get(event.id).n;
  if(Number(latest.legacy_registrations||0)+count>=latest.capacity) throw new HttpError(409,'EVENT_FULL','This event has reached capacity');
  const identifier=`EVT-${randomUUID().slice(0,12).toUpperCase()}`;
  const ticket=issueTicket({eventId:event.id,attendeeId:req.user.id,identifier});
  captureEventSnapshot(event.id,'Attendee registration recorded');
  recordActivity(req.user,'New attendee registered',`${req.user.name} • ${latest.title}`,'success');
  return {id:ticket.id,eventId:event.id,event:latest.title,ticketIdentifier:identifier,ticketToken:ticket.token,status:'Pending',createdAt:now()};
 });
 try{ok(res,register(),201)}catch(e){if(String(e.code).includes('UNIQUE')) throw new HttpError(409,'DUPLICATE_REGISTRATION','You are already registered for this event');throw e;}
}));
