import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { asyncRoute, eventForUser, ok, parse, idParam } from '../http.js';
import { authenticate, allowRoles } from '../middleware.js';
import { calculateEventIntelligence, simulateWhatIf } from '../intelligence.js';

export const intelligenceRouter=Router();
intelligenceRouter.use(authenticate,allowRoles('ADMIN','ORGANIZER'));

function eventAnalysis(req,id){
  const params=parse(idParam,{id}),event=eventForUser(req,params.id);
  const registration=db.prepare(`SELECT SUM(CASE WHEN registration_status='CONFIRMED' THEN 1 ELSE 0 END) confirmed,SUM(CASE WHEN registration_status='CANCELLED' THEN 1 ELSE 0 END) cancelled FROM registrations WHERE event_id=?`).get(event.id);
  const venue=event.venue_id?db.prepare('SELECT capacity,status FROM venues WHERE id=?').get(event.venue_id):null;
  const history=db.prepare(`SELECT e.id,COUNT(DISTINCT r.id) registrations,COUNT(DISTINCT c.id) checkIns FROM events e LEFT JOIN registrations r ON r.event_id=e.id AND r.registration_status='CONFIRMED' LEFT JOIN check_ins c ON c.registration_id=r.id WHERE e.organizer_id=? AND e.id<>? AND (e.status='Completed' OR e.event_date<date('now')) GROUP BY e.id`).all(event.organizer_id,event.id);
  const registrationTrend=db.prepare(`SELECT substr(created_at,1,10) date,COUNT(*) count FROM registrations WHERE event_id=? AND registration_status='CONFIRMED' GROUP BY substr(created_at,1,10) ORDER BY date DESC LIMIT 30`).all(event.id).reverse();
  const checkInTrend=db.prepare(`SELECT substr(c.checked_in_at,1,10) date,COUNT(*) count FROM check_ins c JOIN registrations r ON r.id=c.registration_id WHERE r.event_id=? GROUP BY substr(c.checked_in_at,1,10) ORDER BY date DESC LIMIT 30`).all(event.id).reverse();
  const arrivalTimes=db.prepare(`SELECT c.checked_in_at FROM check_ins c JOIN registrations r ON r.id=c.registration_id WHERE r.event_id=?`).all(event.id).map(item=>item.checked_in_at);
  return calculateEventIntelligence({event,registration,venue,history,registrationTrend,checkInTrend,arrivalTimes});
}

intelligenceRouter.get('/:id/intelligence',asyncRoute((req,res)=>ok(res,eventAnalysis(req,req.params.id))));
intelligenceRouter.post('/:id/what-if',asyncRoute((req,res)=>{
  const input=parse(z.object({expectedRegistrations:z.number().int().min(0).max(1000000)}),req.body);
  const analysis=eventAnalysis(req,req.params.id);
  ok(res,simulateWhatIf(analysis,input.expectedRegistrations));
}));
