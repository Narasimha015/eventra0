import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, now } from '../db.js';
import { asyncRoute, HttpError, ok, parse, recordActivity } from '../http.js';
import { authenticate, allowRoles } from '../middleware.js';

export const vendorsRouter=Router();vendorsRouter.use(authenticate,allowRoles('ADMIN','ORGANIZER'));
const schema=z.object({name:z.string().trim().min(2).max(180),category:z.string().trim().min(2).max(80),contactName:z.string().max(120).optional(),email:z.string().email().max(254).or(z.literal('')).optional(),phone:z.string().max(40).optional(),budget:z.string().max(120).optional(),status:z.enum(['Pending','Confirmed','Cancelled']).optional()});
const dto=r=>({id:r.id,name:r.name,category:r.category,contactName:r.contact_name,email:r.email,phone:r.phone,budget:r.budget,status:r.status,organizerId:r.organizer_id,createdAt:r.created_at,updatedAt:r.updated_at});
const visible=(req,id)=>{const row=db.prepare('SELECT * FROM vendors WHERE id=?').get(id);if(!row||(req.user.role==='ORGANIZER'&&row.organizer_id!==req.user.id))throw new HttpError(404,'NOT_FOUND','Vendor not found');return row};
vendorsRouter.get('/',(req,res)=>ok(res,(req.user.role==='ADMIN'?db.prepare('SELECT * FROM vendors ORDER BY name').all():db.prepare('SELECT * FROM vendors WHERE organizer_id=? ORDER BY name').all(req.user.id)).map(dto)));
vendorsRouter.post('/',asyncRoute(async(req,res)=>{const v=parse(schema,req.body),id=randomUUID(),t=now();db.prepare(`INSERT INTO vendors(id,organizer_id,name,category,contact_name,email,phone,budget,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,req.user.role==='ORGANIZER'?req.user.id:null,v.name,v.category,v.contactName||'',v.email||'',v.phone||'',v.budget||'',v.status||'Pending',t,t);recordActivity(req.user,'Created vendor',v.name,'success');ok(res,dto(db.prepare('SELECT * FROM vendors WHERE id=?').get(id)),201)}));
vendorsRouter.get('/:id',(req,res)=>ok(res,dto(visible(req,req.params.id))));
vendorsRouter.patch('/:id',asyncRoute(async(req,res)=>{const old=visible(req,req.params.id),v=parse(schema.partial(),req.body),next={...old,name:v.name??old.name,category:v.category??old.category,contact_name:v.contactName??old.contact_name,email:v.email??old.email,phone:v.phone??old.phone,budget:v.budget??old.budget,status:v.status??old.status,updated_at:now()};db.prepare('UPDATE vendors SET name=@name,category=@category,contact_name=@contact_name,email=@email,phone=@phone,budget=@budget,status=@status,updated_at=@updated_at WHERE id=@id').run({...next,id:old.id});ok(res,dto(db.prepare('SELECT * FROM vendors WHERE id=?').get(old.id)))}));
vendorsRouter.delete('/:id',asyncRoute(async(req,res)=>{const old=visible(req,req.params.id);db.prepare('DELETE FROM vendors WHERE id=?').run(old.id);recordActivity(req.user,'Deleted vendor',old.name,'danger');ok(res,{id:old.id})}));
