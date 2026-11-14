import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, now } from '../db.js';
import { asyncRoute, HttpError, ok, parse } from '../http.js';
import { authenticate, allowRoles } from '../middleware.js';

export const analyticsRouter=Router();analyticsRouter.use(authenticate,allowRoles('ADMIN','ORGANIZER'));
analyticsRouter.get('/',(req,res)=>{
 const where=req.user.role==='ADMIN'?'':'WHERE e.organizer_id=?',args=req.user.role==='ADMIN'?[]:[req.user.id];
 const events=db.prepare(`SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.registration_status='CONFIRMED') registration_count FROM events e ${where}`).all(...args);
 const ids=events.map(e=>e.id);const registrations=ids.length?db.prepare(`SELECT COUNT(*) n FROM registrations WHERE registration_status='CONFIRMED' AND event_id IN (${ids.map(()=>'?').join(',')})`).get(...ids).n:0;
 const checkedIn=ids.length?db.prepare(`SELECT COUNT(*) n FROM check_ins c JOIN registrations r ON r.id=c.registration_id WHERE r.event_id IN (${ids.map(()=>'?').join(',')})`).get(...ids).n:0;
 const totalRegistrations=events.reduce((s,e)=>s+Number(e.legacy_registrations||0),0)+registrations;
 const totalCapacity=events.reduce((s,e)=>s+Number(e.capacity||0),0),totalRevenue=events.reduce((s,e)=>s+Number(e.revenue||0),0);
 const byMonth=db.prepare(`SELECT substr(r.created_at,1,7) month,COUNT(*) registrations FROM registrations r JOIN events e ON e.id=r.event_id ${req.user.role==='ADMIN'?'':'WHERE e.organizer_id=?'} GROUP BY month ORDER BY month`).all(...args);
 ok(res,{totalEvents:events.length,upcomingEvents:events.filter(e=>['Upcoming','Planning'].includes(e.status)).length,totalRegistrations,totalCapacity,availableCapacity:Math.max(0,totalCapacity-totalRegistrations),totalRevenue,checkedIn,attendanceRate:totalRegistrations?Math.round(checkedIn/totalRegistrations*1000)/10:0,capacityUtilization:totalCapacity?Math.round(totalRegistrations/totalCapacity*1000)/10:0,registrationTrends:byMonth,events:events.map(e=>({id:e.id,name:e.title,registrations:Number(e.legacy_registrations||0)+Number(e.registration_count||0),capacity:e.capacity,revenue:e.revenue,status:e.status}))});
});

export const usersRouter=Router();usersRouter.use(authenticate,allowRoles('ADMIN'));
usersRouter.get('/',(_req,res)=>ok(res,db.prepare('SELECT id,name,email,role,created_at createdAt,updated_at updatedAt FROM users ORDER BY created_at').all()));
usersRouter.post('/',asyncRoute(async(req,res)=>{const input=parse(z.object({name:z.string().trim().min(1).max(120),email:z.string().email().max(254),password:z.string().min(12).max(200),role:z.enum(['ADMIN','ORGANIZER','ATTENDEE'])}),req.body),id=randomUUID(),t=now();try{db.prepare('INSERT INTO users(id,name,email,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,input.name,input.email,await bcrypt.hash(input.password,12),input.role,t,t)}catch(e){if(String(e.code).includes('CONSTRAINT'))throw new HttpError(409,'EMAIL_EXISTS','An account with this email already exists');throw e}ok(res,{id,name:input.name,email:input.email,role:input.role,createdAt:t},201)}));

export const settingsRouter=Router();settingsRouter.use(authenticate,allowRoles('ADMIN','ORGANIZER'));
settingsRouter.get('/',(req,res)=>{const values=Object.fromEntries(db.prepare('SELECT setting_key,setting_value FROM workspace_settings WHERE user_id=?').all(req.user.id).map(row=>[row.setting_key,row.setting_value]));ok(res,{organizationName:values.organizationName||'Campus Events',currency:values.currency||'INR',notificationEmail:values.notificationEmail||''})});
settingsRouter.put('/',(req,res)=>{const input=parse(z.object({organizationName:z.string().trim().min(1).max(120),currency:z.enum(['INR','USD']),notificationEmail:z.string().email().max(254).or(z.literal(''))}),req.body),save=db.prepare('INSERT INTO workspace_settings(user_id,setting_key,setting_value,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at'),t=now();for(const [key,value] of Object.entries(input))save.run(req.user.id,key,value,t);ok(res,input)});

export const activityRouter=Router();activityRouter.use(authenticate);
activityRouter.get('/',(req,res)=>{const rows=req.user.role==='ADMIN'?db.prepare(`SELECT a.*,u.name user FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 30`).all():db.prepare(`SELECT a.*,u.name user FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.user_id=? ORDER BY a.created_at DESC LIMIT 30`).all(req.user.id);ok(res,{items:rows.map(x=>({id:x.id,action:x.action,detail:x.detail,type:x.type,user:x.user||'System',at:x.created_at,read:Boolean(x.read)}))})});
activityRouter.post('/',(req,res)=>{const body=req.body||{},id=randomUUID(),t=new Date().toISOString();db.prepare('INSERT INTO activity(id,user_id,action,detail,type,created_at) VALUES(?,?,?,?,?,?)').run(id,req.user.id,String(body.action||'Activity recorded').slice(0,180),String(body.detail||'').slice(0,500),'system',t);ok(res,{id,action:String(body.action||'Activity recorded'),detail:String(body.detail||''),type:'system',user:req.user.name,at:t,read:false},201)});
activityRouter.patch('/read',(req,res)=>{if(req.user.role==='ADMIN')db.prepare('UPDATE activity SET read=1').run();else db.prepare('UPDATE activity SET read=1 WHERE user_id=?').run(req.user.id);ok(res,{ok:true})});
