import { Router } from 'express';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, now } from '../db.js';
import { asyncRoute, attendeeRows, eventById, HttpError, ok, parse, recordActivity } from '../http.js';
import { authenticate, allowRoles } from '../middleware.js';
import { issueTicket } from '../demo.js';
import { captureEventSnapshot, persistOutcome } from '../data-intelligence.js';

export const registrationsRouter=Router();
registrationsRouter.use(authenticate);
registrationsRouter.get('/',(req,res)=>{
 const rows=req.user.role==='ADMIN'?attendeeRows('1=1'):req.user.role==='ORGANIZER'?attendeeRows('e.organizer_id=?',[req.user.id]):attendeeRows('r.attendee_id=?',[req.user.id]);
 ok(res,rows);
});
registrationsRouter.post('/',allowRoles('ADMIN','ORGANIZER'),asyncRoute(async(req,res)=>{
 const input=parse(z.object({name:z.string().trim().min(1).max(120),email:z.string().email().max(254),eventId:z.string().min(1).max(100),ticket:z.string().max(80).optional()}),req.body);
 const event=eventById(input.eventId);if(!event)throw new HttpError(404,'NOT_FOUND','Event not found');
 if(req.user.role==='ORGANIZER'&&event.organizer_id!==req.user.id)throw new HttpError(404,'NOT_FOUND','Event not found');
 const attendeeEmail=input.email.toLowerCase();let attendee=db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE').get(attendeeEmail);
 if(attendee&&attendee.role!=='ATTENDEE')throw new HttpError(409,'EMAIL_EXISTS','Email belongs to a non-attendee account');
 if(!attendee){const id=randomUUID(),t=now();db.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,input.name,attendeeEmail,`!disabled-${randomBytes(32).toString('hex')}`,'ATTENDEE',t,t);attendee=db.prepare('SELECT * FROM users WHERE id=?').get(id)}
 const register=db.transaction(()=>{
  const n=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND registration_status='CONFIRMED'").get(event.id).n;
  if(Number(event.legacy_registrations||0)+n>=event.capacity)throw new HttpError(409,'EVENT_FULL','This event has reached capacity');
  const code=`EVT-${randomUUID().slice(0,12).toUpperCase()}`;const ticket=issueTicket({eventId:event.id,attendeeId:attendee.id,identifier:code,ticketType:input.ticket||'General Access'});
  captureEventSnapshot(event.id,'Confirmed registration recorded');
  recordActivity(req.user,'Registered attendee',`${attendee.name} • ${event.title}`,'success');
  return {registrationId:ticket.id,id:code,event:event.title,ticketToken:ticket.token,status:'Pending'};
 });
 try{ok(res,register(),201)}catch(e){if(String(e.code).includes('UNIQUE'))throw new HttpError(409,'DUPLICATE_REGISTRATION','This attendee is already registered');throw e;}
}));

export const ticketsRouter=Router();ticketsRouter.use(authenticate);
ticketsRouter.get('/',allowRoles('ATTENDEE'),(req,res)=>{
 const rows=db.prepare(`SELECT r.*,e.title event_title,e.event_date,e.status event_status,e.venue_name,c.checked_in_at FROM registrations r JOIN events e ON e.id=r.event_id LEFT JOIN check_ins c ON c.registration_id=r.id WHERE r.attendee_id=? ORDER BY r.created_at DESC`).all(req.user.id);
 const rotate=db.prepare('UPDATE registrations SET ticket_token_hash=?,updated_at=? WHERE id=?');
 const tickets=rows.map(r=>{const token=randomBytes(32).toString('base64url');rotate.run(createHash('sha256').update(token).digest('hex'),now(),r.id);return {id:r.id,identifier:r.ticket_identifier,ticket:r.ticket_type,eventId:r.event_id,event:r.event_title,date:r.event_date,venue:r.venue_name,status:r.ticket_status,registrationStatus:r.registration_status,checkedInAt:r.checked_in_at,qrToken:token}});
 ok(res,tickets);
});
ticketsRouter.post('/:id/cancel',allowRoles('ATTENDEE'),asyncRoute(async(req,res)=>{
 const registration=db.prepare('SELECT * FROM registrations WHERE id=? AND attendee_id=?').get(req.params.id,req.user.id);
 if(!registration)throw new HttpError(404,'NOT_FOUND','Registration not found');
 if(registration.ticket_status==='USED')throw new HttpError(409,'ALREADY_CHECKED_IN','A checked-in ticket cannot be cancelled');
 if(registration.registration_status==='CANCELLED')throw new HttpError(409,'TICKET_CANCELLED','Registration is already cancelled');
 db.prepare(`UPDATE registrations SET registration_status='CANCELLED',ticket_status='CANCELLED',updated_at=? WHERE id=? AND attendee_id=? AND registration_status='CONFIRMED'`).run(now(),req.params.id,req.user.id);captureEventSnapshot(registration.event_id,'Registration cancelled');persistOutcome(registration.event_id);ok(res,{cancelled:true});
}));

export const checkInRouter=Router();checkInRouter.use(authenticate,allowRoles('ADMIN','ORGANIZER'));
const checkin=z.object({token:z.string().min(1).max(300).optional(),ticketIdentifier:z.string().min(1).max(100).optional()}).refine(x=>x.token||x.ticketIdentifier,{message:'A ticket token or ticket identifier is required'});
function performCheckIn(req,input){
 const lookup=input.token
  ? db.prepare('SELECT r.*,e.organizer_id,e.status event_status,e.title event_title,u.name attendee_name FROM registrations r JOIN events e ON e.id=r.event_id JOIN users u ON u.id=r.attendee_id WHERE r.ticket_token_hash=?').get(createHash('sha256').update(input.token).digest('hex'))
  : db.prepare('SELECT r.*,e.organizer_id,e.status event_status,e.title event_title,u.name attendee_name FROM registrations r JOIN events e ON e.id=r.event_id JOIN users u ON u.id=r.attendee_id WHERE r.ticket_identifier=?').get(input.ticketIdentifier);
 if(!lookup)throw new HttpError(404,'INVALID_TICKET','Invalid ticket');
 if(req.user.role==='ORGANIZER'&&lookup.organizer_id!==req.user.id)throw new HttpError(403,'UNAUTHORIZED_CHECKIN','You cannot check in tickets for another organizer’s event');
 if(lookup.ticket_status==='CANCELLED'||lookup.registration_status==='CANCELLED')throw new HttpError(410,'TICKET_CANCELLED','Ticket has been cancelled');
 if(lookup.event_status!=='Live')throw new HttpError(409,'EVENT_NOT_ACTIVE','Event is not active for check-in');
 if(lookup.ticket_status==='USED'||db.prepare('SELECT 1 FROM check_ins WHERE registration_id=?').get(lookup.id))throw new HttpError(409,'ALREADY_CHECKED_IN','Ticket has already been checked in');
 try{
  const run=db.transaction(()=>{const t=now();const update=db.prepare("UPDATE registrations SET ticket_status='USED',updated_at=? WHERE id=? AND ticket_status='VALID'").run(t,lookup.id);if(!update.changes)throw new HttpError(409,'ALREADY_CHECKED_IN','Ticket has already been checked in');db.prepare('INSERT INTO check_ins(id,registration_id,checked_in_at,checked_in_by) VALUES(?,?,?,?)').run(randomUUID(),lookup.id,t,req.user.id);captureEventSnapshot(lookup.event_id,'Ticket checked in');persistOutcome(lookup.event_id);recordActivity(req.user,'Attendee checked in',`${lookup.attendee_name} • ${lookup.ticket_identifier}`,'success');return t});
  const checkedInAt=run();return {state:'VALID',ticketIdentifier:lookup.ticket_identifier,attendee:lookup.attendee_name,event:lookup.event_title,checkedInAt};
 }catch(e){if(String(e.code).includes('UNIQUE'))throw new HttpError(409,'ALREADY_CHECKED_IN','Ticket has already been checked in');throw e;}
}
checkInRouter.post('/',asyncRoute(async(req,res)=>ok(res,performCheckIn(req,parse(checkin,req.body)))));

export const attendeesRouter=Router();attendeesRouter.use(authenticate,allowRoles('ADMIN','ORGANIZER'));
attendeesRouter.get('/',(req,res)=>ok(res,req.user.role==='ADMIN'?attendeeRows('1=1'):attendeeRows('e.organizer_id=?',[req.user.id])));
attendeesRouter.post('/',asyncRoute(async(req,res)=>{
 const input=parse(z.object({name:z.string().trim().min(1).max(120),email:z.string().email().max(254),event:z.string().min(1),eventId:z.string().optional(),ticket:z.string().max(80).optional()}),req.body);
 const event=input.eventId?eventById(input.eventId):db.prepare('SELECT * FROM events WHERE title=? AND (?=\'ADMIN\' OR organizer_id=?)').get(input.event,req.user.role,req.user.id);
 if(!event||req.user.role==='ORGANIZER'&&event.organizer_id!==req.user.id)throw new HttpError(404,'NOT_FOUND','Event not found');
 req.body={...input,eventId:event.id};
 const attendee=db.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').get(input.email);
 if(attendee)throw new HttpError(409,'DUPLICATE_REGISTRATION','Attendee already has an account; use the registration workflow');
 const id=randomUUID(),time=now();db.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,input.name,input.email,`!disabled-${randomBytes(32).toString('hex')}`,'ATTENDEE',time,time);
 const register=db.transaction(()=>{const count=db.prepare("SELECT COUNT(*) n FROM registrations WHERE event_id=? AND registration_status='CONFIRMED'").get(event.id).n;if(Number(event.legacy_registrations||0)+count>=event.capacity)throw new HttpError(409,'EVENT_FULL','This event has reached capacity');const ticket=issueTicket({eventId:event.id,attendeeId:id,identifier:`EVT-${randomUUID().slice(0,12).toUpperCase()}`,ticketType:input.ticket||'General Access'});captureEventSnapshot(event.id,'Organizer registered attendee');return ticket});
 let ticket;try{ticket=register()}catch(e){db.prepare('DELETE FROM users WHERE id=?').run(id);if(String(e.code).includes('UNIQUE'))throw new HttpError(409,'DUPLICATE_REGISTRATION','Attendee is already registered');throw e}
 ok(res,{id:ticket.identifier,registrationId:ticket.id,name:input.name,email:input.email,ticket:input.ticket||'General Access',event:event.title,status:'Pending',time:'—'},201);
}));
attendeesRouter.patch('/:id',asyncRoute(async(req,res)=>{
 parse(z.object({status:z.literal('Checked In')}),req.body);
 const existing=attendeeRows(req.user.role==='ADMIN'?'r.ticket_identifier=?':'e.organizer_id=? AND r.ticket_identifier=?',req.user.role==='ADMIN'?[req.params.id]:[req.user.id,req.params.id])[0];
 if(!existing)throw new HttpError(404,'NOT_FOUND','Ticket not found');
 const result=performCheckIn(req,{ticketIdentifier:req.params.id});
 ok(res,{...existing,status:'Checked In',time:new Date(result.checkedInAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
}));
